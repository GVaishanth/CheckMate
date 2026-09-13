/** Elo test data — generated offline by scripts/generate-elo.ts (engine-verified). */
import raw from './elo.json';

export type EloRoundKind = 'mate' | 'tactics' | 'convert' | 'consistency';
export type EloCategory = 'tactics' | 'calculation' | 'endgame' | 'consistency';

export interface EloRound {
  id: string;
  kind: EloRoundKind;
  category: EloCategory;
  fen: string;
  sideToMove: 'white' | 'black';
  bestMove?: string;
  mateIn?: number;
  targetMoves?: number;
  defender?: 'apprentice' | 'club' | 'competitor';
  prompt: string;
  winThresholdCp?: number;
}

export interface EloTestData {
  version: number;
  generated: string;
  rounds: EloRound[];
}

export const ELO_ROUNDS: EloRound[] = (raw as EloTestData).rounds;

export const CATEGORY_META: Record<EloCategory, { label: string; weight: number; desc: string }> = {
  tactics: { label: 'Tactics', weight: 0.2, desc: 'spotting the decisive shot' },
  calculation: { label: 'Calculation', weight: 0.2, desc: 'forcing lines to the end' },
  endgame: { label: 'Endgame', weight: 0.17, desc: 'converting an advantage' },
  consistency: { label: 'Consistency', weight: 0.13, desc: 'avoiding unforced errors' },
};
