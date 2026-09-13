/** Move list — numbered SAN pairs, auto-scroll, review navigation. */
import { useEffect, useRef } from 'react';

export interface MoveListProps {
  sans: string[];
  currentPly?: number; // for review highlight
  onSelectPly?: (ply: number) => void;
  collapsed?: boolean;
}

export function MoveList({ sans, currentPly, onSelectPly, collapsed }: MoveListProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (currentPly === undefined) {
      listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
    } else {
      activeRef.current?.scrollIntoView({ block: 'nearest' });
    }
  }, [sans.length, currentPly]);

  if (collapsed) {
    return (
      <div className="movelist-empty">
        <span className="faint small">Move list hidden — press <kbd>M</kbd></span>
      </div>
    );
  }

  const rows: Array<{ number: number; white?: string; black?: string; wPly: number; bPly: number }> = [];
  for (let i = 0; i < sans.length; i += 2) {
    rows.push({ number: i / 2 + 1, white: sans[i], black: sans[i + 1], wPly: i + 1, bPly: i + 2 });
  }

  return (
    <div className="movelist" ref={listRef} role="table" aria-label="Move list">
      {rows.length === 0 ? (
        <div className="movelist-empty">
          <span className="faint small">The board is waiting.</span>
        </div>
      ) : (
        rows.map((r) => (
          <div className="movelist-row" key={r.number} role="row">
            <span className="movelist-num">{r.number}.</span>
            {(['white', 'black'] as const).map((side) => {
              const san = side === 'white' ? r.white : r.black;
              const ply = side === 'white' ? r.wPly : r.bPly;
              if (!san) return <span key={side} />;
              const active = currentPly === ply || (currentPly === undefined && ply === sans.length);
              return (
                <button
                  key={side}
                  ref={active ? activeRef : undefined}
                  className={`movelist-move${active ? ' active' : ''}`}
                  onClick={() => onSelectPly?.(ply)}
                  disabled={!onSelectPly}
                  role="cell"
                >
                  {san}
                </button>
              );
            })}
          </div>
        ))
      )}
    </div>
  );
}
