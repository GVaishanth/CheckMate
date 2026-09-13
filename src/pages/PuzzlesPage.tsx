/**
 * Puzzles — offline tactical training. Every position was generated and
 * verified by the bundled engine; solutions are engine PVs. Player moves are
 * judged by engine move-quality (centipawn loss), so any winning line passes.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Board, BoardAnimate, Orientation } from '../components/Board';
import { MoveList } from '../components/MoveList';
import { useToast } from '../components/Toast';
import { useControllerVersion, useOrientation, useHotkeys } from '../game/hooks';
import { useRegisterCommands } from '../game/commands';
import { GameController } from '../game/GameController';
import {
  CATEGORY_LABELS, DIFFICULTY_LABELS, PUZZLES, Puzzle, PuzzleCategory, puzzlesMatching,
} from '../data/puzzles';
import { engineClient } from '../game/engineClient';

import { BLACK, Color, PieceType, WHITE } from '../chess/constants';
import { moveSoundName, sound } from '../audio/sound';
import { useSettings } from '../storage/settings';
import { puzzlesRepo, PuzzleProgress } from '../storage/db';
import { BotStyle } from '../engine/bots';
import { IconBolt, IconFlip, IconList, IconPuzzle, IconTarget, IconTrophy } from '../components/icons';

/** Defensive engine used for the puzzle opponent's replies. */
const DEFENDER: BotStyle = {
  id: 'puzzle-defender', name: 'DEFENDER', elo: '', tagline: '', traits: [],
  depth: 6, softMs: 350, noiseCp: 0, blunderRate: 0, quiescence: true,
  profile: 'full', bookPly: 0, rankRoot: false, pips: 3,
};

type Phase = 'select' | 'playing' | 'solved' | 'failed';
const LOSS_TOLERANCE_CP = 90;
const MAX_WRONG = 2;

