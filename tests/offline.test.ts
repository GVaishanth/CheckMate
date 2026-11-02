import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

function worker(scope = 'https://example.test/portfolio/checkmate/') {
  const handlers = new Map<string, (event: Record<string, unknown>) => void>();
  const response = new Response('cached asset');
  const match = vi.fn((_request: unknown, options?: { ignoreVary?: boolean }) => Promise.resolve(options?.ignoreVary ? response : undefined));
  const fetch = vi.fn(() => Promise.reject(new Error('offline')));
  const remove = vi.fn(() => Promise.resolve(true));
  const open = vi.fn(async () => ({ match, addAll: vi.fn(async () => undefined) }));
  const context = { self: { registration: { scope }, clients: { claim: vi.fn(async () => undefined) }, addEventListener: (type: string, handler: (event: Record<string, unknown>) => void) => handlers.set(type, handler) },
    URL, Set, encodeURIComponent, Response, fetch, caches: { open, delete: remove, keys: async () => ['checkmate:%2F:old', 'checkmate:%2Fportfolio%2Fcheckmate%2F:old', 'unrelated'] } };
  vm.runInNewContext(readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8'), context);
  function request(path: string, method = 'GET', mode = 'cors') {
    let result: Promise<Response> | undefined;
    handlers.get('fetch')!({ request: { url: new URL(path, scope).href, method, mode }, respondWith: (pending: Promise<Response>) => { result = pending; } });
    return result;
  }
  return { handlers, request, fetch, match, response, open, remove };
}

describe('scoped offline shell', () => {
  it('serves cached assets despite Origin/Vary differences in module requests', async () => {
    const sw = worker();
    expect(await sw.request('favicon.svg')).toBe(sw.response);
    expect(sw.match).toHaveBeenCalledWith(expect.anything(), { ignoreVary: true });
    expect(sw.fetch).not.toHaveBeenCalled();
  });
  it('serves the canonical cached index for hash-based navigation', async () => {
    const sw = worker();
    expect(await sw.request('./', 'GET', 'navigate')).toBe(sw.response);
    expect(sw.match).toHaveBeenCalledWith('https://example.test/portfolio/checkmate/index.html', { ignoreVary: true });
  });
  it.each(['../unrelated.js', 'missing.js', 'https://other.test/favicon.svg'])('does not intercept unowned resources: %s', (path) => {
    expect(worker().request(path)).toBeUndefined();
  });
  it('does not cache non-GET requests', () => expect(worker().request('favicon.svg', 'POST')).toBeUndefined());
  it('removes only obsolete caches belonging to its own scope', async () => {
    const sw = worker(); let done!: Promise<void>;
    sw.handlers.get('activate')!({ waitUntil: (pending: Promise<void>) => { done = pending; } });
    await done;
    expect(sw.remove.mock.calls).toEqual([['checkmate:%2Fportfolio%2Fcheckmate%2F:old']]);
  });
});
