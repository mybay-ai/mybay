// Lossless for the supported Desktop controller profile. A recreated container
// must round-trip through composeIdentity before any recovered writer starts.
const clone=value=>JSON.parse(JSON.stringify(value));
const labels=value=>Object.fromEntries(Object.entries(value || {}).filter(([k])=>!k.startsWith('com.docker.compose.')));
const escape=value=>typeof value === 'string' ? value.replaceAll('$',()=> '$$') : Array.isArray(value) ? value.map(escape) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([k,v])=>[k,escape(v)])) : value;
export function composeIdentity(info) {
  const config=clone(info.Config),host=clone(info.HostConfig);
  for(const key of ['Hostname','Domainname','Image','AttachStdin','AttachStdout','AttachStderr'])delete config[key];
  config.Env=(config.Env || []).slice().sort();config.Labels=labels(config.Labels);
  host.Binds=(info.Mounts || []).map(m=>[m.Type,m.Source.replaceAll('\\','/'),m.Destination,m.RW]).sort((a,b)=>a[2].localeCompare(b[2]));
  delete host.NetworkMode;host.OomKillDisable=host.OomKillDisable === true;
  host.ExtraHosts=host.ExtraHosts || [];
  host.RestartPolicy={Name:'unless-stopped',MaximumRetryCount:0};
  // Compose adds its own discoverability aliases. Network names/IDs are
  // independently pinned by the recovery journal; aliases are checked there.
  return {image:info.Image,config,host,networks:Object.keys(info.NetworkSettings.Networks).sort()};
}
export function composeManifest(info,project,controllerName) {
  const c=info.Config,h=info.HostConfig;
  const networks=Object.fromEntries(Object.entries(info.NetworkSettings.Networks).map(([name,n],i)=>['n'+i,{name,aliases:n.Aliases || []}]));
  const service={image:info.Image,pull_policy:'never',container_name:controllerName,restart:'unless-stopped',
    environment:Object.fromEntries((c.Env || []).map(e=>{const i=e.indexOf('=');return [e.slice(0,i),e.slice(i+1)];})),
    labels:labels(c.Labels),command:c.Cmd || [],entrypoint:c.Entrypoint || [],working_dir:c.WorkingDir || '',user:c.User || '',
    tty:!!c.Tty,stdin_open:!!c.OpenStdin,
    // Docker inspect may reorder mounts between requests. Destination order is
    // immaterial for this supported profile, but must not invalidate approval.
    volumes:info.Mounts.slice().sort((a,b)=>a.Destination.localeCompare(b.Destination)).map(m=>`${m.Source.replaceAll('\\','/')}:${m.Destination}:${m.RW?'rw':'ro'}`),
    networks:Object.fromEntries(Object.entries(networks).map(([k,n])=>[k,{aliases:n.aliases}])),
  };
  if(c.StopSignal)service.stop_signal=c.StopSignal;
  if(c.Healthcheck){const hc=c.Healthcheck;service.healthcheck={test:hc.Test};for(const [a,b] of [['Interval','interval'],['Timeout','timeout'],['StartPeriod','start_period'],['StartInterval','start_interval']])if(hc[a])service.healthcheck[b]=hc[a]+'ns';if(hc.Retries)service.healthcheck.retries=hc.Retries;}
  if(Object.keys(c.ExposedPorts || {}).length)service.expose=Object.keys(c.ExposedPorts);
  if(Object.keys(h.PortBindings || {}).length)service.ports=Object.entries(h.PortBindings).flatMap(([p,bs])=>bs.map(b=>`${b.HostIp}:${b.HostPort}:${p}`));
  for(const [a,b] of [['Dns','dns'],['DnsOptions','dns_opt'],['DnsSearch','dns_search'],['ExtraHosts','extra_hosts'],['CapAdd','cap_add'],['CapDrop','cap_drop'],['SecurityOpt','security_opt'],['GroupAdd','group_add']])if(h[a]?.length)service[b]=h[a];
  for(const [a,b] of [['Memory','mem_limit'],['MemoryReservation','mem_reservation'],['MemorySwap','memswap_limit'],['CpuShares','cpu_shares'],['CpuPeriod','cpu_period'],['CpuQuota','cpu_quota'],['CpusetCpus','cpuset'],['PidsLimit','pids_limit'],['ShmSize','shm_size'],['OomScoreAdj','oom_score_adj']])if(h[a])service[b]=h[a];
  if(h.NanoCpus)service.cpus=h.NanoCpus/1e9;
  if(h.ReadonlyRootfs)service.read_only=true;
  if(h.LogConfig?.Type)service.logging={driver:h.LogConfig.Type,options:h.LogConfig.Config || {}};
  if(h.Ulimits?.length)service.ulimits=Object.fromEntries(h.Ulimits.map(u=>[u.Name,{soft:u.Soft,hard:u.Hard}]));
  return escape({name:project,services:{controller:service},networks:Object.fromEntries(Object.entries(networks).map(([k,n])=>[k,{name:n.name,external:true}]))});
}
