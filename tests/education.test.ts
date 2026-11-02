import { beforeEach, describe, expect, it } from 'vitest';
import { LESSONS, lessonById } from '../src/education/lessons';
import { lessonNotation, lessonPosition, openingMoveMatches } from '../src/education/position';
import { assessMate } from '../src/education/mate';
import { normaliseEducation, recordLesson, reviewLabel } from '../src/education/progress';
import { Position } from '../src/chess/position';
import { WHITE, START_FEN } from '../src/chess/constants';
import { clearAll, educationRepo, exportAll, importAll, put } from '../src/storage/db';

const openings = LESSONS.filter((lesson) => lesson.kind === 'opening');
const mates = LESSONS.filter((lesson) => lesson.kind === 'checkmate');
const DAY = 86_400_000;

describe('education lessons', () => {
  it('contains 120 openings and 120 distinct mating exercises', () => {
    expect(openings).toHaveLength(120);
    expect(mates).toHaveLength(120);
    expect(new Set(LESSONS.map((lesson) => lesson.id)).size).toBe(LESSONS.length);
    expect(lessonById('missing')).toBeUndefined();
  });
  it.each(LESSONS)('$id has a legal, annotated demonstration', (lesson) => {
    const position = Position.fromFen(lesson.startFen);
    expect(position.inCheck(position.stm === WHITE ? 1 : 0)).toBe(false);
    expect(lesson.ideas).toHaveLength(3);
    expect(lesson.remember.length).toBeGreaterThan(12);
    expect(lesson.watchOut.length).toBeGreaterThan(12);
    for (const step of lesson.steps) {
      expect(step.note.length).toBeGreaterThan(10);
      expect(position.uciToMove(step.uci), `${lesson.id}: ${step.uci}`).not.toBeNull();
      position.playUci(step.uci);
    }
    expect(lessonNotation(lesson)).toHaveLength(lesson.steps.length);
    expect(lessonPosition(lesson, lesson.steps.length).fen()).toBe(position.fen());
    if (lesson.kind === 'checkmate') expect(position.isCheckmate()).toBe(true);
    else {
      expect(lesson.startFen).toBe(START_FEN);
      expect(position.isCheckmate()).toBe(false);
    }
  });
  it.each(openings)('$id validates the taught opening one move at a time', (lesson) => {
    lesson.steps.forEach((step, ply) => expect(openingMoveMatches(lesson, ply, step.uci)).toBe(true));
    expect(openingMoveMatches(lesson, 0, 'e2e5')).toBe(false);
    expect(openingMoveMatches(lesson, lesson.steps.length, 'a1a1')).toBe(false);
  });
  it('distinguishes a legal alternative from the taught opening move', () => {
    expect(openingMoveMatches(openings[0]!, 0, 'd2d4')).toBe(false);
    expect(openingMoveMatches(openings[0]!, 0, 'e2e4')).toBe(true);
  });
});

describe('forced-mate exercises', () => {
  it.each(mates)('$id is forced against every defence, not just the demonstration', (lesson) => {
    const position = Position.fromFen(lesson.startFen);
    let finished = false;
    for (let remaining = lesson.mateIn!; remaining > 0; remaining--) {
      const hint = assessMate({ type: 'hint', fen: position.fen(), movesLeft: remaining });
      expect(hint.status).toBe('accepted');
      expect(hint.hint).toBeDefined();
      const answer = assessMate({ type: 'verify', fen: position.fen(), movesLeft: remaining, uci: hint.hint });
      expect(answer.status).toBe('accepted');
      position.playUci(hint.hint!);
      if (answer.complete) { finished = true; break; }
      expect(answer.reply).toBeDefined();
      position.playUci(answer.reply!);
    }
    expect(finished).toBe(true);
    expect(position.isCheckmate()).toBe(true);
  });
  it('accepts an alternative winning route after a different defence', () => {
    const lesson = lessonById('queen-and-king')!;
    const position = Position.fromFen(lesson.startFen);
    position.playUciMoves(['c5d6', 'd8c8']);
    expect(assessMate({ type: 'verify', fen: position.fen(), movesLeft: 2, uci: 'h1b1' }).status).toBe('accepted');
    expect(lesson.steps[2]!.uci).not.toBe('h1b1');
  });
  it('rejects a legal move which misses mate in one', () => {
    expect(assessMate({ type: 'verify', fen: lessonById('back-rank')!.startFen, movesLeft: 1, uci: 'e1e2' }).status).toBe('rejected');
  });
  it('rejects a stalemate instead of celebrating a win', () => {
    const fen = 'k7/2Q5/2K5/8/8/8/8/8 w - - 0 1';
    const position = Position.fromFen(fen);
    position.playUci('c7b6');
    expect(position.isStalemate()).toBe(true);
    expect(assessMate({ type: 'verify', fen, movesLeft: 1, uci: 'c7b6' }).status).toBe('rejected');
  });
  it('handles black-to-move mating exercises correctly', () => {
    const fen = '4r1k1/8/8/8/8/8/5PPP/6K1 b - - 0 1';
    expect(assessMate({ type: 'verify', fen, movesLeft: 1, uci: 'e8e1' })).toMatchObject({ status: 'accepted', complete: true });
  });
  it('returns a bounded-check result rather than guessing when its budget runs out', () => {
    const result = assessMate({ type: 'hint', fen: lessonById('queen-and-king')!.startFen, movesLeft: 3 }, { maxNodes: 1 });
    expect(result.status).toBe('limit');
  });
  it('rejects malformed requests without throwing', () => {
    expect(assessMate({ type: 'hint', fen: 'broken', movesLeft: 2 }).status).toBe('error');
    expect(assessMate({ type: 'hint', fen: START_FEN, movesLeft: 99 }).status).toBe('error');
  });
});

