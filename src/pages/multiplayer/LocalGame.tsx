import { useEffect, useMemo, useState } from 'react';
import { BoardAnimate, Orientation } from '../../components/Board';
import { GameOver } from '../../components/GameOver';
import { GameReview } from '../../components/GameReview';
import { IconFlip, IconQuill } from '../../components/icons';
import { useToast } from '../../components/Toast';
import { useControllerVersion, useGameController, useOrientation } from '../../game/hooks';
import { endReasonText } from '../../game/analysis';
import { endSoundFor, moveSoundName, sound } from '../../audio/sound';
import { useSettings } from '../../storage/settings';
import { gamesRepo, StoredGame } from '../../storage/db';
import { exportPgn } from '../../chess/pgn';
import { ChessVariant, WHITE, PieceType } from '../../chess/constants';
import { uid } from '../../utils';
import { DuelChrome } from './DuelChrome';
import { fmtDur, outcomeOf, resultString } from './shared';

const VARIANTS: { id: ChessVariant; label: string }[] = [
  { id: 'standard', label: 'STANDARD' },
  { id: 'three-check', label: '3-CHECK' },
  { id: 'koth', label: 'KING OF THE HILL' },
];

export function LocalGame({ onExit }: { onExit: () => void }) {
  const { settings } = useSettings();
  const { toast } = useToast();
  const [variant, setVariant] = useState<ChessVariant>('standard');
  const controller = useGameController(
    useMemo(() => ({ whiteName: 'White', blackName: 'Black', variant }), [variant]),
  );
  const version = useControllerVersion(controller);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [autoFlip, setAutoFlip] = useState(true);
  const [orientation, flip] = useOrientation('white');
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
    void gamesRepo.save(game);
    // NOTE: `saved` is deliberately not a dependency — the re-render it causes
    // would run this cleanup and cancel the reveal timer above.
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
              <button
                key={v.id}
                aria-pressed={variant === v.id}
                disabled={controller.moves.length > 0 && controller.phase === 'playing'}
                onClick={() => setVariant(v.id)}
              >
                {v.label}
              </button>
            ))}
          </div>
          <button
            className="btn btn-sm"
            aria-pressed={autoFlip}
            title="Board turns to face whoever moves next"
            onClick={() => {
              setAutoFlip((v) => !v);
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
                  void navigator.clipboard
                    .writeText(
                      exportPgn(
                        controller.position,
                        { Event: 'CHECKMATE Pass & Play', White: 'White', Black: 'Black', Result: resultString(controller) },
                        resultString(controller),
                      ),
                    )
                    .then(() => toast('PGN copied.', 'success'))
                    .catch(() => toast('Could not copy PGN.', 'danger'))
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
          <button className="btn btn-sm btn-danger" onClick={() => controller.resign(controller.turn)} disabled={controller.phase !== 'playing'}>
            RESIGN
          </button>
          <button
            className="btn btn-sm"
            disabled={controller.phase !== 'playing'}
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
          </button>
          <button
            className="btn btn-sm"
            disabled={controller.moves.length === 0}
            onClick={() => {
              if (controller.undoPlies(1)) {
                setAnimate(null);
                sound.play('uiTick');
              }
            }}
          >
            UNDO
          </button>
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
