import { useEffect, useMemo } from 'react';

export class JobScope {
  active = false;
  private requests = new Set<AbortController>();
  private timers = new Set<ReturnType<typeof setTimeout>>();
  activate(): void { this.active = true; }
  request(): AbortController {
    const abort = new AbortController();
    if (!this.active) abort.abort(); else this.requests.add(abort);
    return abort;
  }
  release(abort: AbortController): void { this.requests.delete(abort); }
  later(run: () => void, delay: number): () => void {
    if (!this.active) return () => undefined;
    const timer = setTimeout(() => { this.timers.delete(timer); if (this.active) run(); }, delay);
    this.timers.add(timer);
    return () => { clearTimeout(timer); this.timers.delete(timer); };
  }
  dispose(): void {
    this.active = false;
    for (const abort of this.requests) abort.abort(); this.requests.clear();
    for (const timer of this.timers) clearTimeout(timer); this.timers.clear();
  }
  reset(): void { this.dispose(); this.activate(); }
}
export function useJobScope(): JobScope {
  const scope = useMemo(() => new JobScope(), []);
  useEffect(() => { scope.activate(); return () => scope.dispose(); }, [scope]);
  return scope;
}
