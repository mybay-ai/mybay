import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { createBackup, MAX_SUPPORTED_SCHEMA_VERSION } from './mybay-ops.mjs';
import { activateRecovery, pathMapper, planRecovery, prepareRecovery, publicPlan, rollbackRecovery, previewAdoption, prepareAdoption, adoptRecovery, verifyAdoption, revertAdoption } from './mybay-service-recovery.mjs';
import { composeIdentity, composeManifest } from './recovery-compose.mjs';

const roots:string[]=[];
afterEach(()=>{for(const root of roots.splice(0))fs.rmSync(root,{recursive:true,force:true});});
const clone=<T>(value:T):T=>JSON.parse(JSON.stringify(value));
const id=()=>crypto.randomBytes(32).toString('hex');
const normalized=(value:string)=>value.replaceAll('\\','/');
async function fixture(instanceFields: Record<string, unknown> = {}) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'mybay-service-recovery-'));roots.push(root);
  const source=path.join(root,'source'),backup=path.join(root,'backup'),output=path.join(root,'recovered');
  fs.mkdirSync(source);const instanceId=crypto.randomUUID(),agentId=id(),controlId=id(),helperId=id(),image='sha256:'+id(),networkId=id();
  const key=crypto.randomBytes(32),iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',key,iv);
  const encrypted=Buffer.concat([cipher.update('synthetic-provider-secret'),cipher.final()]);
  const secret=[iv.toString('hex'),cipher.getAuthTag().toString('hex'),encrypted.toString('hex')].join(':');
  // Match createInstance.handler: runtime/channel live in serialized config_json,
  // not top-level instance fields. All transition tests use this real row shape.
  const instance={id:instanceId,container_id:agentId,config_json:JSON.stringify({runtime_type:'hermes',channel:'web',provider:'deepseek',model:'synthetic',providerCredentialId:'cred'}),...instanceFields};
  const database=path.join(source,'mybay.sqlite');
  const db=new DatabaseSync(database);
  db.exec('CREATE TABLE localMetadata(key TEXT PRIMARY KEY,value TEXT); CREATE TABLE instances(id TEXT PRIMARY KEY,data TEXT); CREATE TABLE credentials(id TEXT PRIMARY KEY,data TEXT); CREATE TABLE chatRuns(id TEXT PRIMARY KEY,data TEXT);');
  db.prepare('INSERT INTO localMetadata VALUES (?,?)').run('schema_version',String(MAX_SUPPORTED_SCHEMA_VERSION));
  db.prepare('INSERT INTO instances VALUES (?,?)').run(instanceId,JSON.stringify(instance));
  db.prepare('INSERT INTO credentials VALUES (?,?)').run('cred',JSON.stringify({id:'cred',key:secret}));db.close();
  fs.mkdirSync(path.join(source,'instances',instanceId),{recursive:true});fs.writeFileSync(path.join(source,'instances',instanceId,'file.html'),'PRESERVED');
  const snapshots=new Map<string,any>();const calls:any[]=[];
  const make=(containerId:string,name:string,mountSource:string,destination:string,controller=false)=>({
    Id:containerId,Name:'/'+name,Image:image,State:{Running:false,Restarting:false,Paused:false},
    Config:{Hostname:containerId.slice(0,12),Env:controller?['DEPLOYMENT_MODE=desktop','PROXY_MODE=local','MYBAY_CONTROL_PANEL_CONTAINER=test-control','ENCRYPTION_KEY='+key.toString('hex')]:['SYNTHETIC_SECRET=never-log-this'],Labels:{'com.docker.compose.project':'fixture'},Cmd:['node','fixture.mjs']},
    HostConfig:{NetworkMode:'fixture-net',RestartPolicy:{Name:'unless-stopped'},Binds:[normalized(mountSource)+':'+destination+':rw'],PortBindings:{'3000/tcp':[{HostIp:'127.0.0.1',HostPort:controller?'3347':'12470'}]}},
    Mounts:[{Type:'bind',Source:normalized(mountSource),Destination:destination,RW:true}],
    NetworkSettings:{Networks:{'fixture-net':{NetworkID:networkId,Aliases:[name],IPAMConfig:null}}},
  });
  snapshots.set(agentId,make(agentId,'mybay-agent-'+instanceId,path.join(source,'instances',instanceId),'/opt/data'));
  snapshots.set(controlId,make(controlId,'test-control',source,'/app/data',true));
  const helper={Id:helperId,Mounts:[{Type:'bind',Source:normalized(root),Destination:root,RW:true}]};
  let failCreate=0, failStart=0;
  const docker:any={
    listContainers:async()=>[...snapshots.values()].map(s=>({Id:s.Id,Mounts:clone(s.Mounts)})),
    getImage:()=>({inspect:async()=>({Id:image})}),
    getNetwork:()=>({inspect:async()=>({Name:'fixture-net',Id:networkId,Driver:'bridge',Ingress:false})}),
    getContainer:(reference:string)=>{
      const lookup=()=>{const value=snapshots.get(reference)||[...snapshots.values()].find(s=>s.Name==='/'+reference);if(!value)throw Object.assign(new Error('missing'),{statusCode:404});return value;};
      return {
        inspect:async()=>clone(lookup()),
        rename:async({name}:any)=>{const s=lookup();if([...snapshots.values()].some(other=>other.Id!==s.Id&&other.Name==='/'+name))throw new Error('name collision');calls.push(['rename',s.Id,name]);s.Name='/'+name;},
        start:async()=>{const s=lookup();calls.push(['start',s.Id]);if(++failStart===99)throw new Error('synthetic start failure');s.State.Running=true;},
        stop:async()=>{const s=lookup();calls.push(['stop',s.Id]);s.State.Running=false;},
        update:async(options:any)=>{const s=lookup();calls.push(['update',s.Id]);Object.assign(s.HostConfig,clone(options));},
      };
    },
    createContainer:async(options:any)=>{
      calls.push(['create',options.name]);if(++failCreate===99)throw new Error('synthetic create failure');
      const createdId=id(),s:any=make(createdId,options.name,'unused','/opt/data');
      s.Config={...clone(options),Hostname:createdId.slice(0,12)};
      delete s.Config.name;delete s.Config.HostConfig;delete s.Config.NetworkingConfig;delete s.Config.Image;
      s.HostConfig=clone(options.HostConfig);s.HostConfig.RestartPolicy.MaximumRetryCount??=0;s.Mounts=options.HostConfig.Binds.map((bind:string)=>{const match=bind.match(/^(.*):(\/[^:]+):(rw|ro)$/)!;return {Type:'bind',Source:match[1],Destination:match[2],RW:match[3]==='rw'};});
      s.NetworkSettings={Networks:Object.fromEntries(Object.entries(options.NetworkingConfig.EndpointsConfig).map(([n,value]:any)=>[n,{NetworkID:networkId,Aliases:value.Aliases,IPAMConfig:null}]))};
      snapshots.set(createdId,s);return {id:createdId,inspect:async()=>clone(s)};
    },
  };
  await createBackup({database,output:backup});
  const options={controller:'test-control',backup,output};
  const plan=()=>planRecovery(docker,helper,options);
  const prepare=async()=>prepareRecovery(docker,helper,{...options,confirm:(await plan()).confirmation});
  const stateOptions=(confirmation:string)=>({state:path.join(output,'service-recovery.json'),confirm:confirmation});
  return {root,source,backup,output,database,instanceId,agentId,controlId,helper,docker,snapshots,calls,options,plan,prepare,stateOptions,secret,key,failNextCreate:()=>{failCreate=98;},failSecondStart:()=>{failStart=97;}};
}
function alter(file:string,sql:string,...params:any[]) {const db=new DatabaseSync(file);try{db.prepare(sql).run(...params);}finally{db.close();}}

