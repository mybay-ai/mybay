import express from 'express';
import { describe, expect, it, vi } from 'vitest';
import { InvalidSearchCursor } from '../../../utils/conversationSearchPagination';
const search = vi.hoisted(() => vi.fn());
vi.mock('../../../repositories/chatRepo', () => ({ chatRepo: { searchConversationPage: search } }));
vi.mock('../../../middlewares/auth', () => ({ authenticateToken: (req: any, res: any, next: any) => {
  const user = req.headers['x-test-user'];
  if (!user) return res.status(401).json({ success: false });
  req.user = { id: user }; next();
} }));
vi.mock('../../../services/instances/resourceAuthorityService', () => ({
  resolveInstanceAuthority: async ({ actor }: any) => actor.id === 'owner' ? { ok: true } : { ok: false, status: 403, code: 'FORBIDDEN' },
}));
import { registerConversationRoutes } from './conversation.routes';
describe('conversation search HTTP boundary', () => {
  it('checks ownership before pagination and returns explicit invalid-cursor errors', async () => {
    const router = express.Router(); registerConversationRoutes(router);
    const app = express(); app.use(router);
    const server = app.listen(0);
    try {
      await new Promise<void>(resolve => server.once('listening', resolve));
      const base = `http://127.0.0.1:${(server.address() as any).port}/agent/conversations/search?q=needle`;
      const get = (user: string, suffix = '') => fetch(base + suffix, { headers: user ? { 'x-test-user': user } : {} });
      expect((await get('')).status).toBe(401);
      expect((await get('other')).status).toBe(403);
      expect(search).not.toHaveBeenCalled();
      expect((await get('owner', '&cursor[]=bad')).status).toBe(400);
      search.mockResolvedValueOnce({ results: [], nextCursor: 'next-page' });
      const success = await get('owner', '&limit=999&cursor=first');
      expect(await success.json()).toEqual({ success: true, results: [], nextCursor: 'next-page' });
      expect(search).toHaveBeenCalledWith('owner', 'agent', 'needle', 50, 'first');
      search.mockRejectedValueOnce(new InvalidSearchCursor('INVALID_SEARCH_CURSOR'));
      const invalid = await get('owner', '&cursor=bad');
      expect(invalid.status).toBe(400);
      expect(await invalid.json()).toEqual({ success: false, error: 'INVALID_SEARCH_CURSOR' });
    } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
  });
});
