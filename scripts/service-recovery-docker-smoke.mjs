import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { execFileSync } from "node:child_process";
import Docker from "dockerode";
import { createBackup } from "./mybay-ops.mjs";
import { pathMapper } from "./mybay-service-recovery.mjs";

// Opt-in, synthetic fixtures only. It creates its own containers/network and
// never reads business databases, calls providers or removes host data.
assert.equal(process.env.MYBAY_SERVICE_RECOVERY_SMOKE,"1");
assert.equal(process.platform,"linux");
const docker=new Docker({socketPath:"/var/run/docker.sock"});
const helper=await docker.getContainer(os.hostname()).inspect();
const root=fs.mkdtempSync("/recovery/service-smoke-");
const hostRoot=pathMapper(helper).toHost(root);
const source=path.join(root,"source/data"),backup=path.join(root,"backup"),output=path.join(root,"recovered");
const cohort=crypto.randomUUID(),instanceId=crypto.randomUUID();
const controllerName="mybay-recovery-smoke-"+cohort,agentName="mybay-agent-"+instanceId,networkName="mybay-recovery-smoke-"+cohort;
const label="io.mybay.recovery-smoke";
const owned=new Set();
const password=crypto.randomBytes(24).toString("base64url"),key=crypto.randomBytes(32);
const conversationId=crypto.randomUUID(),messageId=crypto.randomUUID();
let originalAgent,originalController,network;
let preparedSnapshots=[];
const marker="SYNTHETIC-SERVICE-RECOVERY-OK";
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const cli=(command,options)=>JSON.parse(execFileSync(process.execPath,["/app/scripts/mybay-service-recovery.mjs",command,...Object.entries(options).flatMap(([key,value])=>["--"+key,value])],{env:{...process.env,MYBAY_SERVICE_RECOVERY:"1"},encoding:"utf8",stdio:["ignore","pipe","pipe"]}));
async function execNode(containerId,code) {
  const exec=await docker.getContainer(containerId).exec({Cmd:["node","--no-warnings","-e",code],AttachStdout:true,AttachStderr:true});
  const stream=await exec.start({hijack:true,stdin:false});
  const chunks=[];for await(const chunk of stream)chunks.push(chunk);
  const raw=Buffer.concat(chunks);let offset=0,text="";
  while(offset+8<=raw.length){const size=raw.readUInt32BE(offset+4);text+=raw.subarray(offset+8,offset+8+size).toString();offset+=8+size;}
  assert.equal((await exec.inspect()).ExitCode,0,"Synthetic container probe failed.");
  return JSON.parse(text);
}
async function ready(containerId) {
  for(let i=0;i<100;i++) {
    const info=await docker.getContainer(containerId).inspect();assert.equal(info.State.Running,true,"Synthetic controller exited.");
    try {if(await execNode(containerId,"fetch('http://127.0.0.1:3000/api/health',{signal:AbortSignal.timeout(700)}).then(r=>console.log(JSON.stringify(r.ok))).catch(()=>console.log('false'))"))return;}
    catch { /* bounded cold-start readiness probe */ }
    await pause(200);
  }
  throw new Error("Synthetic controller readiness timed out.");
}
async function verifyApplication(controlId,agentId) {
  await ready(controlId);
  const code=`(async()=>{
    const assert=require('node:assert/strict');const base='http://127.0.0.1:3000';
    const login=await fetch(base+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'recovery-smoke-admin',password:${JSON.stringify(password)}})});assert.equal(login.status,200);
    const cookie=login.headers.get('set-cookie').split(';')[0];
    const messages=await fetch(base+'/api/instances/${instanceId}/conversations/${conversationId}/messages',{headers:{Cookie:cookie}});assert.equal(messages.status,200);assert.ok(JSON.stringify(await messages.json()).includes('Synthetic history survives'));
    const file=await fetch(base+'/api/instances/${instanceId}/files/download?path=report.html',{headers:{Cookie:cookie}});assert.equal(file.status,200);assert.equal(await file.text(),${JSON.stringify(marker)});
    console.log(JSON.stringify({login:true,history:true,download:true}));
  })().catch(()=>process.exit(1));`;
  const result=await execNode(controlId,code);
  assert.deepEqual(result,{login:true,history:true,download:true});
  const file=await execNode(agentId,"console.log(JSON.stringify(require('node:fs').readFileSync('/opt/data/report.html','utf8')))");assert.equal(file,marker);
  return result;
}
try {
  fs.mkdirSync(path.join(source,"instances",instanceId),{recursive:true});
  fs.writeFileSync(path.join(source,"instances",instanceId,"report.html"),marker);
  network=await docker.createNetwork({Name:networkName,Labels:{[label]:cohort},Driver:"bridge"});
  const labels={[label]:cohort};
  originalAgent=await docker.createContainer({name:agentName,Image:helper.Image,Labels:labels,Cmd:["node","-e","require('node:http').createServer((q,r)=>r.end('synthetic')).listen(8642,'0.0.0.0')"],HostConfig:{Binds:[`${hostRoot}/source/data/instances/${instanceId}:/opt/data:rw`],NetworkMode:networkName,RestartPolicy:{Name:"no"}},NetworkingConfig:{EndpointsConfig:{[networkName]:{Aliases:[agentName]}}}});owned.add(originalAgent.id);
  const env={NODE_ENV:"production",PORT:"3000",DEPLOYMENT_MODE:"desktop",PROXY_MODE:"local",LOCAL_ADMIN_USERNAME:"recovery-smoke-admin",LOCAL_ADMIN_PASSWORD:password,ENCRYPTION_KEY:key.toString("hex"),JWT_SECRET:crypto.randomBytes(32).toString("hex"),MYBAY_INTERNAL_ROUTING_SECRET:crypto.randomBytes(32).toString("hex"),MYBAY_CONTROL_PANEL_CONTAINER:controllerName,MYBAY_DOCKER_GC_ENABLED:"false",ENABLE_LOCAL_WORKER:"false",PUBLIC_APP_URL:"http://127.0.0.1:3000"};
  originalController=await docker.createContainer({name:controllerName,Image:helper.Image,Labels:labels,Env:Object.entries(env).map(([k,v])=>`${k}=${v}`),HostConfig:{Binds:[`${hostRoot}/source/data:/app/data:rw`,"/var/run/docker.sock:/var/run/docker.sock"],NetworkMode:networkName,RestartPolicy:{Name:"no"}},NetworkingConfig:{EndpointsConfig:{[networkName]:{Aliases:[controllerName]}}}});owned.add(originalController.id);
  await originalController.start();await ready(originalController.id);await originalController.stop({t:15});
  const db=new DatabaseSync(path.join(source,"mybay.sqlite"));
  try {
    const put=(table,row)=>db.prepare(`INSERT INTO ${table}(id,data) VALUES (?,?)`).run(row.id,JSON.stringify(row));
    const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv("aes-256-gcm",key,iv);const encrypted=Buffer.concat([cipher.update("synthetic-no-real-provider-key"),cipher.final()]);
    put("credentials",{id:"smoke-credential",name:"synthetic",type:"deepseek",key:[iv.toString("hex"),cipher.getAuthTag().toString("hex"),encrypted.toString("hex")].join(":"),user_id:"local-admin"});
    put("instances",{id:instanceId,name:"Synthetic recovery fixture",container_id:originalAgent.id,status:"running",owner_id:"local-admin",user_id:"local-admin",config_json:JSON.stringify({runtime_type:"hermes",channel:"web",provider:"deepseek",model:"synthetic",providerCredentialId:"smoke-credential"})});
    put("conversations",{id:conversationId,instance_id:instanceId,user_id:"local-admin",title:"Synthetic recovery",created_at:new Date().toISOString()});
    put("chatMessages",{id:messageId,conversation_id:conversationId,instance_id:instanceId,user_id:"local-admin",role:"assistant",content:"Synthetic history survives",created_at:new Date().toISOString(),sequence_no:1});
  } finally {db.close();}
  await createBackup({database:path.join(source,"mybay.sqlite"),output:backup});
  const sourceHash=crypto.createHash("sha256").update(fs.readFileSync(path.join(source,"mybay.sqlite"))).digest("hex");
  const options={controller:controllerName,backup,output};
  const plan=cli("plan",options);
  assert.ok(!JSON.stringify(plan).includes(password));
  const prepared=cli("prepare",{...options,confirm:plan.confirmation});
  for(const c of prepared.containers)owned.add(c.id);
  preparedSnapshots=await Promise.all(prepared.containers.map(c=>docker.getContainer(c.id).inspect()));
  assert.equal(sourceHash,crypto.createHash("sha256").update(fs.readFileSync(path.join(source,"mybay.sqlite"))).digest("hex"));
  const transition={state:prepared.stateFile,confirm:prepared.confirmation};
  cli("activate",transition);
  const after=await verifyApplication(prepared.containers.at(-1).id,prepared.containers[0].id);
  assert.throws(()=>cli("rollback",transition),/Stop/);
  for(const c of [...prepared.containers].reverse())await docker.getContainer(c.id).stop({t:15});
  const rollback=cli("rollback",transition);assert.equal(rollback.phase,"rolled-back");
  await originalAgent.start();await originalController.start();
  const before=await verifyApplication(originalController.id,originalAgent.id);
  console.log(JSON.stringify({ok:true,preparedContainers:prepared.containers.length,sourceDatabaseUntouchedDuringPreparation:true,restored:after,rollback:before,fixture:"synthetic Agent, real production controller; no provider calls",retainedSyntheticData:root}));
} catch(error) {
  const clean=value=>String(value || "").replaceAll(password,"[redacted]").replace(/[a-f0-9]{64}/gi,"[digest-redacted]");
  console.error(JSON.stringify({error:clean(error.message),cause:clean(error.cause?.message)}));
  const changedPaths=(a,b,prefix="")=>{
    if(JSON.stringify(a)===JSON.stringify(b))return [];
    if(a && b && typeof a === "object" && typeof b === "object")return [...new Set([...Object.keys(a),...Object.keys(b)])].flatMap(k=>changedPaths(a[k],b[k],prefix+"."+k));
    return [prefix];
  };
  for(const before of preparedSnapshots) {
    const after=await docker.getContainer(before.Id).inspect();
    console.error(JSON.stringify({fixtureContainer:before.Name,changedFields:["Config","HostConfig","Mounts","NetworkSettings"].flatMap(k=>changedPaths(before[k],after[k],k)).slice(0,50)}));
  }
  process.exitCode=1;
} finally {
  // Include a newly created fixture whose ID was not journaled before failure.
  const candidates=await docker.listContainers({all:true,filters:JSON.stringify({label:[`${label}=${cohort}`]})});
  for(const c of candidates)owned.add(c.Id);
  for(const containerId of [...owned].reverse()) {
    const c=docker.getContainer(containerId),info=await c.inspect();assert.equal(info.Config.Labels[label],cohort);
    if(info.State.Running)await c.stop({t:15});await c.remove();
  }
  if(network){const info=await network.inspect();assert.equal(info.Labels[label],cohort);assert.equal(Object.keys(info.Containers || {}).length,0);await network.remove();}
}
