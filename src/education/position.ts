import { Position } from '../chess/position';
import { decodeMove, moveToUci } from '../chess/constants';
import { moveToSan } from '../chess/san';
import type { Lesson } from './lessons';

export function lessonPosition(lesson: Lesson, ply: number): Position {
  const position = Position.fromFen(lesson.startFen);
  position.playUciMoves(lesson.steps.slice(0, Math.max(0, ply)).map((step) => step.uci));
  return position;
}

export function lessonNotation(lesson: Lesson): string[] {
  const position = Position.fromFen(lesson.startFen);
  return lesson.steps.map(({ uci }) => {
    const encoded = position.uciToMove(uci);
    if (encoded === null) throw new Error(`Invalid lesson move: ${lesson.id} / ${uci}`);
    const san = moveToSan(position, decodeMove(encoded));
    position.makeMove(encoded);
    return san;
  });
}

export function sanForUci(position: Position, uci: string): string {
  const move = position.uciToMove(uci);
  return move === null ? uci : moveToSan(position, decodeMove(move));
}

export function openingMoveMatches(lesson: Lesson, ply: number, uci: string): boolean {
  const position = lessonPosition(lesson, ply);
  const move = position.uciToMove(uci);
  return move !== null && moveToUci(move) === lesson.steps[ply]?.uci;
}