async function adoptionFixture() {
  const f=await fixture(),prepared=await f.prepare(),opts=f.stateOptions(prepared.confirmation);
  await activateRecovery(f.docker,f.helper,opts);
  for(const c of prepared.containers)f.snapshots.get(c.id).State.Running=false;
  const plan=await previewAdoption(f.docker,f.helper,opts);
  const prepare=()=>prepareAdoption(f.docker,f.helper,{...opts,'adopt-confirm':plan.adoptionConfirmation});
  const create=()=>{const s=clone(f.snapshots.get(prepared.containers.at(-1)!.id));s.Id=id();s.Name='/test-control';s.HostConfig.RestartPolicy={Name:'unless-stopped',MaximumRetryCount:0};s.Config.Labels['com.docker.compose.project']=plan.project;s.Config.Labels['com.docker.compose.service']='controller';f.snapshots.set(s.Id,s);return s;};
  return {...f,prepared,opts,adoptionPlan:plan,prepareAdoption:prepare,composeCreate:create};
}

describe('durable Compose recovery adoption',()=>{
  it('equates absent port bindings but preserves every real port and publication setting',async()=>{
    const f=await fixture(),original=clone(f.snapshots.get(f.controlId));
    original.HostConfig.PortBindings=null;
    const recreated=clone(original);recreated.HostConfig.PortBindings={};
    expect(composeIdentity(recreated)).toEqual(composeIdentity(original));
    for(const hostIp of ['127.0.0.1','0.0.0.0']) {
      recreated.HostConfig.PortBindings={'3000/tcp':[{HostIp:hostIp,HostPort:'3347'}]};
      expect(composeIdentity(recreated)).not.toEqual(composeIdentity(original));
    }
    recreated.HostConfig.PortBindings={};recreated.HostConfig.PublishAllPorts=true;
    expect(composeIdentity(recreated)).not.toEqual(composeIdentity(original));
  });
  it('keeps reviewed adoption confirmation stable when Docker reorders inspected mounts',async()=>{
    const f=await fixture(),source=f.snapshots.get(f.controlId);
    source.Mounts.push({Type:'bind',Source:'/var/run/docker.sock',Destination:'/var/run/docker.sock',RW:true});
    source.HostConfig.Binds.push('/var/run/docker.sock:/var/run/docker.sock:rw');
    const prepared=await f.prepare(),opts=f.stateOptions(prepared.confirmation);
    await activateRecovery(f.docker,f.helper,opts);
    for(const c of prepared.containers)f.snapshots.get(c.id).State.Running=false;
    const reviewed=await previewAdoption(f.docker,f.helper,opts);
    f.snapshots.get(prepared.containers.at(-1)!.id).Mounts.reverse();
    const repeated=await previewAdoption(f.docker,f.helper,opts);
    expect(repeated.manifestHash).toBe(reviewed.manifestHash);
    expect(repeated.adoptionConfirmation).toBe(reviewed.adoptionConfirmation);
    expect((await prepareAdoption(f.docker,f.helper,{...opts,'adopt-confirm':reviewed.adoptionConfirmation})).phase).toBe('adoption-prepared');
  });
  it('exports only after a reviewed digest, preserves secrets literally and leaves all writers stopped',async()=>{
    const f=await adoptionFixture(),before=f.calls.length;
    expect(JSON.stringify(f.adoptionPlan)).not.toContain(f.key.toString('hex'));
    expect(fs.existsSync(path.join(f.output,'compose-adoption'))).toBe(false);
    await expect(prepareAdoption(f.docker,f.helper,{...f.opts,'adopt-confirm':'bad'})).rejects.toThrow(/confirmation/);
    expect(f.calls.length).toBe(before);
    const prepared=await f.prepareAdoption();expect(prepared.phase).toBe('adoption-prepared');
    const manifest=JSON.parse(fs.readFileSync(path.join(f.output,'compose-adoption/compose.json'),'utf8'));
    expect(manifest.services.controller.restart).toBe('unless-stopped');expect(manifest.services.controller.pull_policy).toBe('never');
    expect(manifest.services.controller.volumes[0]).toContain('/recovered/data');
    expect([...f.snapshots.values()].every(s=>!s.State.Running)).toBe(true);
    const info=clone(f.snapshots.get(f.prepared.containers.at(-1)!.id));info.Config.Env.push('LITERAL=$a${B}$$end');
    expect(composeManifest(info,'project','control').services.controller.environment.LITERAL).toBe('$$a$${B}$$$$end');
  });
  it('adopts app-managed Agents and a Compose controller, verifies recreation and reverses safely',async()=>{
    const f=await adoptionFixture();await f.prepareAdoption();const candidate=f.composeCreate();
    const result=await adoptRecovery(f.docker,f.helper,f.opts);expect(result.phase).toBe('adopted');
    expect(f.snapshots.get(f.prepared.containers[0].id).HostConfig.RestartPolicy.Name).toBe('unless-stopped');
    candidate.State.Running=true;f.snapshots.get(f.prepared.containers[0].id).State.Running=true;
    expect((await verifyAdoption(f.docker,f.helper,f.opts)).running).toBe(true);
    await expect(rollbackRecovery(f.docker,f.helper,f.opts)).rejects.toThrow(/adopt-rollback/);
    await expect(revertAdoption(f.docker,f.helper,f.opts)).rejects.toThrow(/Stop/);
    const replacement=clone(candidate);replacement.Id=id();f.snapshots.delete(candidate.Id);f.snapshots.set(replacement.Id,replacement);
    expect((await verifyAdoption(f.docker,f.helper,f.opts)).controllerId).toBe(replacement.Id);
    replacement.State.Running=false;f.snapshots.get(f.prepared.containers[0].id).State.Running=false;
    expect((await revertAdoption(f.docker,f.helper,f.opts)).phase).toBe('adoption-rolled-back');
    expect((await rollbackRecovery(f.docker,f.helper,f.opts)).phase).toBe('rolled-back');
    expect(f.snapshots.has(replacement.Id)).toBe(true);
  });
  it.each(['environment','mount','security','image','ownership','restart'])('refuses changed Compose %s before policy changes',async kind=>{
    const f=await adoptionFixture();await f.prepareAdoption();const c=f.composeCreate(),count=f.calls.length;
    if(kind==='environment')c.Config.Env.push('BAD=1');if(kind==='mount')c.Mounts[0].Source='/wrong';if(kind==='security')c.HostConfig.Privileged=true;
    if(kind==='image')c.Image='sha256:'+id();if(kind==='ownership')c.Config.Labels['com.docker.compose.project']='wrong';if(kind==='restart')c.HostConfig.RestartPolicy.Name='always';
    await expect(adoptRecovery(f.docker,f.helper,f.opts)).rejects.toThrow();expect(f.calls.length).toBe(count);
  });
  it('rejects a running writer and pending work before exporting Compose',async()=>{
    const f=await adoptionFixture();f.snapshots.get(f.prepared.containers[0].id).State.Running=true;
    await expect(previewAdoption(f.docker,f.helper,f.opts)).rejects.toThrow(/Stop/);
    f.snapshots.get(f.prepared.containers[0].id).State.Running=false;
    alter(path.join(f.output,'data/mybay.sqlite'),'INSERT INTO chatRuns VALUES (?,?)','pending',JSON.stringify({status:'running'}));
    await expect(previewAdoption(f.docker,f.helper,f.opts)).rejects.toThrow(/outstanding/);
  });
  it('rejects modified Compose files and handoff database writes, retaining the stopped session',async()=>{
    const f=await adoptionFixture();await f.prepareAdoption();f.composeCreate();
    fs.appendFileSync(path.join(f.output,'compose-adoption/compose.json'),' ');
    await expect(adoptRecovery(f.docker,f.helper,f.opts)).rejects.toThrow(/file changed/);
    expect((await revertAdoption(f.docker,f.helper,f.opts)).phase).toBe('adoption-rolled-back');
    const g=await adoptionFixture();await g.prepareAdoption();g.composeCreate();
    alter(path.join(g.output,'data/mybay.sqlite'),'INSERT INTO chatRuns VALUES (?,?)','new',JSON.stringify({status:'completed'}));
    await expect(adoptRecovery(g.docker,g.helper,g.opts)).rejects.toThrow(/database changed/);
  });
  it('returns to the session if Compose creation never happened',async()=>{
    const f=await adoptionFixture();await f.prepareAdoption();
    await expect(adoptRecovery(f.docker,f.helper,f.opts)).rejects.toThrow(/missing/);
    await revertAdoption(f.docker,f.helper,f.opts);
    expect((await rollbackRecovery(f.docker,f.helper,f.opts)).phase).toBe('rolled-back');
  });
  it('normalizes an absent/empty extra-host list without accepting real DNS changes',async()=>{
    const f=await adoptionFixture();await f.prepareAdoption();const c=f.composeCreate();c.HostConfig.ExtraHosts=[];
    expect((await adoptRecovery(f.docker,f.helper,f.opts)).phase).toBe('adopted');
    c.HostConfig.ExtraHosts=['unexpected:127.0.0.1'];await expect(verifyAdoption(f.docker,f.helper,f.opts)).rejects.toThrow(/configuration/);
  });
  it.each([{}, {IPv4Address:'',IPv6Address:'',LinkLocalIPs:[]}])('accepts automatic Compose IPAM metadata %# but not static addresses',async ipam=>{
    const f=await adoptionFixture();await f.prepareAdoption();const c=f.composeCreate();c.NetworkSettings.Networks['fixture-net'].IPAMConfig=ipam;
    expect((await adoptRecovery(f.docker,f.helper,f.opts)).phase).toBe('adopted');
    c.NetworkSettings.Networks['fixture-net'].IPAMConfig={IPv4Address:'172.31.0.20'};
    await expect(verifyAdoption(f.docker,f.helper,f.opts)).rejects.toThrow(/Static network/);
  });
  it('refuses retained always-restarting containers before a durable handoff',async()=>{
    const f=await fixture();f.snapshots.get(f.agentId).HostConfig.RestartPolicy.Name='always';
    const p=await f.prepare(),opts=f.stateOptions(p.confirmation);await activateRecovery(f.docker,f.helper,opts);
    for(const c of p.containers)f.snapshots.get(c.id).State.Running=false;
    await expect(previewAdoption(f.docker,f.helper,opts)).rejects.toThrow(/auto-start/);
  });
  it('recovers a partially applied Agent policy update through the adoption journal',async()=>{
    const f=await adoptionFixture();await f.prepareAdoption();f.composeCreate();
    const original=f.docker.getContainer;let fail=true;
    f.docker.getContainer=(reference:string)=>{const c=original(reference);return {...c,update:async(options:any)=>{await c.update(options);if(fail){fail=false;throw new Error('synthetic interrupted update');}}};};
    await expect(adoptRecovery(f.docker,f.helper,f.opts)).rejects.toThrow(/interrupted/);
    expect(JSON.parse(fs.readFileSync(path.join(f.output,'service-recovery.json'),'utf8')).adoption.phase).toBe('adopting');
    expect((await revertAdoption(f.docker,f.helper,f.opts)).phase).toBe('adoption-rolled-back');
    expect((await rollbackRecovery(f.docker,f.helper,f.opts)).phase).toBe('rolled-back');
  });
});

