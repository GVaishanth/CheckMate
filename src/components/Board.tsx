import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Color, FILES, Move, PAWN, PieceType, RANKS, WHITE, algebraic, colorOf, fileOf, rankOf, typeOf,
} from '../chess/constants';
import type { Position } from '../chess/position';
import { PieceSvg, glyphFor } from './PieceSvg';
import { sound } from '../audio/sound';
import { effectiveReducedMotion } from '../storage/settings';
import type { Settings } from '../storage/settings';
import { ToastHost } from './Toast';
import { useDialogFocus } from './useDialogFocus';

export type Orientation = 'white' | 'black';
export interface BoardAnimate {
  from: number;
  to: number;
  capturedPiece: number;
  capturedSquare: number;
  promoted?: boolean;
}
export interface BoardProps {
  position: Position;
  version: number;
  orientation: Orientation;
  interactive: boolean;
  selectable: (sq: number) => boolean;
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
  from: number; x: number; y: number; startX: number; startY: number; moved: boolean; pointerId: number;
}
interface PendingMove { from: number; to: number; fen: string; promo: PieceType | null }
const pieceNames = ['', 'pawn', 'knight', 'bishop', 'rook', 'queen', 'king'];
const pieceLabel = (piece: number, sq: number): string => piece
  ? `${colorOf(piece) === WHITE ? 'white' : 'black'} ${pieceNames[piece & 7]} on ${algebraic(sq)}`
  : `${algebraic(sq)}, empty`;

