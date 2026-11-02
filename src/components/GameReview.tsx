/**
 * THE ANNOTATOR — automatic post-game review. The engine scores every ply
 * (worker, depth 6), then the game is replayed move by move with commentary:
 * auto-advance like a lesson recap, pause/step controls, and a per-side
 * accuracy summary at the end. Rendered as an overlay above the board.
 */
import { useEffect, useRef, useState } from 'react';
import { ActionButton } from './ActionButton';
import { ToastHost } from './Toast';
import { createPortal } from 'react-dom';
import { Board, BoardAnimate, Orientation } from './Board';
import { IconClose, IconQuill } from './icons';
import { engineClient } from '../game/engineClient';
import { useHotkeys, useReviewController } from '../game/hooks';

import { buildAnnotations, summarizeReview, PlyAnnotation, REVIEWER, ReviewSummary } from '../game/review';
import { moveSoundName, sound } from '../audio/sound';
import { useDialogFocus } from './useDialogFocus';
import { useSettings } from '../storage/settings';

export interface GameReviewProps {
  whiteName: string;
  blackName: string;
  startFen: string;
  moves: { san: string; uci: string }[];
  /** Rule variant the game was played under (affects replay + engine judging). */
  variant?: 'standard' | 'three-check' | 'koth';
  /** Local player's side — orients the board and marks their summary row. */
  myColor?: 'white' | 'black';
  onExit: () => void;
}

const sqOf = (alg: string): number => alg.charCodeAt(0) - 97 + (Number(alg[1]) - 1) * 16;

