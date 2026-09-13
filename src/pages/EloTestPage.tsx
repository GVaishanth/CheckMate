/**
 * Elo Test — eight engine-verified rounds (tactics, calculation, endgame
 * conversion, consistency) played against the local engine. The result is an
 * EXPERIMENTAL BROWSER ESTIMATE, clearly labeled as unofficial, derived from
 * real performance: centipawn loss, mate accuracy and conversion success.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Board, BoardAnimate, Orientation } from '../components/Board';
import { MoveList } from '../components/MoveList';
import { useToast } from '../components/Toast';
import { useControllerVersion, useOrientation } from '../game/hooks';
import { useRegisterCommands } from '../game/commands';
import { GameController } from '../game/GameController';
import { accuracyFromLoss } from '../game/analysis';
import { CATEGORY_META, ELO_ROUNDS, EloRound } from '../data/elo';
import { engineClient } from '../game/engineClient';
import { BOTS } from '../engine/bots';
import { BLACK, Color, PieceType, WHITE } from '../chess/constants';
import { moveSoundName, sound } from '../audio/sound';
import { effectiveReducedMotion, useSettings } from '../storage/settings';
import { eloRepo, EloResult, gamesRepo, StoredGame } from '../storage/db';
import { uid, formatDate } from '../utils';
import { IconFlip, IconGauge, IconPlay, IconTrophy } from '../components/icons';

type Stage = 'intro' | 'round' | 'result';

interface RoundScore {
  roundId: string;
  score: number;
  lossCp: number;
  moves: string[];
  fen: string;
}

const RATING_MIN = 400;
const RATING_SPAN = 1900;

export function EloTestPage() {
  const [stage, setStage] = useState<Stage>('intro');
  const [roundIdx, setRoundIdx] = useState(0);
  const [scores, setScores] = useState<RoundScore[]>([]);
  const [history, setHistory] = useState<EloResult[] | null>(null);

  useEffect(() => {
    void eloRepo.all().then(setHistory).catch(() => setHistory([]));
  }, []);

  useRegisterCommands(
    useMemo(
      () => [{ id: 'elo-restart', label: 'Restart Elo Test', group: 'Elo', run: () => setStage('intro') }],
      [],
    ),
  );

  const finishRound = useCallback(
    (rs: RoundScore) => {
      const next = [...scores, rs];
      setScores(next);
      if (roundIdx + 1 >= ELO_ROUNDS.length) {
        const result = computeResult(next);
        void eloRepo.save(result).catch(() => undefined);
        // Keep the consistency round's moves as a reviewable game.
        const consistency = next.find((r) => r.roundId === 's1');
        if (consistency && consistency.moves.length > 0) {
          const game: StoredGame = {
            id: uid(),
            mode: 'elo',
            date: Date.now(),
            whiteName: 'You',
            blackName: 'Club Player',
            startFen: consistency.fen,
            moves: consistency.moves.map((uci, i) => ({
              san: '', uci, fenAfter: '', msElapsed: 0, capture: false, check: false, _: i,
            })) as unknown as StoredGame['moves'],
            outcome: { result: 'draw', reason: 'agreement' },
            durationMs: 0,
          };
          void gamesRepo.save(game).catch(() => undefined);
        }
        setStage('result');
        sound.play('reveal');
      } else {
        setRoundIdx(roundIdx + 1);
        setStage('round');
      }
    },
    [roundIdx, scores],
  );

  if (stage === 'intro') {
    return (
      <div className="page">
        <div className="container">
          <div className="page-head">
            <div>
              <div className="eyebrow">Estimated performance rating · versus local engine</div>
              <h1 className="page-title">Elo Test</h1>
              <p className="page-sub">
                8 positions. No hints. Play your best.
              </p>
            </div>
          </div>

          <div className="panel" style={{ maxWidth: 640 }}>
            <div className="panel-title">The gauntlet</div>
            <div className="panel-pad stack gap-12">
              <ol className="flow-steps small">
                <li>Tactics — one move decides.</li>
                <li>Calculation — forced mates to the end.</li>
                <li>Endgames — convert winning positions.</li>
                <li>Consistency — 12 quiet moves, every inaccuracy counted.</li>
              </ol>
              <div className="tiny faint" role="note">
                Experimental browser estimate — not an official rating of any kind.
              </div>
              <div>
                <button
                  className="btn btn-primary btn-lg"
                  onClick={() => {
                    sound.unlock();
                    setScores([]);
                    setRoundIdx(0);
                    setStage('round');
                    sound.play('gameStart');
                  }}
                >
                  <IconPlay size={16} /> BEGIN THE TEST
                </button>
              </div>
            </div>
          </div>

          {history !== null && history.length > 0 && (
            <div className="panel mt-24" style={{ maxWidth: 640 }}>
              <div className="panel-title">Previous estimates</div>
              <div className="stack gap-8" style={{ padding: '14px 16px' }}>
                {history.slice(0, 6).map((h) => (
                  <div key={h.id} className="spread small">
                    <span className="mono">{h.rating} <span className="faint">±{Math.round((h.rangeHigh - h.rangeLow) / 2)}</span></span>
                    <span className="faint">{formatDate(h.date)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (stage === 'round') {
    const round = ELO_ROUNDS[roundIdx]!;
    return (
      <div className="page">
        <div className="container">
          <div className="elo-progress" role="progressbar" aria-valuenow={roundIdx + 1} aria-valuemin={1} aria-valuemax={ELO_ROUNDS.length} aria-label={`Round ${roundIdx + 1} of ${ELO_ROUNDS.length}`}>
            {ELO_ROUNDS.map((r, i) => (
              <span
                key={r.id}
                className={`elo-dot${i < roundIdx ? ' done' : ''}${i === roundIdx ? ' current' : ''}`}
                title={CATEGORY_META[r.category].label}
              />
            ))}
            <span className="tiny faint mono ml-8">ROUND {roundIdx + 1}/{ELO_ROUNDS.length}</span>
          </div>
          <EloRoundView
            key={round.id + roundIdx}
            round={round}
            roundNumber={roundIdx + 1}
            totalRounds={ELO_ROUNDS.length}
            onDone={finishRound}
          />
        </div>
      </div>
    );
  }

  return <EloResultView scores={scores} onRestart={() => setStage('intro')} />;
}

// ------------------------------------------------------------------ round

function EloRoundView({ round, roundNumber, totalRounds, onDone }: { round: EloRound; roundNumber: number; totalRounds: number; onDone: (rs: RoundScore) => void }) {
  const { settings } = useSettings();
  const { toast } = useToast();
  const controller = useMemo(
    () => new GameController({ whiteName: 'You', blackName: 'Engine', startFen: round.fen }),
    [round.fen],
  );
  const version = useControllerVersion(controller);
  const playerColor: Color = round.sideToMove === 'white' ? WHITE : BLACK;
  const [orientation, flip] = useOrientation(round.sideToMove);
  const [animate, setAnimate] = useState<BoardAnimate | null>(null);
  const [thinking, setThinking] = useState(false);
  const [done, setDone] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const lossAcc = useRef<number[]>([]);
  const busy = useRef(false);

  const defenderStyle = useMemo(() => {
    const id = round.defender ?? 'club';
    return BOTS.find((b) => b.id === id) ?? BOTS[2]!;
  }, [round.defender]);

  const finish = useCallback(
    (score: number, note: string) => {
      setDone(true);
      setFeedback(note);
      const avgLoss = lossAcc.current.length
        ? lossAcc.current.reduce((a, b) => a + b, 0) / lossAcc.current.length
        : 0;
      window.setTimeout(() => {
        onDone({
          roundId: round.id,
          score: Math.max(0, Math.min(1, score)),
          lossCp: avgLoss,
          moves: controller.moves.map((m) => m.uci),
          fen: round.fen,
        });
      }, 1600);
    },
    [controller, onDone, round.fen, round.id],
  );

  const defenderTurn = async () => {
    if (controller.phase !== 'playing') return;
    setThinking(true);
    try {
      const r = await engineClient.search({
        gameId: `elo-${round.id}`,
        startFen: round.fen,
        moves: controller.moves.map((m) => m.uci),
        style: defenderStyle,
      });
      if (r.uci && controller.phase === 'playing') {
        const rec = controller.applyUci(r.uci);
        if (rec) {
          setAnimate(settings.animateMoves ? uciToAnim(rec.uci, rec.capture) : null);
          sound.play(moveSoundName(rec));
        }
      }
    } catch {
      toast('Engine unavailable — round cannot continue.', 'danger');
    } finally {
      setThinking(false);
    }
  };

  const onMove = async (from: number, to: number, promo: PieceType | null): Promise<boolean> => {
    if (done || thinking || busy.current || controller.phase !== 'playing' || controller.turn !== playerColor) return false;
    const fenBefore = controller.position.fen();
    const uci = sqAlg(from) + sqAlg(to) + promoLetter(promo);
    busy.current = true;
    try {
      // --- one-shot rounds: judge the single move.
      if (round.kind === 'mate' || round.kind === 'tactics') {
        const q = await engineClient.analyzeMove({ fen: fenBefore, playedUci: uci, depth: 8 });
        lossAcc.current.push(q.lossCp);
        const rec = controller.applyUci(uci);
        if (rec) {
          setAnimate(settings.animateMoves ? { from, to, capturedPiece: 0, capturedSquare: -1, promoted: uci.length === 5 } : null);
          sound.play(moveSoundName(rec));
        }
        if (uci === round.bestMove || q.lossCp <= 40) {
          finish(1, uci === round.bestMove ? 'BEST MOVE' : 'Found the winning move.');
        } else if (q.lossCp <= 150) {
          finish(1 - q.lossCp / 400, 'Good — but a stronger move existed.');
        } else {
          finish(Math.max(0, 1 - q.lossCp / 400), 'The shot was there. Best was different.');
        }
        return true;
      }

      // --- convert / consistency: play on, measuring each move.
      const q = await engineClient.analyzeMove({ fen: fenBefore, playedUci: uci, depth: 7 });
      lossAcc.current.push(Math.min(600, q.lossCp));
      const captured = controller.position.pieceAt(to);
      const rec = controller.applyUci(uci);
      if (!rec) return false;
      setAnimate(settings.animateMoves ? { from, to, capturedPiece: captured, capturedSquare: to, promoted: promo !== null } : null);
      sound.play(moveSoundName(rec));

      if (controller.end) {
        if (controller.end.winner === (playerColor === WHITE ? 'white' : 'black')) {
          finish(1, controller.end.reason === 'checkmate' ? 'CHECKMATE — flawless conversion.' : 'Won.');
        } else if (controller.end.winner === null) {
          finish(0.25, 'Drawn — the win dissolved.');
        } else {
          finish(0, 'Lost the position.');
        }
        return true;
      }

      const played = controller.moves.filter((_, i) => i % 2 === (playerColor === WHITE ? 0 : 1)).length;
      const target = round.targetMoves ?? 12;

      if (round.kind === 'consistency') {
        setFeedback(`${played}/${target} moves · last move ${q.lossCp < 40 ? 'clean' : q.lossCp < 120 ? 'okay' : 'loose'}`);
      } else {
        setFeedback(`${played}/${target} moves to convert`);
      }

      if (played >= target) {
        // Evaluate the resulting position for scoring.
        const cp = await engineClient.evaluate(controller.position.fen());
        const forPlayer = playerColor === WHITE ? cp : -cp;
        if (round.kind === 'consistency') {
          const avgLoss = lossAcc.current.reduce((a, b) => a + b, 0) / lossAcc.current.length;
          finish(accuracyFromLoss(avgLoss) / 100, 'Consistency round complete.');
        } else {
          const thr = round.winThresholdCp ?? 700;
          if (forPlayer >= thr) finish(1, 'Converted cleanly.');
          else if (forPlayer >= 100) finish(0.4 + 0.6 * (forPlayer / thr), 'Winning — but the engine wanted more.');
          else if (forPlayer >= -100) finish(0.35, 'The advantage evaporated.');
          else finish(0, 'The position turned.');
        }
        return true;
      }

      await defenderTurn();
      return true;
    } catch {
      toast('Could not verify the move — engine unavailable.', 'danger');
      return false;
    } finally {
      busy.current = false;
    }
  };

  const interactive = !done && !thinking && controller.phase === 'playing' && controller.turn === playerColor;
  const legalFor = useCallback(
    (sq: number) => (interactive ? controller.movesFrom(sq) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [controller, interactive, version],
  );
  const selectable = useCallback(
    (sq: number) => {
      if (!interactive) return false;
      const piece = controller.position.pieceAt(sq);
      return piece !== 0 && (piece >> 3) === (playerColor === WHITE ? 0 : 1);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [controller, interactive, playerColor, version],
  );

  const kindLabel =
    round.kind === 'mate' ? 'CALCULATION' : round.kind === 'tactics' ? 'TACTICS' : round.kind === 'convert' ? 'ENDGAME' : 'CONSISTENCY';

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
              return true;
            }}
            onIllegal={() => sound.play('illegal')}
            lastMove={controller.lastMove}
            checkSquare={controller.checkSquare}
            animate={animate}
            settings={settings}
            label={`Elo test round. ${round.prompt}`}
          />
          <div className="board-status">
            <span className={`turn-indicator ${interactive ? 'active' : ''}`}>
              <span className={`turn-dot ${controller.turn === WHITE ? 'white' : 'black'}`} />
              {done ? 'ROUND COMPLETE' : thinking ? 'ENGINE THINKING' : interactive ? 'YOUR MOVE' : 'ENGINE MOVING'}
            </span>
            {controller.inCheck && controller.phase === 'playing' && <span className="check-flag">CHECK</span>}
            <div className="board-tools">
              <button className="tool-btn" onClick={flip} aria-label="Flip board" title="Flip (F)"><IconFlip size={15} /></button>
            </div>
          </div>
        </div>

        {feedback && (
          <div className={`puzzle-feedback ${done ? 'ok' : ''}`} role="status">
            {done && <IconTrophy size={14} />}
            {feedback}
          </div>
        )}
      </div>

      <div className="stack gap-12">
        <div className="panel">
          <div className="panel-title">
            Round {roundNumber}/{totalRounds}
            <span className="tiny faint mono">{kindLabel}</span>
          </div>
          <div className="panel-pad stack gap-12">
            <p className="small" style={{ margin: 0 }}>{round.prompt}</p>
            {round.kind === 'mate' && <div className="tiny faint">Mate in {round.mateIn}. One move to prove it.</div>}
            {round.kind === 'tactics' && <div className="tiny faint">One move — make it count.</div>}
            {(round.kind === 'convert' || round.kind === 'consistency') && (
              <div className="tiny faint">{round.targetMoves} of your moves · engine defends</div>
            )}
            <div className="divider" />
            <div className="tiny faint">
              Every move is compared to the engine's best — small centipawn losses, big rating.
            </div>
          </div>
        </div>

        <div className="panel">
          <div className="panel-title">Moves</div>
          <MoveList sans={controller.moves.map((m) => m.san)} />
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ result

function computeResult(scores: RoundScore[]): EloResult {
  const roundById = new Map(ELO_ROUNDS.map((r) => [r.id, r]));
  let wsum = 0;
  let wtotal = 0;
  const byCat = new Map<string, number[]>();
  for (const s of scores) {
    const r = roundById.get(s.roundId);
    if (!r) continue;
    const w = CATEGORY_META[r.category].weight;
    wsum += w * s.score;
    wtotal += w;
    const list = byCat.get(r.category) ?? [];
    list.push(s.score);
    byCat.set(r.category, list);
  }
  const overall = wtotal > 0 ? wsum / wtotal : 0;
  const rating = Math.round(RATING_MIN + RATING_SPAN * overall);

  const categories: Record<string, number> = {};
  for (const [cat, list] of byCat) {
    const avg = list.reduce((a, b) => a + b, 0) / list.length;
    categories[cat] = Math.round(RATING_MIN + RATING_SPAN * avg);
  }

  const vals = scores.map((s) => s.score);
  const spread = vals.length > 1 ? Math.max(...vals) - Math.min(...vals) : 0.3;
  const halfRange = Math.round(Math.max(50, Math.min(250, 70 + 180 * spread)));

  const catKeys = [...byCat.keys()];
  let strongest: string | undefined;
  let weakest: string | undefined;
  if (catKeys.length > 1) {
    catKeys.sort((a, b) => (categories[b] ?? 0) - (categories[a] ?? 0));
    strongest = CATEGORY_META[catKeys[0] as keyof typeof CATEGORY_META]?.label;
    weakest = CATEGORY_META[catKeys[catKeys.length - 1] as keyof typeof CATEGORY_META]?.label;
  }

  return {
    id: uid(),
    date: Date.now(),
    rating,
    rangeLow: Math.max(RATING_MIN, rating - halfRange),
    rangeHigh: Math.min(RATING_MIN + RATING_SPAN, rating + halfRange),
    categories,
    overall: Math.round(overall * 100),
    strongest,
    weakest,
    rounds: scores.length,
  };
}

function EloResultView({ scores, onRestart }: { scores: RoundScore[]; onRestart: () => void }) {
  const { settings } = useSettings();
  const result = useMemo(() => computeResult(scores), [scores]);
  const roundById = new Map(ELO_ROUNDS.map((r) => [r.id, r]));
  const catEntries = (Object.keys(CATEGORY_META) as Array<keyof typeof CATEGORY_META>).filter((c) =>
    result.categories[c] !== undefined,
  );
  const [shownRating, setShownRating] = useState(RATING_MIN);

  useEffect(() => {
    // Reduced motion: skip the count-up, show the number immediately.
    if (effectiveReducedMotion(settings)) {
      setShownRating(result.rating);
      return;
    }
    // Count-up: the number should feel earned.
    const t0 = performance.now();
    const dur = 900;
    let raf = 0;
    const tick = (t: number) => {
      const k = Math.min(1, (t - t0) / dur);
      const eased = 1 - Math.pow(1 - k, 3);
      setShownRating(Math.round(RATING_MIN + (result.rating - RATING_MIN) * eased));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [result.rating, settings]);

  return (
    <div className="page">
      <div className="container">
        <div className="panel panel-pad elo-result stack gap-16" style={{ animation: 'rise-in 500ms var(--ease) both' }}>
          <div className="eyebrow" style={{ justifyContent: 'center' }}>Performance rating</div>
          <div className="elo-big" aria-label={`Estimated ${result.rating} elo`}>
            {shownRating}
          </div>
          <div className="tiny faint" style={{ textAlign: 'center' }}>
            confidence {result.rangeLow}–{result.rangeHigh} · {result.rounds} rounds · {result.overall}% score
          </div>

          <div className="tiny faint" style={{ textAlign: 'center' }} role="note">
            Experimental browser estimate — not an official rating of any kind
          </div>

          <div className="divider" />

          <div className="stack gap-12">
            {catEntries.map((cat) => {
              const v = result.categories[cat] ?? 0;
              return (
                <div key={cat} className="stack gap-4">
                  <div className="spread small">
                    <span>{CATEGORY_META[cat].label}</span>
                    <span className="mono">{v}</span>
                  </div>
                  <div className="bar">
                    <div className="bar-fill" style={{ width: `${Math.round(((v - RATING_MIN) / RATING_SPAN) * 100)}%` }} />
                  </div>
                </div>
              );
            })}
          </div>

          {result.strongest && result.weakest && (
            <p className="small muted" style={{ margin: 0, textAlign: 'center' }}>
              Strongest: <strong>{result.strongest}</strong> · Needs work: <strong>{result.weakest}</strong>
            </p>
          )}

          <div className="divider" />

          <div className="stack gap-8">
            {scores.map((s) => {
              const r = roundById.get(s.roundId);
              return (
                <div key={s.roundId} className="spread small">
                  <span className="faint">{r ? CATEGORY_META[r.category].label : s.roundId}</span>
                  <span className="mono">{Math.round(s.score * 100)}%{s.lossCp > 0 ? ` · ${Math.round(s.lossCp)}cp` : ''}</span>
                </div>
              );
            })}
          </div>

          <div className="row" style={{ justifyContent: 'center' }}>
            <button className="btn btn-primary" onClick={onRestart}>
              <IconGauge size={14} /> RETAKE
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ helpers

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
