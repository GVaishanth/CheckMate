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
import { useGameController, useControllerVersion, useOrientation, useHotkeys } from '../game/hooks';
import { useRegisterCommands } from '../game/commands';
import type { GameController } from '../game/GameController';
import { accuracyFromLoss, endReasonText, performanceRating } from '../game/analysis';
import { BLACK, ChessVariant, Color, WHITE } from '../chess/constants';
import { endSoundFor, moveSoundName, sound } from '../audio/sound';
import { useSettings } from '../storage/settings';
import { gamesRepo, StoredGame } from '../storage/db';
import { exportPgn } from '../chess/pgn';
import { formatNodes, uid } from '../utils';
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
          : [
              {
                id: 'bot-new-game',
                label: 'New Game',
                group: 'Game',
                run: () => setStage({ kind: 'select' }),
              },
            ],
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

// ---------------------------------------------------------------- select

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
    sound.play('gameStart');
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
        <div className="roster" role="list" aria-label="Bot opponents">
          {BOTS.map((bot) => (
            <button
              key={bot.id}
              className="roster-row"
              role="listitem"
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

// ---------------------------------------------------------------- game

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
  const [animate, setAnimate] = useState<BoardAnimate | null>(null);
  const [savedGameId, setSavedGameId] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<{ accuracy: number; performance: number } | null>(null);
  const [drawPending, setDrawPending] = useState(false);
  const [showGameOver, setShowGameOver] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const gameIdRef = useRef(uid());
  const startedRef = useRef(false);
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

  // --- bot turn driver ---------------------------------------------------
  const requestBotMove = useCallback(
    async (ctrl: GameController) => {
      if (ctrl.phase !== 'playing' || busyRef.current) return;
      busyRef.current = true;
      setThinking(true);
      setEngineInfo(null);
      try {
        const reply = await engineClient.search({
          gameId: gameIdRef.current,
          startFen: ctrl.position.startFen,
          moves: ctrl.moves.map((m) => m.uci),
          style: bot,
          variant: variant === 'standard' ? undefined : variant,
          onProgress: (p) => setEngineInfo({ depth: p.depth, nodes: p.nodes, ms: p.ms }),
        });
        if (reply.uci === null || ctrl.phase !== 'playing') {
          setThinking(false);
          busyRef.current = false;
          return;
        }
        // Animation info + apply.
        const enc = ctrl.position.uciToMove(reply.uci!);
        if (enc !== null) {
          const from = enc & 0x7f;
          const to = (enc >> 7) & 0x7f;
          const captured = ctrl.position.pieceAt(to);
          setSettingsAnimate(
            setAnimate,
            settings.animateMoves,
            { from, to, capturedPiece: captured, capturedSquare: to, promoted: reply.uci!.length === 5 },
          );
        }
        const record = ctrl.applyUci(reply.uci!);
        if (record) {
          sound.play(moveSoundName(record));
          setEngineInfo({ depth: reply.depth, nodes: reply.nodes, ms: reply.ms });
        }
      } catch {
        toast('The engine hiccuped — try again.', 'danger');
      } finally {
        setThinking(false);
        busyRef.current = false;
      }
    },
    [bot, settings.animateMoves, toast],
  );

  // Start bot move on mount / when it's bot's turn and game not finished.
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    engineClient.newGame(gameIdRef.current);
    if (controller.turn !== playerColor && controller.phase === 'playing') {
      void requestBotMove(controller);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Announce game end + save + analyze.
  useEffect(() => {
    if (!finished || savedGameId) return;
    sound.play(endSoundFor(controller.end, playerColor === WHITE ? 'white' : 'black'));
    const id = uid();
    setSavedGameId(id);
    const timer = window.setTimeout(() => setShowGameOver(true), 650);

    const game: StoredGame = {
      id,
      mode: 'bot',
      date: Date.now(),
      whiteName: config.whiteName,
      blackName: config.blackName,
      variant,
      botId: bot.id,
      botElo: bot.elo,
      startFen: controller.position.startFen,
      moves: controller.moves,
      outcome:
        controller.end?.winner === 'white'
          ? { result: 'white' }
          : controller.end?.winner === 'black'
            ? { result: 'black' }
            : { result: 'draw', reason: (controller.end?.reason as 'stalemate' | 'agreement' | 'threefold' | 'fifty-move' | 'insufficient') ?? 'agreement' },
      durationMs: controller.durationMs,
    };
    void gamesRepo.save(game);

    // Post-game accuracy analysis (player moves only).
    void (async () => {
      try {
        const playerPlies: number[] = [];
        controller.moves.forEach((_, i) => {
          const moverIsWhite = i % 2 === 0;
          if ((playerColor === WHITE) === moverIsWhite) playerPlies.push(i);
        });
        if (playerPlies.length === 0) return;
        const { losses } = await engineClient.analyzeGame(
          {
            startFen: controller.position.startFen,
            moves: controller.moves.map((m) => m.uci),
            depth: 6,
            variant: variant === 'standard' ? undefined : variant,
          },
          undefined,
        );
        const playerLosses = playerPlies.map((i) => losses[i] ?? 0);
        const avgLoss = playerLosses.reduce((a, b) => a + b, 0) / playerLosses.length;
        const accuracy = accuracyFromLoss(avgLoss);
        const performance = performanceRating(avgLoss);
        setAnalysis({ accuracy, performance });
        void gamesRepo.save({ ...game, analysis: {
          whiteLossCp: playerColor === WHITE ? avgLoss : 0,
          blackLossCp: playerColor === BLACK ? avgLoss : 0,
          whiteAccuracy: playerColor === WHITE ? accuracy : 100,
          blackAccuracy: playerColor === BLACK ? accuracy : 100,
          performance,
          analyzedAt: Date.now(),
        } });
      } catch {
        /* analysis is best-effort */
      }
    })();

    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finished]);

  // --- interactions -------------------------------------------------------
  const onBoardMove = useCallback(
    (from: number, to: number, promo: 1 | 2 | 3 | 4 | 5 | 6 | null): boolean => {
      if (controller.phase !== 'playing' || controller.turn !== playerColor || thinking) return false;
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
    [controller, playerColor, thinking, requestBotMove, settings.animateMoves],
  );

  const undo = () => {
    if (thinking || controller.phase === 'playing' && controller.turn !== playerColor) return;
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
    setDrawPending(true);
    try {
      const decision = await engineClient.evalDraw({
        startFen: controller.position.startFen,
        moves: controller.moves.map((m) => m.uci),
        botId: bot.id,
        variant: variant === 'standard' ? undefined : variant,
      });
      if (decision.accept) {
        controller.drawByAgreement();
        toast(`${bot.name} accepts the draw.`, 'success');
      } else {
        toast(`${bot.name} declines — the machine smells blood.`, 'default');
      }
    } catch {
      toast('Could not evaluate the offer.', 'danger');
    } finally {
      setDrawPending(false);
    }
  };

  const resign = () => {
    if (controller.phase !== 'playing') return;
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
  const interactive = controller.phase === 'playing' && controller.turn === playerColor && !thinking;
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
      await navigator.clipboard.writeText(pgn);
      toast('PGN copied to clipboard.', 'success');
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
          <MoveList sans={controller.moves.map((m) => m.san)} collapsed={!moveListOpen} />
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
          <button className="btn btn-sm" onClick={undo} disabled={controller.moves.length === 0 || thinking || (!finished && controller.turn !== playerColor)}>
            <IconUndo size={14} /> UNDO
          </button>
          <button className="btn btn-sm" onClick={() => void offerDraw()} disabled={finished || thinking || drawPending}>
            <IconDraw size={14} /> {drawPending ? 'OFFERING…' : 'OFFER DRAW'}
          </button>
          <button className="btn btn-sm btn-danger" onClick={resign} disabled={finished}>
            <IconFlag size={14} /> RESIGN
          </button>
          <button className="btn btn-sm" onClick={onNewGame}><IconBolt size={14} /> NEW GAME</button>
          <button className="btn btn-sm btn-ghost" onClick={onExit}>EXIT</button>
          {finished && <button className="btn btn-sm" onClick={() => void copyPgn()}>COPY PGN</button>}
        </div>

        {showGameOver && (
          <GameOver
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
            {analysis ? null : <div className="tiny faint">Analyzing your moves…</div>}
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
          <MoveList sans={controller.moves.map((m) => m.san)} collapsed={!moveListOpen} />
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

// ---------------------------------------------------------------- helpers

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

