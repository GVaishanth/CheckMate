import { ActionButton } from '../components/ActionButton';
/**
 * Bots page — opponent selection + the bot game screen.
 *
 * The bot thinks in a Web Worker via engineClient; the UI stays interactive.
 * After the game, the engine analyzes every player move to produce accuracy
 * and an estimated performance rating — computed from real centipawn loss.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Board, BoardAnimate, Orientation } from '../components/Board';
import { CapturedPieces } from '../components/CapturedPieces';
import { GameOver } from '../components/GameOver';
import { GameReview } from '../components/GameReview';
import { Modal } from '../components/Modal';
import { MoveList } from '../components/MoveList';
import { useToast } from '../components/Toast';
import { BOTS, BotStyle, botById } from '../engine/bots';
import { engineClient } from '../game/engineClient';
import { useJobScope } from '../game/jobScope';
import { useGameController, useControllerVersion, useOrientation, useHotkeys } from '../game/hooks';
import { useRegisterCommands } from '../game/commands';
import type { GameController } from '../game/GameController';
import { accuracyFromLoss, endReasonText, performanceRating } from '../game/analysis';
import { BLACK, ChessVariant, Color, WHITE } from '../chess/constants';
import { endSoundFor, moveSoundName, sound } from '../audio/sound';
import { useSettings } from '../storage/settings';
import { gamesRepo, StoredGame, dataRevision } from '../storage/db';
import { exportPgn } from '../chess/pgn';
import { formatNodes, uid, copyText } from '../utils';
import { IconDraw, IconFlag, IconFlip, IconList, IconUndo, IconBolt } from '../components/icons';

type Stage = { kind: 'select' } | { kind: 'game'; bot: BotStyle; playerColor: Color; variant: ChessVariant };

export function BotsPage() {
  const [stage, setStage] = useState<Stage>({ kind: 'select' });
  const [gameKey, setGameKey] = useState(0);
  const navigate = useNavigate();

  useRegisterCommands(
    useMemo(
      () =>
        stage.kind === 'game'
          ? [
              {
                id: 'bot-new-game',
                label: 'New Game',
                group: 'Game',
                run: () => setGameKey((k) => k + 1),
              },
            ]
          : [],
      [stage.kind],
    ),
  );

  return (
    <div className="page">
      <div className="container">
        {stage.kind === 'select' ? (
          <BotSelect
            onStart={(bot, color, variant) => {
              setStage({ kind: 'game', bot, playerColor: color, variant });
              setGameKey((k) => k + 1);
            }}
          />
        ) : (
          <BotGame
            key={gameKey}
            bot={stage.bot}
            playerColor={stage.playerColor}
            variant={stage.variant}
            onNewGame={() => setGameKey((k) => k + 1)}
            onExit={() => {
              setStage({ kind: 'select' });
              navigate('/bots');
            }}
          />
        )}
      </div>
    </div>
  );
}


const VARIANTS: { id: ChessVariant; label: string; blurb: string }[] = [
  { id: 'standard', label: 'STANDARD', blurb: 'Classical rules.' },
  { id: 'three-check', label: '3-CHECK', blurb: 'Deliver check three times to win.' },
  { id: 'koth', label: 'KING OF THE HILL', blurb: 'March your king to the center to win.' },
];

function BotSelect({ onStart }: { onStart: (bot: BotStyle, color: Color, variant: ChessVariant) => void }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [matchBot, setMatchBot] = useState<string | null>(null);
  const [color, setColor] = useState<'white' | 'black' | 'random'>('white');
  const [variant, setVariant] = useState<ChessVariant>('standard');

  const chosen = matchBot ? botById(matchBot) : null;

  const start = () => {
    if (!chosen) return;
    const actualColor: Color =
      color === 'random' ? (Math.random() < 0.5 ? WHITE : BLACK) : color === 'white' ? WHITE : BLACK;
    sound.unlock();
    onStart(chosen, actualColor, variant);
  };

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Local opponents</div>
          <h1 className="page-title">Choose your opponent</h1>
          <p className="page-sub">
            Six engine personalities — each searches differently, evaluates differently, and cracks
            under different pressure. Tap once to select an opponent, tap again to start.
          </p>
        </div>
      </div>

      <div className="bot-setup">
        <div className="roster" role="group" aria-label="Bot opponents">
          {BOTS.map((bot) => (
            <button
              key={bot.id}
              className="roster-row"
              aria-pressed={selected === bot.id}
              onClick={() => {
                // First tap selects; a tap on the selected row opens the match box
                // (so a quick double tap lands here too).
                if (selected === bot.id) {
                  setMatchBot(bot.id);
                } else {
                  setSelected(bot.id);
                  sound.play('uiTick');
                }
              }}
              onDoubleClick={() => {
                setSelected(bot.id);
                setMatchBot(bot.id);
              }}
            >
              <span className="roster-pips" aria-hidden="true">
                {[1, 2, 3, 4, 5, 6].map((i) => (
                  <span key={i} className={`roster-pip${i <= bot.pips ? ' on' : ''}`} />
                ))}
              </span>
              <span className="roster-identity">
                <span className="roster-name">{bot.name}</span>
                <span className="roster-elo">{bot.elo}</span>
                <span className="roster-tag">{bot.tagline}</span>
              </span>
              <span className="roster-traits">
                {bot.traits.slice(0, 2).map((t) => (
                  <span key={t}>{t}</span>
                ))}
              </span>
              <span className={`roster-cta${selected === bot.id ? ' on' : ''}`} aria-hidden="true">
                {selected === bot.id ? 'START MATCH →' : 'SELECT'}
              </span>
            </button>
          ))}
        </div>
      </div>

      {chosen && (
        <Modal title="Match" onClose={() => setMatchBot(null)} closeLabel="Close match setup">
          <div className="stack gap-16">
            <div className="stack gap-8">
              <div className="roster-name" style={{ fontSize: 20 }}>{chosen.name}</div>
              <div className="mono" style={{ color: 'var(--accent)', fontSize: 13 }}>{chosen.elo}</div>
              <div className="small muted">{chosen.tagline}</div>
            </div>
            <div className="field">
              <span className="field-label">Your side</span>
              <div className="seg" role="group" aria-label="Choose side">
                {(['white', 'random', 'black'] as const).map((c) => (
                  <button key={c} aria-pressed={color === c} onClick={() => setColor(c)}>
                    {c === 'random' ? '?' : c === 'white' ? 'WHITE' : 'BLACK'}
                  </button>
                ))}
              </div>
            </div>
            <div className="field">
              <span className="field-label">Rules</span>
              <div className="seg seg-wrap" role="group" aria-label="Choose rules">
                {VARIANTS.map((v) => (
                  <button key={v.id} aria-pressed={variant === v.id} onClick={() => setVariant(v.id)}>
                    {v.label}
                  </button>
                ))}
              </div>
              <div className="tiny faint" style={{ marginTop: 6 }}>{VARIANTS.find((v) => v.id === variant)!.blurb}</div>
            </div>
            <button className="btn btn-primary btn-lg btn-block" onClick={start}>
              START GAME
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}


interface BotGameProps {
  bot: BotStyle;
  playerColor: Color;
  variant: ChessVariant;
  onNewGame: () => void;
  onExit: () => void;
}

function BotGame({ bot, playerColor, variant, onNewGame, onExit }: BotGameProps) {
  const { settings } = useSettings();
  const { toast } = useToast();
  const navigate = useNavigate();
  const config = useMemo(
    () => ({
      whiteName: playerColor === WHITE ? 'You' : bot.name,
      blackName: playerColor === WHITE ? bot.name : 'You',
      variant,
    }),
    [playerColor, bot.name, variant],
  );
  const controller = useGameController(config);
  const version = useControllerVersion(controller);
  const [orientation, flip] = useOrientation(playerColor === WHITE ? 'white' : 'black');
  const [thinking, setThinking] = useState(false);
  const [engineInfo, setEngineInfo] = useState<{ depth: number; nodes: number; ms: number } | null>(null);
  const [moveListOpen, setMoveListOpen] = useState(true);
  useRegisterCommands([{ id: 'board-moves', label: 'Toggle Move List', group: 'Game', hint: 'M', run: () => setMoveListOpen((value) => !value) }]);
  const [animate, setAnimate] = useState<BoardAnimate | null>(null);
  const [savedGameId, setSavedGameId] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<{ accuracy: number; performance: number } | null>(null);
  const [drawPending, setDrawPending] = useState(false);
  const [showGameOver, setShowGameOver] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const gameIdRef = useRef(uid());
  const scope = useJobScope();
  const revision = useRef(dataRevision());
  const preferences = useRef(settings); preferences.current = settings;
  const searchAbort = useRef<AbortController | null>(null);
  const drawAbort = useRef<AbortController | null>(null);
  const [engineError, setEngineError] = useState(false);
  const [analysisStatus, setAnalysisStatus] = useState<'pending' | 'ready' | 'empty' | 'unavailable'>('pending');
  const busyRef = useRef(false);

  const finished = controller.phase === 'ended';

  useEffect(() => {
    sound.play('gameStart');
  }, []);

  // Hash routing keeps the roster page's scroll position — start every game
  // at the top so the board clears the fixed nav on small screens.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  const requestBotMove = useCallback(async (ctrl: GameController) => {
    if (!scope.active || revision.current !== dataRevision() || ctrl.phase !== 'playing' || ctrl.turn === playerColor || busyRef.current) return;
    const abort = scope.request(), version = ctrl.getVersion(); searchAbort.current = abort;
    busyRef.current = true; setThinking(true); setEngineError(false); setEngineInfo(null);
    const live = () => scope.active && !abort.signal.aborted && revision.current === dataRevision() && ctrl.getVersion() === version && ctrl.phase === 'playing';
    try {
      const reply = await engineClient.search({ gameId: gameIdRef.current, startFen: ctrl.position.startFen,
        moves: ctrl.moves.map((move) => move.uci), style: bot, variant: variant === 'standard' ? undefined : variant,
        signal: abort.signal, onProgress: (progress) => { if (live()) setEngineInfo(progress); } });
      if (!live()) return;
      if (!reply.uci) throw new Error('No legal reply');
      const encoded = ctrl.position.uciToMove(reply.uci);
      if (encoded === null) throw new Error('Illegal engine reply');
      const from = encoded & 0x7f, to = (encoded >> 7) & 0x7f, captured = ctrl.position.pieceAt(to);
      const record = ctrl.applyUci(reply.uci);
      if (!record) throw new Error('Engine reply could not be applied');
      setSettingsAnimate(setAnimate, preferences.current.animateMoves, { from, to, capturedPiece: captured, capturedSquare: to, promoted: reply.uci.length === 5 });
      sound.play(moveSoundName(record)); setEngineInfo({ depth: reply.depth, nodes: reply.nodes, ms: reply.ms });
    } catch {
      if (live()) { setEngineError(true); toast('The engine could not move. Retry when ready.', 'danger'); }
    } finally {
      scope.release(abort);
      if (scope.active && searchAbort.current === abort) { setThinking(false); busyRef.current = false; }
    }
  }, [bot, playerColor, scope, toast, variant]);
  useEffect(() => {
    busyRef.current = false;
    engineClient.newGame(gameIdRef.current);
    if (controller.turn !== playerColor && controller.phase === 'playing') void requestBotMove(controller);
  }, [controller, playerColor, requestBotMove]);

  useEffect(() => {
    if (!finished || savedGameId || revision.current !== dataRevision()) return;
    sound.play(endSoundFor(controller.end, playerColor === WHITE ? 'white' : 'black'));
    const id = uid(); setSavedGameId(id);
    const cancelReveal = scope.later(() => setShowGameOver(true), 650), abort = scope.request();
    const game: StoredGame = { id, mode: 'bot', date: Date.now(), whiteName: config.whiteName, blackName: config.blackName,
      variant, botId: bot.id, botElo: bot.elo, startFen: controller.position.startFen,
      moves: controller.moves.map((move) => ({ ...move })), outcome: controller.end?.winner === 'white' ? { result: 'white' }
        : controller.end?.winner === 'black' ? { result: 'black' } : { result: 'draw', reason: (controller.end?.reason as 'stalemate' | 'agreement' | 'threefold' | 'fifty-move' | 'insufficient') ?? 'agreement' },
      durationMs: controller.durationMs };
    void gamesRepo.save(game, revision.current);
    void (async () => {
      try {
        const firstWhite = game.startFen.split(/\s+/)[1] === 'w';
        const playerPlies = game.moves.flatMap((_, index) => ((index % 2 === 0) === firstWhite) === (playerColor === WHITE) ? [index] : []);
        if (!playerPlies.length) { if (scope.active) setAnalysisStatus('empty'); return; }
        const { losses } = await engineClient.analyzeGame({ startFen: game.startFen, moves: game.moves.map((move) => move.uci), depth: 6,
          variant: variant === 'standard' ? undefined : variant, signal: abort.signal });
        if (!scope.active || abort.signal.aborted || revision.current !== dataRevision()) return;
        if (losses.length !== game.moves.length) throw new Error('Incomplete analysis');
        const average = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
        const playerLoss = average(playerPlies.map((index) => losses[index]!));
        const accuracy = accuracyFromLoss(playerLoss), performance = performanceRating(playerLoss);
        const white = losses.filter((_, index) => (index % 2 === 0) === firstWhite), black = losses.filter((_, index) => (index % 2 === 0) !== firstWhite);
        setAnalysis({ accuracy, performance }); setAnalysisStatus('ready');
        await gamesRepo.save({ ...game, analysis: { analyzedAt: Date.now(), performance,
          ...(white.length ? { whiteLossCp: average(white), whiteAccuracy: accuracyFromLoss(average(white)) } : {}),
          ...(black.length ? { blackLossCp: average(black), blackAccuracy: accuracyFromLoss(average(black)) } : {}) } }, revision.current);
      } catch { if (scope.active && !abort.signal.aborted) setAnalysisStatus('unavailable'); }
      finally { scope.release(abort); }
    })();
    return () => { cancelReveal(); abort.abort(); };
  }, [finished]);

  // --- interactions -------------------------------------------------------
  const onBoardMove = useCallback(
    (from: number, to: number, promo: 1 | 2 | 3 | 4 | 5 | 6 | null): boolean => {
      if (controller.phase !== 'playing' || controller.turn !== playerColor || thinking || drawPending || busyRef.current) return false;
      const captured = controller.position.pieceAt(to);
      const ok = controller.tryMove(from, to, promo);
      if (!ok) return false;
      setSettingsAnimate(setAnimate, settings.animateMoves, {
        from, to, capturedPiece: captured, capturedSquare: to, promoted: promo !== null,
      });
      sound.play(moveSoundName(controller.moves[controller.moves.length - 1]!));
      if (!controller.end) void requestBotMove(controller);
      return true;
    },
    [controller, playerColor, thinking, drawPending, requestBotMove, settings.animateMoves],
  );

  const undo = () => {
    if (finished || thinking || drawPending || controller.turn !== playerColor) return;
    // Undo the bot's reply + the player's move (2 plies), or fewer at start.
    const plies = controller.moves.length >= 2 ? 2 : 1;
    if (controller.undoPlies(plies)) {
      setAnimate(null);
      sound.play('uiTick');
      if (controller.turn !== playerColor) {
        void requestBotMove(controller);
      }
    }
  };

  const offerDraw = async () => {
    if (controller.phase !== 'playing' || drawPending || thinking) return;
    const abort = scope.request(), version = controller.getVersion(); drawAbort.current = abort; setDrawPending(true);
    const live = () => scope.active && !abort.signal.aborted && controller.phase === 'playing' && controller.getVersion() === version;
    try {
      const decision = await engineClient.evalDraw({ startFen: controller.position.startFen, moves: controller.moves.map((move) => move.uci),
        botId: bot.id, variant: variant === 'standard' ? undefined : variant, signal: abort.signal });
      if (!live()) return;
      if (decision.accept) { controller.drawByAgreement(); toast(`${bot.name} accepts the draw.`, 'success'); }
      else toast(`${bot.name} declines the draw.`);
    } catch { if (live()) toast('Could not evaluate the offer.', 'danger'); }
    finally { scope.release(abort); if (scope.active && drawAbort.current === abort) setDrawPending(false); }
  };

  const resign = () => {
    if (controller.phase !== 'playing') return;
    searchAbort.current?.abort(); drawAbort.current?.abort();
    controller.resign(playerColor);
  };

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
    const onNew = () => onNewGame();
    window.addEventListener('checkmate:new-game', onNew);
    return () => window.removeEventListener('checkmate:new-game', onNew);
  }, [onNewGame]);

  // Board wiring.
  const interactive = controller.phase === 'playing' && controller.turn === playerColor && !thinking && !drawPending;
  const legalFor = useCallback(
    (sq: number) => (interactive ? controller.movesFrom(sq) : []),
    [controller, interactive, version],
  );
  const selectable = useCallback(
    (sq: number) => interactive && controller.position.pieceAt(sq) !== 0 && (controller.position.pieceAt(sq) >> 3) === playerColor,
    [controller, interactive, playerColor, version],
  );

  const playerWon = controller.end?.winner === (playerColor === WHITE ? 'white' : 'black');
  const resultForStats =
    controller.end?.winner === null ? 'draw' : playerWon ? 'win' : 'loss';

  const copyPgn = async () => {
    const pgn = exportPgn(
      controller.position,
      {
        Event: 'CHECKMATE Bot Game',
        Site: 'browser',
        ...(variant !== 'standard' ? { Variant: variant === 'koth' ? 'King of the Hill' : 'Three-Check' } : {}),
        Date: new Date().toISOString().slice(0, 10).replace(/-/g, '.'),
        White: config.whiteName,
        Black: config.blackName,
        WhiteElo: playerColor === WHITE ? '?' : bot.elo.replace('+', ''),
        BlackElo: playerColor === BLACK ? '?' : bot.elo.replace('+', ''),
        Result: controller.end?.winner === 'white' ? '1-0' : controller.end?.winner === 'black' ? '0-1' : controller.end ? '1/2-1/2' : '*',
      },
      controller.end?.winner === 'white' ? '1-0' : controller.end?.winner === 'black' ? '0-1' : '1/2-1/2',
    );
    try {
      const ok = await copyText(pgn);
      toast(ok ? 'PGN copied.' : 'Could not copy PGN.', ok ? 'success' : 'danger');
    } catch {
      toast('Could not copy PGN.', 'danger');
    }
  };

  const botCard = (
    <div className="player-card panel">
      <div className="player-avatar">{bot.name.slice(0, 2)}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="player-name">{bot.name}</div>
        <div className="player-sub">
          {bot.elo}
          {variant !== 'standard' ? ` · ${variant === 'koth' ? 'KING OF THE HILL' : 'THREE-CHECK'}` : ''}
          {engineInfo && !thinking ? ` · depth ${engineInfo.depth} · ${formatNodes(engineInfo.nodes)} nodes` : ''}
        </div>
        {thinking && (
          <div className="thinking-indicator mt-8">
            <span className="thinking-dots" aria-hidden="true">
              <span /><span /><span />
            </span>
            {engineInfo ? `CALCULATING · D${engineInfo.depth} · ${formatNodes(engineInfo.nodes)}` : 'CALCULATING'}
          </div>
        )}
      </div>
      <CapturedPieces position={controller.position} color={playerColor === WHITE ? BLACK : WHITE} settings={settings} />
    </div>
  );

  const playerCard = (
    <div className="player-card panel">
      <div className="player-avatar" style={{ color: 'var(--text-1)' }}>YOU</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="player-name">You</div>
        <div className="player-sub">{playerColor === WHITE ? 'White' : 'Black'}</div>
      </div>
      <CapturedPieces position={controller.position} color={playerColor} settings={settings} />
    </div>
  );

  return (
    <div className="game-layout">
      <div className="game-left-rail stack gap-12">
        {playerColor === WHITE ? playerCard : botCard}
        <div className="panel panel-mobile">
          <div className="panel-title">
            Moves
            <span className="faint tiny mono">{Math.ceil(controller.moves.length / 2)}</span>
          </div>
          <MoveList startFen={controller.position.startFen} sans={controller.moves.map((m) => m.san)} collapsed={!moveListOpen} />
        </div>
      </div>

      <div className="game-center stack gap-12" style={{ position: 'relative' }}>
        <div className="board-wrap">
          <Board
            position={controller.position}
            version={version}
            orientation={orientation as Orientation}
            interactive={interactive}
            selectable={selectable}
            legalFor={legalFor}
            onMove={onBoardMove}
            onIllegal={() => sound.play('illegal')}
            lastMove={controller.lastMove}
            checkSquare={controller.checkSquare}
            animate={animate}
            settings={settings}
            label={`Chess game against ${bot.name}. ${controller.phase === 'ended' ? 'Game over.' : controller.turn === playerColor ? 'Your move.' : 'Bot is thinking.'}`}
          />
          <div className="board-status">
            <span className={`turn-indicator ${!finished ? 'active' : ''}`}>
              <span className={`turn-dot ${controller.turn === WHITE ? 'white' : 'black'}`} />
              {finished ? 'GAME OVER' : controller.turn === playerColor ? 'YOUR MOVE' : `${bot.name} TO MOVE`}
            </span>
            {controller.inCheck && !finished && <span className="check-flag">CHECK</span>}
            <div className="board-tools">
              <button className="tool-btn" onClick={flip} aria-label="Flip board" title="Flip (F)"><IconFlip size={15} /></button>
              <button
                className="tool-btn"
                aria-pressed={moveListOpen}
                onClick={() => setMoveListOpen((v) => !v)}
                aria-label="Toggle move list"
                title="Move list (M)"
              >
                <IconList size={15} />
              </button>
            </div>
          </div>
        </div>

        <div className="row">
          <ActionButton className="btn btn-sm" onClick={undo} blockedReason={finished ? 'Finished games cannot be undone. Start a new game to play again.' : drawPending ? 'Wait for the reply to your draw offer before undoing.' : thinking ? `${bot.name} is calculating. Wait for the move before undoing.` : controller.turn !== playerColor ? engineError ? 'Retry the engine move before using Undo.' : 'Undo is available on your turn. Wait for the opponent to move.' : controller.moves.length === 0 && 'There are no moves to undo yet. Play a move first.'}>
            <IconUndo size={14} /> UNDO
          </ActionButton>
          <ActionButton className="btn btn-sm" onClick={() => void offerDraw()} blockedReason={finished ? 'This game has already ended. Start a new game to play again.' : drawPending ? 'Your draw offer is being evaluated. Wait for the reply.' : thinking && `${bot.name} is calculating. Wait for the move before offering a draw.`}>
            <IconDraw size={14} /> {drawPending ? 'OFFERING…' : 'OFFER DRAW'}
          </ActionButton>
          <ActionButton className="btn btn-sm btn-danger" onClick={resign} blockedReason={finished && 'This game has already ended. There is no active game to resign.'}>
            <IconFlag size={14} /> RESIGN
          </ActionButton>
          <button className="btn btn-sm" onClick={onNewGame}><IconBolt size={14} /> NEW GAME</button>
          <button className="btn btn-sm btn-ghost" onClick={onExit}>EXIT</button>
          {finished && !showGameOver && <button className="btn btn-sm" onClick={() => setShowGameOver(true)}>RESULT</button>}
          {finished && <button className="btn btn-sm" onClick={() => void copyPgn()}>COPY PGN</button>}
        </div>

        {engineClient.workerFailed && <p className="small muted" role="status">Worker unavailable. The engine uses a shorter local search.</p>}
        {engineError && !finished && <div className="panel panel-pad row spread" role="alert"><span>Engine move unavailable.</span><ActionButton className="btn btn-sm" blockedReason={thinking && 'An engine move is already being calculated. Wait for it to finish.'} onClick={() => void requestBotMove(controller)}>RETRY MOVE</ActionButton></div>}
        {showGameOver && (
          <GameOver
            onClose={() => setShowGameOver(false)}
            winner={controller.end?.winner ?? null}
            outcome={resultForStats}
            reason={endReasonText(controller.end?.reason)}
            headline={
              resultForStats === 'win'
                ? `You defeated ${bot.name}.`
                : resultForStats === 'draw'
                  ? 'Neither side gave an inch.'
                  : 'The position slipped away.'
            }
            subline={
              resultForStats === 'loss' ? 'Review the game and come back sharper.' : undefined
            }
            stats={[
              { label: 'Moves', value: String(Math.ceil(controller.moves.length / 2)) },
              { label: 'Duration', value: formatMinutes(controller.durationMs) },
              ...(analysis
                ? [
                    { label: 'Accuracy', value: `${analysis.accuracy.toFixed(0)}%` },
                    { label: 'Est. performance', value: String(analysis.performance) },
                  ]
                : []),
            ]}
          >
            {analysisStatus !== 'ready' && <div className="tiny faint" role="status">{analysisStatus === 'pending' ? 'Analyzing your moves…' : analysisStatus === 'empty' ? 'No player moves to analyze.' : 'Analysis unavailable. The game is saved for replay.'}</div>}
            <button className="btn btn-primary" onClick={onNewGame}>PLAY AGAIN</button>
            {controller.moves.length > 0 && (
              <button className="btn" onClick={() => setReviewOpen(true)}>AUTO-REVIEW</button>
            )}
            {savedGameId && (
              <button className="btn" onClick={() => navigate(`/review/${savedGameId}`)}>REVIEW GAME</button>
            )}
            <button className="btn btn-ghost" onClick={onExit}>BACK TO BOTS</button>
          </GameOver>
        )}
        {reviewOpen && controller.phase === 'ended' && (
          <GameReview
            key={savedGameId ?? 'ended'}
            whiteName={config.whiteName}
            blackName={config.blackName}
            startFen={controller.position.startFen}
            moves={controller.moves.map((m) => ({ san: m.san, uci: m.uci }))}
            variant={variant}
            myColor={playerColor === WHITE ? 'white' : 'black'}
            onExit={() => setReviewOpen(false)}
          />
        )}
      </div>

      <div className="game-side stack gap-12">
        {playerColor === WHITE ? botCard : playerCard}
        <div className="panel">
          <div className="panel-title">
            Moves
            <span className="faint tiny mono">{Math.ceil(controller.moves.length / 2)}</span>
          </div>
          <MoveList startFen={controller.position.startFen} sans={controller.moves.map((m) => m.san)} collapsed={!moveListOpen} />
        </div>
        {analysis && !showGameOver && (
          <div className="panel panel-pad stack gap-8">
            <div className="field-label">Your accuracy</div>
            <div className="stat-value">{analysis.accuracy.toFixed(0)}%</div>
            <div className="bar"><div className="bar-fill" style={{ width: `${analysis.accuracy}%` }} /></div>
            <div className="tiny faint">Estimated performance {analysis.performance}</div>
          </div>
        )}
      </div>
    </div>
  );
}


function setSettingsAnimate(
  setter: React.Dispatch<React.SetStateAction<BoardAnimate | null>>,
  enabled: boolean,
  value: BoardAnimate,
): void {
  setter(enabled ? value : { ...value, from: value.to });
}

function formatMinutes(ms: number): string {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

