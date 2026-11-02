import { afterEach, describe, expect, it, vi } from 'vitest';

function database({ rejectWrites = false, deferCommit = false } = {}) {
  const values = new Map<string, unknown>();
  const commits: (() => void)[] = [];
  const event = new Event('success');
  const db = {
    transaction: () => {
      const tx = { oncomplete: null, onabort: null } as unknown as IDBTransaction;
      const request = (value: unknown): IDBRequest => {
        const req = { result: value, onsuccess: null, onerror: null } as IDBRequest;
        queueMicrotask(() => {
          req.onsuccess?.call(req, event);
          if (deferCommit) commits.push(() => tx.oncomplete?.call(tx, event));
          else queueMicrotask(() => tx.oncomplete?.call(tx, event));
        });
        return req;
      };
      const store = {
        get: (key: string) => request(values.get(key)),
        put: (value: { key: string }) => {
          if (rejectWrites) throw new DOMException('Storage full', 'QuotaExceededError');
          values.set(value.key, value);
          return request(value.key);
        },
        getAll: () => request([]),
      } as unknown as IDBObjectStore;
      tx.objectStore = () => store;
      return tx;
    },
  } as unknown as IDBDatabase;
  vi.stubGlobal('indexedDB', {
    open: () => {
      const req = { result: db, onsuccess: null } as unknown as IDBOpenDBRequest;
      queueMicrotask(() => req.onsuccess?.call(req, event));
      return req;
    },
  });
  return { values, commits };
}

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

describe('session storage fallback', () => {
  it('retains sequential lesson completions when reads work but writes fail', async () => {
    vi.resetModules();
    const mock = database({ rejectWrites: true });
    mock.values.set('education:v1', { key: 'education:v1', value: [{ lessonId: 'italian-game', practices: 1 }] });
    const { educationRepo, dbAvailable } = await import('../src/storage/db');
    expect(await dbAvailable()).toBe(true);
    await educationRepo.record('back-rank', 'practice');
    await educationRepo.record('back-rank', 'recall', true);
    const rows = await educationRepo.all();
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.lessonId === 'back-rank')).toMatchObject({ practices: 1, cleanRecalls: 1 });
    expect(await dbAvailable()).toBe(false);
  });
  it('uses a session write instead of a stale persisted value', async () => {
    vi.resetModules();
    const mock = database({ rejectWrites: true });
    mock.values.set('key', { key: 'key', value: 'old' });
    const { get, put } = await import('../src/storage/db');
    await put('kv', { key: 'key', value: 'new' });
    expect(await get('kv', 'key')).toEqual({ key: 'key', value: 'new' });
  });
  it('reads fresh persisted values after a healthy write', async () => {
    vi.resetModules();
    const mock = database();
    const { get, put } = await import('../src/storage/db');
    await put('kv', { key: 'key', value: 'first tab' });
    mock.values.set('key', { key: 'key', value: 'another tab' });
    expect(await get('kv', 'key')).toEqual({ key: 'key', value: 'another tab' });
  });
  it('does not acknowledge a durable write before its transaction commits', async () => {
    vi.resetModules();
    const mock = database({ deferCommit: true });
    const { put } = await import('../src/storage/db');
    let finished = false;
    const write = put('kv', { key: 'key', value: 'saved' }).then(() => { finished = true; });
    await vi.waitFor(() => expect(mock.commits).toHaveLength(1));
    expect(finished).toBe(false);
    mock.commits[0]!();
    await write;
    expect(finished).toBe(true);
  });
});
