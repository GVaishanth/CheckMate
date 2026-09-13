/**
 * Zobrist hashing with a deterministic seeded PRNG so the worker, the
 * main-thread fallback engine and the offline puzzle generator all agree.
 *
 * Two independent 32-bit keys form a 64-bit position key. The transposition
 * table indexes by the low key and verifies with the high key.
 */

// mulberry32 — small, fast, deterministic.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand32from = (rng: () => number) => (rng() * 0x100000000) >>> 0;

function makeTable(rng: () => number, size: number): Int32Array {
  const t = new Int32Array(size);
  for (let i = 0; i < size; i++) t[i] = rand32from(rng);
  return t;
}

const rngLo = mulberry32(0x9e3779b9);
const rngHi = mulberry32(0x85ebca6b);

// pieceKeys[pieceCode 0..14][square 0..127] — codes 0, 7 and 8 are unused slots.
export const PIECE_KEYS_LO: Int32Array[] = [];
export const PIECE_KEYS_HI: Int32Array[] = [];
for (let p = 0; p < 15; p++) {
  PIECE_KEYS_LO.push(makeTable(rngLo, 128));
  PIECE_KEYS_HI.push(makeTable(rngHi, 128));
}

export const CASTLE_KEYS_LO = makeTable(rngLo, 16);
export const CASTLE_KEYS_HI = makeTable(rngHi, 16);
export const EP_KEYS_LO = makeTable(rngLo, 8); // indexed by file
export const EP_KEYS_HI = makeTable(rngHi, 8);
export const SIDE_KEY_LO = rand32from(rngLo);
export const SIDE_KEY_HI = rand32from(rngHi);

export interface HashState {
  lo: number;
  hi: number;
}

export const hashPiece = (h: HashState, piece: number, sq: number): void => {
  h.lo = (h.lo ^ PIECE_KEYS_LO[piece]![sq]) >>> 0;
  h.hi = (h.hi ^ PIECE_KEYS_HI[piece]![sq]) >>> 0;
};
export const hashCastling = (h: HashState, rights: number): void => {
  h.lo = (h.lo ^ CASTLE_KEYS_LO[rights]) >>> 0;
  h.hi = (h.hi ^ CASTLE_KEYS_HI[rights]) >>> 0;
};
export const hashEp = (h: HashState, file: number): void => {
  h.lo = (h.lo ^ EP_KEYS_LO[file]) >>> 0;
  h.hi = (h.hi ^ EP_KEYS_HI[file]) >>> 0;
};
export const hashSide = (h: HashState): void => {
  h.lo = (h.lo ^ SIDE_KEY_LO) >>> 0;
  h.hi = (h.hi ^ SIDE_KEY_HI) >>> 0;
};
