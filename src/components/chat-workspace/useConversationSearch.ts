import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api';
import { conversationSearchResultKey, type ConversationSearchPage } from '../../../shared/conversationSearch';

type SearchState = ConversationSearchPage & { key: string; loading: boolean; failed: boolean; loadingMore: boolean; moreFailed: boolean };
export function useConversationSearch(instanceId: string, query: string) {
  const normalized = query.trim();
  const key = JSON.stringify([instanceId, normalized]);
  const valid = Boolean(instanceId) && normalized.length >= 2;
  const empty: SearchState = { key, results: [], nextCursor: null, loading: valid, failed: false, loadingMore: false, moreFailed: false };
  const [state, setState] = useState<SearchState>(empty);
  const [revision, setRevision] = useState(0);
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const busy = useRef(false);
  const endpoint = `/api/instances/${encodeURIComponent(instanceId)}/conversations/search?q=${encodeURIComponent(normalized)}&limit=30`;
  useEffect(() => {
    const id = ++generation.current;
    const abort = new AbortController();
    controller.current = abort;
    busy.current = false;
    setState({ key, results: [], nextCursor: null, loading: valid, failed: false, loadingMore: false, moreFailed: false });
    const timer = valid ? setTimeout(async () => {
      try {
        const page = await api.get<ConversationSearchPage & { success: boolean }>(endpoint, { signal: abort.signal });
        if (!page.success || !Array.isArray(page.results)) throw new Error('INVALID_SEARCH_RESPONSE');
        if (generation.current !== id) return;
        setState({ key, results: page.results, nextCursor: page.nextCursor || null, loading: false, failed: false, loadingMore: false, moreFailed: false });
      } catch {
        if (generation.current === id && !abort.signal.aborted) setState(previous => ({ ...previous, loading: false, failed: true }));
      }
    }, 250) : null;
    return () => { ++generation.current; abort.abort(); if (timer) clearTimeout(timer); };
  }, [key, endpoint, valid, revision]);
  const current = state.key === key ? state : empty;
  const loadMore = useCallback(async () => {
    if (state.key !== key || !state.nextCursor || busy.current || state.loading) return;
    busy.current = true;
    const id = generation.current;
    const signal = controller.current?.signal;
    setState(previous => ({ ...previous, loadingMore: true, moreFailed: false }));
    try {
      const page = await api.get<ConversationSearchPage & { success: boolean }>(`${endpoint}&cursor=${encodeURIComponent(state.nextCursor)}`, { signal });
      if (!page.success || !Array.isArray(page.results)) throw new Error('INVALID_SEARCH_RESPONSE');
      if (generation.current !== id) return;
      setState(previous => {
        const seen = new Set(previous.results.map(conversationSearchResultKey));
        return { ...previous, results: [...previous.results, ...page.results.filter(result => { const id = conversationSearchResultKey(result); if (seen.has(id)) return false; seen.add(id); return true; })], nextCursor: page.nextCursor || null, loadingMore: false };
      });
    } catch {
      if (generation.current === id && !signal?.aborted) setState(previous => ({ ...previous, loadingMore: false, moreFailed: true }));
    } finally { if (generation.current === id) busy.current = false; }
  }, [state.key, state.nextCursor, state.loading, key, endpoint]);
  return { ...current, loadMore, retry: () => setRevision(value => value + 1) };
}
