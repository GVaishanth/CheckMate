/**
 * Transposition table: fixed-size parallel arrays indexed by the low Zobrist
 * key, verified by the high key. Depth-preferred replacement.
 */
const ENTRIES = 1 << 19; // 512k entries
const MASK = ENTRIES - 1;

export const TT_EXACT = 0;
export const TT_ALPHA = 1; // upper bound (fail-low)
export const TT_BETA = 2; // lower bound (fail-high)

export class TranspositionTable {
  private keyHi = new Uint32Array(ENTRIES);
  private score = new Int32Array(ENTRIES);
  private move = new Int32Array(ENTRIES);
  private depth = new Uint8Array(ENTRIES);
  private flag = new Uint8Array(ENTRIES);
  private used = 0;

  probe(lo: number, hi: number): { score: number; move: number; depth: number; flag: number } | null {
    hi >>>= 0;
    const idx = lo & MASK;
    if (this.keyHi[idx] !== hi) return null;
    if (this.keyHi[idx] === 0 && this.score[idx] === 0 && this.move[idx] === 0 && this.depth[idx] === 0) return null;
    return { score: this.score[idx]!, move: this.move[idx]!, depth: this.depth[idx]!, flag: this.flag[idx]! };
  }

  store(lo: number, hi: number, depth: number, score: number, flag: number, move: number): void {
    hi >>>= 0;
    const idx = lo & MASK;
    if (this.keyHi[idx] !== hi) {
      if (this.depth[idx] === 0) this.used++;
      this.keyHi[idx] = hi;
      this.depth[idx] = depth;
      this.score[idx] = score;
      this.flag[idx] = flag;
      this.move[idx] = move;
    } else if (depth >= this.depth[idx] || flag === TT_EXACT) {
      this.depth[idx] = depth;
      this.score[idx] = score;
      this.flag[idx] = flag;
      if (move) this.move[idx] = move;
    }
  }

  clear(): void {
    this.keyHi.fill(0);
    this.score.fill(0);
    this.move.fill(0);
    this.depth.fill(0);
    this.flag.fill(0);
    this.used = 0;
  }

  get usage(): number {
    return this.used / ENTRIES;
  }
}
