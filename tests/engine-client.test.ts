import { afterEach, describe, expect, it, vi } from 'vitest';
import { EngineClient } from '../src/game/engineClient';
import { BOTS } from '../src/engine/bots';
import { START_FEN } from '../src/chess/constants';

class WorkerMock {
  static last: WorkerMock;
  static respond = true;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  sent: Record<string, unknown>[] = [];
  terminated = false;
  constructor() { WorkerMock.last = this; }
  postMessage(data: Record<string, unknown>) {
    structuredClone(data);
    this.sent.push(data);
    if (!WorkerMock.respond || data.t === 'cancel' || data.t === 'clear') return;
    queueMicrotask(() => {
      if (data.t === 'search') this.onmessage?.({ data: { id: data.id, t: 'search-progress', depth: 2, nodes: 80, ms: 4 } });
      this.onmessage?.({ data: { id: data.id, t: `${data.t}-result`, uci: 'e2e4', fromBook: false, score: 10, depth: 2, nodes: 80, ms: 4, pv: ['e2e4'], lossCp: 25, bestUci: 'd2d4', bestScore: 40 } });
    });
  }
  terminate() { this.terminated = true; }
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); WorkerMock.respond = true; });
const search = { gameId: 'test', startFen: START_FEN, moves: [], style: BOTS[0]! };

describe('engine worker client', () => {
  it('keeps callbacks off the structured-clone payload and receives real progress', async () => {
    vi.stubGlobal('Worker', WorkerMock);
    const client = new EngineClient(), onProgress = vi.fn();
    const reply = await client.search({ ...search, onProgress });
    expect(reply.uci).toBe('e2e4'); expect(client.workerFailed).toBe(false);
    expect(WorkerMock.last.sent[0]).not.toHaveProperty('onProgress');
    expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({ depth: 2, nodes: 80 }));
  });
  it('runs single-move analysis in the worker, not the UI thread', async () => {
    vi.stubGlobal('Worker', WorkerMock);
    const client = new EngineClient();
    expect((await client.analyzeMove({ fen: START_FEN, playedUci: 'e2e4' })).lossCp).toBe(25);
    expect(WorkerMock.last.sent[0]).toMatchObject({ t: 'analyze-move', uci: 'e2e4' });
  });
  it('cancels pending work without serializing AbortSignal or starting a fallback', async () => {
    vi.stubGlobal('Worker', WorkerMock); WorkerMock.respond = false;
    const client = new EngineClient(), abort = new AbortController();
    const promise = client.analyzeReview({ startFen: START_FEN, moves: ['e2e4'], signal: abort.signal });
    const assertion = expect(promise).rejects.toMatchObject({ name: 'AbortError' });
    abort.abort(); await assertion;
    expect(WorkerMock.last.sent[0]).not.toHaveProperty('signal');
    expect(WorkerMock.last.sent[WorkerMock.last.sent.length - 1]).toMatchObject({ t: 'cancel' });
    expect(client.workerFailed).toBe(false);
  });
  it('rejects an already aborted request before creating a worker', async () => {
    const ctor = vi.fn(); vi.stubGlobal('Worker', ctor);
    const abort = new AbortController(); abort.abort();
    await expect(new EngineClient().search({ ...search, signal: abort.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(ctor).not.toHaveBeenCalled();
  });
  it('retries with a legal bounded fallback if the worker fails mid-request', async () => {
    vi.stubGlobal('Worker', WorkerMock); WorkerMock.respond = false;
    const client = new EngineClient(), promise = client.search(search);
    WorkerMock.last.onerror?.(new Event('error'));
    const reply = await promise;
    expect(client.workerFailed).toBe(true); expect(WorkerMock.last.terminated).toBe(true);
    expect(reply.uci).toMatch(/^[a-h][1-8][a-h][1-8][qrbn]?$/);
  });
  it('has a watchdog for a worker that never replies', async () => {
    vi.useFakeTimers(); vi.stubGlobal('Worker', WorkerMock); WorkerMock.respond = false;
    const client = new EngineClient(), promise = client.search(search);
    await vi.advanceTimersByTimeAsync(30_001); vi.useRealTimers();
    expect((await promise).uci).not.toBeNull(); expect(client.workerFailed).toBe(true);
  });
  it('replays fallback analysis from the root exactly once and yields progress', async () => {
    vi.stubGlobal('Worker', class { constructor() { throw new Error('Workers blocked'); } });
    const progress = vi.fn(), client = new EngineClient();
    const result = await client.analyzeReview({ startFen: START_FEN, moves: ['e2e4', 'e7e5'], depth: 1 }, progress);
    expect(result.losses).toHaveLength(2); expect(result.bests).toHaveLength(2);
    expect(progress).toHaveBeenLastCalledWith({ done: 2, total: 2 });
  });
  it('clears request watchdogs after successful replies', async () => {
    vi.useFakeTimers(); vi.stubGlobal('Worker', WorkerMock);
    const client = new EngineClient(); await client.search(search);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('analysis response validation', () => {
  const invalid = (payload: Record<string, unknown>) => {
    class BadWorker extends WorkerMock {
      postMessage(data: Record<string, unknown>) {
        queueMicrotask(() => this.onmessage?.({ data: { id: data.id, t: `${data.t}-result`, ...payload } }));
      }
    }
    vi.stubGlobal('Worker', BadWorker);
    return new EngineClient();
  };
  it('rejects a truncated loss array instead of manufacturing accuracy', async () => {
    await expect(invalid({ losses: [] }).analyzeGame({ startFen: START_FEN, moves: ['e2e4'] })).rejects.toThrow('Incomplete');
  });
  it.each([NaN, Infinity, -1])('rejects a nonfinite or negative loss: %s', async (loss) => {
    await expect(invalid({ losses: [loss] }).analyzeGame({ startFen: START_FEN, moves: ['e2e4'] })).rejects.toThrow('Incomplete');
  });
  it('rejects missing best-move data in a review', async () => {
    await expect(invalid({ losses: [0], bests: [] }).analyzeReview({ startFen: START_FEN, moves: ['e2e4'] })).rejects.toThrow('Incomplete');
  });
  it('does not accept NaN as a move or position evaluation', async () => {
    await expect(invalid({ lossCp: NaN, bestUci: 'e2e4', bestScore: 0 }).analyzeMove({ fen: START_FEN, playedUci: 'e2e4' })).rejects.toThrow('Invalid');
    await expect(invalid({ cp: NaN }).evaluate(START_FEN)).rejects.toThrow('Invalid');
  });
});
