import { useEffect, useRef } from 'react';
import { START_FEN } from '../chess/constants';

export interface MoveListProps {
  sans: string[];
  currentPly?: number;
  onSelectPly?: (ply: number) => void;
  collapsed?: boolean;
  startFen?: string;
}
interface MoveRow { number: number; white?: string; black?: string; wPly?: number; bPly?: number }
export function moveRows(sans: string[], startFen = START_FEN): MoveRow[] {
  const fields = startFen.split(/\s+/), offset = fields[1] === 'b' ? 1 : 0;
  const first = Number(fields[5]) || 1, rows: MoveRow[] = [];
  sans.forEach((san, index) => {
    const halfmove = index + offset, number = first + Math.floor(halfmove / 2);
    let row = rows[rows.length - 1];
    if (!row || row.number !== number) { row = { number }; rows.push(row); }
    if (halfmove % 2 === 0) { row.white = san; row.wPly = index + 1; }
    else { row.black = san; row.bPly = index + 1; }
  });
  return rows;
}
export function MoveList({ sans, currentPly, onSelectPly, collapsed, startFen }: MoveListProps) {
  const listRef = useRef<HTMLDivElement>(null), activeRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const list = listRef.current, active = activeRef.current;
    if (!list) return;
    if (currentPly === undefined || !active) list.scrollTo({ top: list.scrollHeight });
    else {
      const box = list.getBoundingClientRect(), item = active.getBoundingClientRect();
      list.scrollTop += item.top - box.top - (box.height - item.height) / 2;
    }
  }, [sans.length, currentPly, collapsed]);
  if (collapsed) return <div className="movelist-empty"><span className="faint small">Move list hidden — press <kbd>M</kbd></span></div>;
  const rows = moveRows(sans, startFen);
  if (!rows.length) return <div className="movelist-empty"><span className="faint small">The board is waiting.</span></div>;
  return <div className="movelist" ref={listRef} role="table" aria-label="Move list">
    {rows.map((row) => <div className="movelist-row" key={row.number} role="row">
      <span className="movelist-num" role="rowheader">{row.number}{row.white === undefined ? '…' : '.'}</span>
      {(['white', 'black'] as const).map((side) => {
        const san = row[side], ply = side === 'white' ? row.wPly : row.bPly;
        const active = ply !== undefined && (currentPly === ply || (currentPly === undefined && ply === sans.length));
        const className = `movelist-move${active ? ' active' : ''}`;
        return <div role="cell" key={side}>
          {san && ply !== undefined ? onSelectPly
            ? <button className={className} onClick={() => onSelectPly(ply)} ref={active ? (el) => { activeRef.current = el; } : undefined}
                aria-current={active ? 'step' : undefined} aria-label={`${side} move ${row.number}: ${san}`}>{san}</button>
            : <span className={className} ref={active ? (el) => { activeRef.current = el; } : undefined}>{san}</span>
            : <span aria-label="No move">—</span>}
        </div>;
      })}
    </div>)}
  </div>;
}
