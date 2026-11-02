import type { MateAnswer, MateRequest } from './mate';

export class MateClient {
  private worker: Worker | null = null;
  private sequence = 0;
  private pending = new Map<number, { resolve: (answer: MateAnswer) => void; timer: number }>();
  private disposed = false;
  private unavailable = false;

  private open(): Worker | null {
    if (this.disposed || this.unavailable) return null;
    if (this.worker) return this.worker;
    try {
      this.worker = new Worker(new URL('../workers/education.worker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (event: MessageEvent<MateAnswer & { id: number }>) => {
        const pending = this.pending.get(event.data.id);
        if (!pending) return;
        window.clearTimeout(pending.timer);
        this.pending.delete(event.data.id);
        pending.resolve(event.data);
      };
      this.worker.onerror = (event) => { event.preventDefault(); this.unavailable = true; this.close(); };
      this.worker.onmessageerror = () => { this.unavailable = true; this.close(); };
      return this.worker;
    } catch { this.unavailable = true; return null; }
  }

  async request(request: MateRequest): Promise<MateAnswer> {
    if (this.disposed) return { status: 'error', complete: false };
    const worker = this.open();
    if (!worker) {
      try {
        const { assessMate } = await import('./mate');
        if (this.disposed) return { status: 'error', complete: false };
        return assessMate(request, { maxMs: 200, maxNodes: 12_000 });
      } catch { return { status: 'error', complete: false }; }
    }
    return new Promise((resolve) => {
      const id = ++this.sequence;
      const timer = window.setTimeout(() => this.close(), 6000);
      this.pending.set(id, { resolve, timer });
      try { worker.postMessage({ ...request, id }); }
      catch { this.close(); }
    });
  }

  private close(): void {
    this.worker?.terminate();
    this.worker = null;
    for (const { resolve, timer } of this.pending.values()) {
      window.clearTimeout(timer);
      resolve({ status: 'limit', complete: false });
    }
    this.pending.clear();
  }

  dispose(): void { this.disposed = true; this.close(); }
}
