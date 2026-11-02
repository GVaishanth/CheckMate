/** Local search and analysis. Bulk jobs yield between plies so they can be cancelled. */
import { Position, botById, botMove, analyzeMoveQuality, evaluateWhiteCp, resetTable } from '../engine/index';
import type { BotStyle } from '../engine/bots';
import { Searcher } from '../engine/search';
import { TranspositionTable } from '../engine/tt';

const tt = new TranspositionTable();
const jobs = new Map<number, { cancelled: boolean }>();
let lastGameId = '';
const yieldWorker = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

type Req = {
  t: string; id?: number; cancelId?: number; gameId?: string; startFen?: string;
  moves?: string[]; variant?: string; style?: BotStyle; seed?: number;
  botId?: string; depth?: number; fen?: string; uci?: string;
};
const post = (data: Record<string, unknown>) => self.postMessage(data);
function position(msg: Req, replay = true): Position {
  const pos = Position.fromFen(msg.startFen!);
  if (msg.variant === 'three-check' || msg.variant === 'koth') pos.applyVariant(msg.variant);
  if (replay) pos.playUciMoves(msg.moves ?? []);
  return pos;
}

self.onmessage = async (event: MessageEvent<Req>) => {
  const msg = event.data;
  try {
    switch (msg.t) {
      case 'cancel': {
        const job = jobs.get(msg.cancelId!);
        if (job) job.cancelled = true;
        break;
      }
      case 'clear': {
        for (const job of jobs.values()) job.cancelled = true;
        resetTable(); tt.clear(); lastGameId = msg.gameId ?? '';
        break;
      }
      case 'search': {
        if (msg.gameId !== lastGameId) { resetTable(); tt.clear(); lastGameId = msg.gameId ?? ''; }
        const decision = botMove(position(msg), msg.style!, msg.seed, (progress) => post({ t: 'search-progress', id: msg.id, ...progress }));
        post({ t: 'search-result', id: msg.id, ...decision });
        break;
      }
      case 'eval-draw': {
        const result = new Searcher(tt).search(position(msg), { maxDepth: 4, softMs: 400 });
        const bot = botById(msg.botId ?? 'club');
        let accept = Math.abs(result.score) < 60;
        if (bot && (bot.id === 'rookie' || bot.id === 'apprentice') && Math.abs(result.score) < 150) accept = Math.random() < 0.4;
        post({ t: 'eval-draw-result', id: msg.id, accept, scoreCp: result.score });
        break;
      }
      case 'analyze-game':
      case 'analyze-review': {
        const job = { cancelled: false }; jobs.set(msg.id!, job);
        const pos = position(msg, false), moves = msg.moves ?? [];
        const losses: number[] = [], bests: (string | null)[] = [];
        for (const uci of moves) {
          if (job.cancelled) throw new DOMException('Analysis cancelled', 'AbortError');
          const q = analyzeMoveQuality(pos, uci, Math.max(1, Math.min(10, msg.depth ?? 6)), 500);
          losses.push(Math.min(600, q.lossCp)); bests.push(q.lossCp > 0 ? q.bestUci : null);
          pos.playUci(uci);
          post({ t: msg.t === 'analyze-review' ? 'analyze-review-progress' : 'analyze-progress', id: msg.id, done: losses.length, total: moves.length });
          await yieldWorker();
        }
        if (job.cancelled) throw new DOMException('Analysis cancelled', 'AbortError');
        post({ t: `${msg.t}-result`, id: msg.id, losses, bests });
        break;
      }
      case 'eval': {
        post({ t: 'eval-result', id: msg.id, cp: evaluateWhiteCp(Position.fromFen(msg.fen!), 'full') });
        break;
      }
      case 'analyze-move': {
        const q = analyzeMoveQuality(Position.fromFen(msg.fen!), msg.uci!, Math.max(1, Math.min(10, msg.depth ?? 8)), 500);
        post({ t: 'analyze-move-result', id: msg.id, lossCp: q.lossCp, bestUci: q.bestUci, bestScore: q.bestScore });
        break;
      }
    }
  } catch (error) {
    post({ t: 'error', id: msg.id ?? -1, message: error instanceof Error ? error.message : String(error), cancelled: error instanceof Error && error.name === 'AbortError' });
  } finally {
    if (msg.id !== undefined) jobs.delete(msg.id);
  }
};