export function Board({ position, version, orientation, interactive, selectable, legalFor, onMove, onIllegal, lastMove, checkSquare, animate, settings, label }: BoardProps) {
  const id = useId();
  const boardRef = useRef<HTMLDivElement>(null);
  const pointer = useRef<{ element: Element; id: number } | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const previousPieces = useRef(new Map<number, number>());
  const [selected, setSelected] = useState<number | null>(null);
  const [drag, renderDrag] = useState<DragState | null>(null);
  const setDrag = (value: DragState | null) => { dragRef.current = value; renderDrag(value); };
  const [cursor, setCursor] = useState<number | null>(null);
  const [hoverSq, setHoverSq] = useState<number | null>(null);
  const [promo, setPromo] = useState<PendingMove | null>(null);
  const [staged, setStaged] = useState<PendingMove | null>(null);
  const [animFrom, setAnimFrom] = useState<number | null>(null);
  const [ghost, setGhost] = useState<{ square: number; piece: number } | null>(null);
  const [announce, setAnnounce] = useState('');
  const [shake, setShake] = useState<{ sq: number; n: number } | null>(null);
  const [popSq, setPopSq] = useState<number | null>(null);
  const [pulse, setPulse] = useState(0);
  const prevCheck = useRef<number | null>(null);
  const flipped = orientation === 'black';
  const reducedMotion = effectiveReducedMotion(settings);
  const releasePointer = () => {
    if (pointer.current) {
      try { pointer.current.element.releasePointerCapture(pointer.current.id); } catch { /* capture already ended */ }
      pointer.current = null;
    }
  };
  const cancelDrag = () => { releasePointer(); setDrag(null); setHoverSq(null); };
  const displayToSquare = useCallback((col: number, row: number) => ((flipped ? row : 7 - row) << 4) | (flipped ? 7 - col : col), [flipped]);
  const squareToDisplay = (sq: number) => ({ col: flipped ? 7 - fileOf(sq) : fileOf(sq), row: flipped ? rankOf(sq) : 7 - rankOf(sq) });
  const pointerToSquare = (x: number, y: number): number | null => {
    const rect = boardRef.current?.getBoundingClientRect();
    if (!rect || !rect.width || !rect.height) return null;
    const col = (x - rect.left) / rect.width, row = (y - rect.top) / rect.height;
    return col < 0 || col >= 1 || row < 0 || row >= 1 ? null : displayToSquare(Math.floor(col * 8), Math.floor(row * 8));
  };
  const pieces = useMemo(() => {
    const values: Array<{ sq: number; piece: number }> = [];
    for (let sq = 0; sq < 128; sq++) {
      if (sq & 0x88) { sq += 7; continue; }
      const piece = position.pieceAt(sq);
      if (piece) values.push({ sq, piece });
    }
    return values;
  }, [position, version]);

  useLayoutEffect(() => {
    const before = previousPieces.current;
    previousPieces.current = new Map(pieces.map(({ sq, piece }) => [sq, piece]));
    setSelected(null); setPromo(null); setStaged(null); setHoverSq(null);
    releasePointer(); setDrag(null); setAnimFrom(null); setGhost(null); setPopSq(null);
    if (!animate || animate.from === animate.to || !settings.animateMoves || reducedMotion || !before.has(animate.from)) return;
    setAnimFrom(animate.from);
    let capturedSquare = animate.capturedSquare;
    let capturedPiece = before.get(animate.to) ?? 0;
    const mover = before.get(animate.from)!;
    if (!capturedPiece && typeOf(mover) === PAWN && fileOf(animate.from) !== fileOf(animate.to)) {
      capturedSquare = animate.to + (colorOf(mover) === WHITE ? -16 : 16);
      capturedPiece = before.get(capturedSquare) ?? 0;
    } else if (capturedPiece) capturedSquare = animate.to;
    if (capturedPiece) setGhost({ square: capturedSquare, piece: capturedPiece });
    let secondFrame = 0;
    const firstFrame = requestAnimationFrame(() => { secondFrame = requestAnimationFrame(() => setAnimFrom(null)); });
    const end = window.setTimeout(() => { setGhost(null); if (animate.promoted) setPopSq(animate.to); }, 230);
    const pop = window.setTimeout(() => setPopSq(null), 630);
    return () => { cancelAnimationFrame(firstFrame); cancelAnimationFrame(secondFrame); clearTimeout(end); clearTimeout(pop); };
  }, [position, version, animate, settings.animateMoves, reducedMotion, pieces]);
  useLayoutEffect(() => { setSelected(null); setPromo(null); setStaged(null); cancelDrag(); }, [interactive, orientation]);
  useEffect(() => () => releasePointer(), []);
  useEffect(() => {
    if (checkSquare != null && checkSquare !== prevCheck.current) setPulse((p) => p + 1);
    prevCheck.current = checkSquare ?? null;
  }, [checkSquare]);
  useEffect(() => {
    if (!shake) return;
    const timer = window.setTimeout(() => setShake(null), 280);
    return () => clearTimeout(timer);
  }, [shake]);
  useEffect(() => {
    if (lastMove) setAnnounce(`${algebraic(lastMove.from)} to ${algebraic(lastMove.to)}.${checkSquare != null ? ' Check.' : ''} ${position.stm === WHITE ? 'White' : 'Black'} to move.`);
  }, [version, position, lastMove?.from, lastMove?.to, checkSquare]);

  const nudge = (sq: number) => { setShake((state) => ({ sq, n: (state?.n ?? 0) + 1 })); onIllegal?.(); };
  const legalNow = (move: PendingMove): boolean => interactive && position.fen() === move.fen && selectable(move.from)
    && legalFor(move.from).some((m) => m.to === move.to && m.promo === move.promo);
  const execute = (move: PendingMove) => {
    if (!legalNow(move) || !onMove(move.from, move.to, move.promo)) nudge(move.from);
    setSelected(null); setStaged(null); setPromo(null);
  };
  const commit = (move: PendingMove) => {
    if (!legalNow(move)) { nudge(move.from); return; }
    if (settings.confirmMoves) { setStaged(move); setSelected(null); }
    else execute(move);
  };
  const attempt = (from: number, to: number): boolean => {
    if (!interactive || from === to || !selectable(from)) return false;
    const moves = legalFor(from).filter((m) => m.to === to);
    if (!moves.length) return false;
    const move: PendingMove = { from, to, fen: position.fen(), promo: null };
    if (moves.some((m) => m.promo !== null)) {
      if (settings.autoQueen) commit({ ...move, promo: 5 });
      else setPromo(move);
    } else commit(move);
    return true;
  };
  const targetClick = (target: number) => {
    if (!interactive || promo || staged) return;
    if (selected === target) { setSelected(null); return; }
    if (selected !== null && attempt(selected, target)) return;
    if (selectable(target)) setSelected(target);
    else if (selected !== null) nudge(selected);
  };
  const pointerDown = (event: React.PointerEvent, sq?: number) => {
    if (!interactive || promo || staged || event.button !== 0 || event.isPrimary === false || dragRef.current) return;
    const target = sq ?? pointerToSquare(event.clientX, event.clientY);
    if (target === null) return;
    event.preventDefault(); event.stopPropagation();
    sound.unlock(); boardRef.current?.focus({ preventScroll: true }); setCursor(target);
    if (sq === undefined || !selectable(target)) { targetClick(target); return; }
    const element = event.currentTarget;
    try { element.setPointerCapture(event.pointerId); pointer.current = { element, id: event.pointerId }; } catch { /* synthetic pointer */ }
    setSelected((old) => old === target ? null : target);
    setDrag({ from: target, x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, moved: false, pointerId: event.pointerId });
  };
  const pointerMove = (event: React.PointerEvent) => {
    const current = dragRef.current;
    if (!current || event.pointerId !== current.pointerId) return;
    const moved = current.moved || Math.hypot(event.clientX - current.startX, event.clientY - current.startY) >= 4;
    setDrag({ ...current, x: event.clientX, y: event.clientY, moved });
    setHoverSq(pointerToSquare(event.clientX, event.clientY));
  };
  const pointerUp = (event: React.PointerEvent) => {
    const current = dragRef.current;
    if (!current || event.pointerId !== current.pointerId) return;
    const target = pointerToSquare(event.clientX, event.clientY);
    cancelDrag();
    if (!interactive || !current.moved || target === null || target === current.from) return;
    if (!attempt(current.from, target)) {
      if (selectable(target)) setSelected(target); else nudge(current.from);
    }
  };
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.target !== event.currentTarget || !interactive || promo || staged || event.ctrlKey || event.metaKey || event.altKey) return;
    const current = cursor ?? displayToSquare(0, 0), { col, row } = squareToDisplay(current);
    let next = current;
    switch (event.key) {
      case 'ArrowLeft': next = displayToSquare(Math.max(0, col - 1), row); break;
      case 'ArrowRight': next = displayToSquare(Math.min(7, col + 1), row); break;
      case 'ArrowUp': next = displayToSquare(col, Math.max(0, row - 1)); break;
      case 'ArrowDown': next = displayToSquare(col, Math.min(7, row + 1)); break;
      case 'Home': next = displayToSquare(0, row); break;
      case 'End': next = displayToSquare(7, row); break;
      case 'PageUp': next = displayToSquare(col, 0); break;
      case 'PageDown': next = displayToSquare(col, 7); break;
      case 'Enter': case ' ': sound.unlock(); targetClick(current); break;
      case 'Escape': setSelected(null); break;
      default: return;
    }
    event.preventDefault(); event.stopPropagation(); setCursor(next); setAnnounce(pieceLabel(position.pieceAt(next), next));
  };
  const targets = new Map<number, Move>();
  if (interactive && selected !== null && settings.showLegalMoves) for (const m of legalFor(selected)) targets.set(m.to, m);
  const rect = boardRef.current?.getBoundingClientRect();
  const pieceStyle = (sq: number, dragging: boolean, from: number | null): React.CSSProperties => {
    if (dragging && drag && rect) return { transform: `translate(${drag.x - rect.left - rect.width / 16}px, ${drag.y - rect.top - rect.width / 16}px) scale(1.12)`, zIndex: 30 };
    const { col, row } = squareToDisplay(from ?? sq);
    return { transform: `translate(${col * 100}%, ${row * 100}%)` };
  };
  return (
    <div className="board-frame">
      <div style={{ position: 'relative' }}>
        <div ref={boardRef} className={`board${interactive ? ' interactive' : ''}`} role="grid" tabIndex={0}
          aria-label={label ?? 'Chess board'} aria-rowcount={8} aria-colcount={8} aria-readonly={!interactive}
          aria-describedby={`${id}-help`} aria-activedescendant={cursor === null ? undefined : `${id}-${algebraic(cursor)}`}
          onFocus={(e) => { if (e.target === e.currentTarget && interactive && cursor === null) setCursor(displayToSquare(0, 0)); }}
          onKeyDown={onKeyDown} onPointerDown={(e) => pointerDown(e)} onPointerMove={pointerMove} onPointerUp={pointerUp}
          onPointerCancel={cancelDrag} onLostPointerCapture={cancelDrag}>
          {Array.from({ length: 8 }, (_, row) => (
            <div className="board-row" role="row" aria-rowindex={row + 1} key={row} style={{ display: 'contents' }}>
              {Array.from({ length: 8 }, (_, col) => {
                const sq = displayToSquare(col, row), check = checkSquare === sq, hint = targets.get(sq);
                return (
                  <div key={sq} id={`${id}-${algebraic(sq)}`} data-sq={algebraic(sq)} role="gridcell" aria-colindex={col + 1}
                    aria-label={`${pieceLabel(position.pieceAt(sq), sq)}${check ? ', in check' : ''}`} aria-selected={selected === sq || staged?.from === sq || staged?.to === sq}
                    className={['sq', (fileOf(sq) + rankOf(sq)) % 2 === 1 ? 'light' : 'dark', lastMove && (lastMove.from === sq || lastMove.to === sq) ? 'last' : '', selected === sq || staged?.from === sq || staged?.to === sq ? 'sel' : '', check ? 'check' : '', hint ? position.pieceAt(sq) !== 0 || hint.flag === 1 ? 'hint hint-capture' : 'hint' : '', hoverSq === sq && drag ? 'hover-drop' : '', cursor === sq ? 'cursor' : ''].filter(Boolean).join(' ')}>
                    {settings.showCoordinates && row === 7 && <span className="coord coord-file" aria-hidden="true">{FILES[fileOf(sq)]}</span>}
                    {settings.showCoordinates && col === 0 && <span className="coord coord-rank" aria-hidden="true">{RANKS[rankOf(sq)]}</span>}
                    {check && <span className="check-pulse" key={pulse} aria-hidden="true" />}
                    <div className="sq-overlay" aria-hidden="true" />
                  </div>
                );
              })}
            </div>
          ))}
          <div className="piece-layer" aria-hidden="true">
            {ghost && <div className="piece fading" style={pieceStyle(ghost.square, false, null)} key={`ghost-${ghost.square}-${ghost.piece}`}><PieceView piece={ghost.piece} style={settings.pieceStyle} /></div>}
            {pieces.map(({ sq, piece }) => {
              const dragging = drag?.from === sq && drag.moved, from = animFrom !== null && animate?.to === sq ? animFrom : null;
              const shaking = shake?.sq === sq;
              return <div key={`${orientation}-${sq}-${piece}${shaking ? `-s${shake.n}` : ''}`} data-piece={algebraic(sq)}
                className={`piece${dragging ? ' dragging' : ''}${interactive && selectable(sq) ? '' : ' idle'}${shaking ? ' shake' : ''}${popSq === sq ? ' pop' : ''}`}
                style={{ ...pieceStyle(sq, dragging, from), ...(!settings.animateMoves || reducedMotion ? { transition: 'none' } : {}) }} onPointerDown={(e) => pointerDown(e, sq)}><PieceView piece={piece} style={settings.pieceStyle} /></div>;
            })}
          </div>
        </div>
        {promo && <PromotionPicker color={colorOf(position.pieceAt(promo.from))} style={settings.pieceStyle}
          onPick={(type) => { const move = { ...promo, promo: type }; setPromo(null); commit(move); }} onCancel={() => { setPromo(null); setSelected(null); }} />}
        {staged && <ConfirmMove move={staged} onAccept={() => execute(staged)} onCancel={() => setStaged(null)} />}
      </div>
      <p id={`${id}-help`} className="sr-only">{interactive ? 'Arrow keys explore the board. Enter or Space selects a piece or destination. Escape cancels selection. Home and End go to the row edges; Page Up and Page Down change rank.' : 'Read-only chessboard.'}</p>
      <div className="sr-only" role="status" aria-live="polite">{announce}</div>
    </div>
  );
}
function PieceView({ piece, style }: { piece: number; style: Settings['pieceStyle'] }) {
  return style === 'glyph' ? <span className={`piece-glyph ${colorOf(piece) === WHITE ? 'w' : 'b'}`}>{glyphFor(piece & 7, colorOf(piece) === WHITE)}</span>
    : <PieceSvg type={typeOf(piece) as PieceType} color={colorOf(piece)} />;
}
function PromotionPicker({ color, style, onPick, onCancel }: { color: Color; style: Settings['pieceStyle']; onPick: (type: PieceType) => void; onCancel: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useDialogFocus(ref, onCancel);
  return (
    <div className="promo-overlay">
      <div className="promo-panel" role="dialog" aria-modal="true" aria-label="Choose promotion piece" ref={ref}>
        <ToastHost />
        <div className="promo-label">Promote to</div>
        <div className="promo-row">{([5, 2, 4, 3] as PieceType[]).map((type) => (
          <button key={type} className="promo-piece" onClick={() => onPick(type)} aria-label={`Promote to ${pieceNames[type]}`}>
            {style === 'glyph' ? <span className={`piece-glyph ${color === WHITE ? 'w' : 'b'}`} style={{ fontSize: 30 }}>{glyphFor(type, color === WHITE)}</span> : <PieceSvg type={type} color={color} />}
          </button>
        ))}</div>
        <button className="btn btn-sm btn-ghost" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
function ConfirmMove({ move, onAccept, onCancel }: { move: PendingMove; onAccept: () => void; onCancel: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useDialogFocus(ref, onCancel);
  return <div className="confirm-bar" role="dialog" aria-modal="true" aria-label="Confirm move" ref={ref}>
    <ToastHost />
    <span className="confirm-text">{algebraic(move.from)} → {algebraic(move.to)}{move.promo ? ` = ${pieceNames[move.promo]}` : ''}</span>
    <button className="btn btn-primary btn-sm" onClick={onAccept}>Accept</button>
    <button className="btn btn-ghost btn-sm" onClick={onCancel}>Cancel</button>
  </div>;
}
