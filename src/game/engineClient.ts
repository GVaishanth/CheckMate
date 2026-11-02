/** Worker-backed search and analysis with a bounded, session-only fallback. */
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
export interface DrawDecision { accept: boolean; scoreCp: number }
type PositionArgs = { startFen: string; moves: string[]; variant?: 'three-check' | 'koth' };
type AnalysisArgs = PositionArgs & { depth?: number; signal?: AbortSignal };
type Progress = (data: Record<string, unknown>) => void;
type Pending = {
  resolve: (value: Record<string, unknown>) => void;
  reject: (err: Error) => void;
  onProgress?: Progress;
  timer: ReturnType<typeof setTimeout>;
};
const aborted = () => new DOMException('Analysis cancelled', 'AbortError');
const checkAbort = (signal?: AbortSignal) => { if (signal?.aborted) throw aborted(); };
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const uci = (value: unknown): value is string => typeof value === 'string' && /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(value);
function lossesOf(result: Record<string, unknown>, count: number): number[] {
  if (!Array.isArray(result.losses) || result.losses.length !== count || !result.losses.every((loss) => finite(loss) && loss >= 0)) throw new Error('Incomplete engine analysis');
  return result.losses as number[];
}
const yieldUi = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

export class EngineClient {
  private worker: Worker | null = null;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private fallback: Promise<typeof import('../engine/index')> | null = null;
  workerFailed = false;

