import { describe, expect, it } from 'vitest';
import { paginateSearchResults, searchPageContext } from './conversationSearchPagination';
import type { ConversationSearchResult } from '../../shared/conversationSearch';
const row = (id: number): ConversationSearchResult & { score: number } => ({ conversation_id: `c-${String(id).padStart(3,'0')}`, conversation_title: 'needle', project_id: null, matched_field: 'title', message_id: null, message_role: null, sequence_no: null, snippet: 'needle', matched_at: '2026-01-01T00:00:00.000Z', score: 400 });
describe('stable search pagination', () => {
  it('visits all tied rows exactly once even if storage order changes between pages', () => {
    const rows = Array.from({length:65},(_,i)=>row(i));
    const first = paginateSearchResults(rows,30,searchPageContext('u','i','needle'));
    const second = paginateSearchResults([...rows].reverse(),30,searchPageContext('u','i','needle',first.nextCursor!));
    const third = paginateSearchResults(rows,30,searchPageContext('u','i','needle',second.nextCursor!));
    const ids = [...first.results,...second.results,...third.results].map(r=>r.conversation_id);
    expect(ids).toHaveLength(65); expect(new Set(ids).size).toBe(65); expect(third.nextCursor).toBeNull();
  });
  it('binds the cursor to query, user and instance and rejects malformed cursors', () => {
    const page=paginateSearchResults([row(0),row(1)],1,searchPageContext('u','i','needle'));
    for(const scope of [['other','i','needle'],['u','other','needle'],['u','i','other']]) expect(()=>searchPageContext(...scope as [string,string,string],page.nextCursor!)).toThrow('INVALID_SEARCH_CURSOR');
    expect(()=>searchPageContext('u','i','needle','broken')).toThrow('INVALID_SEARCH_CURSOR');
    expect(()=>searchPageContext('u','i','needle',['broken'])).toThrow('INVALID_SEARCH_CURSOR');
  });
  it('excludes results newer than the first page and tolerates a deleted boundary row', () => {
    const rows=[row(0),row(1),row(2)];
    const context=searchPageContext('u','i','needle');
    const page=paginateSearchResults(rows,1,context);
    const next=paginateSearchResults([...rows.slice(1),{...row(3),matched_at:'9999-01-01T00:00:00.000Z'}],30,searchPageContext('u','i','needle',page.nextCursor!));
    expect(next.results.map(r=>r.conversation_id)).toEqual(['c-001','c-002']);
  });
});
