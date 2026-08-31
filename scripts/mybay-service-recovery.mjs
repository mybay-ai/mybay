import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import Docker from "dockerode";
import { MAX_SUPPORTED_SCHEMA_VERSION, restoreBackup, verifyBackup } from "./mybay-ops.mjs";
import { composeIdentity, composeManifest } from "./recovery-compose.mjs";

// Deliberately offline, same-engine, same-image and desktop-only. This tool
// never deletes data/containers, pulls images, changes secrets or upgrades DBs.
const STATE_FILE = "service-recovery.json";
const OWNER_LABEL = "io.mybay.service-recovery";
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const ID = /^[a-f0-9]{64}$/;
const terminal = new Set(["completed", "success", "failed", "cancelled"]);
function requireThat(condition, message) { if (!condition) throw new Error(message); }
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]));
  return value;
}
const digest = value => crypto.createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
const fileHash = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const hostPath = value => path.posix.normalize(value.replaceAll("\\", "/"));
function hostWithin(root, target) {
  let a = hostPath(root), b = hostPath(target);
  if (/^[A-Za-z]:\//.test(a)) { a = a.toLowerCase(); b = b.toLowerCase(); }
  return b === a || b.startsWith(a.replace(/\/$/, "") + "/");
}
function overlap(a, b) { return hostWithin(a, b) || hostWithin(b, a); }
function noLinks(target) {
  const absolute = path.resolve(target), parsed = path.parse(absolute);
  let current = parsed.root;
  for (const part of absolute.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    requireThat(!fs.lstatSync(current, { throwIfNoEntry: false })?.isSymbolicLink(), "Recovery paths must not traverse symbolic links.");
  }
  return absolute;
}
export function pathMapper(helper) {
  const mounts = helper.Mounts.filter(m => m.Type === "bind" && m.Destination !== "/var/run/docker.sock" && m.Destination !== "/");
  return {
    toHost(local) {
      const absolute = noLinks(local);
      const mount = mounts.filter(m => hostWithin(m.Destination, absolute)).sort((a,b) => b.Destination.length-a.Destination.length)[0];
      requireThat(mount?.RW, "Recovery paths require a writable, explicitly mounted host directory.");
      return hostPath(path.posix.join(hostPath(mount.Source), path.relative(mount.Destination, absolute).replaceAll("\\", "/")));
    },
    fromHost(host) {
      const mount = mounts.filter(m => hostWithin(m.Source, host)).sort((a,b) => b.Source.length-a.Source.length)[0];
      requireThat(mount?.RW, "Source data must be visible through the helper's writable host bind mount.");
      return noLinks(path.join(mount.Destination, hostPath(host).slice(hostPath(mount.Source).length)));
    },
  };
}
function envOf(info) {
  return Object.fromEntries((info.Config.Env || []).map(value => { const i=value.indexOf("="); return [value.slice(0,i),value.slice(i+1)]; }));
}
function networksOf(info) {
  return Object.entries(info.NetworkSettings.Networks).map(([name, n]) => {
    const ipam=n.IPAMConfig;
    const automatic=!ipam || (typeof ipam === 'object' && !Array.isArray(ipam)
      && Object.keys(ipam).every(k=>['IPv4Address','IPv6Address','LinkLocalIPs'].includes(k))
      && !ipam.IPv4Address && !ipam.IPv6Address && !ipam.LinkLocalIPs?.length);
    requireThat(automatic && !n.Links?.length, "Static network addresses and legacy links are not supported.");
    return { name, id:n.NetworkID, aliases:(n.Aliases || []).filter(a => a !== info.Id && a !== info.Id.slice(0,12)).sort() };
  }).sort((a,b) => a.name.localeCompare(b.name));
}
function identity(info) {
  const config = { ...info.Config }; delete config.Hostname; delete config.Domainname;
  // Docker materializes null as false on first start; true remains a real,
  // security-relevant configuration change and must still invalidate the plan.
  const host={...info.HostConfig,OomKillDisable:info.HostConfig.OomKillDisable === true};
  // Endpoint NetworkID can appear/disappear across start/stop. The network's
  // immutable ID is separately pinned in the plan; hash only stable intent here.
  return digest({ image:info.Image, config, host, mounts:info.Mounts.map(m => ({type:m.Type,source:hostPath(m.Source),destination:m.Destination,rw:m.RW})).sort((a,b)=>a.destination.localeCompare(b.destination)), networks:networksOf(info).map(({name,aliases})=>({name,aliases})) });
}
function stopped(info) {
  requireThat(!info.State.Running && !info.State.Restarting && !info.State.Paused, `Stop the selected writer first: ${info.Name}`);
}
function supportedContainer(info, destination, expectedSource, controller=false) {
  requireThat(ID.test(info.Id) && /^sha256:[a-f0-9]{64}$/.test(info.Image), "Container IDs and pinned local image IDs are required.");
  const h = info.HostConfig;
  requireThat(!h.AutoRemove && !h.Privileged && !h.Mounts?.length && !h.VolumesFrom?.length && !h.Links?.length && !h.Devices?.length && !h.DeviceRequests?.length, "Unsupported container privilege, mount or lifecycle configuration.");
  requireThat(!["host","none","default","bridge"].includes(h.NetworkMode) && !String(h.NetworkMode).startsWith("container:"), "A dedicated bridge network is required.");
  requireThat(!h.PidMode && !h.IpcMode?.startsWith("container:") && h.IpcMode !== "host", "Shared host/container namespaces are not supported.");
  const data = info.Mounts.find(m => m.Destination === destination);
  requireThat(data?.Type === "bind" && data.RW && hostPath(data.Source) === hostPath(expectedSource), "Container data mount does not match the selected recovery cohort.");
  requireThat(info.Mounts.every(m => m === data || (controller && m.Type === "bind" && m.Destination === "/var/run/docker.sock" && m.Source === "/var/run/docker.sock")), "Extra mounts require a separately reviewed recovery procedure.");
  requireThat((h.Binds || []).length === info.Mounts.length, "Only explicit bind mounts are supported.");
  for (const bindings of Object.values(h.PortBindings || {})) {
    requireThat(Array.isArray(bindings) && bindings.every(b => b.HostIp === "127.0.0.1" && /^\d+$/.test(b.HostPort)), "Only explicit desktop loopback port bindings are supported.");
  }
  requireThat(networksOf(info).length > 0, "Container network attachment is missing.");
}
function supportedInstance(instance) {
  let config=instance.config_json;
  if(typeof config === "string") {
    try {config=JSON.parse(config);} catch {throw new Error("Invalid instance configuration JSON.");}
  }
  requireThat(config && typeof config === "object" && !Array.isArray(config),"Invalid instance configuration object.");
  // Normal API-created rows persist these fields inside config_json. Keep the
  // original config unchanged for hashing/restoration, and reject disagreement
  // with any legacy top-level fields instead of silently choosing one value.
  const runtimes=[config.runtime_type,instance.runtime_type].filter(v=>v !== undefined);
  const channels=[config.channel,instance.channel].filter(v=>v !== undefined);
  return UUID.test(instance.id) && ID.test(instance.container_id)
    && runtimes.length > 0 && runtimes.every(v=>v === "hermes")
    && channels.length > 0 && channels.every(v=>v === "web");
}
function readStore(file) {
  noLinks(file); requireThat(fs.existsSync(file), "Recovery database is missing.");
  const db = new DatabaseSync(file, { readOnly:true });
  try {
    requireThat(db.prepare("PRAGMA integrity_check").get().integrity_check === "ok", "Database integrity check failed.");
    requireThat(Number(db.prepare("SELECT value FROM localMetadata WHERE key='schema_version'").get()?.value) === MAX_SUPPORTED_SCHEMA_VERSION, "Service recovery requires the current exact schema; migrations are not supported.");
    const has = table => !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table);
    const rows = table => has(table) ? db.prepare(`SELECT data FROM ${table} ORDER BY id`).all().map(row => JSON.parse(row.data)) : [];
    for (const table of ["chatRuns", "deploymentTasks", "tasks"]) {
      requireThat(rows(table).every(row => terminal.has(row.status)), "Finish/cancel outstanding chat, deployment and task-runner work before taking a recovery point.");
    }
    requireThat(rows("scheduledJobs").every(row=>row.is_active === false),"Pause scheduled jobs before taking a recovery point; activation must not silently replay scheduled model work.");
    for (const table of ["deploymentTasksCore", "cleanupTasks", "scheduledFires"]) {
      if (has(table)) {
        const columns=db.prepare(`PRAGMA table_info(${table})`).all().map(c=>c.name);
        const statuses=columns.includes("status") ? db.prepare(`SELECT status FROM ${table}`).all() : rows(table);
        requireThat(statuses.every(row => terminal.has(row.status) || row.status === "skipped"), "Recovery point contains unfinished background work.");
      }
    }
    const instances=rows("instances");
    requireThat(instances.length > 0 && instances.length <= 64, "Recovery requires 1-64 retained instances.");
    requireThat(instances.every(supportedInstance), "Only retained web-channel Hermes instances with exact container IDs are supported.");
    return { instances, credentials:rows("credentials") };
  } finally { db.close(); }
}
function checkSecrets(store, key) {
  requireThat(/^[a-f0-9]{64}$/i.test(key || ""), "The retained controller encryption key is missing or invalid.");
  for (const row of store.credentials) {
    const value=row.key || row.encrypted_value || row.key_encrypted;
    requireThat(typeof value === "string" && /^[a-f0-9]{24}:[a-f0-9]{32}:[a-f0-9]+$/i.test(value), "Encrypted credential format is unsupported.");
    try {
      const [iv,tag,data]=value.split(":"); const decipher=crypto.createDecipheriv("aes-256-gcm",Buffer.from(key,"hex"),Buffer.from(iv,"hex"));
      decipher.setAuthTag(Buffer.from(tag,"hex")); decipher.update(Buffer.from(data,"hex")); decipher.final();
    } catch { throw new Error("The retained encryption key cannot decrypt the backup credentials."); }
  }
}
async function assertNoForeignMounts(docker, roots, allowedIds) {
  for (const entry of await docker.listContainers({all:true})) {
    if (allowedIds.includes(entry.Id)) continue;
    // Inspect mounts only, not unrelated container environments.
    requireThat(!(entry.Mounts || []).some(m => m.Type === "bind" && roots.some(root => overlap(root,m.Source))), "Another container mounts the recovery data tree; isolate or stop/remove that dependency separately.");
  }
}
async function networksPresent(docker, snapshots) {
  const ids={};
  for (const snapshot of snapshots) for (const network of networksOf(snapshot)) {
    // Docker can clear endpoint NetworkID while a container is stopped or has
    // never started. Resolve its configured name and pin the actual network ID.
    const actual=await docker.getNetwork(network.name).inspect();
    requireThat(actual.Name === network.name && (!network.id || actual.Id === network.id) && actual.Driver === "bridge" && !actual.Ingress, "Network changed or is not a local bridge.");
    ids[network.name]=actual.Id;
  }
  return ids;
}
export async function planRecovery(docker, helper, options) {
  requireThat(options.controller && options.backup && options.output, "--controller, --backup and --output are required.");
  const mapper=pathMapper(helper), backup=noLinks(options.backup), output=noLinks(options.output);
  const outputHost=mapper.toHost(output), backupHost=mapper.toHost(backup);
  requireThat(!fs.lstatSync(output,{throwIfNoEntry:false}), "Recovery output must not exist.");
  const controller=await docker.getContainer(options.controller).inspect(); stopped(controller);
  requireThat(controller.Id !== helper.Id, "Run recovery from a separate helper, never from the selected controller.");
  const sourceHost=controller.Mounts.find(m=>m.Destination === "/app/data")?.Source;
  requireThat(sourceHost, "Controller /app/data bind mount is required.");
  supportedContainer(controller,"/app/data",sourceHost,true);
  requireThat(!overlap(outputHost,sourceHost) && !overlap(backupHost,sourceHost) && !overlap(outputHost,backupHost), "Source, backup and recovery output must be disjoint trees.");
  const env=envOf(controller), controllerName=controller.Name.slice(1);
  requireThat((env.DEPLOYMENT_MODE || "desktop") === "desktop" && (env.PROXY_MODE || "local") === "local", "Only desktop/local Docker deployments are supported.");
  requireThat((env.MYBAY_CONTROL_PANEL_CONTAINER || "mybay-local-control-panel") === controllerName, "Controller name does not match MYBAY_CONTROL_PANEL_CONTAINER.");
  requireThat(!env.LOCAL_STORE_PATH && (!env.MYBAY_SQLITE_PATH || ["data/mybay.sqlite","/app/data/mybay.sqlite"].includes(env.MYBAY_SQLITE_PATH)), "Custom database paths are not supported.");
  // Reject any active writer in the source tree before opening its SQLite WAL.
  const containers=await docker.listContainers({all:true});
  for (const c of containers.filter(c=>(c.Mounts || []).some(m=>m.Type === "bind" && overlap(sourceHost,m.Source)))) {
    if (c.Id !== helper.Id) stopped(await docker.getContainer(c.Id).inspect());
  }
  const source=mapper.fromHost(sourceHost), sourceStore=readStore(path.join(source,"mybay.sqlite"));
  const verified=verifyBackup({backup});
  const saved=readStore(path.join(backup,"data/mybay.sqlite"));
  requireThat(digest(sourceStore.instances.map(i=>[i.id,i.container_id,i.config_json])) === digest(saved.instances.map(i=>[i.id,i.container_id,i.config_json])), "Backup instance inventory/configuration differs from the retained containers; use the matching recovery point.");
  requireThat(digest(sourceStore.credentials) === digest(saved.credentials), "Credentials changed since backup; use a matching recovery point.");
  checkSecrets(saved,env.ENCRYPTION_KEY);
  const snapshots=[];
  for (const instance of saved.instances) {
    const info=await docker.getContainer(instance.container_id).inspect(); stopped(info);
    requireThat(info.Name === `/mybay-agent-${instance.id}`, "Agent container name/ID mismatch.");
    supportedContainer(info,"/opt/data",path.posix.join(hostPath(sourceHost),"instances",instance.id));
    snapshots.push(info);
  }
  snapshots.push(controller);
  await assertNoForeignMounts(docker,[sourceHost,outputHost],[helper.Id,...snapshots.map(s=>s.Id)]);
  const networkIds=await networksPresent(docker,snapshots);
  for (const info of snapshots) await docker.getImage(info.Image).inspect();
  const members=snapshots.map((s,index)=>({sourceId:s.Id,name:s.Name.slice(1),image:s.Image,fingerprint:identity(s),instanceId:index < saved.instances.length ? saved.instances[index].id : null,networks:networksOf(s).map(n=>({...n,id:networkIds[n.name]}))}));
  const summary={formatVersion:1,controller:controllerName,source:hostPath(sourceHost),backup:backupHost,output:outputHost,manifestHash:fileHash(path.join(backup,"manifest.json")),configurationHash:digest(saved.instances.map(i=>[i.id,i.config_json])),credentialHash:digest(saved.credentials),sourceDatabaseHash:fileHash(path.join(source,"mybay.sqlite")),sourceWalHash:fs.existsSync(path.join(source,"mybay.sqlite-wal")) ? fileHash(path.join(source,"mybay.sqlite-wal")) : null,members};
  return { ...summary,confirmation:digest(summary),files:verified.files,local:{backup,output},snapshots };
}
export function publicPlan(plan) {
  const {snapshots,local,...safe}=plan;
  return {...safe,notice:"Offline same-image recovery only. No service is stopped or started by plan/prepare. Preserve the original containers and data."};
}
function writeState(output, state) {
  const target=path.join(output,STATE_FILE); noLinks(target);
  const temp=path.join(output,`.service-recovery-${crypto.randomUUID()}.json`);
  fs.writeFileSync(temp,JSON.stringify(state,null,2)+"\n",{flag:"wx",mode:0o600});
  const fd=fs.openSync(temp,"r+"); try {fs.fsyncSync(fd);} finally {fs.closeSync(fd);}
  fs.renameSync(temp,target);
}
function cloneOptions(info, member, state) {
  const config={...info.Config}; delete config.Hostname; delete config.Domainname;
  // Compose must not adopt the newly provisioned recovery copy unexpectedly.
  config.Labels=Object.fromEntries(Object.entries(config.Labels || {}).filter(([k])=>!k.startsWith("com.docker.compose.")));
  config.Labels[OWNER_LABEL]=state.confirmation;
  const destination=member.instanceId ? "/opt/data" : "/app/data";
  const source=member.instanceId ? path.posix.join(state.output,"data/instances",member.instanceId) : path.posix.join(state.output,"data");
  const binds=info.Mounts.map(m=>`${m.Destination === destination ? source : m.Source}:${m.Destination}:${m.RW ? "rw" : "ro"}`);
  return {...config,name:member.preparedName,Image:info.Image,HostConfig:{...info.HostConfig,Binds:binds,RestartPolicy:{Name:"no"}},NetworkingConfig:{EndpointsConfig:Object.fromEntries(member.networks.map(n=>[n.name,{Aliases:n.aliases}]))}};
}
async function originalsUnchanged(docker,state) {
  for (const member of state.members) {
    const info=await docker.getContainer(member.sourceId).inspect(); stopped(info);
    requireThat(identity(info) === member.fingerprint, "Retained container configuration changed; refusing cutover.");
    requireThat([`/${member.name}`,`/${member.parkedName}`].includes(info.Name), "Retained container was renamed outside this recovery.");
    for(const network of member.networks) {
      const actual=await docker.getNetwork(network.name).inspect();
      requireThat(actual.Id === network.id && actual.Driver === "bridge","Recovery network was replaced after planning.");
    }
  }
}
export async function prepareRecovery(docker,helper,options) {
  const plan=await planRecovery(docker,helper,options);
  requireThat(options.confirm === plan.confirmation, "Confirmation mismatch; run plan again and review the exact cohort.");
  // No Docker mutation until the full backup has been restored and validated.
  restoreBackup({backup:plan.local.backup,output:plan.local.output});
  const releaseLock=acquireLock(plan.local.output,helper);
  const state={...publicPlan(plan),phase:"preparing",members:plan.members.map((m,index)=>({...m,parkedName:`mybay-retained-${plan.confirmation.slice(0,16)}-${index}`,preparedName:`mybay-recovered-${plan.confirmation.slice(0,16)}-${index}`,newId:null})),createdAt:new Date().toISOString()};
  let stage="journal";
  try {
    writeState(plan.local.output,state);
    stage="revalidate-originals";
    await originalsUnchanged(docker,state);
    for (let i=0;i<state.members.length;i++) {
      stage=`create-container-${i}`;
      const member=state.members[i];
      const created=await docker.createContainer(cloneOptions(plan.snapshots[i],member,state));
      member.newId=created.id;member.newFingerprint=identity(await created.inspect());writeState(plan.local.output,state);
    }
    stage="map-recovered-database";
    const db=new DatabaseSync(path.join(plan.local.output,"data/mybay.sqlite"));
    try {
      db.exec("BEGIN IMMEDIATE");
      for (const member of state.members.filter(m=>m.instanceId)) {
        const row=JSON.parse(db.prepare("SELECT data FROM instances WHERE id=?").get(member.instanceId).data);
        requireThat(row.container_id === member.sourceId,"Restored instance changed before container mapping.");
        row.container_id=member.newId;
        db.prepare("UPDATE instances SET data=? WHERE id=?").run(JSON.stringify(row),member.instanceId);
      }
      db.exec("COMMIT");
    } finally { db.close(); }
    state.preparedDatabaseHash=fileHash(path.join(plan.local.output,"data/mybay.sqlite"));
    state.phase="prepared";writeState(plan.local.output,state);
    return {ok:true,phase:state.phase,confirmation:state.confirmation,stateFile:path.join(plan.local.output,STATE_FILE),containers:state.members.map(m=>({name:m.preparedName,id:m.newId}))};
  } catch(error) {
    state.failure={stage,dockerStatus:error.statusCode || null};
    state.phase="prepare-failed";writeState(plan.local.output,state);
    throw new Error(`Preparation failed at ${stage}${error.statusCode ? ` (Docker HTTP ${error.statusCode})` : ""}; originals remain stopped and untouched. Partial data/containers are retained; inspect the state file before retrying into a new directory.`,{cause:error});
  } finally { releaseLock(); }
}
function readState(helper, options) {
  requireThat(options.state,"--state is required.");
  const file=noLinks(options.state),output=path.dirname(file);
  requireThat(path.basename(file) === STATE_FILE,"Expected a service-recovery.json state file.");
  const state=JSON.parse(fs.readFileSync(file,"utf8"));
  requireThat(state.formatVersion === 1 && ID.test(state.confirmation) && options.confirm === state.confirmation,"Invalid state or confirmation.");
  requireThat(state.output === pathMapper(helper).toHost(output),"Recovery state is not in its recorded output directory.");
  requireThat(!overlap(state.source,state.output) && Array.isArray(state.members) && state.members.length > 1 && state.members.length <= 65,"Invalid recovery cohort.");
  requireThat(new Set(state.members.flatMap(m=>[m.sourceId,m.newId].filter(Boolean))).size === state.members.flatMap(m=>[m.sourceId,m.newId].filter(Boolean)).length,"Duplicate container IDs in recovery state.");
  state.members.forEach((m,index)=>{
    requireThat(ID.test(m.sourceId) && ID.test(m.fingerprint) && (!m.newId || ID.test(m.newId)),"Invalid container identity in recovery state.");
    requireThat(m.parkedName === `mybay-retained-${state.confirmation.slice(0,16)}-${index}` && m.preparedName === `mybay-recovered-${state.confirmation.slice(0,16)}-${index}`,"Invalid recovery container name.");
    requireThat(index === state.members.length-1 ? m.instanceId === null && m.name === state.controller : UUID.test(m.instanceId) && m.name === `mybay-agent-${m.instanceId}`,"Invalid member role.");
  });
  return {state,output};
}
async function inspectNew(docker,state,member) {
  if (!member.newId) {
    // Reconcile a crash after Docker create but before its ID was journaled.
    try { member.newId=(await docker.getContainer(member.preparedName).inspect()).Id; }
    catch(error) { if(error.statusCode === 404)return null; throw error; }
  }
  const info=await docker.getContainer(member.newId).inspect();
  requireThat(info.Config.Labels?.[OWNER_LABEL] === state.confirmation && info.Image === member.image,"Recovery container ownership or image changed.");
  requireThat(!member.newFingerprint || identity(info) === member.newFingerprint,"Recovery container configuration changed.");
  const names=[`/${member.name}`,`/${member.preparedName}`];
  if(!member.instanceId && state.adoption && state.adoption.phase !== 'rolled-back')names.push('/'+adoptionNames(state).session);
  requireThat(names.includes(info.Name),"Recovery container name changed.");
  supportedContainer(info,member.instanceId ? "/opt/data" : "/app/data",member.instanceId ? path.posix.join(state.output,"data/instances",member.instanceId) : path.posix.join(state.output,"data"),!member.instanceId);
  return info;
}
async function preflightTransition(docker,helper,state,requirePrepared) {
  await originalsUnchanged(docker,state);
  const originalDb=path.join(pathMapper(helper).fromHost(state.source),"mybay.sqlite");
  requireThat(fileHash(originalDb) === state.sourceDatabaseHash && (fs.existsSync(originalDb+"-wal") ? fileHash(originalDb+"-wal") : null) === state.sourceWalHash,"Retained database changed after planning; review the recovery point before switching.");
  const fresh=[];
  for(const member of state.members) {
    const info=await inspectNew(docker,state,member);
    requireThat(!requirePrepared || info,"A prepared container is missing.");
    if(info) {stopped(info);fresh.push(info);}
  }
  const extra=[];
  if(state.adoption?.phase === 'rolled-back' && state.adoption.parkedId){const info=await docker.getContainer(state.adoption.parkedId).inspect();stopped(info);requireThat(info.Name === '/'+adoptionNames(state).parked && identity(info) === state.adoption.parkedFingerprint,'Retained Compose controller changed.');extra.push(info.Id);}
  await assertNoForeignMounts(docker,[state.source,path.posix.join(state.output,"data")],[helper.Id,...state.members.flatMap(m=>[m.sourceId,m.newId]).filter(Boolean),...extra]);
  await networksPresent(docker,fresh);
  return fresh;
}
async function returnNames(docker,state) {
  for (const m of [...state.members].reverse()) {
    const info=await inspectNew(docker,state,m);
    if(info) {stopped(info);if(info.Name !== `/${m.preparedName}`)await docker.getContainer(info.Id).rename({name:m.preparedName});}
  }
  for (const m of state.members) {
    const original=await docker.getContainer(m.sourceId).inspect();stopped(original);
    if(original.Name !== `/${m.name}`)await docker.getContainer(m.sourceId).rename({name:m.name});
  }
}
async function activateUnlocked(docker,helper,options) {
  const {state,output}=readState(helper,options);
  requireThat(state.phase === "prepared","Only a prepared recovery can be activated. Use rollback to reconcile an interrupted transition.");
  const fresh=await preflightTransition(docker,helper,state,true);
  const backup=pathMapper(helper).fromHost(state.backup);
  requireThat(fileHash(path.join(backup,"manifest.json")) === state.manifestHash,"Backup manifest changed after preparation.");
  verifyBackup({backup});
  const manifest=JSON.parse(fs.readFileSync(path.join(backup,"manifest.json"),"utf8"));
  const expected=new Set(manifest.files.map(entry=>entry.path.replaceAll("\\","/")));
  const checkFiles=(directory,relative="data")=>{
    for(const entry of fs.readdirSync(directory,{withFileTypes:true})) {
      const child=path.join(directory,entry.name),name=relative+"/"+entry.name;
      requireThat(!entry.isSymbolicLink(),"Prepared data contains a symbolic link.");
      if(entry.isDirectory())checkFiles(child,name);
      else requireThat(entry.isFile() && expected.has(name),"Prepared data contains an unexpected file or SQLite sidecar.");
    }
  };
  checkFiles(path.join(output,"data"));
  for(const entry of manifest.files) {
    const relative=entry.path.replaceAll("\\","/");
    const expectedHash=relative === "data/mybay.sqlite" ? state.preparedDatabaseHash : entry.sha256.toLowerCase();
    requireThat(fileHash(noLinks(path.join(output,relative))) === expectedHash,"Prepared recovery files changed before activation.");
  }
  // Bind files may have been changed since prepare; reject missing/mismapped IDs.
  const recovered=readStore(path.join(output,"data/mybay.sqlite"));
  requireThat(digest(recovered.instances.map(i=>[i.id,i.container_id])) === digest(state.members.filter(m=>m.instanceId).map(m=>[m.instanceId,m.newId]).sort((a,b)=>a[0].localeCompare(b[0]))),"Prepared database container mapping changed.");
  requireThat(digest(recovered.instances.map(i=>[i.id,i.config_json])) === state.configurationHash && digest(recovered.credentials) === state.credentialHash,"Prepared configuration/credentials changed.");
  state.phase="activating";writeState(output,state);
  try {
    for(const m of state.members)await docker.getContainer(m.sourceId).rename({name:m.parkedName});
    for(const m of state.members)await docker.getContainer(m.newId).rename({name:m.name});
    for(const m of state.members)await docker.getContainer(m.newId).start();
    state.phase="active";writeState(output,state);
    return {ok:true,phase:"active",readiness:"not-verified",notice:"Containers started. Verify controller login and Agent chat health before accepting recovery. Do not run Compose against the retained source configuration."};
  } catch {
    let reconciled=false;
    try {
      for(const info of [...fresh].reverse()) {const c=docker.getContainer(info.Id);if((await c.inspect()).State.Running)await c.stop({t:20});}
      await returnNames(docker,state);reconciled=true;
    } catch { /* Journal the partial transition; never delete evidence or guess. */ }
    state.phase=reconciled ? "activation-failed-stopped" : "reconciliation-required";writeState(output,state);
    throw new Error(`Activation failed (${state.phase}). No data was deleted. Review the state and use rollback; originals are not automatically restarted.`);
  }
}
async function rollbackUnlocked(docker,helper,options) {
  const {state,output}=readState(helper,options);
  requireThat(!state.adoption || state.adoption.phase === 'rolled-back','Use adopt-rollback to return from Compose before service rollback.');
  requireThat(["preparing","prepare-failed","prepared","activating","active","activation-failed-stopped","reconciliation-required","rolling-back","rolled-back"].includes(state.phase),"Unknown recovery phase.");
  // Intentionally refuse to stop active model work. Operator must stop ALL
  // restored writers before invoking rollback, just as for backup/cutover.
  await preflightTransition(docker,helper,state,false);
  state.phase="rolling-back";writeState(output,state);
  await returnNames(docker,state);
  state.phase="rolled-back";writeState(output,state);
  return {ok:true,phase:state.phase,notice:"Original container names and data bindings restored; all writers remain stopped. Start the listed original Agent containers, then the controller, after review. Post-backup writes stay in the recovered copy.",startInOrder:state.members.map(m=>m.name)};
}
function acquireLock(output,helper) {
  const lock=path.join(output,".service-recovery.lock");noLinks(lock);
  let fd;
  try {fd=fs.openSync(lock,"wx",0o600);} catch {throw new Error("Recovery state is locked. Do not remove the lock until the previous helper is confirmed stopped and its journal has been reviewed.");}
  try {fs.writeSync(fd,JSON.stringify({helper:helper.Id,startedAt:new Date().toISOString()}));fs.fsyncSync(fd);}
  catch(error) {fs.closeSync(fd);throw error;}
  return ()=>{fs.closeSync(fd);fs.unlinkSync(lock);};
}
async function withStateLock(helper,options,operation) {
  const {output}=readState(helper,options),releaseLock=acquireLock(output,helper);
  try {return await operation();} finally {releaseLock();}
}
export const activateRecovery=(docker,helper,options)=>withStateLock(helper,options,()=>activateUnlocked(docker,helper,options));
export const rollbackRecovery=(docker,helper,options)=>withStateLock(helper,options,()=>rollbackUnlocked(docker,helper,options));
function adoptionNames(state) {
  const prefix=state.confirmation.slice(0,16);
  return {project:'mybay-adopted-'+prefix,session:'mybay-session-'+prefix,parked:'mybay-compose-retained-'+prefix};
}
function adoptionFile(output){return path.join(output,'compose-adoption','compose.json');}
async function planAdoption(docker,helper,options) {
  const {state,output}=readState(helper,options);
  requireThat(state.phase === 'active' && !state.adoption,'Adoption requires an active recovery session with all writers stopped, and no prior adoption.');
  const snapshots=await preflightTransition(docker,helper,state,true);
  readStore(path.join(output,'data/mybay.sqlite'));
  for(const m of state.members){const info=await docker.getContainer(m.sourceId).inspect();requireThat(['no','unless-stopped'].includes(info.HostConfig.RestartPolicy.Name),'Retained containers must not auto-start after daemon restart; review their restart policy separately.');}
  const names=adoptionNames(state);
  requireThat(!(await docker.listContainers({all:true})).some(c=>c.Labels?.['com.docker.compose.project'] === names.project),'The dedicated Compose project already has containers.');
  requireThat(!fs.existsSync(path.dirname(adoptionFile(output))),'Compose adoption output already exists.');
  const controller=snapshots.at(-1),manifest=composeManifest(controller,names.project,state.controller);
  const summary={project:names.project,controller:state.controller,image:controller.Image,data:state.output+'/data',composeFile:state.output+'/compose-adoption/compose.json',manifestHash:digest(manifest),controllerHash:digest(composeIdentity(controller)),databaseHash:fileHash(path.join(output,'data/mybay.sqlite')),walHash:fs.existsSync(path.join(output,'data/mybay.sqlite-wal'))?fileHash(path.join(output,'data/mybay.sqlite-wal')):null,agents:state.members.filter(m=>m.instanceId).map(m=>({id:m.newId,name:m.name,restart:'unless-stopped'}))};
  return {summary:{...summary,adoptionConfirmation:digest(summary),notice:'Creates a private Compose file containing controller environment/secrets. Only the controller becomes Compose-owned; Agents remain app-managed. All writers remain stopped.'},state,output,manifest};
}
export const previewAdoption=async(docker,helper,options)=>(await planAdoption(docker,helper,options)).summary;
export const prepareAdoption=(docker,helper,options)=>withStateLock(helper,options,async()=>{
  const {summary,state,output,manifest}=await planAdoption(docker,helper,options);
  requireThat(options['adopt-confirm'] === summary.adoptionConfirmation,'Adoption confirmation mismatch; review adopt-plan first.');
  state.adoption={...summary,phase:'preparing'};writeState(output,state);
  fs.mkdirSync(path.dirname(adoptionFile(output)),{mode:0o700});
  fs.writeFileSync(adoptionFile(output),JSON.stringify(manifest,null,2)+'\n',{flag:'wx',mode:0o600});
  state.adoption.fileHash=fileHash(adoptionFile(output));writeState(output,state);
  await docker.getContainer(state.members.at(-1).newId).rename({name:adoptionNames(state).session});
  state.adoption.phase='prepared';writeState(output,state);
  return {ok:true,phase:'adoption-prepared',composeFile:summary.composeFile,project:summary.project,notice:'On the host, use this exact file/project with docker compose create --no-build --pull never controller. Do not start it yet. Then run adopt.'};
});
async function adoptionContext(docker,helper,options,{running=false,missing=false}={}) {
  const {state,output}=readState(helper,options),a=state.adoption,names=adoptionNames(state);
  requireThat(a && ['preparing','prepared','adopting','adopted','reverting'].includes(a.phase),'No pending/adopted Compose handoff.');
  requireThat(a.project === names.project && a.composeFile === state.output+'/compose-adoption/compose.json','Invalid adoption journal.');
  await originalsUnchanged(docker,state);
  const originalDb=path.join(pathMapper(helper).fromHost(state.source),'mybay.sqlite');
  requireThat(fileHash(originalDb) === state.sourceDatabaseHash && (fs.existsSync(originalDb+'-wal')?fileHash(originalDb+'-wal'):null) === state.sourceWalHash,'Retained database changed.');
  const snapshots=[];
  for(const m of state.members){
    const info=await docker.getContainer(m.newId).inspect();
    if(m.instanceId){const normalized=structuredClone(info);normalized.HostConfig.RestartPolicy={Name:'no',MaximumRetryCount:0};requireThat(identity(normalized) === m.newFingerprint && ['no','unless-stopped'].includes(info.HostConfig.RestartPolicy.Name),'Recovered Agent changed beyond the approved restart policy.');}
    else requireThat(identity(info) === m.newFingerprint && [names.session,state.controller].includes(info.Name.slice(1)),'Recovery-session controller changed.');
    requireThat(info.Config.Labels?.[OWNER_LABEL] === state.confirmation,'Recovery ownership changed.');
    if(!running || !m.instanceId)stopped(info);snapshots.push(info);
  }
  let candidate=null;
  try{candidate=await docker.getContainer(a.parkedId || state.controller).inspect();}catch(e){if(e.statusCode !== 404)throw e;}
  if(candidate?.Id === state.members.at(-1).newId)candidate=null;
  if(!candidate)requireThat(missing,'Compose controller is missing; run the reviewed compose create command first.');
  if(candidate){
    requireThat(!state.members.some(m=>[m.sourceId,m.newId].includes(candidate.Id)),'Compose controller overlaps retained identities.');
    requireThat(candidate.Config.Labels?.['com.docker.compose.project'] === names.project && candidate.Config.Labels?.['com.docker.compose.service'] === 'controller','Compose controller ownership mismatch.');
    requireThat(candidate.HostConfig.RestartPolicy.Name === 'unless-stopped','Compose controller restart policy must be unless-stopped.');
    requireThat(digest(composeIdentity(candidate)) === a.controllerHash,'Compose controller does not match the retained execution/security configuration. Do not start it.');
    supportedContainer(candidate,'/app/data',state.output+'/data',true);
    for(const [name,n] of Object.entries(candidate.NetworkSettings.Networks)){const old=snapshots.at(-1).NetworkSettings.Networks[name];const allowed=[...(old?.Aliases || []),state.controller,'controller',candidate.Id,candidate.Id.slice(0,12)];requireThat(old && (old.Aliases || []).every(alias=>(n.Aliases || []).includes(alias)) && (n.Aliases || []).every(alias=>allowed.includes(alias)),'Compose network aliases changed.');}
    if(!running)stopped(candidate);
  }
  await networksPresent(docker,[...snapshots,...(candidate?[candidate]:[])]);
  await assertNoForeignMounts(docker,[state.source,state.output+'/data'],[helper.Id,...state.members.flatMap(m=>[m.sourceId,m.newId]),...(candidate?[candidate.Id]:[])]);
  return {state,output,candidate,snapshots};
}
export const adoptRecovery=(docker,helper,options)=>withStateLock(helper,options,async()=>{
  const {state,output,candidate}=await adoptionContext(docker,helper,options),a=state.adoption;
  requireThat(['prepared','adopting'].includes(a.phase),'Adoption has already completed; use adopt-verify.');
  requireThat(fileHash(noLinks(adoptionFile(output))) === a.fileHash,'Private Compose file changed after preparation.');
  requireThat(fileHash(path.join(output,'data/mybay.sqlite')) === a.databaseHash && (fs.existsSync(path.join(output,'data/mybay.sqlite-wal'))?fileHash(path.join(output,'data/mybay.sqlite-wal')):null) === a.walHash,'Recovered database changed during handoff.');
  readStore(path.join(output,'data/mybay.sqlite'));
  a.phase='adopting';a.controllerId=candidate.Id;writeState(output,state);
  for(const m of state.members.filter(m=>m.instanceId))await docker.getContainer(m.newId).update({RestartPolicy:{Name:'unless-stopped',MaximumRetryCount:0}});
  a.phase='adopted';writeState(output,state);
  return {ok:true,phase:'adopted',readiness:'not-verified',composeFile:a.composeFile,project:a.project,startInOrder:[...state.members.filter(m=>m.instanceId).map(m=>m.name),state.controller],notice:'Start the listed Agents, then docker compose up --no-build --pull never --no-recreate controller using the dedicated file/project. Never run the old Compose project against retained data.'};
});
export async function verifyAdoption(docker,helper,options) {
  const {state,output,candidate,snapshots}=await adoptionContext(docker,helper,options,{running:true});
  requireThat(state.adoption.phase === 'adopted','Adoption is not complete.');
  requireThat(fileHash(noLinks(adoptionFile(output))) === state.adoption.fileHash,'Private Compose file changed.');
  requireThat(snapshots.slice(0,-1).every(s=>s.HostConfig.RestartPolicy.Name === 'unless-stopped'),'Agent restart policy changed.');
  return {ok:true,phase:'adopted',controllerId:candidate.Id,data:state.output+'/data',restart:'unless-stopped',running:candidate.State.Running && snapshots.slice(0,-1).every(s=>s.State.Running),readiness:'not-verified'};
}
export const revertAdoption=(docker,helper,options)=>withStateLock(helper,options,async()=>{
  const {state,output,candidate}=await adoptionContext(docker,helper,options,{missing:true}),a=state.adoption;
  // Journal identity before renaming; retries can find the exact stopped copy.
  a.phase='reverting';if(candidate)a.parkedId=candidate.Id;writeState(output,state);
  for(const m of state.members.filter(m=>m.instanceId))await docker.getContainer(m.newId).update({RestartPolicy:{Name:'no',MaximumRetryCount:0}});
  if(candidate){if(candidate.Name !== '/'+adoptionNames(state).parked)await docker.getContainer(candidate.Id).rename({name:adoptionNames(state).parked});a.parkedFingerprint=identity(await docker.getContainer(candidate.Id).inspect());writeState(output,state);}
  const session=docker.getContainer(state.members.at(-1).newId);if((await session.inspect()).Name !== '/'+state.controller)await session.rename({name:state.controller});
  a.phase='rolled-back';writeState(output,state);
  return {ok:true,phase:'adoption-rolled-back',notice:'All writers remain stopped. The Compose copy and files are retained; do not run that Compose project again. The original service rollback command can now return to the source recovery point.'};
});
function parseArgs(argv) {
  const options={command:argv[0]};
  for(let i=1;i<argv.length;i++) {
    const key=argv[i];requireThat(["--controller","--backup","--output","--confirm","--state","--adopt-confirm"].includes(key),"Unknown recovery argument.");
    requireThat(argv[i+1] && !argv[i+1].startsWith("--"),"Recovery argument requires a value.");options[key.slice(2)]=argv[++i];
  }
  return options;
}
async function main() {
  requireThat(process.platform === "linux" && process.env.MYBAY_SERVICE_RECOVERY === "1","Run in a separate Linux Docker helper with MYBAY_SERVICE_RECOVERY=1 and a local Docker socket.");
  const docker=new Docker({socketPath:"/var/run/docker.sock"});
  const helper=await docker.getContainer(os.hostname()).inspect();
  requireThat(helper.State.Running,"Recovery helper is not running.");
  const options=parseArgs(process.argv.slice(2));
  const handlers={plan:async()=>publicPlan(await planRecovery(docker,helper,options)),prepare:()=>prepareRecovery(docker,helper,options),activate:()=>activateRecovery(docker,helper,options),rollback:()=>rollbackRecovery(docker,helper,options)};
  Object.assign(handlers,{'adopt-plan':()=>previewAdoption(docker,helper,options),'adopt-prepare':()=>prepareAdoption(docker,helper,options),adopt:()=>adoptRecovery(docker,helper,options),'adopt-verify':()=>verifyAdoption(docker,helper,options),'adopt-rollback':()=>revertAdoption(docker,helper,options)});
  requireThat(handlers[options.command],"Usage: service-recovery plan|prepare --controller NAME --backup DIR --output NEW_DIR [--confirm DIGEST] | activate|rollback --state FILE --confirm DIGEST");
  console.log(JSON.stringify(await handlers[options.command](),null,2));
}
if(process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))main().catch(error=>{
  // Docker errors can include create config/environment; never print raw API
  // errors, causes or stacks containing provider credentials.
  console.error(error?.statusCode ? `Docker operation failed (HTTP ${error.statusCode}); inspect container state locally.` : error.message);
  process.exitCode=1;
});
