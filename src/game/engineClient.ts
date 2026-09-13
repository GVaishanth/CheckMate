/**
 * Engine client — talk to the engine worker; fall back to a synchronous
 * main-thread engine if workers are unavailable or fail. All consumers use
 * this promise-based API and never touch the worker directly.
 */
import type { BotStyle } from '../engine/bots';

export interface SearchReply {
  uci: string | null;
  fromBook: boolean;
  score: number;
  depth: number;
  nodes: number;
  ms: number;
  pv: string[];
}

export interface DrawDecision {
  accept: boolean;
  scoreCp: number;
}

type Pending = {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  onProgress?: (data: unknown) => void;
};

class EngineClient {
  private worker: Worker | null = null;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private fallback: Promise<typeof import('../engine/index')> | null = null;
  workerFailed = false;

  private ensureWorker(): Worker | null {
    if (this.workerFailed) return null;
    if (this.worker) return this.worker;
    try {
      this.worker = new Worker(new URL('../workers/engine.worker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (ev: MessageEvent) => this.onMessage(ev.data);
      this.worker.onerror = () => this.degrade();
      return this.worker;
    } catch {
      this.degrade();
      return null;
    }
  }

  private degrade(): void {
    this.workerFailed = true;
    this.worker?.terminate();
    this.worker = null;
    for (const [, p] of this.pending) p.reject(new Error('engine-worker-failed'));
    this.pending.clear();
  }

  private onMessage(msg: Record<string, unknown>): void {
    if (typeof msg.id !== 'number') return;
    const entry = this.pending.get(msg.id);
    if (!entry) return;
    const t = msg.t as string;
    if (t === 'error') {
      this.pending.delete(msg.id);
      entry.reject(new Error(String(msg.message)));
      return;
    }
    if (t.endsWith('-progress')) {
      entry.onProgress?.(msg);
      return;
    }
    this.pending.delete(msg.id);
    entry.resolve(msg);
  }

  private request(payload: Record<string, unknown>, onProgress?: (data: unknown) => void): Promise<Record<string, unknown>> {
    const worker = this.ensureWorker();
    if (!worker) return this.requestFallback(payload);
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        onProgress,
      });
      worker.postMessage({ ...payload, id });
    });
  }

  /** Synchronous fallback on the main thread (workers unavailable). */
  private async requestFallback(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    this.fallback ??= import('../engine/index');
    const eng = await this.fallback;
    switch (payload.t) {
      case 'search': {
        const pos = eng.Position.fromFen(payload.startFen as string);
        pos.playUciMoves((payload.moves as string[]) ?? []);
        const d = eng.botMove(pos, payload.style as BotStyle, (payload.seed as number) ?? undefined);
        return { t: 'search-result', uci: d.uci, fromBook: d.fromBook, score: d.score, depth: d.depth, nodes: d.nodes, ms: d.ms, pv: d.pv };
      }
      case 'eval-draw': {
        const pos = eng.Position.fromFen(payload.startFen as string);
        pos.playUciMoves((payload.moves as string[]) ?? []);
        const bot = eng.botById((payload.botId as string) ?? 'club');
        const r = eng.findBestMove(pos, { maxDepth: 4, softMs: 300 });
        let accept = Math.abs(r.score) < 60;
        if (bot && (bot.id === 'rookie' || bot.id === 'apprentice') && Math.abs(r.score) < 150) accept = Math.random() < 0.4;
        return { t: 'eval-draw-result', accept, scoreCp: r.score };
      }
      case 'analyze-game': {
        const losses: number[] = [];
        const pos = eng.Position.fromFen(payload.startFen as string);
        for (const uci of (payload.moves as string[]) ?? []) {
          const q = eng.analyzeMoveQuality(pos, uci, (payload.depth as number) ?? 6);
          losses.push(Math.min(600, q.lossCp));
          pos.playUci(uci);
        }
        return { t: 'analyze-game-result', losses };
      }
      case 'eval': {
        const pos = eng.Position.fromFen(payload.fen as string);
        return { t: 'eval-result', cp: eng.evaluateWhiteCp(pos, 'full') };
      }
      case 'analyze-review': {
        const pos = eng.Position.fromFen(payload.startFen as string);
        const depth = (payload.depth as number) ?? 6;
        const losses: number[] = [];
        const bests: (string | null)[] = [];
        for (const uci of (payload.moves as string[]) ?? []) {
          const q = eng.analyzeMoveQuality(pos, uci, depth);
          losses.push(Math.min(600, q.lossCp));
          bests.push(q.lossCp > 0 ? q.bestUci : null);
          pos.playUci(uci);
        }
        return { t: 'analyze-review-result', losses, bests };
      }
      case 'analyze-move': {
        const pos = eng.Position.fromFen(payload.fen as string);
        const q = eng.analyzeMoveQuality(pos, payload.uci as string, (payload.depth as number) ?? 8);
        return { t: 'analyze-move-result', lossCp: q.lossCp, bestUci: q.bestUci, bestScore: q.bestScore };
      }
      default:
        return {};
    }
  }

  async search(args: {
    gameId: string;
    startFen: string;
    moves: string[];
    style: BotStyle;
    seed?: number;
    onProgress?: (p: { depth: number; nodes: number; ms: number }) => void;
  }): Promise<SearchReply> {
    try {
      const r = await this.request({ t: 'search', ...args }, args.onProgress as never);
      return r as unknown as SearchReply;
    } catch (err) {
      if ((err as Error).message === 'engine-worker-failed') throw err;
      // Worker path threw a logic error — retry on main thread.
      const r = await this.requestFallback({ t: 'search', ...args });
      return r as unknown as SearchReply;
    }
  }

  async evalDraw(args: { startFen: string; moves: string[]; botId: string }): Promise<DrawDecision> {
    try {
      const r = await this.request({ t: 'eval-draw', ...args });
      return r as unknown as DrawDecision;
    } catch {
      const r = await this.requestFallback({ t: 'eval-draw', ...args });
      return r as unknown as DrawDecision;
    }
  }

  async analyzeGame(
    args: { startFen: string; moves: string[]; depth?: number },
    onProgress?: (p: { done: number; total: number }) => void,
  ): Promise<{ losses: number[] }> {
    try {
      const r = await this.request({ t: 'analyze-game', ...args }, onProgress as never);
      return r as unknown as { losses: number[] };
    } catch {
      const r = await this.requestFallback({ t: 'analyze-game', ...args });
      return r as unknown as { losses: number[] };
    }
  }

  /** Per-ply loss + best move for the post-game review (progressive). */
  async analyzeReview(
    args: { startFen: string; moves: string[]; depth?: number },
    onProgress?: (p: { done: number; total: number }) => void,
  ): Promise<{ losses: number[]; bests: (string | null)[] }> {
    try {
      const r = await this.request({ t: 'analyze-review', ...args }, onProgress as never);
      return r as unknown as { losses: number[]; bests: (string | null)[] };
    } catch {
      const r = await this.requestFallback({ t: 'analyze-review', ...args });
      return r as unknown as { losses: number[]; bests: (string | null)[] };
    }
  }

  /** Quick single-position move quality (used by puzzles + elo). */
  async analyzeMove(args: { fen: string; playedUci: string; depth?: number }): Promise<{ lossCp: number; bestUci: string; bestScore: number }> {
    this.fallback ??= import('../engine/index');
    const eng = await this.fallback;
    const pos = eng.Position.fromFen(args.fen);
    const q = eng.analyzeMoveQuality(pos, args.playedUci, args.depth ?? 8);
    return { lossCp: q.lossCp, bestUci: q.bestUci, bestScore: q.bestScore };
  }

  /** Static evaluation in centipawns from White's perspective. */
  async evaluate(fen: string): Promise<number> {
    try {
      const r = await this.request({ t: 'eval', fen });
      return (r as { cp: number }).cp;
    } catch {
      const r = await this.requestFallback({ t: 'eval', fen });
      return (r as { cp: number }).cp;
    }
  }

  newGame(gameId: string): void {
    try {
      this.ensureWorker()?.postMessage({ t: 'clear', gameId });
    } catch {
      /* fallback mode — nothing to clear */
    }
  }
}

export const engineClient = new EngineClient();
