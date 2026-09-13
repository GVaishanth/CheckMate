/**
 * Board — the interactive chessboard.
 *
 * Features: click-to-move, pointer drag & drop (mouse + touch), keyboard
 * cursor navigation, legal-move hints, last-move / check / selection
 * highlights, move + capture animations, promotion picker, orientation flip,
 * themes, coordinates, and screen-reader announcements.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Color, FILES, Move, PAWN, PieceType, RANKS, WHITE, algebraic, colorOf, fileOf, rankOf, typeOf,
} from '../chess/constants';
import type { Position } from '../chess/position';
import { PieceSvg } from './PieceSvg';
import { sound } from '../audio/sound';
import type { Settings } from '../storage/settings';

export type Orientation = 'white' | 'black';

export interface BoardAnimate {
  from: number;
  to: number;
  capturedPiece: number; // 0 if no capture
  capturedSquare: number;
  /** Pawn just promoted — the new piece pops in after the slide. */
  promoted?: boolean;
}

export interface BoardProps {
  position: Position;
  version: number;
  orientation: Orientation;
  interactive: boolean;
  /** Can the piece on this square be picked up right now? */
  selectable: (sq: number) => boolean;
  /** Legal moves from a square (empty when not interactive). */
  legalFor: (sq: number) => Move[];
  onMove: (from: number, to: number, promo: PieceType | null) => boolean;
  onIllegal?: () => void;
  lastMove?: { from: number; to: number } | null;
  checkSquare?: number | null;
  animate?: BoardAnimate | null;
  settings: Settings;
  label?: string;
}

interface DragState {
  from: number;
  x: number;
  y: number;
  moved: boolean;
  pointerId: number;
}

const animDurationMs = 200;

