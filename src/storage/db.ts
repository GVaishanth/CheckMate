import type { StoredGame, PuzzleProgress, EloResult, ExportBundle } from './schema';
import { normaliseEducation, recordLesson } from '../education/progress';
import type { LessonProgress } from '../education/progress';
import type { LessonStage } from '../education/lessons';
import { loadSettings, saveSettings, wipeSettings } from './settings';
import { puzzleStreak, restoreStreak, wipeStreak } from './streak';
import { validateBackup } from './validation';

export type { StoredGame, PuzzleProgress, EloResult, ExportBundle, GameAnalysis, MoveRecord, GameMode } from './schema';
const STORES = ['games', 'puzzles', 'elo', 'kv'] as const;
export type StoreName = (typeof STORES)[number];
type Key = string | number;
const memory = Object.fromEntries(STORES.map((s) => [s, new Map<Key, unknown>()])) as Record<StoreName, Map<Key, unknown>>;
const dirty = Object.fromEntries(STORES.map((s) => [s, new Map<Key, number>()])) as Record<StoreName, Map<Key, number>>;
const cleared = new Map<StoreName, number>();
let writeSequence = 0;
const copy = <T,>(value: T): T => typeof structuredClone === 'function' ? structuredClone(value) : value === undefined ? value : JSON.parse(JSON.stringify(value)) as T;
const keyOf = (value: unknown): Key | undefined => {
  if (!value || typeof value !== 'object') return undefined;
  const row = value as { id?: Key; key?: Key };
  return row.id ?? row.key;
};
let dbPromise: Promise<IDBDatabase | null> | null = null;
let storageFailed = false;
let educationWrites: Promise<void> = Promise.resolve();
let puzzleWrites: Promise<void> = Promise.resolve();
let revision = 0;
let changing: Promise<void> | null = null;
export const dataRevision = () => revision;
const EDUCATION_KEY = 'education:v1';

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') { resolve(null); return; }
    let settled = false;
    const finish = (db: IDBDatabase | null) => { if (!settled) { settled = true; clearTimeout(timer); resolve(db); } };
    const timer = setTimeout(() => finish(null), 8000);
    try {
      const req = indexedDB.open('checkmate', 1);
      req.onupgradeneeded = () => {
        try {
          for (const store of STORES) if (!req.result.objectStoreNames.contains(store)) {
            req.result.createObjectStore(store, { keyPath: store === 'games' || store === 'elo' ? 'id' : 'key' });
          }
        } catch { req.transaction?.abort(); finish(null); }
      };
      req.onsuccess = () => {
        if (settled) { req.result.close(); return; }
        const db = req.result;
        db.onversionchange = () => { db.close(); dbPromise = null; storageFailed = true; };
        finish(db);
      };
      req.onerror = () => finish(null);
      req.onblocked = () => finish(null);
    } catch { finish(null); }
  });
  return dbPromise;
}
function transaction<T>(db: IDBDatabase, store: StoreName, mode: IDBTransactionMode, fn: (os: IDBObjectStore) => IDBRequest): Promise<T | null> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (value: T | null) => { if (!done) { done = true; clearTimeout(timer); resolve(value); } };
    let tx: IDBTransaction | undefined;
    const fail = () => { storageFailed = true; finish(null); };
    const timer = setTimeout(() => { try { tx?.abort(); } catch { /* transaction already closed */ } fail(); }, 8000);
    try {
      tx = db.transaction(store, mode);
      const req = fn(tx.objectStore(store));
      let result: T | null = null;
      req.onsuccess = () => { result = req.result as T; if (mode === 'readonly') finish(result); };
      req.onerror = fail;
      tx.onabort = fail;
      if (mode === 'readwrite') tx.oncomplete = () => finish(result);
    } catch { fail(); }
  });
}
async function read<T>(store: StoreName, fn: (os: IDBObjectStore) => IDBRequest): Promise<T | null> {
  const db = await openDb();
  return db ? transaction<T>(db, store, 'readonly', fn) : null;
}
export const dbAvailable = async (): Promise<boolean> => (await openDb()) !== null && !storageFailed;

async function write(expected: number, job: (db: IDBDatabase | null) => Promise<void>): Promise<void> {
  const db = await openDb();
  while (changing) await changing;
  if (expected === revision) return job(db);
}
async function changeRecords<T>(job: () => Promise<T>): Promise<T> {
  let release!: () => void;
  changing = new Promise<void>((resolve) => { release = resolve; });
  try {
    const result = await job();
    revision++;
    return result;
  } finally { changing = null; release(); }
}
export async function put<T extends { key?: Key; id?: Key }>(store: StoreName, value: T, expectedRevision = revision): Promise<void> {
  const snapshot = copy(value), key = keyOf(snapshot);
  if (key === undefined || (typeof key === 'number' && !Number.isFinite(key))) throw new Error('Record has no valid key.');
  return write(expectedRevision, async (db) => {
    const ticket = ++writeSequence;
    memory[store].set(key, snapshot); dirty[store].set(key, ticket);
    if (db && await transaction(db, store, 'readwrite', (os) => os.put(snapshot)) !== null && dirty[store].get(key) === ticket) dirty[store].delete(key);
  });
}

