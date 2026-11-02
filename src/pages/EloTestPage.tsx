import { ActionButton } from '../components/ActionButton';
/** Eight local assessment rounds with an unofficial performance estimate. */
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
import { useJobScope } from '../game/jobScope';
import { MateClient } from '../education/mateClient';
import { BOTS } from '../engine/bots';
import { BLACK, Color, PieceType, WHITE } from '../chess/constants';
import { moveSoundName, sound } from '../audio/sound';
import { effectiveReducedMotion, useSettings } from '../storage/settings';
import { eloRepo, EloResult, gamesRepo, StoredGame, dataRevision, dbAvailable } from '../storage/db';
import { uid, formatDate } from '../utils';
import { IconFlip, IconGauge, IconPlay, IconTrophy } from '../components/icons';

type Stage = 'intro' | 'round' | 'result';

interface RoundScore {
  roundId: string;
  score: number;
  lossCp: number;
  moves: string[];
  fen: string;
  records: StoredGame['moves'];
  outcome: StoredGame['outcome'];
  durationMs: number;
  side: 'white' | 'black';
  defender: string;
}

const RATING_MIN = 400;
const RATING_SPAN = 1900;

export function EloTestPage() {
  const [stage, setStage] = useState<Stage>('intro');
  const [roundIdx, setRoundIdx] = useState(0);
  const [scores, setScores] = useState<RoundScore[]>([]);
  const [history, setHistory] = useState<EloResult[] | null>(null);
  const [completedResult, setCompletedResult] = useState<EloResult | null>(null);
  const [persistent, setPersistent] = useState(true);
  const scope = useJobScope(), revision = useRef(dataRevision());

  useEffect(() => {
    void eloRepo.all().then(async (rows) => { const available = await dbAvailable(); if (scope.active) { setHistory(rows); setPersistent(available); } }).catch(() => { if (scope.active) setHistory([]); });
  }, []);

  useRegisterCommands(
    useMemo(
      () => stage === 'intro' ? [] : [{ id: 'elo-restart', label: 'Restart Elo Test', group: 'Elo', run: () => setStage('intro') }],
      [stage],
    ),
  );

  const finishRound = useCallback(
    (rs: RoundScore) => {
      if (!scope.active || revision.current !== dataRevision() || stage !== 'round' || rs.roundId !== ELO_ROUNDS[roundIdx]?.id || scores.some((score) => score.roundId === rs.roundId)) return;
      const next = [...scores, rs];
      setScores(next);
      if (roundIdx + 1 >= ELO_ROUNDS.length) {
        const result = computeResult(next);
        setCompletedResult(result);
        void eloRepo.save(result, revision.current).then(async () => { const available = await dbAvailable(); if (scope.active) { setPersistent(available); setHistory((rows) => [result, ...(rows ?? [])]); } });
        // Keep the consistency round's moves as a reviewable game.
        const consistency = next.find((r) => r.roundId === 's1');
        if (consistency && consistency.moves.length > 0) {
          const game: StoredGame = {
            id: uid(),
            mode: 'elo',
            date: Date.now(),
            whiteName: consistency.side === 'white' ? 'You' : consistency.defender,
            blackName: consistency.side === 'black' ? 'You' : consistency.defender,
            startFen: consistency.fen,
            moves: consistency.records.map((move) => ({ ...move })),
            outcome: consistency.outcome,
            durationMs: consistency.durationMs,
          };
          void gamesRepo.save(game, revision.current);
        }
        setStage('result');
        sound.play('reveal');
      } else {
        setRoundIdx(roundIdx + 1);
        setStage('round');
      }
    },
    [roundIdx, scores, stage, scope],
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
                <li>Calculation — find the key to a forced mate.</li>
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
                    setScores([]); setCompletedResult(null);
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

  return completedResult ? <EloResultView scores={scores} result={completedResult} persistent={persistent} onRestart={() => setStage('intro')} /> : null;
}


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
  const busy = useRef(false), doneRef = useRef(false);
  const scope = useJobScope(), revision = useRef(dataRevision());
  const operation = useRef<AbortController | null>(null), mate = useRef<MateClient | null>(null);
  const [defenceError, setDefenceError] = useState(false);
  useEffect(() => { mate.current = new MateClient(); return () => mate.current?.dispose(); }, []);

  const defenderStyle = useMemo(() => {
    const id = round.defender ?? 'club';
    return BOTS.find((b) => b.id === id) ?? BOTS[2]!;
  }, [round.defender]);

  const finish = useCallback((score: number, note: string) => {
    if (!scope.active || doneRef.current || revision.current !== dataRevision()) return;
    doneRef.current = true; setDone(true); setFeedback(note);
    const records = controller.moves.map((move) => ({ ...move }));
    const outcome: StoredGame['outcome'] = !controller.end ? { result: 'unfinished' } : controller.end.winner === 'white' ? { result: 'white' }
      : controller.end.winner === 'black' ? { result: 'black' } : { result: 'draw', reason: controller.end.reason as 'stalemate' | 'threefold' | 'fifty-move' | 'insufficient' };
    const result: RoundScore = { roundId: round.id, score: Math.max(0, Math.min(1, score)),
      lossCp: lossAcc.current.length ? lossAcc.current.reduce((sum, loss) => sum + loss, 0) / lossAcc.current.length : 0,
      moves: records.map((move) => move.uci), records, outcome, durationMs: controller.durationMs,
      side: round.sideToMove, defender: defenderStyle.name, fen: round.fen };
    scope.later(() => onDone(result), 1600);
  }, [controller, onDone, round, scope, defenderStyle.name]);
  const terminal = (): boolean => {
    if (!controller.end) return false;
    if (controller.end.winner === (playerColor === WHITE ? 'white' : 'black')) finish(1, controller.end.reason === 'checkmate' ? 'CHECKMATE' : 'Won.');
    else if (controller.end.winner === null) finish(0.25, 'Drawn — the win dissolved.');
    else finish(0, 'Lost the position.');
    return true;
  };
  const live = (abort: AbortController) => scope.active && !abort.signal.aborted && !doneRef.current && revision.current === dataRevision();
  const defenderTurn = async (abort: AbortController) => {
    if (controller.phase !== 'playing') { terminal(); return; }
    const reply = await engineClient.search({ gameId: `elo-${round.id}`, startFen: round.fen,
      moves: controller.moves.map((move) => move.uci), style: defenderStyle, signal: abort.signal });
    if (!live(abort)) return;
    if (!reply.uci) throw new Error('No defence available');
    const record = controller.applyUci(reply.uci);
    if (!record) throw new Error('Illegal engine reply');
    setDefenceError(false); setAnimate(settings.animateMoves ? uciToAnim(record.uci, record.capture) : null);
    sound.play(moveSoundName(record)); terminal();
  };

  const onMove = async (from: number, to: number, promo: PieceType | null): Promise<boolean> => {
    if (!scope.active || doneRef.current || thinking || busy.current || controller.phase !== 'playing' || controller.turn !== playerColor) return false;
    const fenBefore = controller.position.fen();
    const uci = sqAlg(from) + sqAlg(to) + promoLetter(promo);
    const abort = scope.request(); operation.current = abort;
    busy.current = true; setThinking(true);
    try {
      // --- one-shot rounds: judge the single move.
      if (round.kind === 'mate' || round.kind === 'tactics') {
        const q = await engineClient.analyzeMove({ fen: fenBefore, playedUci: uci, depth: 8, signal: abort.signal });
        if (!live(abort)) return false;
        let forcedMate = false;
        if (round.kind === 'mate') {
          const proof = await mate.current!.request({ type: 'verify', fen: fenBefore, uci, movesLeft: round.mateIn ?? 1 });
          if (!live(abort)) return false;
          if (proof.status === 'limit' || proof.status === 'error') { setFeedback('The local proof limit was reached. Try again; no score was recorded.'); return false; }
          forcedMate = proof.status === 'accepted';
        }
        lossAcc.current.push(q.lossCp);
        const rec = controller.applyUci(uci);
        if (rec) {
          setAnimate(settings.animateMoves ? { from, to, capturedPiece: 0, capturedSquare: -1, promoted: uci.length === 5 } : null);
          sound.play(moveSoundName(rec));
        }
        if (round.kind === 'mate' ? forcedMate : uci === round.bestMove || q.lossCp <= 40) {
          finish(1, uci === round.bestMove ? 'BEST MOVE' : 'Found the winning move.');
        } else if (round.kind === 'mate') {
          finish(0, 'That move does not force mate within the target.');
        } else if (q.lossCp <= 150) {
          finish(1 - q.lossCp / 400, 'Good — but a stronger move existed.');
        } else {
          finish(Math.max(0, 1 - q.lossCp / 400), 'The shot was there. Best was different.');
        }
        return true;
      }

      // --- convert / consistency: play on, measuring each move.
      const q = await engineClient.analyzeMove({ fen: fenBefore, playedUci: uci, depth: 7, signal: abort.signal });
      if (!live(abort)) return false;
      lossAcc.current.push(Math.min(600, q.lossCp));
      const captured = controller.position.pieceAt(to);
      const rec = controller.applyUci(uci);
      if (!rec) return false;
      setAnimate(settings.animateMoves ? { from, to, capturedPiece: captured, capturedSquare: to, promoted: promo !== null } : null);
      sound.play(moveSoundName(rec));

      if (terminal()) return true;

      const played = controller.moves.filter((_, index) => ((index % 2 === 0) === (round.fen.split(/\s+/)[1] === 'w')) === (playerColor === WHITE)).length;
      const target = round.targetMoves ?? 12;

      if (round.kind === 'consistency') {
        setFeedback(`${played}/${target} moves · last move ${q.lossCp < 40 ? 'clean' : q.lossCp < 120 ? 'okay' : 'loose'}`);
      } else {
        setFeedback(`${played}/${target} moves to convert`);
      }

      if (played >= target) {
        // Evaluate the resulting position for scoring.
        const cp = await engineClient.evaluate(controller.position.fen(), abort.signal);
        if (!live(abort)) return false;
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

      await defenderTurn(abort);
      return true;
    } catch {
      if (live(abort)) { setDefenceError(controller.turn !== playerColor); toast('Engine unavailable. Retry when ready.', 'danger'); }
      return false;
    } finally {
      scope.release(abort);
      if (scope.active && operation.current === abort) { busy.current = false; setThinking(false); }
    }
  };

  const interactive = !done && !thinking && controller.phase === 'playing' && controller.turn === playerColor;
  const legalFor = useCallback(
    (sq: number) => (interactive ? controller.movesFrom(sq) : []),
    [controller, interactive, version],
  );
  const selectable = useCallback(
    (sq: number) => {
      if (!interactive) return false;
      const piece = controller.position.pieceAt(sq);
      return piece !== 0 && (piece >> 3) === (playerColor === WHITE ? 0 : 1);
    },
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

        {engineClient.workerFailed && <p className="small muted" role="status">Worker unavailable. Evaluations use a shorter local search.</p>}
        {defenceError && !done && <div className="panel panel-pad" role="alert"><p>The defence could not move.</p><ActionButton className="btn btn-sm" blockedReason={thinking && 'The defence is already calculating its move. Wait for it to finish.'} onClick={() => {
          if (busy.current || doneRef.current) return;
          const abort = scope.request(); operation.current = abort; busy.current = true; setThinking(true);
          void defenderTurn(abort).catch(() => { if (live(abort)) toast('Defence unavailable. Retry when ready.', 'danger'); }).finally(() => {
            scope.release(abort); if (scope.active && operation.current === abort) { busy.current = false; setThinking(false); }
          });
        }}>RETRY DEFENCE</ActionButton></div>}
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
            {round.kind === 'mate' && <div className="tiny faint">Find the first move of mate in {round.mateIn}.</div>}
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
          <MoveList startFen={controller.position.startFen} sans={controller.moves.map((m) => m.san)} />
        </div>
      </div>
    </div>
  );
}


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

function EloResultView({ scores, result, persistent, onRestart }: { scores: RoundScore[]; result: EloResult; persistent: boolean; onRestart: () => void }) {
  const { settings } = useSettings();
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
          {!persistent && <p className="small muted" role="status">Saving is unavailable. Export your data before closing this session.</p>}
          <div className="eyebrow" style={{ justifyContent: 'center' }}>Performance rating</div>
          <div className="elo-big" aria-label={`Estimated ${result.rating} elo`}>
            {shownRating}
          </div>
          <div className="tiny faint" style={{ textAlign: 'center' }}>
            estimate range {result.rangeLow}–{result.rangeHigh} · {result.rounds} rounds · {result.overall}% score
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
