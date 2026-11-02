import { Position } from '../chess/position';
import { decodeMove, FLAG_EN_PASSANT } from '../chess/constants';
import { moveToSan } from '../chess/san';
import { normaliseEducation } from '../education/progress';
import { normaliseSettings } from './settings';
import type { ExportBundle, StoredGame, PuzzleProgress, EloResult, GameAnalysis, GameOutcome, DrawReason } from './schema';

const DRAW_REASONS = ['stalemate', 'agreement', 'threefold', 'fifty-move', 'insufficient', 'disconnect', 'unspecified'];
const MAX_DATE = 8_640_000_000_000_000;
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid record in backup.');
  return value as Record<string, unknown>;
};
function text(value: unknown, max = 160): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) throw new Error('Invalid text in backup.');
  return value;
}
function number(value: unknown, max = MAX_DATE, min = 0): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error('Invalid number in backup.');
  return value;
}
const count = (value: unknown, max = 1_000_000): number => {
  const n = number(value, max);
  if (!Number.isSafeInteger(n)) throw new Error('Invalid count in backup.');
  return n;
};
function rows(value: unknown, max: number): unknown[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > max) throw new Error('Invalid or oversized record list.');
  return value;
}
function unique<T>(values: T[], key: (value: T) => string): T[] {
  if (new Set(values.map(key)).size !== values.length) throw new Error('Duplicate record IDs in backup.');
  return values;
}
function outcome(value: unknown): GameOutcome {
  const row = object(value);
  if (row.result === 'white' || row.result === 'black' || row.result === 'unfinished') return { result: row.result };
  if (row.result === 'draw' && DRAW_REASONS.includes(row.reason as string)) return { result: 'draw', reason: row.reason as DrawReason };
  throw new Error('Invalid game result in backup.');
}
function analysis(value: unknown): GameAnalysis | undefined {
  if (value === undefined) return undefined;
  const row = object(value);
  const result: GameAnalysis = { analyzedAt: number(row.analyzedAt) };
  for (const key of ['whiteAccuracy', 'blackAccuracy'] as const) if (row[key] !== undefined) result[key] = number(row[key], 100);
  for (const key of ['whiteLossCp', 'blackLossCp'] as const) if (row[key] !== undefined) result[key] = number(row[key], 1_000_000);
  if (row.performance !== undefined) result.performance = number(row.performance, 10_000);
  return result;
}
function puzzle(value: unknown): PuzzleProgress {
  const row = object(value), id = text(row.puzzleId);
  if (row.key !== id || (row.status !== 'solved' && row.status !== 'failed')) throw new Error('Invalid puzzle record in backup.');
  const result: PuzzleProgress = { key: id, puzzleId: id, status: row.status, attempts: count(row.attempts), lastTriedAt: number(row.lastTriedAt) };
  if (row.bestTimeMs !== undefined) result.bestTimeMs = number(row.bestTimeMs);
  if (row.bestStreak !== undefined) result.bestStreak = count(row.bestStreak);
  if (row.solvedAt !== undefined) result.solvedAt = number(row.solvedAt);
  return result;
}
function elo(value: unknown): EloResult {
  const row = object(value), categories = object(row.categories);
  if (Object.keys(categories).length > 100) throw new Error('Too many rating categories.');
  const result: EloResult = { id: text(row.id), date: number(row.date), rating: number(row.rating, 10_000), rangeLow: number(row.rangeLow, 10_000), rangeHigh: number(row.rangeHigh, 10_000), overall: number(row.overall, 100), rounds: count(row.rounds, 10_000), categories: Object.fromEntries(Object.entries(categories).map(([key, value]) => [text(key, 80), number(value, 10_000)])) };
  if (result.rangeLow > result.rating || result.rangeHigh < result.rating) throw new Error('Invalid rating range.');
  if (row.strongest !== undefined) result.strongest = text(row.strongest);
  if (row.weakest !== undefined) result.weakest = text(row.weakest);
  return result;
}
function settings(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || value.length > 10_000) throw new Error('Invalid settings in backup.');
  let parsed: Record<string, unknown>;
  try { parsed = object(JSON.parse(value)); } catch { throw new Error('Invalid settings in backup.'); }
  if (parsed.version !== undefined && parsed.version !== 1) throw new Error('Unsupported settings version.');
  for (const key of ['showCoordinates', 'showLegalMoves', 'animateMoves', 'autoQueen', 'confirmMoves', 'sound', 'uiSounds', 'highContrast', 'autoFlipLocal']) {
    if (parsed[key] !== undefined && typeof parsed[key] !== 'boolean') throw new Error('Invalid settings in backup.');
  }
  for (const [key, choices] of Object.entries({ boardTheme: ['carbon', 'tournament', 'walnut', 'fog'], pieceStyle: ['vanguard', 'glyph'], reducedMotion: ['auto', 'on'], defaultOrientation: ['white', 'black'] })) {
    if (parsed[key] !== undefined && !choices.includes(parsed[key] as string)) throw new Error('Invalid settings in backup.');
  }
  if (parsed.volume !== undefined) number(parsed.volume, 1);
  return JSON.stringify(normaliseSettings(parsed));
}
const yieldTask = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

