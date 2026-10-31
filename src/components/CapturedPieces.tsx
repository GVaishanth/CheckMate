/** Captured pieces tray + material balance. */
import { colorOf, Color, PIECE_VALUE_CP, typeOf } from '../chess/constants';
import type { Position } from '../chess/position';
import { PieceSvg, glyphFor } from './PieceSvg';
import type { Settings } from '../storage/settings';

const INITIAL_COUNTS: Record<number, number> = { 1: 8, 2: 2, 3: 2, 4: 2, 5: 1, 6: 1 };

export function CapturedPieces({ position, color, settings }: { position: Position; color: Color; settings: Settings }) {
  // Captured = initial − current per piece type (clamped at 0).
  const captured: number[] = [];
  for (let t = 1; t <= 5; t++) {
    const code = color === 0 ? t : t + 8;
    const current = position.counts[code] ?? 0;
    const missing = Math.max(0, (INITIAL_COUNTS[t] ?? 0) - current);
    for (let i = 0; i < missing; i++) captured.push(code);
  }
  const material = materialBalance(position, color);
  return (
    <div className="captured" aria-label={`Captured by ${color === 0 ? 'white' : 'black'}`}>
      {captured.sort((a, b) => (a & 7) - (b & 7)).map((code, i) =>
        settings.pieceStyle === 'glyph' ? (
          <span key={i} className={`captured-glyph ${colorOf(code) === 0 ? 'w' : 'b'}`}>{glyphFor(code & 7, colorOf(code) === 0)}</span>
        ) : (
          <span key={i} className="captured-piece">
            <PieceSvg type={typeOf(code) as 1 | 2 | 3 | 4 | 5 | 6} color={(color === 0 ? 1 : 0) as Color} />
          </span>
        ),
      )}
      {material > 0 && <span className="captured-advantage">+{material}</span>}
    </div>
  );
}

function materialBalance(position: Position, color: Color): number {
  let diff = 0;
  for (let t = 1; t <= 5; t++) {
    const own = position.counts[color === 0 ? t : t + 8] ?? 0;
    const their = position.counts[color === 0 ? t + 8 : t] ?? 0;
    diff += (own - their) * PIECE_VALUE_CP[t]!;
  }
  return Math.max(0, Math.round(diff / 100));
}