export async function get<T>(store: StoreName, key: Key): Promise<T | undefined> {
  if (dirty[store].has(key) || cleared.has(store)) return copy(memory[store].get(key) as T | undefined);
  const value = await read<T | undefined>(store, (os) => os.get(key));
  if (dirty[store].has(key) || cleared.has(store)) return copy(memory[store].get(key) as T | undefined);
  if (value !== null) {
    if (value === undefined) memory[store].delete(key); else memory[store].set(key, value);
  }
  return copy(memory[store].get(key) as T | undefined);
}
export async function getAll<T>(store: StoreName): Promise<T[]> {
  const values = cleared.has(store) ? null : await read<T[]>(store, (os) => os.getAll());
  if (Array.isArray(values) && !cleared.has(store)) {
    const seen = new Set<Key>();
    for (const value of values) {
      const key = keyOf(value);
      if (key === undefined) continue;
      seen.add(key);
      if (!dirty[store].has(key)) memory[store].set(key, value);
    }
    for (const key of memory[store].keys()) if (!seen.has(key) && !dirty[store].has(key)) memory[store].delete(key);
  }
  return copy(Array.from(memory[store].values()) as T[]);
}
export async function remove(store: StoreName, key: Key): Promise<void> {
  return write(revision, async (db) => {
    const ticket = ++writeSequence;
    memory[store].delete(key); dirty[store].set(key, ticket);
    if (db && await transaction(db, store, 'readwrite', (os) => os.delete(key)) !== null && dirty[store].get(key) === ticket) dirty[store].delete(key);
  });
}
export async function clearStore(store: StoreName): Promise<void> {
  return write(revision, async (db) => {
    const ticket = ++writeSequence;
    memory[store].clear(); dirty[store].clear(); cleared.set(store, ticket);
    if (db && await transaction(db, store, 'readwrite', (os) => os.clear()) !== null && cleared.get(store) === ticket) cleared.delete(store);
  });
}
function queueEducation<T>(job: () => Promise<T>): Promise<T> {
  const task = educationWrites.then(job);
  educationWrites = task.then(() => undefined, () => undefined);
  return task;
}
function bulk(db: IDBDatabase, operation: (tx: IDBTransaction) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    let tx: IDBTransaction | undefined;
    const timer = setTimeout(() => { try { tx?.abort(); } catch { /* transaction already closed */ } reject(new Error('Storage timed out; restore did not complete.')); }, 30_000);
    const fail = () => { clearTimeout(timer); reject(new Error('Storage rejected the change. Existing records were not replaced.')); };
    try {
      tx = db.transaction([...STORES], 'readwrite');
      tx.oncomplete = () => { clearTimeout(timer); resolve(); };
      tx.onabort = fail;
      operation(tx);
    } catch { try { tx?.abort(); } catch { /* transaction already closed */ } fail(); }
  });
}
function clearMemory(): void {
  for (const store of STORES) { memory[store].clear(); dirty[store].clear(); }
  cleared.clear();
}
export function clearAll(): Promise<void> {
  return queueEducation(() => changeRecords(async () => {
    const db = await openDb();
    if (db) await bulk(db, (tx) => { for (const store of STORES) tx.objectStore(store).clear(); });
    clearMemory();
    if (db) storageFailed = false;
  }));
}