describe('offline service recovery safety and transitions',()=>{
  it.each(['object','legacy-top-level'])('accepts explicit Hermes/Web metadata in %s records without changing config',async shape=>{
    const config={provider:'deepseek',model:'synthetic',providerCredentialId:'cred'};
    const fields=shape==='object'?{config_json:{...config,runtime_type:'hermes',channel:'web'}}:{runtime_type:'hermes',channel:'web',config_json:JSON.stringify(config)};
    const f=await fixture(fields),prepared=await f.prepare();
    const db=new DatabaseSync(path.join(f.output,'data/mybay.sqlite'),{readOnly:true});
    try{expect(JSON.parse(String(db.prepare('SELECT data FROM instances').get()!.data)).config_json).toEqual(fields.config_json);}finally{db.close();}
    expect(prepared.phase).toBe('prepared');
  });
  it.each([
    {config_json:'not-json'}, {config_json:'[]'}, {config_json:'null'}, {config_json:{}},
    {config_json:{runtime_type:'pi',channel:'web'}},
    {config_json:{runtime_type:'hermes',channel:'telegram'}},
    {runtime_type:'pi'}, {channel:'telegram'},
    {runtime_type:'hermes',channel:'web',config_json:{runtime_type:'pi',channel:'web'}},
    {runtime_type:'hermes',channel:'web',config_json:{runtime_type:'hermes',channel:'telegram'}},
  ])('rejects malformed, missing, unsupported or conflicting instance metadata %#',async fields=>{
    const f=await fixture(fields);await expect(f.plan()).rejects.toThrow(/instance configuration|web-channel Hermes/);
    expect(f.calls).toEqual([]);expect(fs.existsSync(f.output)).toBe(false);
  });
  it('previews without mutations or secrets; prepares new containers and atomically remaps only recovered IDs',async()=>{
    const f=await fixture(),before=fs.readFileSync(f.database),plan=await f.plan();
    const safe=JSON.stringify(publicPlan(plan));expect(safe).not.toContain(f.secret);expect(safe).not.toContain(f.key.toString('hex'));expect(safe).not.toContain('never-log-this');
    expect(f.calls).toEqual([]);expect(fs.existsSync(f.output)).toBe(false);
    const prepared=await f.prepare();expect(prepared.phase).toBe('prepared');expect(f.calls.every(c=>c[0]==='create')).toBe(true);
    expect(fs.readFileSync(f.database)).toEqual(before);
    const db=new DatabaseSync(path.join(f.output,'data/mybay.sqlite'),{readOnly:true});
    expect(JSON.parse(String(db.prepare('SELECT data FROM instances').get()!.data)).container_id).not.toBe(f.agentId);db.close();
    expect(fs.readFileSync(path.join(f.output,'data/instances',f.instanceId,'file.html'),'utf8')).toBe('PRESERVED');
    for(const s of [...f.snapshots.values()].slice(2)){expect(s.State.Running).toBe(false);expect(s.HostConfig.RestartPolicy.Name).toBe('no');expect(s.Config.Labels['com.docker.compose.project']).toBeUndefined();}
    expect(fs.readFileSync(path.join(f.output,'service-recovery.json'),'utf8')).not.toContain(f.key.toString('hex'));
  });
  it('requires exact confirmation before any restore or Docker mutation',async()=>{
    const f=await fixture();await expect(prepareRecovery(f.docker,f.helper,{...f.options,confirm:'wrong'})).rejects.toThrow(/Confirmation/);
    expect(fs.existsSync(f.output)).toBe(false);expect(f.calls).toEqual([]);
  });
  it.each(['controller','agent'])('refuses a running %s before preparation',async kind=>{
    const f=await fixture();f.snapshots.get(kind==='controller'?f.controlId:f.agentId).State.Running=true;
    await expect(f.plan()).rejects.toThrow(/Stop/);expect(f.calls).toEqual([]);
  });
  it('rejects foreign writers even when they only mount a parent directory',async()=>{
    const f=await fixture();const foreign=clone(f.snapshots.get(f.agentId));foreign.Id=id();foreign.Mounts[0].Source=normalized(f.root);f.snapshots.set(foreign.Id,foreign);
    await expect(f.plan()).rejects.toThrow(/Another container/);expect(f.calls).toEqual([]);
  });
  it.each(['mount','public-port','privileged','server','static-network'])('rejects unsupported %s configuration',async issue=>{
    const f=await fixture(),a=f.snapshots.get(f.agentId),c=f.snapshots.get(f.controlId);
    if(issue==='mount')a.Mounts[0].Source='/unrelated';
    if(issue==='public-port')a.HostConfig.PortBindings['3000/tcp'][0].HostIp='0.0.0.0';
    if(issue==='privileged')a.HostConfig.Privileged=true;
    if(issue==='server')c.Config.Env[0]='DEPLOYMENT_MODE=server';
    if(issue==='static-network')a.NetworkSettings.Networks['fixture-net'].IPAMConfig={IPv4Address:'10.0.0.1'};
    await expect(f.plan()).rejects.toThrow();expect(f.calls).toEqual([]);
  });
  it('rejects outstanding runs and mismatched instance inventories',async()=>{
    const f=await fixture();alter(f.database,'INSERT INTO chatRuns VALUES (?,?)','run',JSON.stringify({status:'running'}));
    await expect(f.plan()).rejects.toThrow(/outstanding/);
    alter(f.database,'DELETE FROM chatRuns');alter(f.database,'UPDATE instances SET data=?',JSON.stringify({id:f.instanceId,container_id:id(),runtime_type:'hermes',channel:'web',config_json:{}}));
    await expect(f.plan()).rejects.toThrow(/inventory/);
  });
  it('refuses credential changes, a wrong retained key and corrupted backups',async()=>{
    const f=await fixture();const c=f.snapshots.get(f.controlId);const env=[...c.Config.Env];c.Config.Env=env.map((e:string)=>e.startsWith('ENCRYPTION_KEY=')?'ENCRYPTION_KEY='+id():e);
    await expect(f.plan()).rejects.toThrow(/cannot decrypt/);c.Config.Env=env;
    alter(f.database,'UPDATE credentials SET data=?',JSON.stringify({id:'cred',key:'changed'}));await expect(f.plan()).rejects.toThrow(/Credentials changed/);
    fs.appendFileSync(path.join(f.backup,'data/mybay.sqlite'),'corrupt');await expect(f.plan()).rejects.toThrow(/checksum/);
  });
  it('rejects existing, nested and symlinked output without touching originals',async()=>{
    const f=await fixture();await expect(planRecovery(f.docker,f.helper,{...f.options,output:path.join(f.source,'nested')})).rejects.toThrow(/disjoint/);
    fs.mkdirSync(f.output);await expect(f.plan()).rejects.toThrow(/must not exist/);expect(f.calls).toEqual([]);
  });
  it('rejects a changed plan digest and retained container drift after prepare',async()=>{
    const f=await fixture(),plan=await f.plan();f.snapshots.get(f.controlId).Config.Env.push('EXTRA=changed');
    await expect(prepareRecovery(f.docker,f.helper,{...f.options,confirm:plan.confirmation})).rejects.toThrow(/Confirmation/);
    const prepared=await f.prepare();f.snapshots.get(f.agentId).HostConfig.Memory=123;
    await expect(activateRecovery(f.docker,f.helper,f.stateOptions(prepared.confirmation))).rejects.toThrow(/changed/);
    expect(f.calls.some(c=>c[0]==='start')).toBe(false);
  });
  it('activates in Agent/controller order, refuses live rollback and returns names without deleting data',async()=>{
    const f=await fixture(),prepared=await f.prepare(),opts=f.stateOptions(prepared.confirmation);
    const active=await activateRecovery(f.docker,f.helper,opts);expect(active.readiness).toBe('not-verified');
    expect(f.calls.filter(c=>c[0]==='start').map(c=>c[1])).toEqual(prepared.containers.map(c=>c.id));
    await expect(rollbackRecovery(f.docker,f.helper,opts)).rejects.toThrow(/Stop/);
    for(const c of prepared.containers)f.snapshots.get(c.id).State.Running=false;
    const rolled=await rollbackRecovery(f.docker,f.helper,opts);expect(rolled.phase).toBe('rolled-back');
    expect(f.snapshots.get(f.agentId).Name).toBe('/mybay-agent-'+f.instanceId);expect(f.snapshots.get(f.controlId).Name).toBe('/test-control');
    expect(f.snapshots.size).toBe(4);expect(fs.existsSync(path.join(f.output,'data/mybay.sqlite'))).toBe(true);
    expect((await rollbackRecovery(f.docker,f.helper,opts)).phase).toBe('rolled-back');
  });
  it('retains incomplete preparation and leaves originals unchanged after Docker create failure',async()=>{
    const f=await fixture();f.failNextCreate();await expect(f.prepare()).rejects.toThrow(/Preparation failed/);
    expect(f.snapshots.get(f.controlId).Name).toBe('/test-control');expect(f.snapshots.get(f.controlId).State.Running).toBe(false);
    expect(JSON.parse(fs.readFileSync(path.join(f.output,'service-recovery.json'),'utf8')).phase).toBe('prepare-failed');
  });
  it('stops only new containers and restores names after a partial activation failure',async()=>{
    const f=await fixture(),prepared=await f.prepare();f.failSecondStart();
    await expect(activateRecovery(f.docker,f.helper,f.stateOptions(prepared.confirmation))).rejects.toThrow(/activation-failed-stopped/);
    expect([...f.snapshots.values()].every(s=>!s.State.Running)).toBe(true);
    expect(f.snapshots.get(f.controlId).Name).toBe('/test-control');expect(f.calls.filter(c=>c[0]==='stop').every(c=>![f.controlId,f.agentId].includes(c[1]))).toBe(true);
  });
  it('refuses state tampering, prepared container changes and overlapping executions',async()=>{
    const f=await fixture(),prepared=await f.prepare(),opts=f.stateOptions(prepared.confirmation);
    f.snapshots.get(prepared.containers[0].id).Config.Env.push('CHANGED=yes');
    await expect(activateRecovery(f.docker,f.helper,opts)).rejects.toThrow(/configuration changed/);
    fs.writeFileSync(path.join(f.output,'.service-recovery.lock'),'another operation');
    await expect(activateRecovery(f.docker,f.helper,opts)).rejects.toThrow(/locked/);
    expect(f.calls.some(c=>c[0]==='start')).toBe(false);
  });
  it('maps Windows Docker host paths through the real helper bind mount',()=>{
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'mybay-path-map-'));roots.push(root);
    const mapper=pathMapper({Mounts:[{Type:'bind',Source:'G:\\MyBay Project',Destination:root,RW:true}]});
    expect(mapper.toHost(path.join(root,'recovered','data'))).toBe('G:/MyBay Project/recovered/data');
    expect(mapper.fromHost('G:/MyBay Project/data')).toBe(path.join(root,'data'));
    expect(()=>mapper.fromHost('G:/MyBay Project-other/data')).toThrow(/visible/);
  });
  it('normalizes Docker endpoint IDs, mount ordering and null-to-false OOM defaults across lifecycle transitions',async()=>{
    const f=await fixture();
    for(const s of f.snapshots.values()){s.NetworkSettings.Networks['fixture-net'].NetworkID='';s.HostConfig.OomKillDisable=null;}
    const prepared=await f.prepare();
    for(const s of f.snapshots.values()){s.Mounts.reverse();s.HostConfig.OomKillDisable=false;}
    const opts=f.stateOptions(prepared.confirmation);await activateRecovery(f.docker,f.helper,opts);
    for(const c of prepared.containers){const s=f.snapshots.get(c.id);s.State.Running=false;s.NetworkSettings.Networks['fixture-net'].NetworkID='';s.HostConfig.OomKillDisable=false;}
    expect((await rollbackRecovery(f.docker,f.helper,opts)).phase).toBe('rolled-back');
  });
  it('rejects modified prepared files before renaming or starting containers',async()=>{
    const f=await fixture(),prepared=await f.prepare();fs.writeFileSync(path.join(f.output,'data/instances',f.instanceId,'file.html'),'CHANGED');
    await expect(activateRecovery(f.docker,f.helper,f.stateOptions(prepared.confirmation))).rejects.toThrow(/files changed/);
    expect(f.calls.every(c=>c[0]==='create')).toBe(true);
  });
  it('rejects unexpected prepared files and source database drift',async()=>{
    const f=await fixture(),prepared=await f.prepare();fs.writeFileSync(path.join(f.output,'data','unexpected.env'),'synthetic');
    await expect(activateRecovery(f.docker,f.helper,f.stateOptions(prepared.confirmation))).rejects.toThrow(/unexpected file/);
    alter(f.database,'INSERT INTO chatRuns VALUES (?,?)','new',JSON.stringify({status:'completed'}));
    await expect(rollbackRecovery(f.docker,f.helper,f.stateOptions(prepared.confirmation))).rejects.toThrow(/database changed/);
  });
  it('refuses a network recreated under the original name',async()=>{
    const f=await fixture(),prepared=await f.prepare();f.docker.getNetwork=()=>({inspect:async()=>({Id:id(),Name:'fixture-net',Driver:'bridge'})});
    await expect(activateRecovery(f.docker,f.helper,f.stateOptions(prepared.confirmation))).rejects.toThrow(/network was replaced/);
  });
  it.runIf(process.platform!=='win32')('rejects symlinked output ancestors',async()=>{
    const f=await fixture();fs.symlinkSync(f.source,path.join(f.root,'linked'),'dir');
    await expect(planRecovery(f.docker,f.helper,{...f.options,output:path.join(f.root,'linked','new')})).rejects.toThrow(/symbolic links/);
  });
  it.each(['tasks','scheduledJobs'])('refuses resumable %s work instead of replaying it on activation',async table=>{
    const f=await fixture(),db=new DatabaseSync(f.database);
    db.exec(`CREATE TABLE ${table}(id TEXT PRIMARY KEY,data TEXT)`);db.prepare(`INSERT INTO ${table} VALUES (?,?)`).run('pending',JSON.stringify(table==='tasks'?{status:'queued'}:{is_active:true}));db.close();
    await expect(f.plan()).rejects.toThrow(table==='tasks'?/outstanding/:/Pause scheduled/);expect(f.calls).toEqual([]);
  });
});
