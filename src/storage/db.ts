/**
 * Persistence — IndexedDB for game data, localStorage for lightweight
 * preferences. Every operation degrades gracefully: if storage is unavailable
 * (private mode, sandboxed iframe), an in-memory store keeps the app usable.
 */
import type { StoredGame, PuzzleProgress, EloResult, ExportBundle } from './schema';

export type { StoredGame, PuzzleProgress, EloResult, ExportBundle, GameAnalysis, MoveRecord, GameMode } from './schema';

const DB_NAME = 'checkmate';
const DB_VERSION = 1;
const STORES = ['games', 'puzzles', 'elo', 'kv'] as const;
export type StoreName = (typeof STORES)[number];

const memory: Record<string, Map<string | number, unknown>> = {
  games: new Map(),
  puzzles: new Map(),
  elo: new Map(),
  kv: new Map(),
};

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve(null);
      return;
    }
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const s of STORES) {
          if (!db.objectStoreNames.contains(s)) {
            db.createObjectStore(s, { keyPath: s === 'games' || s === 'elo' ? 'id' : 'key' });
          }
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

async function withStore<T>(
  store: StoreName,
  mode: IDBTransactionMode,
  fn: (os: IDBObjectStore) => IDBRequest,
): Promise<T | null> {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(store, mode);
      const req = fn(tx.objectStore(store));
      req.onsuccess = () => resolve(req.result as T);
      req.onerror = () => resolve(null);
      tx.onabort = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/** Memory fallback always works — used when IDB is unavailable. */
const memoryGet = async <T,>(store: StoreName, key: string | number): Promise<T | undefined> => {
  const m = memory[store] as Map<string | number, unknown>;
  return Promise.resolve(m.get(key) as T | undefined);
};

export const dbAvailable = async (): Promise<boolean> => (await openDb()) !== null;

export async function put<T extends { key?: string | number; id?: string | number }>(store: StoreName, value: T): Promise<void> {
  const key = (value.id ?? value.key) as string | number;
  (memory[store] as Map<string | number, unknown>).set(key, value);
  await withStore(store, 'readwrite', (os) => os.put(value));
}

export async function get<T>(store: StoreName, key: string | number): Promise<T | undefined> {
  const viaIdb = await withStore<T>(store, 'readonly', (os) => os.get(key));
  if (viaIdb !== null && viaIdb !== undefined) return viaIdb;
  return memoryGet<T>(store, key);
}

export async function getAll<T>(store: StoreName): Promise<T[]> {
  const viaIdb = await withStore<T[]>(store, 'readonly', (os) => os.getAll());
  if (viaIdb && Array.isArray(viaIdb)) {
    // merge with memory (memory is authoritative for the session)
    const m = memory[store] as Map<string | number, unknown>;
    const seen = new Set<string | number>();
    const out: T[] = [];
    for (const v of viaIdb) {
      const k = (v as { id?: string | number; key?: string | number }).id ?? (v as { key?: string | number }).key;
      seen.add(k!);
      const live = m.get(k!) as T | undefined;
      out.push(live ?? v);
    }
    for (const [k, v] of m.entries()) if (!seen.has(k)) out.push(v as T);
    return out;
  }
  return Promise.resolve(Array.from((memory[store] as Map<string | number, unknown>).values()) as T[]);
}

export async function remove(store: StoreName, key: string | number): Promise<void> {
  (memory[store] as Map<string | number, unknown>).delete(key);
  await withStore(store, 'readwrite', (os) => os.delete(key));
}

export async function clearStore(store: StoreName): Promise<void> {
  (memory[store] as Map<string | number, unknown>).clear();
  await withStore(store, 'readwrite', (os) => os.clear());
}

export async function clearAll(): Promise<void> {
  for (const s of STORES) await clearStore(s);
}

// ---------------------------------------------------------------- repositories

export const gamesRepo = {
  async save(game: StoredGame): Promise<void> {
    await put('games', game);
  },
  async all(): Promise<StoredGame[]> {
    const games = await getAll<StoredGame>('games');
    return games.sort((a, b) => b.date - a.date);
  },
  async get(id: string): Promise<StoredGame | undefined> {
    return get<StoredGame>('games', id);
  },
  async remove(id: string): Promise<void> {
    await remove('games', id);
  },
};

export const puzzlesRepo = {
  async put(progress: PuzzleProgress): Promise<void> {
    await put('puzzles', progress);
  },
  async all(): Promise<PuzzleProgress[]> {
    return getAll<PuzzleProgress>('puzzles');
  },
  async forPuzzle(puzzleId: string): Promise<PuzzleProgress | undefined> {
    return get<PuzzleProgress>('puzzles', puzzleId);
  },
  async summary(): Promise<{ solved: number; attempted: number; streak: number; bestStreak: number; totalTimeMs: number; totalAttempts: number }> {
    const all = await getAll<PuzzleProgress>('puzzles');
    const solved = all.filter((p) => p.status === 'solved');
    const streak = all.filter((p) => p.status === 'solved').length; // recomputed live by UI with ordering
    return {
      solved: solved.length,
      attempted: all.length,
      streak,
      bestStreak: all.reduce((a, p) => Math.max(a, p.bestStreak ?? 0), 0),
      totalTimeMs: solved.reduce((a, p) => a + (p.bestTimeMs ?? 0), 0),
      totalAttempts: all.reduce((a, p) => a + (p.attempts ?? 0), 0),
    };
  },
};

export const eloRepo = {
  async save(result: EloResult): Promise<void> {
    await put('elo', result);
  },
  async all(): Promise<EloResult[]> {
    const rows = await getAll<EloResult>('elo');
    return rows.sort((a, b) => b.date - a.date);
  },
};

// ------------------------------------------------------------------ export

export async function exportAll(): Promise<ExportBundle> {
  const [games, puzzles, elo] = await Promise.all([
    getAll<StoredGame>('games'),
    getAll<PuzzleProgress>('puzzles'),
    getAll<EloResult>('elo'),
  ]);
  let settings: string | null = null;
  try {
    settings = localStorage.getItem('checkmate:settings') ?? null;
  } catch {
    settings = null;
  }
  return {
    version: 1,
    exportedAt: Date.now(),
    games,
    puzzles,
    elo,
    settings,
  };
}

export async function importAll(bundle: ExportBundle, { wipe = true }: { wipe?: boolean } = {}): Promise<{ games: number; puzzles: number; elo: number }> {
  if (!bundle || typeof bundle !== 'object' || !Array.isArray(bundle.games)) {
    throw new Error('Not a CHECKMATE export file');
  }
  if (wipe) await clearAll();
  let games = 0, puzzles = 0, elo = 0;
  for (const g of bundle.games ?? []) {
    if (!g || typeof g.id !== 'string' || !Array.isArray(g.moves)) continue;
    await put('games', g);
    games++;
  }
  for (const p of bundle.puzzles ?? []) {
    if (!p || typeof p.puzzleId !== 'string') continue;
    await put('puzzles', p);
    puzzles++;
  }
  for (const e of bundle.elo ?? []) {
    if (!e || typeof e.rating !== 'number') continue;
    await put('elo', e);
    elo++;
  }
  if (bundle.settings) {
    try {
      localStorage.setItem('checkmate:settings', bundle.settings);
    } catch {
      /* storage unavailable — ignore */
    }
  }
  return { games, puzzles, elo };
}