export const gamesRepo = {
  async save(game: StoredGame, expectedRevision = revision): Promise<void> { await put('games', game, expectedRevision); },
  async all(): Promise<StoredGame[]> { return (await getAll<StoredGame>('games')).sort((a, b) => b.date - a.date); },
  async get(id: string): Promise<StoredGame | undefined> { return get<StoredGame>('games', id); },
  async remove(id: string): Promise<void> { await remove('games', id); },
};
export const puzzlesRepo = {
  record(puzzleId: string, status: 'solved' | 'failed', timeMs: number, streak: number, expectedRevision = revision): Promise<void> {
    const task = puzzleWrites.then(async () => {
      const previous = await get<PuzzleProgress>('puzzles', puzzleId);
      if (expectedRevision !== revision) return;
      await put('puzzles', { key: puzzleId, puzzleId, status: previous?.status === 'solved' ? 'solved' : status,
        attempts: (previous?.attempts ?? 0) + 1,
        bestTimeMs: status === 'solved' ? Math.min(previous?.bestTimeMs ?? Infinity, timeMs) : previous?.bestTimeMs,
        bestStreak: Math.max(previous?.bestStreak ?? 0, status === 'solved' ? streak : 0),
        solvedAt: status === 'solved' ? Date.now() : previous?.solvedAt, lastTriedAt: Date.now() }, expectedRevision);
    });
    puzzleWrites = task.then(() => undefined, () => undefined);
    return task;
  },
  async put(progress: PuzzleProgress, expectedRevision = revision): Promise<void> { await put('puzzles', progress, expectedRevision); },
  async all(): Promise<PuzzleProgress[]> { return getAll<PuzzleProgress>('puzzles'); },
  async forPuzzle(puzzleId: string): Promise<PuzzleProgress | undefined> { return get<PuzzleProgress>('puzzles', puzzleId); },
  async summary(): Promise<{ solved: number; attempted: number; streak: number; bestStreak: number; totalTimeMs: number; totalAttempts: number }> {
    const all = await getAll<PuzzleProgress>('puzzles'), solved = all.filter((p) => p.status === 'solved');
    return { solved: solved.length, attempted: all.length, streak: puzzleStreak().current,
      bestStreak: Math.max(puzzleStreak().best, ...all.map((p) => p.bestStreak ?? 0)), totalTimeMs: solved.reduce((a, p) => a + (p.bestTimeMs ?? 0), 0), totalAttempts: all.reduce((a, p) => a + (p.attempts ?? 0), 0) };
  },
};
export const eloRepo = {
  async save(result: EloResult, expectedRevision = revision): Promise<void> { await put('elo', result, expectedRevision); },
  async all(): Promise<EloResult[]> { return (await getAll<EloResult>('elo')).sort((a, b) => b.date - a.date); },
};
export const educationRepo = {
  async all(): Promise<LessonProgress[]> {
    await educationWrites;
    return normaliseEducation((await get<{ key: string; value: unknown }>('kv', EDUCATION_KEY))?.value);
  },
  record(lessonId: string, stage: LessonStage, clean = true, expectedRevision = revision): Promise<LessonProgress> {
    return queueEducation(async () => {
      const stored = await get<{ key: string; value: unknown }>('kv', EDUCATION_KEY);
      const rows = normaliseEducation(stored?.value);
      const next = recordLesson(rows.find((row) => row.lessonId === lessonId), lessonId, stage, clean);
      if (expectedRevision === revision) await put('kv', { key: EDUCATION_KEY, value: [...rows.filter((row) => row.lessonId !== lessonId), next] }, expectedRevision);
      return next;
    });
  },
};
export async function exportAll(): Promise<ExportBundle> {
  await Promise.all([educationWrites, puzzleWrites]);
  const [games, puzzles, elo, education] = await Promise.all([getAll<StoredGame>('games'), getAll<PuzzleProgress>('puzzles'), getAll<EloResult>('elo'), educationRepo.all()]);
  return { version: 1, exportedAt: Date.now(), games, puzzles, elo, education, settings: JSON.stringify(loadSettings()), puzzleStreak: puzzleStreak() };
}
export async function importAll(value: unknown, { wipe = true }: { wipe?: boolean } = {}): Promise<{ games: number; puzzles: number; elo: number; education: number; persistent: boolean }> {
  // Validate and replay every record before opening the destructive transaction.
  const bundle = await validateBackup(value);
  return queueEducation(() => changeRecords(async () => {
    const imported = normaliseEducation(bundle.education);
    const previous = wipe ? [] : normaliseEducation((await get<{ key: string; value: unknown }>('kv', EDUCATION_KEY))?.value);
    const education = { key: EDUCATION_KEY, value: normaliseEducation([...previous, ...imported]) };
    const db = await openDb();
    if (db) await bulk(db, (tx) => {
      if (wipe) for (const store of STORES) tx.objectStore(store).clear();
      for (const game of bundle.games) tx.objectStore('games').put(game);
      for (const puzzle of bundle.puzzles) tx.objectStore('puzzles').put(puzzle);
      for (const result of bundle.elo) tx.objectStore('elo').put(result);
      tx.objectStore('kv').put(education);
    });
    if (wipe) { clearMemory(); if (db) storageFailed = false; }
    for (const [store, records] of [['games', bundle.games], ['puzzles', bundle.puzzles], ['elo', bundle.elo], ['kv', [education]]] as const) {
      for (const record of records) {
        const key = keyOf(record)!; memory[store].set(key, copy(record));
        if (db) dirty[store].delete(key); else dirty[store].set(key, ++writeSequence);
      }
    }
    let preferencesOk = true;
    if (bundle.settings) preferencesOk = saveSettings(JSON.parse(bundle.settings));
    else if (wipe) preferencesOk = wipeSettings();
    if (bundle.puzzleStreak) preferencesOk = restoreStreak(bundle.puzzleStreak) && preferencesOk;
    else if (wipe) preferencesOk = restoreStreak({ current: 0, best: bundle.puzzles.reduce((best, p) => Math.max(best, p.bestStreak ?? 0), 0) }) && preferencesOk;
    return { games: bundle.games.length, puzzles: bundle.puzzles.length, elo: bundle.elo.length, education: imported.length, persistent: db !== null && !storageFailed && preferencesOk };
  }));
}

export async function resetAll(): Promise<boolean> {
  await clearAll();
  const settingsOk = wipeSettings(), streakOk = wipeStreak();
  return settingsOk && streakOk && await dbAvailable();
}