export async function validateBackup(value: unknown): Promise<ExportBundle> {
  const bundle = object(value);
  if (bundle.version !== 1 || !Array.isArray(bundle.games)) throw new Error('Unsupported CHECKMATE backup.');
  const games: StoredGame[] = [];
  let plies = 0;
  for (const entry of rows(bundle.games, 10_000)) {
    const row = object(entry);
    if (!['bot', 'local', 'p2p', 'import', 'elo'].includes(row.mode as string)) throw new Error('Invalid game mode.');
    if (row.variant !== undefined && !['standard', 'three-check', 'koth'].includes(row.variant as string)) throw new Error('Invalid game variant.');
    const position = Position.fromFen(text(row.startFen, 200));
    const variant = row.variant as StoredGame['variant'];
    if (variant) position.applyVariant(variant);
    const game: StoredGame = { id: text(row.id), mode: row.mode as StoredGame['mode'], date: number(row.date), whiteName: text(row.whiteName), blackName: text(row.blackName), startFen: position.startFen, moves: [], outcome: outcome(row.outcome), durationMs: number(row.durationMs) };
    if (variant) game.variant = variant;
    if (row.botId !== undefined) game.botId = text(row.botId);
    if (row.botElo !== undefined) game.botElo = text(row.botElo);
    if (row.pgn !== undefined) {
      if (typeof row.pgn !== 'string' || row.pgn.length > 1_000_000) throw new Error('Invalid PGN in backup.');
      game.pgn = row.pgn;
    }
    game.analysis = analysis(row.analysis);
    if (!Array.isArray(row.moves)) throw new Error('Invalid game moves.');
    for (const move of rows(row.moves, 20_000)) {
      if (++plies > 250_000) throw new Error('Backup exceeds 250,000 moves.');
      const record = object(move), uci = text(record.uci, 5);
      if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci) || position.variantWinner() !== null) throw new Error('Invalid move in backup.');
      const encoded = position.uciToMove(uci);
      if (encoded === null) throw new Error(`Illegal move in backup: ${uci}`);
      const decoded = decodeMove(encoded);
      const capture = position.pieceAt(decoded.to) !== 0 || decoded.flag === FLAG_EN_PASSANT;
      const san = moveToSan(position, decoded);
      position.makeMove(encoded);
      game.moves.push({ uci, san, capture, check: position.inCheck(position.stm), fenAfter: position.fen(), msElapsed: record.msElapsed === undefined ? 0 : number(record.msElapsed) });
      if (plies % 128 === 0) await yieldTask();
    }
    games.push(game);
    if (games.length % 16 === 0) await yieldTask();
  }
  const educationRows = rows(bundle.education, 10_000);
  for (const value of educationRows) {
    const row = object(value); text(row.lessonId, 100);
    if (row.studied !== undefined && typeof row.studied !== 'boolean') throw new Error('Invalid lesson record.');
    for (const key of ['practices', 'cleanPractices', 'recalls', 'cleanRecalls', 'lastScore', 'intervalDays', 'lapses']) if (row[key] !== undefined) count(row[key]);
    for (const key of ['dueAt', 'lastAt']) if (row[key] !== undefined && row[key] !== null) number(row[key]);
  }
  const education = normaliseEducation(educationRows);
  if (education.length !== educationRows.length) throw new Error('Invalid or duplicate lesson IDs.');
  const result: ExportBundle = { version: 1, exportedAt: number(bundle.exportedAt), games: unique(games, (g) => g.id), puzzles: unique(rows(bundle.puzzles, 20_000).map(puzzle), (p) => p.key), elo: unique(rows(bundle.elo, 10_000).map(elo), (e) => e.id), education, settings: settings(bundle.settings) };
  if (bundle.puzzleStreak !== undefined) {
    const streak = object(bundle.puzzleStreak);
    result.puzzleStreak = { current: count(streak.current), best: count(streak.best) };
    if (result.puzzleStreak.best < result.puzzleStreak.current) throw new Error('Invalid puzzle streak.');
  }
  return result;
}
