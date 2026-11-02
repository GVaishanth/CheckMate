import { afterEach, describe, expect, it, vi } from 'vitest';
import { JobScope } from '../src/game/jobScope';

afterEach(() => vi.useRealTimers());

describe('component job ownership', () => {
  it('does not start work before activation or after disposal', () => {
    const scope = new JobScope();
    expect(scope.request().signal.aborted).toBe(true);
    scope.activate();
    expect(scope.request().signal.aborted).toBe(false);
    scope.dispose();
    expect(scope.request().signal.aborted).toBe(true);
  });

  it('aborts every owned request but not a released request', () => {
    const scope = new JobScope(); scope.activate();
    const owned = scope.request(), released = scope.request();
    scope.release(released); scope.dispose();
    expect(owned.signal.aborted).toBe(true);
    expect(released.signal.aborted).toBe(false);
  });

  it('cancels delayed round transitions on unmount', () => {
    vi.useFakeTimers();
    const scope = new JobScope(); scope.activate();
    const next = vi.fn(); scope.later(next, 1600);
    scope.dispose(); vi.runAllTimers();
    expect(next).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels one timer without affecting another', () => {
    vi.useFakeTimers();
    const scope = new JobScope(); scope.activate();
    const cancelled = vi.fn(), kept = vi.fn();
    scope.later(cancelled, 20)(); scope.later(kept, 30);
    vi.runAllTimers();
    expect(cancelled).not.toHaveBeenCalled();
    expect(kept).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('survives StrictMode-style cleanup and reactivation without reviving old jobs', () => {
    vi.useFakeTimers();
    const scope = new JobScope(); scope.activate();
    const old = scope.request(), callback = vi.fn(); scope.later(callback, 30);
    scope.dispose(); scope.activate();
    const fresh = scope.request(); vi.runAllTimers();
    expect(old.signal.aborted).toBe(true);
    expect(fresh.signal.aborted).toBe(false);
    expect(callback).not.toHaveBeenCalled();
    scope.dispose(); expect(fresh.signal.aborted).toBe(true);
  });

  it('resets all work for a repeated puzzle', () => {
    vi.useFakeTimers();
    const scope = new JobScope(); scope.activate();
    const request = scope.request(), callback = vi.fn(); scope.later(callback, 600);
    scope.reset(); vi.runAllTimers();
    expect(request.signal.aborted).toBe(true);
    expect(callback).not.toHaveBeenCalled();
    expect(scope.active).toBe(true);
    expect(scope.request().signal.aborted).toBe(false);
    scope.dispose();
  });

  it('does not revive timers scheduled while inactive', () => {
    vi.useFakeTimers();
    const scope = new JobScope(), callback = vi.fn();
    scope.later(callback, 20); scope.activate(); vi.runAllTimers();
    expect(callback).not.toHaveBeenCalled();
  });
});