export function GameReview(p: GameReviewProps) {
  const { settings } = useSettings();
  const panelRef = useRef<HTMLDivElement>(null);
  useDialogFocus(panelRef, p.onExit);
  const [phase, setPhase] = useState<'analyzing' | 'replay' | 'summary'>('analyzing');
  const [annotations, setAnnotations] = useState<PlyAnnotation[] | null>(null);
  const [summary, setSummary] = useState<ReviewSummary | null>(null);
  const [progress, setProgress] = useState({ done: 0, total: p.moves.length });
  const [playing, setPlaying] = useState(true);
  const [animate, setAnimate] = useState<BoardAnimate | null>(null);
  const [shown, setShown] = useState(false);

  const review = useReviewController(
    p.startFen,
    p.moves.map((m) => m.uci),
    p.variant,
  );

  useEffect(() => {
    const t = window.setTimeout(() => setShown(true), 30);
    return () => window.clearTimeout(t);
  }, []);

  // Score every ply in the worker, then build the annotations.
  const movesRef = useRef(p.moves);
  movesRef.current = p.moves;
  const movesKey = p.moves.map((m) => m.uci).join(' ');
  useEffect(() => {
    let alive = true;
    const abort = new AbortController();
    setAnnotations(null); setSummary(null); setPhase('analyzing');
    if (movesRef.current.length === 0) {
      setPhase('replay');
      return;
    }
    void (async () => {
      try {
        const { losses, bests } = await engineClient.analyzeReview(
          {
            startFen: p.startFen,
            moves: movesRef.current.map((m) => m.uci),
            depth: 6,
            signal: abort.signal,
            variant: p.variant && p.variant !== 'standard' ? p.variant : undefined,
          },
          (prog) => {
            if (alive) setProgress({ done: prog.done, total: prog.total });
          },
        );
        if (!alive) return;
        const ann = buildAnnotations(p.startFen, movesRef.current, losses, bests);
        setAnnotations(ann);
        setSummary(summarizeReview(ann, losses, p.startFen.split(/\s+/)[1] === 'b' ? 'black' : 'white'));
        setPhase('replay');
        sound.play('notify');
      } catch {
        if (alive) setPhase('replay');
      }
    })();
    return () => {
      alive = false; abort.abort();
    };
  }, [p.startFen, movesKey, p.variant]);

  const atEnd = review.ply >= review.totalPlies;

  // Auto-advance; big swings get a longer beat, like a lesson pausing on an error.
  useEffect(() => {
    if (phase !== 'replay' || !playing || atEnd) return;
    const kind = annotations && review.ply > 0 ? annotations[review.ply - 1]!.kind : 'best';
    const delay = kind === 'blunder' ? 4000 : kind === 'mistake' ? 3300 : 2500;
    const t = window.setTimeout(() => review.next(), delay);
    return () => window.clearTimeout(t);
  }, [phase, playing, atEnd, review.ply, annotations]);

  // The final ply lands → summary.
  useEffect(() => {
    if (phase === 'replay' && atEnd && p.moves.length > 0) {
      const t = window.setTimeout(() => {
        setPhase('summary');
        sound.play('reveal');
      }, 600);
      return () => window.clearTimeout(t);
    }
  }, [phase, atEnd, p.moves.length]);

  // Sound + animation for each played ply.
  const prevPly = useRef(0);
  useEffect(() => {
    const ply = review.ply;
    if (phase !== 'replay' || ply === prevPly.current) return;
    const forward = ply > prevPly.current;
    prevPly.current = ply;
    if (ply > 0 && forward) {
      const m = p.moves[ply - 1]!;
      const a = annotations?.[ply - 1];
      if (settings.animateMoves) {
        setAnimate({
          from: sqOf(m.uci.slice(0, 2)),
          to: sqOf(m.uci.slice(2, 4)),
          capturedPiece: m.san.includes('x') ? 1 : 0,
          capturedSquare: m.san.includes('x') ? sqOf(m.uci.slice(2, 4)) : -1,
          promoted: m.uci.length === 5,
        });
      }
      if (a && (a.kind === 'mistake' || a.kind === 'blunder')) sound.play('wrong');
      else sound.play(moveSoundName({ capture: m.san.includes('x'), check: /[+#]/.test(m.san), san: m.san }));
    } else {
      setAnimate(null);
    }
  }, [review.ply, phase, annotations, settings.animateMoves, p.moves]);

  const step = (dir: 1 | -1) => {
    setPlaying(false);
    if (dir === 1) review.next();
    else review.prev();
  };

  useHotkeys(
    {
      arrowleft: (e) => {
        e.preventDefault();
        step(-1);
      },
      arrowright: (e) => {
        e.preventDefault();
        step(1);
      },
      ' ': (e) => {
        e.preventDefault();
        setPlaying((v) => !v);
      },
      escape: () => p.onExit(),
    },
    panelRef,
  );

  const restart = () => {
    review.first();
    prevPly.current = 0;
    setAnimate(null);
    setPlaying(true);
    setPhase('replay');
  };

  const orientation: Orientation = p.myColor === 'black' ? 'black' : 'white';
  const lastUci = review.ply > 0 ? p.moves[review.ply - 1]!.uci : null;
  const current = review.ply > 0 ? annotations?.[review.ply - 1] ?? null : null;
  const root = p.startFen.split(/\s+/);
  const offset = root[1] === 'b' ? 1 : 0;
  const moveIndex = Math.max(0, review.ply - 1) + offset;
  const moveNo = Number(root[5] ?? 1) + Math.floor(moveIndex / 2);
  const moveDot = moveIndex % 2 === 0 ? '.' : '…';
  const fillPct =
    phase === 'analyzing' && progress.total > 0
      ? Math.round((progress.done / progress.total) * 100)
      : Math.round((review.ply / Math.max(1, review.totalPlies)) * 100);

  // Portal to the body: page-level animations leave a transform on ancestors,
  // which would otherwise re-anchor this fixed overlay to the page column.
  return createPortal(
    <div ref={panelRef} className={`review-scrim${shown ? ' shown' : ''}`} role="dialog" aria-modal="true" aria-label="Automatic game review">
      <ToastHost />
      <div className="review">
        {engineClient.workerFailed && <p className="small muted" role="status">Worker unavailable. Analysis uses a shorter local search.</p>}
        {phase !== 'analyzing' && !annotations && <p className="small muted" role="status">{p.moves.length ? 'Move analysis is unavailable. You can still replay the game.' : 'No moves were recorded in this game.'}</p>}
        <div className="review-head">
          <div className="annotator-avatar" aria-hidden="true">
            <IconQuill size={22} />
          </div>
          <div className="review-who">
            <div className="review-name">{REVIEWER.name}</div>
            <div className="review-sub">
              {p.variant && p.variant !== 'standard' ? `${p.variant === 'koth' ? 'KING OF THE HILL' : 'THREE-CHECK'} · ` : ''}
              {phase === 'analyzing'
                ? `STUDYING THE GAME · ${progress.done}/${progress.total}`
                : phase === 'summary'
                  ? 'REVIEW COMPLETE'
                  : `MOVE ${review.ply}/${review.totalPlies}`}
            </div>
          </div>
          <button className="tool-btn" onClick={p.onExit} aria-label="Close review">
            <IconClose size={16} />
          </button>
        </div>

        <div
          className="review-progress"
          role="progressbar"
          aria-label="Review progress"
          aria-valuemin={0}
          aria-valuemax={review.totalPlies}
          aria-valuenow={phase === 'analyzing' ? progress.done : review.ply}
        >
          <div className="review-progress-fill" style={{ width: `${fillPct}%` }} />
        </div>

        {phase !== 'summary' ? (
          <>
            <div className="board-wrap review-board">
              <Board
                position={review.position}
                version={review.ply}
                orientation={orientation}
                interactive={false}
                selectable={() => false}
                legalFor={() => []}
                onMove={() => false}
                lastMove={lastUci ? { from: sqOf(lastUci.slice(0, 2)), to: sqOf(lastUci.slice(2, 4)) } : null}
                checkSquare={review.position.inCheck() ? review.position.kingSquare(review.position.stm) : null}
                animate={animate}
                settings={settings}
                label={`Replay. Move ${review.ply} of ${review.totalPlies}.`}
              />
            </div>

            <div className="review-card" aria-live="polite">
              {review.ply === 0 ? (
                <>
                  <div className="review-move mono">START</div>
                  <div className="review-comment">
                    {p.whiteName} vs {p.blackName} — {Math.ceil(review.totalPlies / 2)} moves. Step through the evaluations below.
                  </div>
                </>
              ) : (
                <>
                  <div className="review-move mono">
                    {moveNo}
                    {moveDot} {p.moves[review.ply - 1]!.san}
                  </div>
                  {current ? (
                    <>
                      <span className={`review-chip review-chip-${current.kind}`}>{current.kind.toUpperCase()}</span>
                      <div className="review-comment">{current.comment}</div>
                    </>
                  ) : (
                    <div className="review-comment">Stepping through the game.</div>
                  )}
                </>
              )}
            </div>

            <div className="row review-controls-row">
              <ActionButton className="btn btn-sm" blockedReason={review.totalPlies === 0 ? 'This game has no recorded moves to replay.' : !playing && review.ply === 0 && 'You are already at the starting position. Press Next to see the first move.'} onClick={() => { setPlaying(false); review.first(); prevPly.current = 0; setAnimate(null); }} aria-label="First move">⏮</ActionButton>
              <ActionButton className="btn btn-sm" blockedReason={review.totalPlies === 0 ? 'This game has no recorded moves to replay.' : !playing && review.ply === 0 && 'You are at the starting position. There is no previous move.'} onClick={() => step(-1)} aria-label="Previous move">◀</ActionButton>
              <ActionButton className="btn btn-sm btn-primary" blockedReason={review.totalPlies === 0 ? 'This game has no recorded moves to play.' : !playing && atEnd && 'You have reached the end of this replay. Step back to replay earlier moves.'} onClick={() => setPlaying((v) => !v)} aria-label={playing ? 'Pause' : 'Play'}>
                {playing ? '⏸' : '▶'}
              </ActionButton>
              <ActionButton className="btn btn-sm" blockedReason={review.totalPlies === 0 ? 'This game has no recorded moves to replay.' : !playing && atEnd && 'You have reached the last recorded move. Choose Previous to review earlier moves.'} onClick={() => step(1)} aria-label="Next move">▶</ActionButton>
              <ActionButton className="btn btn-sm" blockedReason={review.totalPlies === 0 ? 'This game has no recorded moves to replay.' : !playing && atEnd && 'You are already at the last recorded move.'} onClick={() => { setPlaying(false); review.last(); }} aria-label="Skip to end">⏭</ActionButton>
              <span className="tiny faint">← → step · SPACE pause</span>
            </div>
          </>
        ) : (
          <div className="review-summary">
            <div className="review-sum-title">THE VERDICT</div>
            {(['white', 'black'] as const).map((color) => {
              const s = summary ? summary[color] : null;
              const name = color === 'white' ? p.whiteName : p.blackName;
              return (
                <div key={color} className={`review-sum-row${p.myColor === color ? ' mine' : ''}`}>
                  <div className="review-sum-name">
                    <span className={`turn-dot ${color}`} />
                    {name}
                    {p.myColor === color && name.toLowerCase() !== 'you' ? <span className="tiny faint"> · YOU</span> : null}
                  </div>
                  <div className="review-sum-acc mono">{s?.accuracy !== null && s?.accuracy !== undefined ? `${s.accuracy}%` : '—'}</div>
                  <div className="review-sum-kinds">
                    {s &&
                      (['best', 'good', 'inaccuracy', 'mistake', 'blunder'] as const).map((k) =>
                        s.counts[k] > 0 ? (
                          <span key={k} className={`review-chip review-chip-${k}`}>
                            {s.counts[k]} {k.toUpperCase()}
                          </span>
                        ) : null,
                      )}
                  </div>
                  <div className="review-sum-pr mono tiny faint">{s?.performance ? `EST. ${s.performance}` : ''}</div>
                </div>
              );
            })}
            <div className="review-note tiny faint">Depth-6 review · approximate by design</div>
            <div className="row">
              <button className="btn btn-primary btn-sm" onClick={restart}>REPLAY</button>
              <button className="btn btn-sm" onClick={p.onExit}>DONE</button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
