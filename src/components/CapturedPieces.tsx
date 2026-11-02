import { Color, PIECE_VALUE_CP, colorOf, typeOf } from '../chess/constants';
import type { Position } from '../chess/position';
import { PieceSvg, glyphFor } from './PieceSvg';
import type { Settings } from '../storage/settings';

export function CapturedPieces({ position, color, settings }: { position: Position; color: Color; settings: Settings }) {
  const captured = position.capturedBy(color).sort((a, b) => (a & 7) - (b & 7));
  let balance = 0;
  for (let type = 1; type <= 5; type++) balance += ((position.counts[color === 0 ? type : type + 8] ?? 0) - (position.counts[color === 0 ? type + 8 : type] ?? 0)) * PIECE_VALUE_CP[type]!;
  const material = Math.max(0, Math.round(balance / 100));
  const names = ['', 'pawn', 'knight', 'bishop', 'rook', 'queen', 'king'];
  const label = `Captured by ${color === 0 ? 'white' : 'black'}: ${captured.length ? captured.map((p) => names[typeOf(p)]).join(', ') : 'none'}.${material > 0 ? ` Material advantage ${material}.` : ''}`;
  return <div className="captured" role="img" aria-label={label}>
    {captured.map((piece, index) => settings.pieceStyle === 'glyph'
      ? <span aria-hidden="true" key={index} className={`captured-glyph ${colorOf(piece) === 0 ? 'w' : 'b'}`}>{glyphFor(typeOf(piece), colorOf(piece) === 0)}</span>
      : <span aria-hidden="true" key={index} className="captured-piece"><PieceSvg type={typeOf(piece)} color={colorOf(piece)} /></span>)}
    {material > 0 && <span aria-hidden="true" className="captured-advantage">+{material}</span>}
  </div>;
}
