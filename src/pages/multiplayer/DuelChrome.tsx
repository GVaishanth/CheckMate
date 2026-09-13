/** Board, player cards and move list shared by both multiplayer modes. */
import { type ReactNode, useCallback, useMemo, useState } from 'react';
import { Board, BoardAnimate, Orientation } from '../../components/Board';
import { CapturedPieces } from '../../components/CapturedPieces';
import { MoveList } from '../../components/MoveList';
import { GameController } from '../../game/GameController';
import { useHotkeys } from '../../game/hooks';
import { BLACK, PieceType, WHITE } from '../../chess/constants';
import { useSettings } from '../../storage/settings';
import { PeerState } from '../../multiplayer/peer';
import { IconFlip, IconList } from '../../components/icons';

interface DuelChromeProps {
  controller: GameController;
  version: number;
  orientation: Orientation;
  animate: BoardAnimate | null;
  interactive: boolean;
  onMove: (from: number, to: number, promo: PieceType | null) => boolean;
  onFlip: () => void;
  onIllegal: () => void;
  banner?: ReactNode;
  gameOver?: ReactNode;
  children?: ReactNode;
}

/** Board + cards + move list shared by both multiplayer modes. */
export function DuelChrome(p: DuelChromeProps) {
  const { settings } = useSettings();
  const [moveListOpen, setMoveListOpen] = useState(true);
  const { controller, version } = p;

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

  const legalFor = useCallback(
    (sq: number) => (p.interactive ? controller.movesFrom(sq) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [controller, p.interactive, version],
  );
  const selectable = useCallback(
    (sq: number) => {
      if (!p.interactive) return false;
      const piece = controller.position.pieceAt(sq);
      return piece !== 0 && (piece >> 3) === (controller.turn === WHITE ? 0 : 1);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [controller, p.interactive, version],
  );

  const card = (name: string, color: 'white' | 'black') => (
    <div className="player-card panel">
      <div className="player-avatar">{name.slice(0, 2).toUpperCase()}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="player-name">{name}</div>
        <div className="player-sub">{color === 'white' ? 'White' : 'Black'}</div>
      </div>
      <CapturedPieces position={controller.position} color={color === 'white' ? WHITE : BLACK} settings={settings} />
    </div>
  );

  const ended = controller.phase === 'ended';

  return (
    <div className="game-layout">
      <div className="game-left-rail stack gap-12">
        {p.orientation === 'white' ? card(controller.config.blackName, 'black') : card(controller.config.whiteName, 'white')}
        <div className="panel panel-mobile">
          <div className="panel-title">Moves</div>
          <MoveList sans={controller.moves.map((m) => m.san)} collapsed={!moveListOpen} />
        </div>
      </div>

      <div className="game-center stack gap-12" style={{ position: 'relative' }}>
        <div className="board-wrap">
          <Board
            position={controller.position}
            version={version}
            orientation={p.orientation}
            interactive={p.interactive}
            selectable={selectable}
            legalFor={legalFor}
            onMove={p.onMove}
            onIllegal={p.onIllegal}
            lastMove={controller.lastMove}
            checkSquare={controller.checkSquare}
            animate={p.animate}
            settings={settings}
            label={`Multiplayer game. ${ended ? 'Game over.' : `${controller.turn === WHITE ? controller.config.whiteName : controller.config.blackName} to move.`}`}
          />
          <div className="board-status">
            <span className={`turn-indicator ${!ended ? 'active' : ''}`}>
              <span className={`turn-dot ${controller.turn === WHITE ? 'white' : 'black'}`} />
              {ended
                ? 'GAME OVER'
                : `${(controller.turn === WHITE ? controller.config.whiteName : controller.config.blackName).toUpperCase()} TO MOVE`}
            </span>
            {controller.inCheck && !ended && <span className="check-flag">CHECK</span>}
            <div className="board-tools">
              <button className="tool-btn" onClick={p.onFlip} aria-label="Flip board" title="Flip (F)"><IconFlip size={15} /></button>
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
        {p.children}
        {p.banner}
        {p.gameOver}
      </div>

      <div className="game-side stack gap-12">
        {p.orientation === 'white' ? card(controller.config.whiteName, 'white') : card(controller.config.blackName, 'black')}
        <div className="panel">
          <div className="panel-title">Moves</div>
          <MoveList sans={controller.moves.map((m) => m.san)} collapsed={!moveListOpen} />
        </div>
      </div>
    </div>
  );
}

export function ConnChip({ state }: { state: PeerState }) {
  const map: Partial<Record<PeerState, [string, string]>> = {
    connected: ['CONNECTED', 'chip chip-success'],
    connecting: ['CONNECTING…', 'chip'],
    'offer-ready': ['WAITING FOR REPLY', 'chip'],
    'answer-ready': ['WAITING FOR HOST', 'chip'],
    failed: ['CONNECTION FAILED', 'chip chip-danger'],
    disconnected: ['DISCONNECTED', 'chip chip-danger'],
  };
  const [label, cls] = map[state] ?? [state.toUpperCase(), 'chip'];
  return <span className={cls}>{label}</span>;
}
