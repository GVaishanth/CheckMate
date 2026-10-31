/**
 * Engine worker — runs all search/analysis off the UI thread.
 *
 * Protocol (all messages are plain objects):
 *   → { t: 'search', id, gameId, startFen, moves, style, seed, variant? }
 *   ← { t: 'progress', id, depth, nodes, ms, score }
 *   ← { t: 'search-result', id, uci, fromBook, score, depth, nodes, ms, pv }
 *
 *   → { t: 'eval-draw', id, startFen, moves, botId }
 *   ← { t: 'eval-draw-result', id, accept, scoreCp }
 *
 *   → { t: 'analyze-game', id, startFen, moves, plies: number[], depth }
 *   ← { t: 'analyze-progress', id, done, total }
 *   ← { t: 'analyze-game-result', id, losses: number[] }   // cp loss per ply
 *
 *   → { t: 'analyze-review', id, startFen, moves, depth }
 *   ← { t: 'analyze-review-progress', id, done, total }
 *   ← { t: 'analyze-review-result', id, losses, bests }    // loss + best uci per ply
 *
 *   → { t: 'eval', id, fen }
 *   ← { t: 'eval-result', id, cp }   // static eval, White POV, centipawns
 *
 *   → { t: 'clear' }
 */
import { Position } from '../chess/position';
import { botById, BOTS } from '../engine/bots';
import { botMove, resetTable, analyzeMoveQuality, evaluateWhiteCp } from '../engine';
import { Searcher } from '../engine/search';
import { TranspositionTable } from '../engine/tt';

const tt = new TranspositionTable();
let lastGameId = '';

function buildPosition(startFen: string, moves: string[], variant?: string): Position {
  const pos = Position.fromFen(startFen);
  if (variant === 'three-check' || variant === 'koth') pos.applyVariant(variant);
  pos.playUciMoves(moves);
  return pos;
}

type Req = {
  t: string;
  id?: number;
  gameId?: string;
  startFen?: string;
  moves?: string[];
  variant?: string;
  style?: unknown;
  seed?: number;
  botId?: string;
  plies?: number[];
  depth?: number;
  fen?: string;
  uci?: string;
};

self.onmessage = (ev: MessageEvent<Req>) => {
  const msg = ev.data;
  try {
    switch (msg.t) {
      case 'clear': {
        resetTable();
        tt.clear();
        break;
      }
      case 'search': {
        const id = msg.id!;
        if (msg.gameId && msg.gameId !== lastGameId) {
          tt.clear();
          lastGameId = msg.gameId;
        }
        const pos = buildPosition(msg.startFen!, msg.moves ?? [], msg.variant);
        const style = msg.style as (typeof BOTS)[number];
        const decision = botMove(pos, style, msg.seed ?? (Date.now() & 0xffffffff));
        (self as unknown as Worker).postMessage({
          t: 'search-result',
          id,
          uci: decision.uci,
          fromBook: decision.fromBook,
          score: decision.score,
          depth: decision.depth,
          nodes: decision.nodes,
          ms: decision.ms,
          pv: decision.pv,
        });
        break;
      }
      case 'eval-draw': {
        const id = msg.id!;
        const pos = buildPosition(msg.startFen!, msg.moves ?? [], msg.variant);
        const bot = botById(msg.botId ?? 'club');
        const searcher = new Searcher(tt);
        const r = searcher.search(pos, { maxDepth: 4, softMs: 400 });
        // Accept when the engine sees a balanced position (or is losing).
        let accept = Math.abs(r.score) < 60;
        if (bot && (bot.id === 'rookie' || bot.id === 'apprentice') && Math.abs(r.score) < 150) {
          accept = Math.random() < 0.4;
        }
        (self as unknown as Worker).postMessage({ t: 'eval-draw-result', id, accept, scoreCp: r.score });
        break;
      }
      case 'analyze-game': {
        const id = msg.id!;
        const depth = msg.depth ?? 7;
        const only = msg.plies ?? [];
        const total = msg.moves?.length ?? 0;
        // losses[p] is the centipawn loss of ply p (0 when skipped) —
        // index alignment matters to consumers.
        const losses: number[] = new Array(total).fill(0);
        const pos = buildPosition(msg.startFen!, [], msg.variant);
        let done = 0;
        for (let ply = 0; ply < total; ply++) {
          const uci = msg.moves?.[ply];
          if (uci === undefined) break;
          if (only.length === 0 || only.includes(ply)) {
            const q = analyzeMoveQuality(pos, uci, depth);
            losses[ply] = Math.min(600, q.lossCp);
            done++;
            if (done % 4 === 0) {
              (self as unknown as Worker).postMessage({ t: 'analyze-progress', id, done, total: only.length || total });
            }
          }
          pos.playUci(uci);
        }
        (self as unknown as Worker).postMessage({ t: 'analyze-game-result', id, losses });
        break;
      }
      case 'analyze-review': {
        const id = msg.id!;
        const depth = msg.depth ?? 6;
        const total = msg.moves?.length ?? 0;
        const losses: number[] = new Array(total).fill(0);
        const bests: (string | null)[] = new Array(total).fill(null);
        const pos = buildPosition(msg.startFen!, [], msg.variant);
        for (let ply = 0; ply < total; ply++) {
          const uci = msg.moves?.[ply];
          if (uci === undefined) break;
          const q = analyzeMoveQuality(pos, uci, depth);
          losses[ply] = Math.min(600, q.lossCp);
          bests[ply] = q.lossCp > 0 ? q.bestUci : null;
          (self as unknown as Worker).postMessage({ t: 'analyze-review-progress', id, done: ply + 1, total });
          pos.playUci(uci);
        }
        (self as unknown as Worker).postMessage({ t: 'analyze-review-result', id, losses, bests });
        break;
      }
      case 'eval': {
        const id = msg.id!;
        const pos = Position.fromFen(msg.fen!);
        (self as unknown as Worker).postMessage({ t: 'eval-result', id, cp: evaluateWhiteCp(pos, 'full') });
        break;
      }
      case 'analyze-move': {
        const id = msg.id!;
        const pos = Position.fromFen(msg.fen!);
        const q = analyzeMoveQuality(pos, msg.uci!, msg.depth ?? 8);
        (self as unknown as Worker).postMessage({
          t: 'analyze-move-result', id, lossCp: q.lossCp, bestUci: q.bestUci, bestScore: q.bestScore,
        });
        break;
      }
      default:
        break;
    }
  } catch (err) {
    // Never let the worker die silently — report back so the UI can fall back.
    (self as unknown as Worker).postMessage({
      t: 'error',
      id: msg.id ?? -1,
      kind: msg.t,
      message: err instanceof Error ? err.message : String(err),
    });
  }
};