export function PuzzlesPage() {
  const [category, setCategory] = useState<PuzzleCategory | 'all'>('all');
  const [difficulty, setDifficulty] = useState<number | 'all'>('all');
  const [puzzle, setPuzzle] = useState<Puzzle | null>(null);
  const [stats, setStats] = useState<{ solved: number; attempted: number; bestStreak: number; avgMs: number; accuracy: number } | null>(null);

  const refreshStats = useCallback(async () => {
    try {
      const rows = await puzzlesRepo.all();
      const solved = rows.filter((r) => r.status === 'solved');
      const attempts = rows.reduce((a, r) => a + Math.max(1, r.attempts ?? 0), 0);
      setStats({
        solved: solved.length,
        attempted: rows.length,
        bestStreak: rows.reduce((a, r) => Math.max(a, r.bestStreak ?? 0), 0),
        avgMs: solved.length ? solved.reduce((a, r) => a + (r.bestTimeMs ?? 0), 0) / solved.length : 0,
        accuracy: attempts ? Math.round((solved.length / attempts) * 100) : 100,
      });
    } catch {
      setStats({ solved: 0, attempted: 0, bestStreak: 0, avgMs: 0, accuracy: 100 });
    }
  }, []);

  useEffect(() => {
    void refreshStats();
  }, [refreshStats]);

  useRegisterCommands(
    useMemo(
      () => [
        {
          id: 'puzzle-next',
          label: 'Next Puzzle',
          group: 'Puzzles',
          run: () => window.dispatchEvent(new CustomEvent('checkmate:next-puzzle')),
        },
      ],
      [],
    ),
  );

  const pickNext = useCallback(
    async (current: Puzzle | null) => {
      const pool = puzzlesMatching(category, difficulty);
      if (pool.length === 0) return null;
      let progress: PuzzleProgress[] = [];
      try {
        progress = await puzzlesRepo.all();
      } catch {
        progress = [];
      }
      const solvedIds = new Set(progress.filter((p) => p.status === 'solved').map((p) => p.puzzleId));
      const fresh = pool.find((p) => !solvedIds.has(p.id));
      const next = fresh ?? pool[(pool.indexOf(current ?? pool[0]!) + 1) % pool.length] ?? null;
      return next;
    },
    [category, difficulty],
  );

  const start = (p: Puzzle | null) => {
    setPuzzle(p);
    sound.unlock();
  };

  const pool = puzzle === null ? puzzlesMatching(category, difficulty) : [];

  if (!puzzle) {
    return (
      <div className="page">
        <div className="container">
          <div className="page-head">
            <div>
              <div className="eyebrow">{PUZZLES.length} positions · engine-verified · offline</div>
              <h1 className="page-title">Puzzles</h1>
              <p className="page-sub">
                Mates, forks, pins, skewers, sacrifices, endgame conversions — harvested from
                engine games, verified by the same engine. Find the winning move.
              </p>
            </div>
          </div>

          <div className="stat-grid mb-24">
            <StatCell label="Solved" value={stats ? String(stats.solved) : '…'} />
            <StatCell label="Accuracy" value={stats ? `${stats.accuracy}%` : '…'} />
            <StatCell label="Best streak" value={stats ? String(stats.bestStreak) : '…'} />
            <StatCell label="Avg time" value={stats ? (stats.avgMs ? `${(stats.avgMs / 1000).toFixed(1)}s` : '—') : '…'} />
          </div>

          <div className="panel" style={{ maxWidth: 720 }}>
            <div className="panel-title">Training</div>
            <div className="panel-pad stack gap-16">
              <div className="field">
                <span className="field-label">Theme</span>
                <div className="chip-row wrap" role="group" aria-label="Puzzle theme">
                  {CATEGORY_LABELS.map((c) => (
                    <button
                      key={c.id}
                      className={`chip${category === c.id ? ' chip-active' : ''}`}
                      aria-pressed={category === c.id}
                      onClick={() => setCategory(c.id)}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="field">
                <span className="field-label">Difficulty</span>
                <div className="seg" role="group" aria-label="Puzzle difficulty">
                  <button aria-pressed={difficulty === 'all'} onClick={() => setDifficulty('all')}>ALL</button>
                  {[1, 2, 3, 4].map((d) => (
                    <button key={d} aria-pressed={difficulty === d} onClick={() => setDifficulty(d)}>
                      {DIFFICULTY_LABELS[d]}
                    </button>
                  ))}
                </div>
              </div>
              {pool.length > 0 ? (
                <div className="tiny faint">
                  {pool.length} positions match — {pool.filter((p) => p.solution.length > 1).length} of them multi-move.
                </div>
              ) : (
                <div className="tiny" style={{ color: 'var(--danger)' }}>
                  No positions match this filter — widen the theme or level.
                </div>
              )}
              <div>
                <button
                  className="btn btn-primary btn-lg"
                  disabled={pool.length === 0}
                  onClick={() => void pickNext(null).then(start)}
                >
                  <IconPuzzle size={16} /> START TRAINING
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="container">
        <PuzzlePlayer
          key={puzzle.id}
          puzzle={puzzle}
          onStats={refreshStats}
          onNext={async () => {
            const next = await pickNext(puzzle);
            if (next) start(next);
            else setPuzzle(null);
          }}
          onExit={() => setPuzzle(null)}
          filterLabel={`${category === 'all' ? 'ALL' : category.toUpperCase()} · ${
            difficulty === 'all' ? 'ALL LEVELS' : DIFFICULTY_LABELS[difficulty]
          }`}
        />
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ player

function PuzzlePlayer({
  puzzle, onStats, onNext, onExit, filterLabel,
}: {
  puzzle: Puzzle;
  onStats: () => Promise<void>;
  onNext: () => Promise<void>;
  onExit: () => void;
  filterLabel: string;
}) {
  const { settings } = useSettings();
  const { toast } = useToast();
  const controller = useMemo(
    () => new GameController({ whiteName: 'You', blackName: 'Puzzle', startFen: puzzle.fen }),
    [puzzle.fen],
  );
  const version = useControllerVersion(controller);
  const solverColor: Color = puzzle.sideToMove === 'white' ? WHITE : BLACK;
  const [orientation, flip] = useOrientation(puzzle.sideToMove);
  const [phase, setPhase] = useState<Phase>('playing');
  const [wrong, setWrong] = useState(0);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [animate, setAnimate] = useState<BoardAnimate | null>(null);
  const [showSolution, setShowSolution] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [streak, setStreak] = useState(() => loadStreak());
  const [playerMoveCount, setPlayerMoveCount] = useState(0);
  const startedAt = useRef(Date.now());
  const attempts = useRef(0);
  const busy = useRef(false);
  const [moveListOpen, setMoveListOpen] = useState(true);

  useEffect(() => {
    if (phase !== 'playing') return undefined;
    const iv = window.setInterval(() => setElapsed(Date.now() - startedAt.current), 250);
    return () => window.clearInterval(iv);
  }, [phase]);

  useHotkeys(
    useMemo(
      () => ({
        m: (e: KeyboardEvent) => {
          e.preventDefault();
          setMoveListOpen((v) => !v);
        },
      }),
      [],
    ),
  );

  useEffect(() => {
    const onNextEvt = () => {
      if (phase === 'solved' || phase === 'failed') void onNext();
    };
    window.addEventListener('checkmate:next-puzzle', onNextEvt);
    return () => window.removeEventListener('checkmate:next-puzzle', onNextEvt);
  }, [phase, onNext]);

  const record = async (status: 'solved' | 'failed', timeMs: number) => {
    try {
      const existing = await puzzlesRepo.forPuzzle(puzzle.id);
      await puzzlesRepo.put({
        key: puzzle.id,
        puzzleId: puzzle.id,
        status: existing?.status === 'solved' && status === 'failed' ? 'solved' : status,
        attempts: (existing?.attempts ?? 0) + 1,
        bestTimeMs:
          status === 'solved'
            ? Math.min(existing?.bestTimeMs ?? Infinity, timeMs)
            : existing?.bestTimeMs,
        bestStreak: status === 'solved' ? Math.max(existing?.bestStreak ?? 0, streak + 1) : (existing?.bestStreak ?? 0),
        solvedAt: status === 'solved' ? Date.now() : existing?.solvedAt,
        lastTriedAt: Date.now(),
      });
    } catch {
      /* storage unavailable — session-only */
    }
    await onStats();
  };

  const solve = async (silent = false) => {
    const timeMs = Date.now() - startedAt.current;
    setPhase('solved');
    if (!silent) sound.play('solved');
    const nextStreak = streak + 1;
    setStreak(nextStreak);
    saveStreak(nextStreak);
    await record('solved', timeMs);
  };

  const fail = async () => {
    setPhase('failed');
    setStreak(0);
    saveStreak(0);
    sound.play('wrong');
    await record('failed', Date.now() - startedAt.current);
  };

  /** Validate + apply a solver move; drive the opponent reply. */
  const onMove = async (from: number, to: number, promo: PieceType | null): Promise<boolean> => {
    if (phase !== 'playing' || checking || busy.current) return false;
    const fenBefore = controller.position.fen();
    const captured = controller.position.pieceAt(to);

    // Mate-in-one is judged by the rules engine instantly.
    const test = controller.position.clone();
    const enc = test.uciToMove(sqAlg(from) + sqAlg(to) + promoLetter(promo));
    if (enc !== null) {
      test.makeMove(enc);
      if (test.isCheckmate()) {
        const rec = controller.tryMove(from, to, promo);
        if (rec) {
          setAnimate(settings.animateMoves ? { from, to, capturedPiece: captured, capturedSquare: to, promoted: promo !== null } : null);
          sound.play('checkmate');
          setFeedback('CHECKMATE');
          void solve(true);
          return true;
        }
      }
    }

    busy.current = true;
    setChecking(true);
    try {
      const uci = sqAlg(from) + sqAlg(to) + promoLetter(promo);
      const q = await engineClient.analyzeMove({ fen: fenBefore, playedUci: uci, depth: 7 });
      if (q.lossCp > LOSS_TOLERANCE_CP || (q.bestScore < 0 && controller.moves.length === 0)) {
        // Not the shot (or the puzzle is not actually winning for the solver).
        attempts.current++;
        const w = wrong + 1;
        setWrong(w);
        sound.play('wrong');
        if (w >= MAX_WRONG) {
          setFeedback('Not the move. The chance slipped.');
          void fail();
        } else {
          setFeedback('Not the strongest — try again.');
        }
        return false;
      }
      const rec = controller.applyUci(uci);
      if (!rec) {
        setFeedback('Illegal move.');
        return false;
      }
      setAnimate(settings.animateMoves ? { from, to, capturedPiece: captured, capturedSquare: to, promoted: uci.length === 5 } : null);
      sound.play(moveSoundName(rec));
      setFeedback(null);
      setWrong(0);
      const moved = playerMoveCount + 1;
      setPlayerMoveCount(moved);

      // Terminal: solution length reached (tactics) or draw/insufficient happened.
      if (controller.end) {
        if (controller.end?.winner === null) {
          setFeedback('Drawn — the win was there.');
          void fail();
        } else {
          void solve();
        }
        return true;
      }
      if (moved >= puzzle.solution.length) {
        setFeedback('Conversion complete — the rest is technique.');
        void solve();
        return true;
      }

      // Opponent replies: stored defense when still legal, engine otherwise.
      const stored = puzzle.line[controller.moves.length] ?? null;
      let reply = stored && controller.position.uciToMove(stored) !== null ? stored : null;
      if (!reply) {
        const r = await engineClient.search({
          gameId: `puzzle-${puzzle.id}`,
          startFen: puzzle.fen,
          moves: controller.moves.map((m) => m.uci),
          style: DEFENDER,
        });
        reply = r.uci;
      }
      if (reply && controller.phase === 'playing') {
        const replyRec = controller.applyUci(reply);
        if (replyRec) {
          setAnimate(settings.animateMoves ? uciToAnim(reply, replyRec.capture) : null);
          window.setTimeout(() => sound.play(moveSoundName(replyRec)), 120);
        }
      }
      return true;
    } catch {
      toast('Could not verify the move — engine unavailable.', 'danger');
      return false;
    } finally {
      setChecking(false);
      busy.current = false;
    }
  };

  const interactive = phase === 'playing' && !checking && controller.turn === solverColor;
  const legalFor = useCallback(
    (sq: number) => (interactive ? controller.movesFrom(sq) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [controller, interactive, version],
  );
  const selectable = useCallback(
    (sq: number) => {
      if (!interactive) return false;
      const piece = controller.position.pieceAt(sq);
      return piece !== 0 && (piece >> 3) === (solverColor === WHITE ? 0 : 1);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [controller, interactive, solverColor, version],
  );

  const retry = () => {
    controller.reset();
    setPhase('playing');
    setWrong(0);
    setFeedback(null);
    setPlayerMoveCount(0);
    setShowSolution(false);
    startedAt.current = Date.now();
    setElapsed(0);
  };

  return (
    <div className="puzzle-layout">
      <div className="stack gap-12" style={{ position: 'relative', minWidth: 0 }}>
        <div className="board-wrap">
          <Board
            position={controller.position}
            version={version}
            orientation={orientation as Orientation}
            interactive={interactive}
            selectable={selectable}
            legalFor={legalFor}
            onMove={(f, t, p) => {
              void onMove(f, t, p);
              return true; // feedback path handles rejection display
            }}
            onIllegal={() => sound.play('illegal')}
            lastMove={controller.lastMove}
            checkSquare={controller.checkSquare}
            animate={animate}
            settings={settings}
            label={`Puzzle. ${puzzle.sideToMove === 'white' ? 'White' : 'Black'} to move — find the strongest continuation.`}
          />
          <div className="board-status">
            <span className={`turn-indicator ${phase === 'playing' ? 'active' : ''}`}>
              <span className={`turn-dot ${solverColor === WHITE ? 'white' : 'black'}`} />
              {phase === 'solved'
                ? 'SOLVED'
                : phase === 'failed'
                  ? 'FAILED'
                  : checking
                    ? 'VERIFYING'
                    : `${puzzle.sideToMove === 'white' ? 'WHITE' : 'BLACK'} TO MOVE`}
            </span>
            {controller.inCheck && phase === 'playing' && <span className="check-flag">CHECK</span>}
            <div className="board-tools">
              <button className="tool-btn" onClick={flip} aria-label="Flip board" title="Flip (F)"><IconFlip size={15} /></button>
            </div>
          </div>
        </div>

        {feedback && (
          <div className={`puzzle-feedback ${phase === 'solved' ? 'ok' : phase === 'failed' ? 'bad' : ''}`} role="status">
            {phase === 'solved' && <IconTrophy size={14} />}
            {phase === 'failed' && <IconTarget size={14} />}
            {feedback}
          </div>
        )}

        <div className="row wrap">
          {phase === 'solved' && (
            <button className="btn btn-primary" onClick={() => void onNext()}>
              <IconBolt size={13} /> NEXT
            </button>
          )}
          {phase === 'failed' && (
            <button className="btn btn-primary" onClick={retry}>
              <IconBolt size={13} /> RETRY
            </button>
          )}
          {(phase === 'failed' || (phase === 'playing' && wrong >= 1)) && (
            <button className="btn" onClick={() => setShowSolution(true)}>
              <IconList size={13} /> SOLUTION
            </button>
          )}
          <button className="btn btn-ghost" onClick={() => void onNext()} disabled={phase === 'playing' && controller.moves.length === 0}>
            SKIP
          </button>
          <button className="btn btn-ghost" onClick={onExit}>FILTERS</button>
        </div>
      </div>

      <div className="stack gap-12">
        <div className="panel">
          <div className="panel-title">
            Puzzle
            <span className="tiny faint mono">{DIFFICULTY_LABELS[puzzle.difficulty]}</span>
          </div>
          <div className="panel-pad stack gap-12">
            <div className="spread">
              <span className="roster-name" style={{ fontSize: 14 }}>{puzzle.category.toUpperCase()}</span>
              <span className="puzzle-timer">{(elapsed / 1000).toFixed(1)}s</span>
            </div>
            <div className="tiny faint">
              {puzzle.sideToMove === 'white' ? 'White' : 'Black'} to move ·{' '}
              {puzzle.solution.length > 1 ? `${puzzle.solution.length} key moves` : 'one key move'}
            </div>
            <div className="divider" />
            <div className="spread small">
              <span className="faint">Streak</span>
              <span className="mono">{streak} <span className="faint">/ best {loadBestStreak()}</span></span>
            </div>
          </div>
        </div>

        <div className="panel">
          <div className="panel-title">Moves</div>
          <MoveList sans={controller.moves.map((m) => m.san)} collapsed={!moveListOpen} />
        </div>

        <div className="tiny faint" style={{ padding: '0 4px' }}>
          {filterLabel}
        </div>
      </div>

      {showSolution && (
        <div className="modal-scrim" role="dialog" aria-modal="true" aria-label="Solution">
          <div className="panel stack" style={{ maxWidth: 440 }}>
            <div className="panel-title">Solution</div>
            <div className="panel-pad stack gap-12">
            <p className="small" style={{ margin: 0 }}>{puzzle.motif}</p>
            <div className="mono small solution-line">
              {puzzle.line.map((_, i) => (
                <span key={i} className={i % 2 === 0 ? 'sol-player' : 'sol-opponent'}>
                  {i % 2 === 0 ? `${Math.floor(i / 2) + 1}.` : ''} {uciToSan(puzzle, i)}
                </span>
              ))}
            </div>
            <div className="row">
              <button className="btn btn-primary btn-sm" onClick={() => setShowSolution(false)}>CLOSE</button>
            </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ helpers

function StatCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat-cell">
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

function sqAlg(sq: number): string {
  return `${String.fromCharCode(97 + (sq & 7))}${(sq >> 4) + 1}`;
}

function promoLetter(promo: PieceType | null): string {
  switch (promo) {
    case 2: return 'n';
    case 3: return 'b';
    case 4: return 'r';
    case 5:
    case 6: return 'q';
    default: return '';
  }
}

function uciToAnim(uci: string, capture: boolean): BoardAnimate {
  const from = (uci.charCodeAt(0) - 97) + (Number(uci[1]) - 1) * 16;
  const to = (uci.charCodeAt(2) - 97) + (Number(uci[3]) - 1) * 16;
  return { from, to, capturedPiece: capture ? 1 : 0, capturedSquare: capture ? to : -1, promoted: uci.length === 5 };
}

/** SAN for a ply of the stored puzzle line (replayed on a scratch position). */
function uciToSan(puzzle: Puzzle, plyIndex: number): string {
  try {
    const pos = new GameController({ whiteName: '', blackName: '', startFen: puzzle.fen });
    for (let i = 0; i < plyIndex; i++) {
      if (!pos.applyUci(puzzle.line[i]!)) return puzzle.line[plyIndex] ?? '';
    }
    const rec = pos.applyUci(puzzle.line[plyIndex]!);
    return rec?.san ?? puzzle.line[plyIndex] ?? '';
  } catch {
    return puzzle.line[plyIndex] ?? '';
  }
}

const STREAK_KEY = 'checkmate:puzzle-streak';
function loadStreak(): number {
  try {
    return Number(localStorage.getItem(STREAK_KEY) ?? '0') || 0;
  } catch {
    return 0;
  }
}
function loadBestStreak(): number {
  try {
    return Number(localStorage.getItem(`${STREAK_KEY}:best`) ?? '0') || 0;
  } catch {
    return 0;
  }
}
function saveStreak(current: number): void {
  try {
    localStorage.setItem(STREAK_KEY, String(current));
    const best = Math.max(loadBestStreak(), current);
    localStorage.setItem(`${STREAK_KEY}:best`, String(best));
  } catch {
    /* storage blocked */
  }
}
