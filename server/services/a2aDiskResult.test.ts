import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { readA2ADiskResult } from './a2aDiskResult';
import type { A2ATaskLink } from './a2aTaskLinks';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'a2a-disk-'));
const folder=path.join(root,'peer','a2a_conversations');fs.mkdirSync(folder,{recursive:true});
const file=path.join(folder,'ctx-mybay-room-run123.jsonl');
const link={peerId:'peer',contextId:'ctx-mybay-room-run123',remoteTaskId:'task-remote'} as A2ATaskLink;
afterEach(()=>{if(fs.existsSync(file))fs.unlinkSync(file);});
const rows=[{role:'user',task_id:'task-remote',text:'request'},{role:'agent',task_id:'task-remote',text:'saved reply'}];
const write=(items:any[])=>fs.writeFileSync(file,items.map(x=>JSON.stringify(x)).join('\n')+'\n');
it('reads only the exact mapped task reply even when the context contains other tasks',()=>{
  write([...rows,{role:'agent',task_id:'task-other',text:'other reply'}]);
  expect(readA2ADiskResult(link,root)).toBe('saved reply');
  expect(readA2ADiskResult({...link,remoteTaskId:'task-missing'},root)).toBeUndefined();
  expect(readA2ADiskResult({...link,peerId:'another-peer'},root)).toBeUndefined();
});
it('rejects incomplete, duplicate, reordered and malformed records',()=>{
  write([rows[0],{...rows[1],text:'[client disconnected]'}]);expect(readA2ADiskResult(link,root)).toBeUndefined();
  for(const value of [[rows[0]], [rows[1]], [...rows,rows[1]], [...rows].reverse()]){write(value);expect(readA2ADiskResult(link,root)).toBeUndefined();}
  fs.writeFileSync(file,JSON.stringify(rows[0])+'\n{');expect(readA2ADiskResult(link,root)).toBeUndefined();
});
it('rejects path traversal and oversized files',()=>{
  write(rows);expect(readA2ADiskResult({...link,peerId:'../peer'},root)).toBeUndefined();
  expect(readA2ADiskResult({...link,contextId:'../ctx-one'},root)).toBeUndefined();
  fs.writeFileSync(file,' '.repeat(256*1024+1));expect(readA2ADiskResult(link,root)).toBeUndefined();
});
