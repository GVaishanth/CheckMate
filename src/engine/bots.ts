/**
 * Bot personalities — genuine engine configuration, not cosmetic labels.
 *
 * Strength differences come from real mechanisms:
 *   - search depth + time budget
 *   - evaluation profile ('basic' = material/PST only, 'full' = structural)
 *   - quiescence search on/off (seeing recaptures)
 *   - search noise (centipawn jitter added to root move scores)
 *   - blunder rate (probability of picking from the weaker half of moves)
 *   - opening book usage
 */
import type { EvalProfile } from './evaluate';

export interface BotStyle {
  id: string;
  name: string;
  elo: string;            // displayed approximate range
  tagline: string;
  traits: string[];       // personality descriptors shown in the UI
  depth: number;
  softMs: number;
  noiseCp: number;        // ± jitter applied to root scores
  blunderRate: number;    // 0..1 chance of a deliberately weak choice
  quiescence: boolean;
  profile: EvalProfile;
  bookPly: number;        // use book up to this ply (0 = never)
  rankRoot: boolean;      // full-window root scores (needed for noise/blunder)
  pips: number;           // 1..6 difficulty indicator
}

export const BOTS: BotStyle[] = [
  {
    id: 'rookie',
    name: 'ROOKIE',
    elo: '600–800',
    tagline: 'Learns the ropes. Takes what is given — and sometimes gives it back.',
    traits: ['1-ply search', 'material and piece placement', 'frequent blunders', 'no opening theory'],
    depth: 1, softMs: 250, noiseCp: 130, blunderRate: 0.3, quiescence: false,
    profile: 'basic', bookPly: 0, rankRoot: true, pips: 1,
  },
  {
    id: 'apprentice',
    name: 'APPRENTICE',
    elo: '900–1100',
    tagline: 'Knows how pieces move together. Forgets under pressure.',
    traits: ['2-ply search', 'sees recaptures', 'inconsistent positional play', 'light opening theory'],
    depth: 2, softMs: 350, noiseCp: 70, blunderRate: 0.12, quiescence: true,
    profile: 'basic', bookPly: 4, rankRoot: true, pips: 2,
  },
  {
    id: 'club',
    name: 'CLUB PLAYER',
    elo: '1200–1400',
    tagline: 'Solid fundamentals. Punishes free pieces, respects development.',
    traits: ['3-ply search', 'full evaluation', 'sound opening principles', 'occasional inaccuracy'],
    depth: 3, softMs: 500, noiseCp: 35, blunderRate: 0.05, quiescence: true,
    profile: 'full', bookPly: 8, rankRoot: true, pips: 3,
  },
  {
    id: 'competitor',
    name: 'COMPETITOR',
    elo: '1500–1700',
    tagline: 'Tactical and prepared. Converts small edges, searches deep enough to sting.',
    traits: ['4-ply iterative search', 'full evaluation', 'rare blunders'],
    depth: 4, softMs: 700, noiseCp: 15, blunderRate: 0.015, quiescence: true,
    profile: 'full', bookPly: 10, rankRoot: true, pips: 4,
  },
  {
    id: 'master',
    name: 'MASTER',
    elo: '1800–2000',
    tagline: 'Deep calculation with a cold, positional style.',
    traits: ['6-ply iterative search', 'pruned + ordered search', 'no artificial noise'],
    depth: 6, softMs: 1100, noiseCp: 0, blunderRate: 0, quiescence: true,
    profile: 'full', bookPly: 12, rankRoot: false, pips: 5,
  },
  {
    id: 'grandmaster',
    name: 'GRANDMASTER',
    elo: '2100+',
    tagline: 'The strongest local configuration. Long thinks, sharp tactics, no mercy.',
    traits: ['deep iterative search', 'full search arsenal', 'book + deep preparation'],
    depth: 10, softMs: 1900, noiseCp: 0, blunderRate: 0, quiescence: true,
    profile: 'full', bookPly: 12, rankRoot: false, pips: 6,
  },
];

export const botById = (id: string): BotStyle | undefined => BOTS.find((b) => b.id === id);
