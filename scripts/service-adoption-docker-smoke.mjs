import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import Docker from 'dockerode';
import { composeIdentity } from './recovery-compose.mjs';

// Host-only driver for actual Compose. New synthetic data only, no provider
// calls, no business mounts; every Docker mutation is restricted to this cohort.
assert.equal(process.env.MYBAY_ADOPTION_SMOKE,'1');
assert.ok(process.env.MYBAY_ADOPTION_SMOKE_ROOT,'Set a dedicated synthetic fixture root');
assert.ok(process.platform !== 'linux' || process.getuid() === 0,'Run this maintenance smoke as root on Linux; private helper-created Compose files are root-owned');
const docker=new Docker({socketPath:process.platform === 'win32'?'//./pipe/docker_engine':'/var/run/docker.sock'});
const root=fs.mkdtempSync(path.join(path.resolve(process.env.MYBAY_ADOPTION_SMOKE_ROOT),'adoption-'));
const hostRoot=root.replaceAll('\\','/'),cohort=crypto.randomUUID(),instance=crypto.randomUUID();
const label='io.mybay.adoption-smoke',networkName='mybay-adoption-test-'+cohort,controller='mybay-adoption-test-'+cohort,agent='mybay-agent-'+instance;
const owned=new Set(),key=crypto.randomBytes(32).toString('hex'),password=crypto.randomBytes(24).toString('base64url');
const image=(await docker.getImage(process.env.MYBAY_ADOPTION_SMOKE_IMAGE || 'mybay-local:adoption-candidate').inspect()).Id;
const marker='SYNTHETIC-COMPOSE-ADOPTION-OK';
const run=(args,extraEnv={})=>execFileSync('docker',args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],env:{...process.env,...extraEnv}});
const helper=(script,args,socket=false,extraEnv={})=>JSON.parse(run(['run','--rm','--network','none',...(socket?['-e','MYBAY_SERVICE_RECOVERY=1','--mount','type=bind,source=/var/run/docker.sock,target=/var/run/docker.sock']:[]),...Object.keys(extraEnv).flatMap(k=>['-e',k]),'--mount',`type=bind,source=${hostRoot},target=/recovery`,image,'node',script,...args],extraEnv));
const cli=(cmd,opts)=>helper('scripts/mybay-service-recovery.mjs',[cmd,...Object.entries(opts).flatMap(([k,v])=>['--'+k,v])],true);
const probe=(id,code)=>JSON.parse(run(['exec',id,'node','--no-warnings','-e',code]));
async function ready(id){for(let i=0;i<80;i++){try{if(probe(id,"fetch('http://127.0.0.1:3000/api/health',{signal:AbortSignal.timeout(500)}).then(r=>console.log(JSON.stringify(r.ok))).catch(()=>console.log(false))"))return;}catch{/* cold start */}await new Promise(r=>setTimeout(r,250));}throw new Error('Fixture readiness timeout');}
async function stop(id){const c=docker.getContainer(id);if((await c.inspect()).State.Running)await c.stop({t:15});}
async function inspectIfPresent(id){try{return await docker.getContainer(id).inspect();}catch(e){if(e.statusCode===404)return null;throw e;}}
async function verify(id){await ready(id);return probe(id,`(async()=>{const assert=require('node:assert/strict');const base='http://127.0.0.1:3000';const r=await fetch(base+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'adoption-admin',password:process.env.LOCAL_ADMIN_PASSWORD})});assert.equal(r.status,200);const cookie=r.headers.get('set-cookie').split(';')[0];const file=await fetch(base+'/api/instances/${instance}/files/download?path=report.html',{headers:{Cookie:cookie}});assert.equal(file.status,200);assert.equal(await file.text(),${JSON.stringify(marker)});const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync('/app/data/mybay.sqlite',{readOnly:true});assert.ok(db.prepare('SELECT data FROM chatMessages').all().some(x=>JSON.parse(x.data).content==='Synthetic retained history'));db.close();console.log(JSON.stringify({login:true,history:true,download:true}));})().catch(()=>process.exit(1));`);}
let network,sourceController,sourceAgent,composeArgs,prepared,expectedController,adoptionSummary,transitionOptions,stage='setup';
try{
  fs.mkdirSync(path.join(root,'source/data'),{recursive:true});
  network=await docker.createNetwork({Name:networkName,Driver:'bridge',Labels:{[label]:cohort}});
  sourceAgent=await docker.createContainer({name:agent,Image:image,Labels:{[label]:cohort},Cmd:['node','-e',"require('node:http').createServer((q,r)=>r.end('synthetic')).listen(8642,'0.0.0.0')"],HostConfig:{Binds:[`${hostRoot}/source/data/instances/${instance}:/opt/data:rw`],NetworkMode:networkName,RestartPolicy:{Name:'unless-stopped'}},NetworkingConfig:{EndpointsConfig:{[networkName]:{Aliases:[agent]}}}});owned.add(sourceAgent.id);
  const env={NODE_ENV:'production',PORT:'3000',DEPLOYMENT_MODE:'desktop',PROXY_MODE:'local',LOCAL_ADMIN_USERNAME:'adoption-admin',LOCAL_ADMIN_PASSWORD:password,ENCRYPTION_KEY:key,JWT_SECRET:crypto.randomBytes(32).toString('hex'),MYBAY_INTERNAL_ROUTING_SECRET:crypto.randomBytes(32).toString('hex'),MYBAY_CONTROL_PANEL_CONTAINER:controller,MYBAY_DOCKER_GC_ENABLED:'false',ENABLE_LOCAL_WORKER:'false',PUBLIC_APP_URL:'http://127.0.0.1:3000',SYNTHETIC_LITERAL:'literal $var ${DO_NOT_EXPAND} $$ "quotes"'};
  sourceController=await docker.createContainer({name:controller,Image:image,Labels:{[label]:cohort},Env:Object.entries(env).map(([k,v])=>k+'='+v),HostConfig:{Binds:[`${hostRoot}/source/data:/app/data:rw`,'/var/run/docker.sock:/var/run/docker.sock:rw'],NetworkMode:networkName,RestartPolicy:{Name:'unless-stopped'},Dns:['1.1.1.1'],Memory:536870912,SecurityOpt:['no-new-privileges:true']},NetworkingConfig:{EndpointsConfig:{[networkName]:{Aliases:[controller]}}}});owned.add(sourceController.id);
  await sourceController.start();await ready(sourceController.id);await stop(sourceController.id);
  const seed=`const fs=require('node:fs'),crypto=require('node:crypto'),{DatabaseSync}=require('node:sqlite');const d=new DatabaseSync('/recovery/source/data/mybay.sqlite');const put=(t,r)=>d.prepare('INSERT INTO '+t+'(id,data) VALUES (?,?)').run(r.id,JSON.stringify(r));const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',Buffer.from(process.env.FIXTURE_KEY,'hex'),iv),ct=Buffer.concat([cipher.update('synthetic-only'),cipher.final()]);put('credentials',{id:'fixture',key:[iv.toString('hex'),cipher.getAuthTag().toString('hex'),ct.toString('hex')].join(':')});put('instances',{id:'${instance}',name:'Synthetic Compose fixture',container_id:'${sourceAgent.id}',status:'running',user_id:'local-admin',config_json:JSON.stringify({runtime_type:'hermes',channel:'web',provider:'deepseek',model:'synthetic',providerCredentialId:'fixture'})});put('conversations',{id:'conversation',instance_id:'${instance}',user_id:'local-admin',title:'Retained history'});put('chatMessages',{id:'message',conversation_id:'conversation',instance_id:'${instance}',user_id:'local-admin',role:'assistant',content:'Synthetic retained history',sequence_no:1});d.close();fs.writeFileSync('/recovery/source/data/instances/${instance}/report.html',${JSON.stringify(marker)});console.log('{}');`;
  helper('-e',[seed],false,{FIXTURE_KEY:key});
  helper('scripts/mybay-ops.mjs',['backup','--database','/recovery/source/data/mybay.sqlite','--output','/recovery/backup','--json']);
  const opts={controller,backup:'/recovery/backup',output:'/recovery/recovered'},plan=cli('plan',opts);
  prepared=cli('prepare',{...opts,confirm:plan.confirmation});prepared.containers.forEach(c=>owned.add(c.id));
  const transition={state:prepared.stateFile,confirm:plan.confirmation};transitionOptions=transition;cli('activate',transition);
  await verify(prepared.containers.at(-1).id);
  for(const c of [...prepared.containers].reverse())await stop(c.id);
  stage='adopt-plan';expectedController=await docker.getContainer(prepared.containers.at(-1).id).inspect();
  const adoption=cli('adopt-plan',transition);adoptionSummary=adoption;assert.equal(adoption.agents.length,1);
  const preparedAdoption=cli('adopt-prepare',{...transition,'adopt-confirm':adoption.adoptionConfirmation});
  assert.equal(path.resolve(preparedAdoption.composeFile),path.join(root,'recovered/compose-adoption/compose.json'));
  composeArgs=['compose','--project-name',preparedAdoption.project,'--file',preparedAdoption.composeFile];
  stage='compose-create';run([...composeArgs,'create','--no-build','--pull','never','controller']);
  let composed=await docker.getContainer(controller).inspect();owned.add(composed.Id);
  assert.equal(composed.Config.Labels[label],cohort);assert.equal(composed.State.Running,false);
  stage='adopt';assert.equal(cli('adopt',transition).phase,'adopted');
  await docker.getContainer(prepared.containers[0].id).start();run([...composeArgs,'up','-d','--no-build','--pull','never','--no-recreate','controller']);
  stage='verify-adoption';const adopted=await verify(composed.Id);assert.equal(cli('adopt-verify',transition).running,true);
  assert.equal(composed.Config.Env.find(e=>e.startsWith('SYNTHETIC_LITERAL=')),'SYNTHETIC_LITERAL='+env.SYNTHETIC_LITERAL);
  // Actual Compose restart, then recreation (not only docker start). No source
  // container or data is removed; only this uniquely labelled composed copy.
  stage='compose-restart';run([...composeArgs,'restart','controller']);await verify(composed.Id);
  await docker.getContainer(prepared.containers[0].id).restart({t:10});await verify(composed.Id);
  stage='compose-recreate';run([...composeArgs,'up','-d','--no-build','--pull','never','--force-recreate','controller']);
  const recreated=await docker.getContainer(controller).inspect();owned.delete(composed.Id);owned.add(recreated.Id);assert.notEqual(recreated.Id,composed.Id);composed=recreated;
  const afterRecreate=await verify(composed.Id);assert.equal(cli('adopt-verify',transition).controllerId,composed.Id);
  assert.equal((await docker.getContainer(sourceController.id).inspect()).State.Running,false);
  await stop(composed.Id);await stop(prepared.containers[0].id);
  stage='rollback';assert.equal(cli('adopt-rollback',transition).phase,'adoption-rolled-back');assert.equal(cli('rollback',transition).phase,'rolled-back');
  await sourceAgent.start();await sourceController.start();const rolledBack=await verify(sourceController.id);
  console.log(JSON.stringify({ok:true,adopted,composeRestart:true,agentRestart:true,composeRecreated:afterRecreate,literalEnvironmentPreserved:true,rollback:rolledBack,fixture:'Synthetic Agent, real production controller and host Compose; no provider calls',retainedSyntheticData:root}));
}catch(e){
  // Raw Compose errors/config can include environment values. Keep only a safe
  // error class here; diagnostic field paths can be inspected locally if needed.
  console.error(JSON.stringify({ok:false,stage,error:e.code || e.name,status:e.status || e.statusCode || null,notice:'Fixture retained for diagnosis until scoped cleanup; no raw secret-bearing command output printed.'}));
  // The recovery CLI sanitizes Docker exceptions itself. At this exact stage
  // its final stderr line is a static validation message, not Compose output.
  if(stage==='adopt' && e.stderr)console.error(String(e.stderr).trim().split('\n').at(-1));
  if(stage==='adopt-plan' && adoptionSummary){try{const now=cli('adopt-plan',transitionOptions);console.error(JSON.stringify({changedPlanFields:Object.keys(now).filter(k=>JSON.stringify(now[k])!==JSON.stringify(adoptionSummary[k]))}));}catch{/* preserve original failure */}}
  if(e.stderr)console.error(String(e.stderr).split('\n').filter(line=>/^(Compose (controller|network) |Recovered (Agent|database) |Container data |Retained |Private Compose |Recovery |Invalid |Adoption |Only |Stop |Finish|Another container|Source data|A dedicated|Extra mounts|The retained)/.test(line)).join('\n'));
  if(expectedController){try{const current=await docker.getContainer(controller).inspect();const fields=(a,b,p='')=>JSON.stringify(a)===JSON.stringify(b)?[]:a&&b&&typeof a==='object'&&typeof b==='object'?[...new Set([...Object.keys(a),...Object.keys(b)])].flatMap(k=>fields(a[k],b[k],p+'.'+k)):[p];console.error(JSON.stringify({changedFieldPaths:fields(composeIdentity(expectedController),composeIdentity(current))}));}catch{/* container not created yet */}}
  process.exitCode=1;
}finally{
  const candidates=await docker.listContainers({all:true,filters:JSON.stringify({label:[label+'='+cohort]})});candidates.forEach(c=>owned.add(c.Id));
  for(const id of owned){const info=await inspectIfPresent(id);if(!info)continue;assert.equal(info.Config.Labels[label],cohort);assert.ok(info.Mounts.filter(m=>m.Destination==='/app/data'||m.Destination==='/opt/data').every(m=>m.Source.replaceAll('\\','/').startsWith(hostRoot+'/')));await stop(id);await docker.getContainer(id).remove();}
  if(network){assert.equal(Object.keys((await network.inspect()).Containers || {}).length,0);await network.remove();}
}