export function Board(props: BoardProps) {
  const { position, version, orientation, interactive, selectable, legalFor, onMove, onIllegal, lastMove, checkSquare, animate, settings, label } = props;
  const boardRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [cursor, setCursor] = useState<number | null>(null);
  const [hoverSq, setHoverSq] = useState<number | null>(null);
  const [promo, setPromo] = useState<{ from: number; to: number } | null>(null);
  const [staged, setStaged] = useState<{ from: number; to: number; promo: PieceType | null } | null>(null);
  const [animFrom, setAnimFrom] = useState<number | null>(null);
  const [ghost, setGhost] = useState<{ square: number; piece: number } | null>(null);
  const [announce, setAnnounce] = useState('');
  const [shake, setShake] = useState<{ sq: number; n: number } | null>(null);
  const [popSq, setPopSq] = useState<number | null>(null);
  const [pulse, setPulse] = useState(0);
  const prevCheckRef = useRef<number | null>(null);

  // Reset transient state when the position changes externally.
  useEffect(() => {
    setSelected(null);
    setDrag(null);
    setPromo(null);
    setStaged(null);
    if (animate) {
      setAnimFrom(animate.from);
      if (animate.capturedPiece) setGhost({ square: animate.capturedSquare, piece: animate.capturedPiece });
      const t1 = window.setTimeout(() => setAnimFrom(null), animDurationMs);
      const t2 = window.setTimeout(() => setGhost(null), animDurationMs);
      // Promotion: once the pawn arrives, the new piece announces itself.
      const t3 = animate.promoted ? window.setTimeout(() => setPopSq(animate.to), animDurationMs - 20) : null;
      const t4 = animate.promoted ? window.setTimeout(() => setPopSq(null), animDurationMs + 400) : null;
      return () => { for (const t of [t1, t2, t3, t4]) if (t !== null) window.clearTimeout(t); };
    }
    return undefined;
  }, [version, animate]);

  // One-shot pulse each time a *new* check lands on the board.
  useEffect(() => {
    if (checkSquare != null && checkSquare !== prevCheckRef.current) setPulse((p) => p + 1);
    prevCheckRef.current = checkSquare ?? null;
  }, [checkSquare]);

  // The refusal shake clears itself.
  useEffect(() => {
    if (!shake) return undefined;
    const t = window.setTimeout(() => setShake(null), 280);
    return () => window.clearTimeout(t);
  }, [shake]);

  const flipped = orientation === 'black';

  /** Square for display coordinates: (col,row) → 0x88 index. */
  const displayToSquare = useCallback(
    (col: number, row: number): number => {
      const file = flipped ? 7 - col : col;
      const rank = flipped ? row : 7 - row;
      return (rank << 4) | file;
    },
    [flipped],
  );

  const squareToDisplay = useCallback(
    (sq: number): { col: number; row: number } => {
      const f = fileOf(sq);
      const r = rankOf(sq);
      return { col: flipped ? 7 - f : f, row: flipped ? r : 7 - r };
    },
    [flipped],
  );

  const pointerToSquare = useCallback(
    (clientX: number, clientY: number): number | null => {
      const rect = boardRef.current?.getBoundingClientRect();
      if (!rect) return null;
      const x = (clientX - rect.left) / rect.width;
      const y = (clientY - rect.top) / rect.height;
      if (x < 0 || x >= 1 || y < 0 || y >= 1) return null;
      return displayToSquare(Math.floor(x * 8), Math.floor(y * 8));
    },
    [displayToSquare],
  );

  const legalTargets = useMemo(() => {
    if (selected === null || !interactive) return new Map<number, Move>();
    const map = new Map<number, Move>();
    for (const m of legalFor(selected)) map.set(m.to, m);
    return map;
  }, [selected, interactive, legalFor, version]);

  /** Invalid action: the piece refuses — a 240ms shake, no buzz, no flash. */
  const nudge = useCallback((sq: number | null) => {
    if (sq === null) return;
    setShake((s) => ({ sq, n: (s?.n ?? 0) + 1 }));
  }, []);

  // ------------------------------------------------------------- moves

  const isPromotion = (from: number, to: number): boolean => {
    const piece = position.pieceAt(from);
    return typeOf(piece) === PAWN && (rankOf(to) === 7 || rankOf(to) === 0);
  };

  const commitMove = useCallback(
    (from: number, to: number, promo: PieceType | null) => {
      if (settings.confirmMoves && !promo) {
        setStaged({ from, to, promo: null });
        setSelected(null);
        return;
      }
      const ok = onMove(from, to, promo);
      if (!ok) {
        nudge(from);
        onIllegal?.();
      }
      setSelected(null);
    },
    [onMove, onIllegal, settings.confirmMoves, nudge],
  );

  const attemptMove = useCallback(
    (from: number, to: number) => {
      if (from === to) return false;
      const legal = legalFor(from).filter((m) => m.to === to);
      if (legal.length === 0) return false;
      if (isPromotion(from, to)) {
        if (settings.autoQueen) {
          const ok = onMove(from, to, 5 as PieceType);
          if (!ok) {
            nudge(from);
            onIllegal?.();
          }
          setSelected(null);
          return true;
        }
        setPromo({ from, to });
        return true;
      }
      commitMove(from, to, null);
      return true;
    },
    [legalFor, commitMove, onMove, onIllegal, settings.autoQueen, position],
  );

  // ------------------------------------------------------------- pointer

  /** Shared click-target logic: commit the selected piece toward `target`. */
  const targetClick = (target: number): boolean => {
    if (selected !== null && target !== selected) {
      if (attemptMove(selected, target)) return true;
      if (selectable(target)) {
        setSelected(target);
        return true;
      }
      // Not a legal destination — the piece stays selected and refuses.
      nudge(selected);
      onIllegal?.();
      return true;
    }
    if (selected === null && selectable(target)) {
      setSelected(target);
      return true;
    }
    return false;
  };

  const onPiecePointerDown = (e: React.PointerEvent, sq: number) => {
    if (!interactive) return;
    soundUnlock();
    if (e.button !== undefined && e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation(); // board-level handler must not treat this as a target click
    if (!selectable(sq)) {
      // Clicking an enemy piece with one of ours selected = capture attempt.
      targetClick(sq);
      return;
    }
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setSelected((prev) => (prev === sq ? null : sq));
    setDrag({ from: sq, x: e.clientX, y: e.clientY, moved: false, pointerId: e.pointerId });
  };

  /** Click-to-move: pointer down on an empty square commits the selected piece's move. */
  const onBoardPointerDown = (e: React.PointerEvent) => {
    if (!interactive || (e.target as HTMLElement).closest('.piece')) return;
    if (e.button !== undefined && e.button !== 0) return;
    const target = pointerToSquare(e.clientX, e.clientY);
    if (target === null) return;
    soundUnlock();
    targetClick(target);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag) return;
    setDrag({ ...drag, x: e.clientX, y: e.clientY, moved: true });
    setHoverSq(pointerToSquare(e.clientX, e.clientY));
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (!drag) return;
    const target = pointerToSquare(e.clientX, e.clientY);
    const wasDrag = drag.moved && Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) > 0;
    const from = drag.from;
    setDrag(null);
    setHoverSq(null);
    if (!interactive) return;
    if (target !== null && target !== from) {
      if (!attemptMove(from, target)) {
        // Click on another own piece while something is selected reselects.
        if (selectable(target)) setSelected(target);
        else {
          nudge(from);
          onIllegal?.();
        }
      }
    } else if (wasDrag && target === from) {
      // Dragged and dropped back — keep selection for click-move.
    }
  };

  // ------------------------------------------------------------- keyboard

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!interactive && cursor === null) return;
    const cur = cursor ?? displayToSquare(4, 4);
    const { col, row } = squareToDisplay(cur);
    let nextCol = col;
    let nextRow = row;
    switch (e.key) {
      case 'ArrowLeft': nextCol = Math.max(0, col - 1); break;
      case 'ArrowRight': nextCol = Math.min(7, col + 1); break;
      case 'ArrowUp': nextRow = Math.max(0, row - 1); break;
      case 'ArrowDown': nextRow = Math.min(7, row + 1); break;
      case 'Enter':
      case ' ': {
        e.preventDefault();
        if (selected !== null && cursor !== null && cursor !== selected) {
          if (!attemptMove(selected, cursor) && selectable(cursor)) setSelected(cursor);
        } else if (selectable(cur)) {
          setSelected(cur);
          setCursor(cur);
        } else if (selected === cur) {
          setSelected(null);
        }
        return;
      }
      case 'Escape':
        setSelected(null);
        setPromo(null);
        setStaged(null);
        return;
      default:
        return;
    }
    e.preventDefault();
    const next = displayToSquare(nextCol, nextRow);
    setCursor(next);
    setAnnounce(squareName(next));
  };

  // ------------------------------------------------------------- render

  const squares = useMemo(() => {
    const out: Array<{ sq: number; light: boolean; col: number; row: number }> = [];
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const sq = displayToSquare(col, row);
        out.push({ sq, light: (fileOf(sq) + rankOf(sq)) % 2 === 1, col, row });
      }
    }
    return out;
  }, [displayToSquare]);

  const pieces = useMemo(() => {
    const out: Array<{ sq: number; piece: number }> = [];
    for (let sq = 0; sq < 128; sq++) {
      if (sq & 0x88) { sq += 7; continue; }
      const p = position.pieceAt(sq);
      if (p) out.push({ sq, piece: p });
    }
    return out;
  }, [position, version]);

  const dragRect = boardRef.current?.getBoundingClientRect();

  const pieceStyle = (sq: number, isDragging: boolean, animStartFrom: number | null): React.CSSProperties => {
    if (isDragging && dragRect) {
      const size = dragRect.width / 8;
      return {
        transform: `translate(${drag!.x - dragRect.left - size / 2}px, ${drag!.y - dragRect.top - size / 2}px) scale(1.12)`,
        zIndex: 30,
      };
    }
    const src = animStartFrom ?? sq;
    const { col, row } = squareToDisplay(src);
    return { transform: `translate(${col * 100}%, ${row * 100}%)` };
  };

  return (
    <div className="board-frame">
      <div
        ref={boardRef}
        className={`board${interactive ? ' interactive' : ''}`}
        role="grid"
        tabIndex={0}
        aria-label={label ?? 'Chess board'}
        onKeyDown={onKeyDown}
        onPointerDown={onBoardPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {squares.map(({ sq, light, col, row }) => {
          const isLast = lastMove && (lastMove.from === sq || lastMove.to === sq);
          const isSel = selected === sq || staged?.from === sq || staged?.to === sq;
          const isCheck = checkSquare === sq;
          const hint = legalTargets.get(sq);
          const hintClass = hint ? (position.pieceAt(sq) !== 0 || hint.flag === 1 ? 'hint hint-capture' : 'hint') : '';
          return (
            <div
              key={sq}
              data-sq={algebraic(sq)}
              className={[
                'sq',
                light ? 'light' : 'dark',
                isLast ? 'last' : '',
                isSel ? 'sel' : '',
                isCheck ? 'check' : '',
                hintClass,
                hoverSq === sq && drag ? 'hover-drop' : '',
                cursor === sq ? 'cursor' : '',
              ].filter(Boolean).join(' ')}
            >
              {settings.showCoordinates && row === 7 && (
                <span className="coord coord-file">{FILES[flipped ? 7 - col : col]}</span>
              )}
              {settings.showCoordinates && col === 0 && (
                <span className="coord coord-rank">{RANKS[flipped ? 7 - row : row]}</span>
              )}
              {isCheck && <span className="check-pulse" key={pulse} aria-hidden="true" />}
              <div className="sq-overlay" />
            </div>
          );
        })}

        <div className="piece-layer">
          {ghost && (
            <div
              className="piece fading"
              style={pieceStyle(ghost.square, false, null)}
              key={`ghost-${ghost.square}-${ghost.piece}`}
            >
              <PieceView piece={ghost.piece} style={settings.pieceStyle} />
            </div>
          )}
          {pieces.map(({ sq, piece }) => {
            const isDragging = drag?.from === sq && drag.moved;
            const animStart = animFrom !== null && animate && animate.to === sq ? animFrom : null;
            const shaking = shake !== null && shake.sq === sq;
            return (
              <div
                key={`${sq}-${piece}${shaking ? `-s${shake.n}` : ''}`}
                className={`piece${isDragging ? ' dragging' : ''}${selectable(sq) ? '' : ' idle'}${shaking ? ' shake' : ''}${popSq === sq ? ' pop' : ''}`}
                style={pieceStyle(sq, isDragging, animStart)}
                onPointerDown={(e) => onPiecePointerDown(e, sq)}
                role="button"
                aria-label={pieceLabel(piece, sq)}
                aria-disabled={!interactive || !selectable(sq)}
                tabIndex={-1}
              >
                <PieceView piece={piece} style={settings.pieceStyle} />
              </div>
            );
          })}
        </div>

        {promo && (
          <PromotionPicker
            color={colorOf(position.pieceAt(promo.from))}
            style={settings.pieceStyle}
            onPick={(t) => {
              const { from, to } = promo;
              setPromo(null);
              const ok = onMove(from, to, t);
              if (!ok) onIllegal?.();
              setSelected(null);
            }}
            onCancel={() => setPromo(null)}
          />
        )}

        {staged && (
          <div className="confirm-bar" role="dialog" aria-label="Confirm move">
            <span className="confirm-text">
              {squareName(staged.from)} → {squareName(staged.to)}
            </span>
            <button
              className="btn btn-primary btn-sm"
              onClick={() => {
                const s = staged;
                setStaged(null);
                if (!onMove(s.from, s.to, null)) onIllegal?.();
              }}
              autoFocus
            >
              Accept
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => setStaged(null)}>
              Cancel
            </button>
          </div>
        )}
      </div>
      <div className="sr-only" role="status" aria-live="polite">
        {announce}
      </div>
    </div>
  );
}