describe('learning and spaced recall', () => {
  const now = 1_800_000_000_000;
  it('records study and practice without claiming recall', () => {
    const studied = recordLesson(undefined, 'italian-game', 'study', true, now);
    const practised = recordLesson(studied, 'italian-game', 'practice', true, now);
    expect(practised).toMatchObject({ studied: true, practices: 1, recalls: 0, cleanRecalls: 0, dueAt: null });
  });
  it('spaces successful reviews to 1, 3, 7, 14 and 30 days', () => {
    let time = now;
    let row = recordLesson(undefined, 'italian-game', 'recall', true, time);
    expect(row.dueAt).toBe(time + DAY);
    for (const interval of [3, 7, 14, 30, 30]) {
      time = row.dueAt!;
      row = recordLesson(row, 'italian-game', 'recall', true, time);
      expect(row.dueAt).toBe(time + interval * DAY);
    }
  });
  it('does not inflate spacing by replaying repeatedly before a review is due', () => {
    const first = recordLesson(undefined, 'back-rank', 'recall', true, now);
    const early = recordLesson(first, 'back-rank', 'recall', true, now + 1000);
    expect(early.streak).toBe(1);
    expect(early.dueAt).toBe(first.dueAt);
    expect(early.recalls).toBe(2);
  });
  it('schedules an assisted recall for a short retry, then restarts spacing', () => {
    const first = recordLesson(undefined, 'back-rank', 'recall', true, now);
    const assisted = recordLesson(first, 'back-rank', 'recall', false, now + 1000);
    expect(assisted).toMatchObject({ streak: 0, dueAt: now + 601_000, cleanRecalls: 1, recalls: 2 });
    const retry = recordLesson(assisted, 'back-rank', 'recall', true, now + 602_000);
    expect(retry.dueAt).toBe(now + 602_000 + DAY);
    expect(retry.streak).toBe(1);
  });
  it('normalises corrupt, duplicate and unbounded stored fields', () => {
    expect(normaliseEducation(null)).toEqual([]);
    const normal = normaliseEducation([null, {}, { lessonId: '<bad>' }, { lessonId: 'italian-game', studied: 'yes', practices: -4, recalls: Infinity, dueAt: 'tomorrow' }]);
    expect(normal).toHaveLength(1);
    expect(normal[0]).toMatchObject({ studied: false, practices: 0, recalls: 0, dueAt: null });
    expect(normaliseEducation([{ lessonId: 'back-rank' }, { lessonId: 'back-rank', practices: 3 }])).toHaveLength(1);
  });
  it('labels review times without showing negative or zero-minute countdowns', () => {
    expect(reviewLabel(null, now)).toBe('Not tested yet');
    expect(reviewLabel(now - 1, now)).toBe('Ready to review');
    expect(reviewLabel(now + 1, now)).toBe('Review in 1 min');
    expect(reviewLabel(now + DAY - 100, now)).toBe('Review tomorrow');
    expect(reviewLabel(now + 3 * DAY, now)).toBe('Review in 3 days');
  });
});

describe('education persistence and portability', () => {
  beforeEach(async () => { await clearAll(); });
  it('serialises rapid progress writes without losing completions', async () => {
    await Promise.all([educationRepo.record('italian-game', 'study'), educationRepo.record('italian-game', 'practice'), educationRepo.record('back-rank', 'recall')]);
    expect(await educationRepo.all()).toHaveLength(2);
    expect((await educationRepo.all()).find((row) => row.lessonId === 'italian-game')).toMatchObject({ studied: true, practices: 1 });
  });
  it('exports and imports learning progress with the existing data bundle', async () => {
    await educationRepo.record('back-rank', 'recall');
    const bundle = await exportAll();
    expect(bundle.education).toHaveLength(1);
    await clearAll();
    expect(await educationRepo.all()).toEqual([]);
    const counts = await importAll(bundle);
    expect(counts.education).toBe(1);
    expect(await educationRepo.all()).toEqual(bundle.education);
  });
  it('still imports older exports without education records', async () => {
    await educationRepo.record('back-rank', 'study');
    const bundle = await exportAll();
    delete bundle.education;
    await importAll(bundle);
    expect(await educationRepo.all()).toEqual([]);
  });
  it('merges education records when importing without wiping', async () => {
    await educationRepo.record('back-rank', 'study');
    const bundle = await exportAll();
    bundle.education = [recordLesson(undefined, 'italian-game', 'practice', true)];
    await importAll(bundle, { wipe: false });
    expect(await educationRepo.all()).toHaveLength(2);
  });
  it('self-heals malformed stored progress', async () => {
    await put('kv', { key: 'education:v1', value: 'broken' });
    expect(await educationRepo.all()).toEqual([]);
    await educationRepo.record('back-rank', 'study');
    expect(await educationRepo.all()).toHaveLength(1);
  });
});
