/** Engine benchmark: nodes/sec and depth reached within bot time budgets. */
import { Position } from '../src/chess/position';
import { Searcher } from '../src/engine/search';
import { TranspositionTable } from '../src/engine/tt';
import { moveToUci } from '../src/chess/constants';
import { evaluateFull } from '../src/engine/evaluate';

const positions: Array<[string, string]> = [
  ['startpos', 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'],
  ['middlegame', 'r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10'],
  ['tactical', 'r1bqk2r/pp2bppp/2n1pn2/3p4/3P4/2N1PN2/PP2BPPP/R1BQK2R w KQkq - 0 9'],
  ['endgame', '8/5pk1/6p1/7p/7P/6P1/5PK1/8 w - - 0 1'],
];

// Eval throughput.
{
  const pos = Position.fromFen(positions[1]![1]);
  const N = 200_000;
  const t0 = Date.now();
  let acc = 0;
  for (let i = 0; i < N; i++) acc += evaluateFull(pos);
  const ms = Date.now() - t0;
  console.log(`evaluateFull: ${(N / ms).toFixed(0)}k evals/sec (${(acc).toFixed(0)})`);
}

for (const [name, fen] of positions) {
  const tt = new TranspositionTable();
  const s = new Searcher(tt);
  const pos = Position.fromFen(fen);
  const t0 = Date.now();
  const r = s.search(pos, { maxDepth: 30, softMs: 1900 }, {
    onDepth: (d) => process.stdout.write(`  d${d.depth}(${(d.nodes / 1000).toFixed(0)}k) `),
  });
  console.log(`\n${name}: depth=${r.depth} nodes=${(r.nodes / 1000).toFixed(0)}k ms=${Date.now() - t0} nps=${(r.nodes / (Date.now() - t0)).toFixed(0)}k best=${moveToUci(r.bestMove)} score=${r.score.toFixed(0)}`);
}
