/** React bindings for GameController (useSyncExternalStore) + shared helpers. */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { GameController } from './GameController';
import { Position } from '../chess/position';

export function useGameController(config: {
  whiteName: string;
  blackName: string;
  startFen?: string;
  variant?: 'standard' | 'three-check' | 'koth';
}): GameController {
  const controller = useMemo(
    () => new GameController(config),
    // Recreate only when the identity token changes — pages pass a stable token.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [config.whiteName, config.blackName, config.startFen, config.variant],
  );
  useSyncExternalStore(controller.subscribe, controller.getVersion, controller.getVersion);
  return controller;
}

/** Subscribes to controller state with a forced re-render token. */
export function useControllerVersion(controller: GameController): number {
  return useSyncExternalStore(controller.subscribe, controller.getVersion, controller.getVersion);
}

/** Keyboard hotkeys, scoped to non-typing contexts. */
export function useHotkeys(map: Record<string, (e: KeyboardEvent) => void>): void {
  const mapRef = useRef(map);
  mapRef.current = map;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const fn = mapRef.current[e.key.toLowerCase()];
      if (fn) fn(e);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

/** Board orientation with flip support + the global F hotkey. */
export function useOrientation(initial: 'white' | 'black', enableHotkey = true): ['white' | 'black', () => void] {
  const [orientation, setOrientation] = useState<'white' | 'black'>(initial);
  const flip = useCallback(() => setOrientation((o) => (o === 'white' ? 'black' : 'white')), []);
  useEffect(() => {
    if (!enableHotkey) return undefined;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.key.toLowerCase() === 'f') {
        e.preventDefault();
        flip();
      }
    };
    const onCommand = () => flip();
    window.addEventListener('keydown', onKey);
    window.addEventListener('checkmate:flip-board', onCommand);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('checkmate:flip-board', onCommand);
    };
  }, [flip, enableHotkey]);
  return [orientation, flip];
}

/** Review controller — steps through a stored game's moves. */
export class ReviewController {
  position: Position;
  ply: number;
  private listeners = new Set<() => void>();
  private version = 0;
  private variant: string;

  constructor(startFen: string, moves: string[], variant?: string) {
    this.position = Position.fromFen(startFen);
    if (variant === 'three-check' || variant === 'koth') this.position.applyVariant(variant);
    this.variant = variant ?? 'standard';
    this.ply = 0;
    this.totalPlies = moves.length;
    this.moves = moves;
  }

  readonly moves: string[];
  readonly totalPlies: number;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getVersion = (): number => this.version;

  private emit(): void {
    this.version++;
    for (const fn of this.listeners) fn();
  }

  private rebuild(ply: number): void {
    const pos = Position.fromFen(this.position.startFen);
    if (this.variant !== 'standard') pos.applyVariant(this.variant as 'three-check' | 'koth');
    for (let i = 0; i < ply; i++) {
      try {
        pos.playUci(this.moves[i]!);
      } catch {
        break;
      }
    }
    this.position = pos;
    this.ply = ply;
    this.emit();
  }

  goTo(ply: number): void {
    const target = Math.max(0, Math.min(this.totalPlies, ply));
    if (target !== this.ply) this.rebuild(target);
  }

  next(): void {
    this.goTo(this.ply + 1);
  }

  prev(): void {
    this.goTo(this.ply - 1);
  }

  first(): void {
    this.goTo(0);
  }

  last(): void {
    this.goTo(this.totalPlies);
  }
}

export function useReviewController(startFen: string, moves: string[], variant?: string): ReviewController {
  const ref = useRef<ReviewController | null>(null);
  if (ref.current === null || ref.current.position.startFen !== startFen || ref.current.moves.length !== moves.length) {
    ref.current = new ReviewController(startFen, moves, variant);
  }
  const review = ref.current;
  useSyncExternalStore(review.subscribe, review.getVersion, review.getVersion);
  return review;
}
