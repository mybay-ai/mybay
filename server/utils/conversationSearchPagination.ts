import { createHash } from 'node:crypto';
import type { ConversationSearchResult, ConversationSearchPage } from '../../shared/conversationSearch';

type SearchKey = { score: number; matched_at: string; sequence_no: number | null; conversation_id: string; message_id: string | null };
type SearchCursor = { version: 1; scope: string; asOf: string; after: SearchKey };
export class InvalidSearchCursor extends Error {}
const order = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
export function compareSearchResults(a: SearchKey, b: SearchKey): number {
  return b.score - a.score || order(b.matched_at, a.matched_at) || (b.sequence_no || 0) - (a.sequence_no || 0)
    || order(a.conversation_id, b.conversation_id) || order(a.message_id || '', b.message_id || '');
}
export function searchPageContext(userId: string, instanceId: string, query: string, cursor?: unknown) {
  const scope = createHash('sha256').update(JSON.stringify([userId, instanceId, query])).digest('hex');
  if (!cursor) return { scope, asOf: new Date().toISOString(), after: null };
  try {
    if (typeof cursor !== 'string') throw new Error();
    if (cursor.length > 2048) throw new Error();
    const parsed: SearchCursor = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    const key = parsed.after;
    if (parsed.version !== 1 || parsed.scope !== scope || typeof parsed.asOf !== 'string' || !Number.isFinite(Date.parse(parsed.asOf))
      || Date.parse(parsed.asOf) > Date.now() || !key || ![200, 300, 350, 400].includes(key.score)
      || typeof key.matched_at !== 'string' || key.matched_at.length > 64
      || (key.sequence_no !== null && (!Number.isSafeInteger(key.sequence_no) || key.sequence_no < 0))
      || typeof key.conversation_id !== 'string' || key.conversation_id.length > 128
      || (key.message_id !== null && (typeof key.message_id !== 'string' || key.message_id.length > 128))) throw new Error();
    return { scope, asOf: parsed.asOf, after: key };
  } catch { throw new InvalidSearchCursor('INVALID_SEARCH_CURSOR'); }
}
export function paginateSearchResults(rows: (ConversationSearchResult & { score: number })[], limit: number, context: ReturnType<typeof searchPageContext>): ConversationSearchPage {
  const sorted = rows.filter(row => row.matched_at <= context.asOf && (!context.after || compareSearchResults(row, context.after) > 0)).sort(compareSearchResults);
  const page = sorted.slice(0, Math.max(1, Math.min(50, Number.isFinite(limit) ? Math.floor(limit) : 30)));
  const last = page[page.length - 1];
  const cursor: SearchCursor | null = sorted.length > page.length && last ? { version: 1, scope: context.scope, asOf: context.asOf,
    after: { score: last.score, matched_at: last.matched_at, sequence_no: last.sequence_no, conversation_id: last.conversation_id, message_id: last.message_id } } : null;
  return { results: page.map(({ score: _score, ...result }) => result), nextCursor: cursor ? Buffer.from(JSON.stringify(cursor)).toString('base64url') : null };
}