  private ensureWorker(): Worker | null {
    if (this.workerFailed) return null;
    if (this.worker) return this.worker;
    try {
      const worker = new Worker(new URL('../workers/engine.worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (ev: MessageEvent) => this.onMessage(ev.data);
      worker.onerror = (event) => { event.preventDefault(); this.degrade(); };
      worker.onmessageerror = () => this.degrade();
      this.worker = worker;
      return worker;
    } catch {
      this.degrade();
      return null;
    }
  }

  private degrade(): void {
    this.workerFailed = true;
    this.worker?.terminate();
    this.worker = null;
    const requests = [...this.pending.values()];
    this.pending.clear();
    for (const request of requests) request.reject(new Error('engine-worker-failed'));
  }

  private onMessage(msg: unknown): void {
    if (!msg || typeof msg !== 'object') return;
    const data = msg as Record<string, unknown>;
    if (typeof data.id !== 'number' || typeof data.t !== 'string') return;
    const entry = this.pending.get(data.id);
    if (!entry) return;
    if (data.t.endsWith('-progress')) {
      clearTimeout(entry.timer);
      entry.timer = setTimeout(() => this.degrade(), 30_000);
      entry.onProgress?.(data);
      return;
    }
    this.pending.delete(data.id);
    if (data.t === 'error') entry.reject(data.cancelled ? aborted() : new Error(String(data.message)));
    else entry.resolve(data);
  }

  private async request(payload: Record<string, unknown>, onProgress?: Progress, signal?: AbortSignal): Promise<Record<string, unknown>> {
    checkAbort(signal);
    const worker = this.ensureWorker();
    if (!worker) return this.requestFallback(payload, onProgress, signal);
    const id = this.nextId++;
    try {
      return await new Promise<Record<string, unknown>>((resolve, reject) => {
        const cleanup = () => {
          clearTimeout(entry.timer);
          signal?.removeEventListener('abort', cancel);
        };
        const cancel = () => {
          this.pending.delete(id);
          try { worker.postMessage({ t: 'cancel', cancelId: id }); } catch { /* already closed */ }
          entry.reject(aborted());
        };
        const entry: Pending = {
          resolve: (data) => { cleanup(); resolve(data); },
          reject: (error) => { cleanup(); reject(error); },
          onProgress,
          timer: setTimeout(() => this.degrade(), 30_000),
        };
        this.pending.set(id, entry);
        signal?.addEventListener('abort', cancel, { once: true });
        try { worker.postMessage({ ...payload, id }); }
        catch (error) { this.pending.delete(id); entry.reject(error as Error); }
      });
    } catch (error) {
      if ((error as Error).name === 'AbortError') throw error;
      checkAbort(signal);
      return this.requestFallback(payload, onProgress, signal);
    }
  }

  private fallbackPosition(eng: typeof import('../engine/index'), payload: Record<string, unknown>) {
    const pos = eng.Position.fromFen(payload.startFen as string);
    const variant = payload.variant;
    if (variant === 'three-check' || variant === 'koth') pos.applyVariant(variant);
    pos.playUciMoves((payload.moves as string[]) ?? []);
    return pos;
  }

  private async requestFallback(payload: Record<string, unknown>, onProgress?: Progress, signal?: AbortSignal): Promise<Record<string, unknown>> {
    checkAbort(signal);
    this.fallback ??= import('../engine/index');
    const eng = await this.fallback;
    await yieldUi();
    checkAbort(signal);
    switch (payload.t) {
      case 'search': {
        const pos = this.fallbackPosition(eng, payload);
        const style = payload.style as BotStyle;
        const decision = eng.botMove(pos, { ...style, softMs: Math.max(30, Math.min(200, style.softMs / 10)) }, payload.seed as number | undefined);
        return { ...decision };
      }
      case 'eval-draw': {
        const pos = this.fallbackPosition(eng, payload);
        const bot = eng.botById((payload.botId as string) ?? 'club');
        const result = eng.findBestMove(pos, { maxDepth: 3, softMs: 80 });
        let accept = Math.abs(result.score) < 60;
        if (bot && (bot.id === 'rookie' || bot.id === 'apprentice') && Math.abs(result.score) < 150) accept = Math.random() < 0.4;
        return { accept, scoreCp: result.score };
      }
      case 'analyze-game':
      case 'analyze-review': {
        const pos = this.fallbackPosition(eng, { ...payload, moves: [] });
        const moves = (payload.moves as string[]) ?? [];
        const losses: number[] = [], bests: (string | null)[] = [];
        for (const uci of moves) {
          checkAbort(signal);
          const q = eng.analyzeMoveQuality(pos, uci, Math.min(4, (payload.depth as number) ?? 4), 70);
          losses.push(Math.min(600, q.lossCp)); bests.push(q.lossCp > 0 ? q.bestUci : null);
          pos.playUci(uci);
          onProgress?.({ done: losses.length, total: moves.length });
          await yieldUi();
        }
        checkAbort(signal);
        return { losses, bests };
      }
      case 'eval': {
        const pos = eng.Position.fromFen(payload.fen as string);
        return { cp: eng.evaluateWhiteCp(pos, 'full') };
      }
      case 'analyze-move': {
        const pos = eng.Position.fromFen(payload.fen as string);
        const q = eng.analyzeMoveQuality(pos, payload.uci as string, Math.min(4, (payload.depth as number) ?? 4), 70);
        return { lossCp: q.lossCp, bestUci: q.bestUci, bestScore: q.bestScore };
      }
      default: throw new Error('Unknown engine request');
    }
  }

  async search(args: PositionArgs & {
    gameId: string; style: BotStyle; seed?: number; signal?: AbortSignal;
    onProgress?: (p: { depth: number; nodes: number; ms: number }) => void;
  }): Promise<SearchReply> {
    const { onProgress, signal, ...payload } = args;
    return await this.request({ t: 'search', ...payload }, onProgress as Progress | undefined, signal) as unknown as SearchReply;
  }

  async evalDraw(args: PositionArgs & { botId: string; signal?: AbortSignal }): Promise<DrawDecision> {
    const { signal, ...payload } = args;
    return await this.request({ t: 'eval-draw', ...payload }, undefined, signal) as unknown as DrawDecision;
  }

  async analyzeGame(args: AnalysisArgs, onProgress?: (p: { done: number; total: number }) => void): Promise<{ losses: number[] }> {
    const { signal, ...payload } = args;
    const result = await this.request({ t: 'analyze-game', ...payload }, onProgress as Progress | undefined, signal);
    return { losses: lossesOf(result, args.moves.length) };
  }

  async analyzeReview(args: AnalysisArgs, onProgress?: (p: { done: number; total: number }) => void): Promise<{ losses: number[]; bests: (string | null)[] }> {
    const { signal, ...payload } = args;
    const result = await this.request({ t: 'analyze-review', ...payload }, onProgress as Progress | undefined, signal);
    const losses = lossesOf(result, args.moves.length);
    if (!Array.isArray(result.bests) || result.bests.length !== losses.length || !result.bests.every((move) => move === null || uci(move))) throw new Error('Incomplete engine analysis');
    return { losses, bests: result.bests as (string | null)[] };
  }

  async analyzeMove(args: { fen: string; playedUci: string; depth?: number; signal?: AbortSignal }): Promise<{ lossCp: number; bestUci: string; bestScore: number }> {
    const { signal, playedUci, ...payload } = args;
    const result = await this.request({ t: 'analyze-move', ...payload, uci: playedUci }, undefined, signal);
    if (!finite(result.lossCp) || result.lossCp < 0 || !finite(result.bestScore) || !uci(result.bestUci)) throw new Error('Invalid move analysis');
    return { lossCp: result.lossCp, bestUci: result.bestUci, bestScore: result.bestScore };
  }

  async evaluate(fen: string, signal?: AbortSignal): Promise<number> {
    const result = await this.request({ t: 'eval', fen }, undefined, signal);
    if (!finite(result.cp)) throw new Error('Invalid engine evaluation');
    return result.cp;
  }

  newGame(gameId: string): void {
    try { this.ensureWorker()?.postMessage({ t: 'clear', gameId }); }
    catch { this.degrade(); }
  }
}

export const engineClient = new EngineClient();
