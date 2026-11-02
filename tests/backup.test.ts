import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { START_FEN } from '../src/chess/constants';
import type { ExportBundle, StoredGame } from '../src/storage/schema';

const game = (id = 'safe'): StoredGame => ({ id, mode: 'local', date: 1, whiteName: 'White', blackName: 'Black', startFen: START_FEN, moves: [], outcome: { result: 'unfinished' }, durationMs: 0 });
const backup = (patch: Partial<ExportBundle> = {}): ExportBundle => ({ version: 1, exportedAt: 1, games: [], puzzles: [], elo: [], education: [], settings: null, ...patch });
let storage: Map<string, string>;
beforeEach(() => {
  vi.resetModules();
  storage = new Map();
  vi.stubGlobal('indexedDB', new IDBFactory());
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value); },
    removeItem: (key: string) => { storage.delete(key); },
  });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('backup validation', () => {
  it.each([
    ['unknown version', { version: 99 }],
    ['non-array games', { games: {} }],
    ['non-array puzzles', { puzzles: {} }],
    ['non-array ratings', { elo: 'bad' }],
    ['non-array education', { education: {} }],
    ['invalid settings JSON', { settings: '{bad' }],
    ['unknown settings version', { settings: '{"version":2}' }],
    ['invalid preference type', { settings: '{"sound":"false"}' }],
    ['nonfinite preference', { settings: '{"volume":null}' }],
    ['invalid game name', { games: [{ ...game(), whiteName: {} }] }],
    ['invalid game root', { games: [{ ...game(), startFen: 'invalid' }] }],
    ['illegal move', { games: [{ ...game(), moves: [{ uci: 'e2e5' }] }] }],
    ['invalid game result', { games: [{ ...game(), outcome: { result: 'draw', reason: {} } }] }],
    ['negative time', { games: [{ ...game(), durationMs: -1 }] }],
    ['invalid variant', { games: [{ ...game(), variant: 'atomic' }] }],
    ['duplicate games', { games: [game(), game()] }],
    ['mismatched puzzle key', { puzzles: [{ key: 'different', puzzleId: 'p1', status: 'solved', attempts: 1, lastTriedAt: 1 }] }],
    ['invalid lesson ID', { education: [{ lessonId: {} }] }],
    ['negative lesson count', { education: [{ lessonId: 'italian', practices: -1 }] }],
    ['invalid streak', { puzzleStreak: { current: 5, best: 2 } }],
  ])('rejects $0 before erasing anything', async (_label, patch) => {
    const db = await import('../src/storage/db');
    await db.gamesRepo.save(game());
    const revision = db.dataRevision();
    await expect(db.importAll({ ...backup(), ...patch })).rejects.toThrow();
    expect(await db.gamesRepo.all()).toEqual([game()]);
    expect(db.dataRevision()).toBe(revision);
  });
  it('reconstructs truthful SAN, FEN, capture and check fields from legal UCI', async () => {
    const db = await import('../src/storage/db');
    const legacy = { ...game('legacy'), pgn: '[Event "Legacy"]\n\n1. e4 d5 2. exd5 *\n', moves: ['e2e4', 'd7d5', 'e4d5'].map((uci) => ({ uci, san: '', fenAfter: '', msElapsed: 0, capture: false, check: false })) };
    await db.importAll(backup({ games: [legacy] }));
    const restored = (await db.gamesRepo.get('legacy'))!;
    expect(restored.moves.map((m) => m.san)).toEqual(['e4', 'd5', 'exd5']);
    expect(restored.moves[2].capture).toBe(true);
    expect(restored.moves[2].fenAfter).toContain(' b KQkq ');
    expect(restored.pgn).toBe(legacy.pgn);
  });
  it('preserves an unspecified imported draw without inventing an agreement', async () => {
    const db = await import('../src/storage/db');
    const drawn: StoredGame = { ...game('pgn-draw'), mode: 'import', outcome: { result: 'draw', reason: 'unspecified' } };
    await db.importAll(backup({ games: [drawn] }));
    expect((await db.gamesRepo.get(drawn.id))?.outcome).toEqual(drawn.outcome);
    expect((await db.exportAll()).games[0].outcome).toEqual(drawn.outcome);
  });
  it('preserves legacy version-one backups without Education or streak fields', async () => {
    const db = await import('../src/storage/db');
    const value = backup(); delete value.education;
    expect(await db.importAll(value)).toMatchObject({ games: 0, puzzles: 0, elo: 0, education: 0, persistent: true });
  });
});

