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
    const list = listRef.current;
    const active = activeRef.current;
    if (!list) return;
    if (currentPly === undefined || !active) {
      list.scrollTo({ top: list.scrollHeight });
    } else {
      // Keep the active move centered inside the list itself. scrollIntoView
      // would also scroll every ancestor (including the window), yanking the
      // page whenever the list is below the fold.
      const listR = list.getBoundingClientRect();
      const activeR = active.getBoundingClientRect();
      list.scrollTop += activeR.top - listR.top - (listR.height - activeR.height) / 2;
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
