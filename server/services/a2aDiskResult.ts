import fs from 'node:fs';
import path from 'node:path';
import type { A2ATaskLink } from './a2aTaskLinks';

// This recovers a recorded reply, not the remote TaskStore state or execution.
export function readA2ADiskResult(link: A2ATaskLink, dataRoot = path.resolve('data', 'instances')): string | undefined {
  if (!/^[a-zA-Z0-9-]{1,128}$/.test(link.peerId) || !/^ctx-[a-z0-9](?:[a-z0-9-]{0,158})$/i.test(link.contextId) || !/^task-[a-z0-9]+$/i.test(link.remoteTaskId || '')) return;
  try {
    const root = fs.realpathSync(dataRoot);
    const file = path.join(root, link.peerId, 'a2a_conversations', link.contextId + '.jsonl');
    // Do not follow instance-controlled symlinks outside the intended directory.
    for (const entry of [path.join(root, link.peerId), path.dirname(file), file]) if (fs.lstatSync(entry).isSymbolicLink()) return;
    const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    let text: string;
    try {
      if (process.platform === 'linux' && fs.realpathSync(`/proc/self/fd/${fd}`) !== file) return;
      const stat = fs.fstatSync(fd);
      if (!stat.isFile() || stat.size > 256 * 1024) return;
      const buffer = Buffer.alloc(256 * 1024 + 1);
      const bytes = fs.readSync(fd, buffer, 0, buffer.length, 0);
      if (bytes > 256 * 1024) return;
      text = buffer.subarray(0, bytes).toString('utf8');
    } finally { fs.closeSync(fd); }
    if (!text.endsWith('\n')) return;
    const rows = text.split('\n').filter(Boolean).map(line => JSON.parse(line)).filter(row => row.task_id === link.remoteTaskId);
    if (rows.length !== 2 || rows[0].role !== 'user' || rows[1].role !== 'agent' || typeof rows[1].text !== 'string' || !rows[1].text.trim()) return;
    // Hermes writes diagnostic sentinels as agent messages too; they are not a recovered answer.
    if (/^\[[^\r\n]*\]$/.test(rows[1].text.trim())) return;
    return rows[1].text.slice(0, 8000);
  } catch { return; }
}