describe('atomic record replacement', () => {
  it('rolls back all four stores when a later queued write fails', async () => {
    const db = await import('../src/storage/db');
    await db.gamesRepo.save(game());
    await db.educationRepo.record('italian', 'practice');
    await db.puzzlesRepo.put({ key: 'p1', puzzleId: 'p1', status: 'solved', attempts: 1, lastTriedAt: 1 });
    const before = await db.exportAll(), revision = db.dataRevision();
    const original = IDBObjectStore.prototype.put;
    const spy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
      if ((value as { id?: string }).id === 'reject') throw new DOMException('Quota', 'QuotaExceededError');
      return key === undefined ? original.call(this, value) : original.call(this, value, key);
    });
    await expect(db.importAll(backup({ games: [game('first'), game('reject')] }))).rejects.toThrow('Existing records');
    spy.mockRestore();
    const after = await db.exportAll();
    expect(after.games).toEqual(before.games);
    expect(after.puzzles).toEqual(before.puzzles);
    expect(after.education).toEqual(before.education);
    expect(db.dataRevision()).toBe(revision);
  });
  it('waits for commit and rolls back even after a request has succeeded', async () => {
    const db = await import('../src/storage/db');
    await db.gamesRepo.save(game());
    const original = IDBObjectStore.prototype.put;
    const spy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value: unknown) {
      const request = original.call(this, value);
      if ((value as { id?: string }).id === 'abort') request.onsuccess = () => this.transaction.abort();
      return request;
    });
    await expect(db.importAll(backup({ games: [game('abort')] }))).rejects.toThrow();
    spy.mockRestore();
    expect(await db.gamesRepo.all()).toEqual([game()]);
  });
  it('does not resurrect an old asynchronous save across a successful restore', async () => {
    const db = await import('../src/storage/db');
    await db.gamesRepo.save(game());
    const revision = db.dataRevision();
    const original = IDBObjectStore.prototype.put;
    let staleSave: Promise<void> | undefined;
    const spy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value: unknown) {
      const request = original.call(this, value);
      if ((value as { id?: string }).id === 'incoming') request.onsuccess = () => { staleSave = db.gamesRepo.save(game('stale'), revision); };
      return request;
    });
    await db.importAll(backup({ games: [game('incoming')] }));
    await staleSave; spy.mockRestore();
    expect((await db.gamesRepo.all()).map((g) => g.id)).toEqual(['incoming']);
    expect(db.dataRevision()).toBe(revision + 1);
  });
  it('continues saving the current session after a failed restore', async () => {
    const db = await import('../src/storage/db');
    await db.gamesRepo.save(game());
    const revision = db.dataRevision(), original = IDBObjectStore.prototype.put;
    let pending: Promise<void> | undefined;
    const spy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value: unknown) {
      const request = original.call(this, value);
      if ((value as { id?: string }).id === 'abort') request.onsuccess = () => {
        pending = db.gamesRepo.save(game('later'), revision); this.transaction.abort();
      };
      return request;
    });
    await expect(db.importAll(backup({ games: [game('abort')] }))).rejects.toThrow();
    await pending; spy.mockRestore();
    expect((await db.gamesRepo.all()).map((g) => g.id).sort()).toEqual(['later', 'safe']);
  });
  it('rolls back reset if one store cannot be cleared', async () => {
    const db = await import('../src/storage/db');
    await db.gamesRepo.save(game());
    const original = IDBObjectStore.prototype.clear;
    const spy = vi.spyOn(IDBObjectStore.prototype, 'clear').mockImplementation(function (this: IDBObjectStore) {
      if (this.name === 'puzzles') throw new Error('Denied');
      return original.call(this);
    });
    await expect(db.clearAll()).rejects.toThrow();
    spy.mockRestore(); expect(await db.gamesRepo.all()).toEqual([game()]);
  });
});