function PieceView({ piece, style }: { piece: number; style: Settings['pieceStyle'] }) {
  if (style === 'glyph') {
    const glyph = { 1: '♟', 2: '♞', 3: '♝', 4: '♜', 5: '♛', 6: '♚' }[piece & 7]!;
    return <span className={`piece-glyph ${colorOf(piece) === WHITE ? 'w' : 'b'}`}>{glyph}</span>;
  }
  return <PieceSvg type={typeOf(piece) as PieceType} color={colorOf(piece) as Color} />;
}

function PromotionPicker({
  color,
  style,
  onPick,
  onCancel,
}: {
  color: Color;
  style: Settings['pieceStyle'];
  onPick: (t: PieceType) => void;
  onCancel: () => void;
}) {
  const options: PieceType[] = [5 as PieceType, 2 as PieceType, 4 as PieceType, 3 as PieceType];
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector('button')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);
  return (
    <div className="promo-overlay">
      <div className="promo-panel" role="dialog" aria-label="Choose promotion piece" ref={ref}>
        <div className="promo-label">Promote to</div>
        <div className="promo-row">
          {options.map((t) => (
            <button key={t} className="promo-piece" onClick={() => onPick(t)} aria-label={`Promote to ${['', 'pawn', 'knight', 'bishop', 'rook', 'queen', 'king'][t]}`}>
              {style === 'glyph' ? (
                <span className={`piece-glyph ${color === WHITE ? 'w' : 'b'}`} style={{ fontSize: 30 }}>
                  { ({ 2: '♞', 3: '♝', 4: '♜', 5: '♛' } as Record<number, string>)[t]! }
                </span>
              ) : (
                <PieceSvg type={t} color={color} />
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

const squareName = (sq: number): string => FILES[fileOf(sq)] + RANKS[rankOf(sq)];

const pieceLabel = (piece: number, sq: number): string => {
  const names = ['', 'pawn', 'knight', 'bishop', 'rook', 'queen', 'king'];
  return `${colorOf(piece) === WHITE ? 'white' : 'black'} ${names[piece & 7]} on ${squareName(sq)}`;
};

// Audio unlock must happen inside a user gesture — the first board
// interaction is a safe place.
let unlocked = false;
function soundUnlock(): void {
  if (unlocked) return;
  unlocked = true;
  sound.unlock();
}
