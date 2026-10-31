/**
 * "VANGUARD" — CHECKMATE's custom piece set.
 *
 * Original geometric silhouettes designed for the app's sharp-identity look:
 * single-path bodies, one accent detail per piece, high contrast in both
 * colors without relying on external assets (fully offline).
 */
import { Color, PieceType } from '../chess/constants';

const W_FILL = '#ece5d3';
const W_STROKE = '#26221b';
const B_FILL = '#2c2f38';
const B_STROKE = '#cfc8b6';

interface PiecePaths {
  body: string;
  detail?: string; // stroke-only accent detail (eye, slit, band)
}

const PATHS: Record<number, PiecePaths> = {
  [1 as PieceType]: {
    // Pawn
    body: 'M24 8.5a6 6 0 0 1 6 6c0 2.2-1.2 4.1-3 5.2l3.6 17.8H17.4L21 19.7a6 6 0 0 1-3-5.2 6 6 0 0 1 6-6Z',
  },
  [2 as PieceType]: {
    // Knight — geometric horse head facing left
    body:
      'M14.6 39.5c-.5-6.5.2-11.4 2.6-15.4l-4.4 2c-1.8.8-3.4-.9-2.4-2.5l1.2-1.9 4-1.6c3-4.4 5.5-7 9.7-9.1l-.6-3.4 3.1 1.9 2.4-2.5.6 3.5c4.7 2.6 6.6 8 6.9 15.2.2 4.4.1 9.2 0 13.8Z',
    detail: 'M22.8 14.6a1.7 1.7 0 1 1 0 .1Z',
  },
  [3 as PieceType]: {
    // Bishop — orb + mitre + flared skirt (symmetric about x=24)
    body:
      'M21.7 9.2a2.3 2.3 0 1 0 4.6 0 2.3 2.3 0 1 0-4.6 0ZM24 12c5.5 2.5 8.5 7 8.5 11s-3 8.5-7 10.1L27 38H21l1.5-4.9C18.5 31.5 15.5 27 15.5 23S18.5 14.5 24 12Z',
    detail: 'M26 17 20.5 23.5',
  },
  [4 as PieceType]: {
    // Rook
    body:
      'M13 8.5h4.4v3.4h4.2V8.5h4.8v3.4h4.2V8.5H35v8.2l-2.6 2v14.9l2.6 2.4v2H13v-2l2.6-2.4V18.7l-2.6-2Z',
  },
  [5 as PieceType]: {
    // Queen
    body:
      'M12.2 12.4a1.9 1.9 0 1 1 .1 3.8l3.3 11.8h17l3.3-11.8a1.9 1.9 0 1 1 2.1-3.1 1.9 1.9 0 1 1-1.5 3.2L34.9 30.4l1.8 6.1c.3 1.1-.5 1.6-1.5 1.6H13c-1 0-1.8-.5-1.5-1.6l1.8-6.1-2.6-14.1a1.9 1.9 0 1 1 1.5-3.9Z',
    detail: 'M14.5 33h19',
  },
  [6 as PieceType]: {
    // King
    body:
      'M22.3 5.5h3.4v3h3v3.4h-3v3h-3.4v-3h-3V8.5h3ZM17 17h14.2c1.3 0 2 1 1.5 2.2l-1.6 4c3.4 2 5.6 5.4 5.6 9.3v3.6H11.5V32.5c0-3.9 2.2-7.3 5.6-9.3l-1.6-4C15 18 15.7 17 17 17Z',
    detail: 'M15.5 33.5h17',
  },
};

/**
 * Classic set — the Unicode convention: outline glyphs for white, solid for
 * black, so the two sides differ by shape, not colour alone. U+FE0E forces
 * text rendering on platforms that would otherwise draw these as emoji
 * (which would ignore the CSS colour entirely).
 */
const OUTLINE_GLYPHS: Record<number, string> = { 1: '\u2659', 2: '\u2658', 3: '\u2657', 4: '\u2656', 5: '\u2655', 6: '\u2654' };
const SOLID_GLYPHS: Record<number, string> = { 1: '\u265F', 2: '\u265E', 3: '\u265D', 4: '\u265C', 5: '\u265B', 6: '\u265A' };

export const glyphFor = (type: number, white: boolean): string =>
  ((white ? OUTLINE_GLYPHS : SOLID_GLYPHS)[type] ?? '') + '\uFE0E';

export function PieceSvg({ type, color }: { type: PieceType; color: Color }) {
  const white = color === 0;
  const fill = white ? W_FILL : B_FILL;
  const stroke = white ? W_STROKE : B_STROKE;
  const path = PATHS[type]!;
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <path
        d={path.body}
        fill={fill}
        stroke={stroke}
        strokeWidth={1.6}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {path.detail && (
        <path
          d={path.detail}
          fill="none"
          stroke={stroke}
          strokeWidth={type === 3 ? 2.2 : 1.8}
          strokeLinecap="round"
        />
      )}
    </svg>
  );
}