describe('session snapshots and cross-tab freshness', () => {
  it('does not expose saved objects by reference', async () => {
    vi.stubGlobal('indexedDB', undefined);
    const db = await import('../src/storage/db'), source = game();
    await db.gamesRepo.save(source); source.whiteName = 'Changed';
    const first = (await db.gamesRepo.get('safe'))!; first.blackName = 'Changed';
    expect(await db.gamesRepo.get('safe')).toMatchObject({ whiteName: 'White', blackName: 'Black' });
  });
  it('keeps session-only writes exportable with storage blocked', async () => {
    vi.stubGlobal('indexedDB', undefined);
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('Denied'); }, setItem: () => { throw new Error('Denied'); }, removeItem: () => { throw new Error('Denied'); } });
    const db = await import('../src/storage/db');
    const result = await db.importAll(backup({ games: [game()], puzzleStreak: { current: 2, best: 4 }, settings: '{"version":1,"sound":false}' }));
    expect(result.persistent).toBe(false);
    const exported = await db.exportAll();
    expect(exported.games).toHaveLength(1);
    expect(exported.puzzleStreak).toEqual({ current: 2, best: 4 });
    expect(JSON.parse(exported.settings!)).toMatchObject({ sound: false });
  });
  it('reads changes and deletions made by another database connection', async () => {
    const db = await import('../src/storage/db');
    await db.gamesRepo.save(game()); await db.gamesRepo.all();
    const other = await new Promise<IDBDatabase>((resolve) => { const req = indexedDB.open('checkmate', 1); req.onsuccess = () => resolve(req.result); });
    const update = (fn: (store: globalThis.IDBObjectStore) => void) => new Promise<void>((resolve, reject) => {
      const tx = other.transaction('games', 'readwrite'); fn(tx.objectStore('games')); tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error);
    });
    await update((s) => s.put({ ...game(), whiteName: 'Other tab' }));
    expect((await db.gamesRepo.get('safe'))!.whiteName).toBe('Other tab');
    await update((s) => s.delete('safe'));
    expect(await db.gamesRepo.all()).toEqual([]);
    expect(await db.gamesRepo.get('safe')).toBeUndefined(); other.close();
  });
  it('resets settings and both puzzle streak keys without touching unrelated data', async () => {
    const db = await import('../src/storage/db');
    await db.gamesRepo.save(game());
    storage.set('checkmate:settings', '{"sound":false}');
    storage.set('checkmate:puzzle-streak', '7'); storage.set('checkmate:puzzle-streak:best', '9'); storage.set('other-app', 'keep');
    expect(await db.resetAll()).toBe(true);
    expect(await db.gamesRepo.all()).toEqual([]);
    expect([...storage]).toEqual([['other-app', 'keep']]);
  });
  it('exports and restores preferences, streak, records and scheduled lessons', async () => {
    const db = await import('../src/storage/db');
    const { saveSettings, DEFAULT_SETTINGS } = await import('../src/storage/settings');
    const { restoreStreak, puzzleStreak } = await import('../src/storage/streak');
    saveSettings({ ...DEFAULT_SETTINGS, sound: false, boardTheme: 'fog' }); restoreStreak({ current: 2, best: 7 });
    await db.gamesRepo.save(game()); await db.educationRepo.record('italian', 'practice');
    const exported = await db.exportAll(); await db.resetAll();
    await db.importAll(exported);
    expect(await db.educationRepo.all()).toHaveLength(1); expect(puzzleStreak()).toEqual({ current: 2, best: 7 });
    expect((await db.exportAll()).settings).toBe(exported.settings);
  });
});

describe('preference validation', () => {
  it('ignores invalid types and enum values without spreading unknown properties', async () => {
    const { normaliseSettings, DEFAULT_SETTINGS } = await import('../src/storage/settings');
    expect(normaliseSettings({ sound: 'false', animateMoves: null, boardTheme: 'invalid', pieceStyle: [], volume: Infinity, extra: true })).toEqual(DEFAULT_SETTINGS);
    expect(normaliseSettings({ sound: false, volume: -1 })).toMatchObject({ sound: false, volume: 0 });
    expect(normaliseSettings({ volume: 5 })).toMatchObject({ volume: 1 });
    expect(normaliseSettings({ version: 99, sound: false })).toEqual(DEFAULT_SETTINGS);
  });
  it('keeps the active session preference when a write fails', async () => {
    const { saveSettings, loadSettings, DEFAULT_SETTINGS } = await import('../src/storage/settings');
    storage.set('checkmate:settings', JSON.stringify(DEFAULT_SETTINGS));
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new Error('Quota'); });
    expect(saveSettings({ ...DEFAULT_SETTINGS, sound: false })).toBe(false);
    expect(loadSettings().sound).toBe(false);
  });
});

describe('puzzle recording', () => {
  it('serializes rapid attempts without losing a completion or the best time', async () => {
    const db = await import('../src/storage/db');
    await Promise.all([
      db.puzzlesRepo.record('p1', 'solved', 1600, 1),
      db.puzzlesRepo.record('p1', 'failed', 0, 0),
      db.puzzlesRepo.record('p1', 'solved', 900, 3),
    ]);
    expect(await db.puzzlesRepo.forPuzzle('p1')).toMatchObject({ status: 'solved', attempts: 3, bestTimeMs: 900, bestStreak: 3 });
  });

  it('includes queued puzzle writes in an immediate export', async () => {
    const db = await import('../src/storage/db');
    const pending = db.puzzlesRepo.record('p1', 'solved', 1200, 1);
    const bundle = await db.exportAll();
    expect(bundle.puzzles).toMatchObject([{ puzzleId: 'p1', attempts: 1, bestTimeMs: 1200 }]);
    await pending;
  });

  it('does not resurrect attempts queued before a reset', async () => {
    const db = await import('../src/storage/db');
    const revision = db.dataRevision();
    await db.clearAll();
    await db.puzzlesRepo.record('stale', 'solved', 500, 1, revision);
    expect(await db.puzzlesRepo.all()).toEqual([]);
  });
});

describe('castling backup reconstruction', () => {
  it('does not mistake queenside castling for an en-passant capture', async () => {
    const db = await import('../src/storage/db');
    await db.importAll(backup({ games: [{ ...game('castle'), startFen: 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1', moves: [{ uci: 'e1c1', san: '', fenAfter: '', msElapsed: 0, capture: true, check: false }] }] }));
    expect((await db.gamesRepo.get('castle'))!.moves[0]).toMatchObject({ san: 'O-O-O', capture: false, fenAfter: 'r3k2r/8/8/8/8/8/8/2KR3R b kq - 1 1' });
  });
});
