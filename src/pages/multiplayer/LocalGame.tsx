import { ActionButton } from '../../components/ActionButton';
import { useEffect, useMemo, useState, useRef } from 'react';
import { BoardAnimate, Orientation } from '../../components/Board';
import { GameOver } from '../../components/GameOver';
import { GameReview } from '../../components/GameReview';
import { IconFlip, IconQuill } from '../../components/icons';
import { useToast } from '../../components/Toast';
import { useControllerVersion, useGameController, useOrientation } from '../../game/hooks';
import { endReasonText } from '../../game/analysis';
import { endSoundFor, moveSoundName, sound } from '../../audio/sound';
import { useSettings } from '../../storage/settings';
import { gamesRepo, StoredGame, dataRevision } from '../../storage/db';
import { exportPgn } from '../../chess/pgn';
import { ChessVariant, WHITE, PieceType } from '../../chess/constants';
import { uid, copyText } from '../../utils';
import { DuelChrome } from './DuelChrome';
import { fmtDur, outcomeOf, resultString } from './shared';

const VARIANTS: { id: ChessVariant; label: string }[] = [
  { id: 'standard', label: 'STANDARD' },
  { id: 'three-check', label: '3-CHECK' },
  { id: 'koth', label: 'KING OF THE HILL' },
];

export function LocalGame({ onExit }: { onExit: () => void }) {
  const { settings, update } = useSettings();
  const revision = useRef(dataRevision());
  const { toast } = useToast();
  const [variant, setVariant] = useState<ChessVariant>('standard');
  const controller = useGameController(
    useMemo(() => ({ whiteName: 'White', blackName: 'Black', variant }), [variant]),
  );
  const version = useControllerVersion(controller);
  const [reviewOpen, setReviewOpen] = useState(false);
  const autoFlip = settings.autoFlipLocal;
  const [orientation, flip] = useOrientation(settings.defaultOrientation);
  const [animate, setAnimate] = useState<BoardAnimate | null>(null);
  const [saved, setSaved] = useState(false);
  const [gameOverOpen, setGameOverOpen] = useState(false);
  const [drawArmed, setDrawArmed] = useState(false);

  useEffect(() => {
    setSaved(false);
    setGameOverOpen(false);
    setAnimate(null);
    setDrawArmed(false);
  }, [controller]);

  useEffect(() => {
    if (controller.phase !== 'ended' || saved) return;
    setSaved(true);
    sound.play(endSoundFor(controller.end));
    // Let the final position land before the result panel covers it.
    const revealDelay = controller.end?.reason === 'checkmate' ? 620 : 260;
    const t = window.setTimeout(() => setGameOverOpen(true), revealDelay);
    const game: StoredGame = {
      id: uid(),
      mode: 'local',
      date: Date.now(),
      whiteName: 'White',
      blackName: 'Black',
      variant,
      startFen: controller.position.startFen,
      moves: controller.moves,
      outcome: outcomeOf(controller),
      durationMs: controller.durationMs,
    };
    void gamesRepo.save(game, revision.current);
    // NOTE: `saved` is deliberately not a dependency — the re-render it causes
    // would run this cleanup and cancel the reveal timer above.
    return () => window.clearTimeout(t);
  }, [controller.phase, controller]);

  const onMove = (from: number, to: number, promo: PieceType | null): boolean => {
    if (controller.phase !== 'playing') return false;
    const captured = controller.position.pieceAt(to);
    const ok = controller.tryMove(from, to, promo);
    if (!ok) return false;
    setAnimate(
      settings.animateMoves
        ? { from, to, capturedPiece: captured, capturedSquare: to, promoted: promo !== null }
        : { from: to, to, capturedPiece: 0, capturedSquare: -1 },
    );
    sound.play(moveSoundName(controller.moves[controller.moves.length - 1]!));
    return true;
  };

  const shownOrientation: Orientation =
    autoFlip && controller.phase === 'playing' ? (controller.turn === WHITE ? 'white' : 'black') : orientation;

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Same device</div>
          <h1 className="page-title">Pass &amp; Play</h1>
          <p className="page-sub">
            Two players, one board. {autoFlip ? 'The board turns to face whoever moves next.' : 'Fixed orientation.'}
          </p>
        </div>
        <div className="row wrap">
          <div className="seg seg-wrap" role="group" aria-label="Choose rules">
            {VARIANTS.map((v) => (
              <ActionButton
                key={v.id}
                aria-pressed={variant === v.id}
                blockedReason={controller.moves.length > 0 && controller.phase === 'playing' && 'Rules cannot change during a game. Finish this game before choosing different rules.'}
                onClick={() => setVariant(v.id)}
              >
                {v.label}
              </ActionButton>
            ))}
          </div>
          <button
            className="btn btn-sm"
            aria-pressed={autoFlip}
            title="Board turns to face whoever moves next"
            onClick={() => {
              update({ autoFlipLocal: !autoFlip });
              sound.play('uiTick');
            }}
          >
            <IconFlip size={14} /> {autoFlip ? 'AUTO-FLIP' : 'FIXED BOARD'}
          </button>
          <button className="btn btn-sm btn-ghost" onClick={onExit}>EXIT</button>
        </div>
      </div>
      <DuelChrome
        controller={controller}
        version={version}
        orientation={shownOrientation}
        animate={animate}
        interactive={controller.phase === 'playing'}
        onMove={onMove}
        onFlip={flip}
        onIllegal={() => sound.play('illegal')}
        gameOver={
          gameOverOpen ? (
            <GameOver
              onClose={() => setGameOverOpen(false)}
              winner={controller.end?.winner ?? null}
              outcome="side"
              reason={endReasonText(controller.end?.reason)}
              headline={
                controller.end?.winner === null
                  ? 'A balanced duel.'
                  : `${controller.end?.winner === 'white' ? 'White' : 'Black'} takes the game.`
              }
              stats={[
                { label: 'Moves', value: String(Math.ceil(controller.moves.length / 2)) },
                { label: 'Duration', value: fmtDur(controller.durationMs) },
              ]}
            >
              {controller.moves.length > 0 && (
                <button className="btn" onClick={() => setReviewOpen(true)}>
                  <IconQuill size={14} /> AUTO-REVIEW
                </button>
              )}
              <button
                className="btn btn-primary"
                onClick={() => {
                  setGameOverOpen(false);
                  controller.reset();
                  setSaved(false);
                  setAnimate(null);
                  setDrawArmed(false);
                  sound.play('gameStart');
                }}
              >
                NEW GAME
              </button>
              <button
                className="btn"
                onClick={() =>
                  void copyText(
                      exportPgn(
                        controller.position,
                        { Event: 'CHECKMATE Pass & Play', White: 'White', Black: 'Black', Result: resultString(controller) },
                        resultString(controller),
                      ),
                    )
                    .then((ok) => toast(ok ? 'PGN copied.' : 'Could not copy PGN.', ok ? 'success' : 'danger'))
                }
              >
                COPY PGN
              </button>
              <button className="btn btn-ghost" onClick={onExit}>EXIT</button>
            </GameOver>
          ) : null
        }
      >
        <div className="row wrap">
          {controller.phase === 'ended' && !gameOverOpen && <button className="btn btn-sm" onClick={() => setGameOverOpen(true)}>RESULT</button>}
          <ActionButton className="btn btn-sm btn-danger" onClick={() => controller.resign(controller.turn)} blockedReason={controller.phase !== 'playing' && 'This game has already ended. Open RESULT to start a new game.'}>
            RESIGN
          </ActionButton>
          <ActionButton
            className="btn btn-sm"
            blockedReason={controller.phase !== 'playing' && 'This game has already ended. Open RESULT to start a new game.'}
            onClick={() => {
              if (drawArmed) {
                controller.drawByAgreement();
                setDrawArmed(false);
              } else {
                setDrawArmed(true);
                toast('Press CONFIRM DRAW to agree.', 'default');
              }
            }}
          >
            {drawArmed ? 'CONFIRM DRAW' : 'OFFER DRAW'}
          </ActionButton>
          <ActionButton
            className="btn btn-sm"
            blockedReason={controller.phase !== 'playing' ? 'Finished games cannot be undone. Open RESULT to start a new game.' : controller.moves.length === 0 && 'There are no moves to undo yet. Play a move first.'}
            onClick={() => {
              if (controller.phase === 'playing' && controller.undoPlies(1)) {
                setAnimate(null);
                sound.play('uiTick');
              }
            }}
          >
            UNDO
          </ActionButton>
        </div>
      </DuelChrome>
      {reviewOpen && controller.phase === 'ended' && (
        <GameReview
          whiteName="White"
          blackName="Black"
          startFen={controller.position.startFen}
          moves={controller.moves.map((m) => ({ san: m.san, uci: m.uci }))}
          variant={variant}
          onExit={() => setReviewOpen(false)}
        />
      )}
    </>
  );
}
