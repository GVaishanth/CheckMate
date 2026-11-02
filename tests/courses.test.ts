import { describe, expect, it } from 'vitest';
import { LESSONS, lessonById } from '../src/education/lessons';
import type { Lesson, LessonKind } from '../src/education/lessons';
import { courseLevels, levelLockReason, courseLink, courseRecommendation, lessonAccessible, topicCompleted, topicRecalled } from '../src/education/courses';
import { recordLesson } from '../src/education/progress';
import type { LessonProgress } from '../src/education/progress';
import { lessonMoveSide, lessonMoveNumber, lessonPosition } from '../src/education/position';
import { assessMate } from '../src/education/mate';
import { Position } from '../src/chess/position';

const kinds: LessonKind[] = ['opening', 'checkmate'];
const completed = (lesson: Lesson, clean = false): LessonProgress => {
  const row = recordLesson(undefined, lesson.id, 'practice', true, 1000);
  return clean ? recordLesson(row, lesson.id, 'recall', true, 2000) : row;
};
function clearLevels(kind: LessonKind, through: number): LessonProgress[] {
  return courseLevels(kind, []).filter((level) => level.number <= through).flatMap((level) => level.lessons.slice(0, level.completionTarget).map((lesson, index) => completed(lesson, index < level.recallTarget)));
}

describe('course catalogue', () => {
  it.each(kinds)('%s has ten ordered levels of twelve topics', (kind) => {
    const levels = courseLevels(kind, []);
    expect(levels).toHaveLength(10);
    expect(levels.map((level) => level.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(levels.flatMap((level) => level.lessons)).toHaveLength(120);
    for (const level of levels) {
      expect(level.lessons).toHaveLength(12);
      expect(level.completionTarget).toBe(10);
      expect(level.recallTarget).toBe(6);
      expect(level.lessons.every((lesson) => lesson.kind === kind && lesson.courseLevel === level.number)).toBe(true);
      expect(level.title.length).toBeGreaterThan(6);
      expect(level.description.length).toBeGreaterThan(15);
    }
  });
  it('assigns every lesson to a real level and preserves the original lesson IDs', () => {
    expect(LESSONS).toHaveLength(240);
    for (const lesson of LESSONS) expect(lesson.courseLevel >= 1 && lesson.courseLevel <= 10).toBe(true);
    for (const id of ['italian-game', 'london-system', 'scotch-game', 'queens-gambit', 'caro-kann', 'french-advance', 'sicilian-classical', 'ruy-lopez', 'kings-indian', 'scandinavian', 'back-rank', 'supported-queen', 'smothered-mate', 'ladder-mate', 'arabian-mate', 'anastasia-mate', 'queen-and-king', 'rook-and-king']) expect(lessonById(id)).toBeDefined();
  });
  it('has distinct opening lines and distinct mating positions, not duplicate IDs for the same drill', () => {
    const openings = LESSONS.filter((lesson) => lesson.kind === 'opening');
    const mates = LESSONS.filter((lesson) => lesson.kind === 'checkmate');
    expect(new Set(openings.map((lesson) => lesson.steps.map((step) => step.uci).join(' '))).size).toBe(openings.length);
    expect(new Set(mates.map((lesson) => lesson.startFen.split(' ').slice(0, 4).join(' '))).size).toBe(mates.length);
    expect(mates.filter((lesson) => lesson.side === 'black').length).toBeGreaterThanOrEqual(40);
  });
  it('keeps practice credit separate from study and unaided recall', () => {
    const lesson = LESSONS[0]!;
    const study = recordLesson(undefined, lesson.id, 'study', true);
    expect(topicCompleted(study)).toBe(false);
    expect(topicRecalled(study)).toBe(false);
    const recallOnly = recordLesson(study, lesson.id, 'recall', true);
    expect(topicCompleted(recallOnly)).toBe(false);
    expect(topicRecalled(recallOnly)).toBe(false);
    const practice = recordLesson(recallOnly, lesson.id, 'practice', false);
    expect(topicCompleted(practice)).toBe(true);
    expect(topicRecalled(practice)).toBe(true);
    expect(topicCompleted(undefined)).toBe(false);
  });
});

describe.each(kinds)('%s level gates', (kind) => {
  const first = courseLevels(kind, [])[0]!;
  it('opens only the first level for a new learner', () => {
    expect(courseLevels(kind, []).map((level) => level.unlocked)).toEqual([true, false, false, false, false, false, false, false, false, false]);
    for (const lesson of LESSONS.filter((lesson) => lesson.kind === kind)) expect(lessonAccessible(lesson, [])).toBe(lesson.courseLevel === 1);
  });
  it('explains a locked level with both remaining thresholds', () => {
    const levels = courseLevels(kind, []);
    expect(levelLockReason(levels, 1)).toBeUndefined();
    expect(levelLockReason(levels, 2)).toBe('Level 2 is locked. In Level 1, complete 10 more distinct topics in Practice and finish unaided Recall on 6 more completed topics. Levels unlock in order.');
    expect(levels[1]!.unlocked).toBe(false);
  });
  it('explains only the still-missing recalls when practice is sufficient', () => {
    const rows = first.lessons.slice(0, 10).map((lesson, index) => completed(lesson, index < 5));
    const reason = levelLockReason(courseLevels(kind, rows), 2)!;
    expect(reason).toContain('finish unaided Recall on 1 more completed topic.');
    expect(reason).not.toContain('in Practice');
  });
  it('explains only the still-missing practice topics when recalls are sufficient', () => {
    const rows = first.lessons.slice(0, 9).map((lesson, index) => completed(lesson, index < 6));
    const reason = levelLockReason(courseLevels(kind, rows), 2)!;
    expect(reason).toContain('complete 1 more distinct topic in Practice.');
    expect(reason).not.toContain('finish unaided Recall');
  });
  it('points at the earliest unfinished level rather than bypassing prerequisites', () => {
    const reason = levelLockReason(courseLevels(kind, clearLevels(kind, 1)), 10)!;
    expect(reason).toContain('Level 10 is locked. In Level 2,');
  });
  it('removes the explanation immediately after the actual thresholds are met', () => {
    const levels = courseLevels(kind, clearLevels(kind, 1));
    expect(levelLockReason(levels, 2)).toBeUndefined();
    expect(levelLockReason(courseLevels(kind, clearLevels(kind, 10)), 10)).toBeUndefined();
  });
  it('does not unlock from study completions alone', () => {
    const rows = first.lessons.map((lesson) => recordLesson(undefined, lesson.id, 'study', true));
    expect(courseLevels(kind, rows)[0]).toMatchObject({ completed: 0, recalled: 0, cleared: false });
    expect(courseLevels(kind, rows)[1]!.unlocked).toBe(false);
  });
  it('requires both the exact completion threshold and the exact recall threshold', () => {
    const belowCompletion = first.lessons.slice(0, 9).map((lesson, index) => completed(lesson, index < 6));
    expect(courseLevels(kind, belowCompletion)[1]!.unlocked).toBe(false);
    const belowRecall = first.lessons.slice(0, 10).map((lesson, index) => completed(lesson, index < 5));
    expect(courseLevels(kind, belowRecall)[1]!.unlocked).toBe(false);
    const atThreshold = first.lessons.slice(0, 10).map((lesson, index) => completed(lesson, index < 6));
    expect(courseLevels(kind, atThreshold)[0]).toMatchObject({ completed: 10, recalled: 6, cleared: true });
    expect(courseLevels(kind, atThreshold)[1]!.unlocked).toBe(true);
    expect(courseLevels(kind, atThreshold)[2]!.unlocked).toBe(false);
  });
  it('does not multiply credit for repeating one topic or importing duplicate records', () => {
    let row = completed(first.lessons[0]!, true);
    for (let i = 0; i < 20; i++) row = recordLesson(recordLesson(row, row.lessonId, 'practice', true), row.lessonId, 'recall', true);
    const state = courseLevels(kind, Array.from({ length: 20 }, () => row));
    expect(state[0]).toMatchObject({ completed: 1, recalled: 1, cleared: false });
    expect(state[1]!.unlocked).toBe(false);
  });
  it('does not count assisted recalls towards unlocking', () => {
    const rows = first.lessons.map((lesson) => recordLesson(completed(lesson), lesson.id, 'recall', false));
    expect(courseLevels(kind, rows)[0]).toMatchObject({ completed: 12, recalled: 0, cleared: false });
  });
  it('does not use recalls from uncompleted topics as level credit', () => {
    const rows = first.lessons.map((lesson) => recordLesson(undefined, lesson.id, 'recall', true));
    expect(courseLevels(kind, rows)[0]).toMatchObject({ completed: 0, recalled: 0, cleared: false });
  });
  it('keeps an earned unlock after a later assisted review', () => {
    const rows = clearLevels(kind, 1).map((row) => recordLesson(row, row.lessonId, 'recall', false));
    expect(courseLevels(kind, rows)[1]!.unlocked).toBe(true);
    expect(rows.every((row) => row.streak === 0)).toBe(true);
  });
  it('does not let future-level progress bypass the preceding level', () => {
    const later = clearLevels(kind, 10).filter((row) => lessonById(row.lessonId)!.courseLevel > 1);
    expect(courseLevels(kind, later).slice(1).every((level) => !level.unlocked && !level.cleared)).toBe(true);
    expect(courseRecommendation(kind, later)?.lesson.courseLevel).toBe(1);
  });
  it('ignores unknown lesson records when calculating thresholds', () => {
    const unknown = Array.from({ length: 50 }, (_, index) => recordLesson(undefined, `unknown-${index}`, 'practice', true));
    expect(courseLevels(kind, unknown)[0]).toMatchObject({ completed: 0, recalled: 0 });
  });
  it.each([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])('unlocks sequentially after clearing %i levels', (through) => {
    const rows = clearLevels(kind, through), states = courseLevels(kind, rows);
    expect(states.filter((level) => level.cleared)).toHaveLength(through);
    expect(states.filter((level) => level.unlocked)).toHaveLength(Math.min(10, through + 1));
    expect(LESSONS.filter((lesson) => lesson.kind === kind && lessonAccessible(lesson, rows)).every((lesson) => lesson.courseLevel <= through + 1)).toBe(true);
  });
  it('keeps the two tracks independent', () => {
    const other: LessonKind = kind === 'opening' ? 'checkmate' : 'opening';
    expect(courseLevels(kind, clearLevels(other, 10))[1]!.unlocked).toBe(false);
  });
  it('recommends practice after study, then recalls after all practices', () => {
    const lesson = first.lessons[0]!;
    expect(courseRecommendation(kind, [])).toMatchObject({ lesson: { id: lesson.id }, stage: 'study' });
    expect(courseRecommendation(kind, [recordLesson(undefined, lesson.id, 'study', true)])).toMatchObject({ lesson: { id: lesson.id }, stage: 'practice' });
    const rows = first.lessons.map((item) => completed(item));
    expect(courseRecommendation(kind, rows)?.stage).toBe('recall');
    expect(courseRecommendation(kind, rows, lesson.id)?.lesson.id).not.toBe(lesson.id);
  });
  it('recommends the newly unlocked level, never a locked lesson', () => {
    const rows = clearLevels(kind, 1), next = courseRecommendation(kind, rows)!;
    expect(next.lesson.courseLevel).toBe(2);
    expect(lessonAccessible(next.lesson, rows)).toBe(true);
  });
  it('returns to optional unfinished topics once every level is cleared', () => {
    const rows = clearLevels(kind, 10), next = courseRecommendation(kind, rows)!;
    expect(next.lesson.courseLevel).toBe(1);
    expect(rows.some((row) => row.lessonId === next.lesson.id)).toBe(false);
    expect(lessonAccessible(next.lesson, rows)).toBe(true);
  });
});

describe('expanded mating techniques', () => {
  it('requires the knight underpromotion instead of auto-queening', () => {
    const fen = lessonById('knight-promotion-mate')!.startFen;
    expect(assessMate({ type: 'verify', fen, movesLeft: 1, uci: 'g7g8q' }).status).toBe('rejected');
    expect(assessMate({ type: 'verify', fen, movesLeft: 1, uci: 'g7g8n' })).toMatchObject({ status: 'accepted', complete: true });
  });
  it('distinguishes a stalemating queen promotion from the winning rook promotion', () => {
    const fen = lessonById('rook-promotion-stalemate')!.startFen;
    const position = Position.fromFen(fen);
    position.playUci('c7c8q');
    expect(position.isStalemate()).toBe(true);
    expect(assessMate({ type: 'verify', fen, movesLeft: 2, uci: 'c7c8q' }).status).toBe('rejected');
    expect(assessMate({ type: 'verify', fen, movesLeft: 2, uci: 'c7c8r' })).toMatchObject({ status: 'accepted', complete: false });
  });
  it.each(['castling-mate', 'castling-mate-new-angle', 'en-passant-mate', 'en-passant-double-check', 'legal-mate'])('%s demonstrates a real legal mating finish', (id) => {
    const lesson = lessonById(id)!;
    expect(lessonPosition(lesson, lesson.steps.length).isCheckmate()).toBe(true);
    expect(assessMate({ type: 'verify', fen: lesson.startFen, movesLeft: lesson.mateIn!, uci: lesson.steps[0]!.uci }).status).toBe('accepted');
  });
  it.each(LESSONS.filter((lesson) => lesson.id.startsWith('mate-calculation-')))('$id genuinely requires three moves, not a hidden mate in one or two', (lesson) => {
    expect(assessMate({ type: 'hint', fen: lesson.startFen, movesLeft: 2 }).status).toBe('rejected');
    expect(lesson.steps).toHaveLength(5);
  });
  it('labels Black-first demonstrations and move numbers correctly', () => {
    const lesson = lessonById('ladder-mate-black')!;
    expect(lessonMoveSide(lesson, 0)).toBe('black');
    expect(lessonMoveSide(lesson, 1)).toBe('white');
    expect(lessonMoveSide(lesson, 2)).toBe('black');
    expect(lessonMoveNumber(lesson, 0)).toBe(1);
    expect(lessonMoveNumber(lesson, 1)).toBe(2);
    expect(lessonMoveNumber(lesson, 2)).toBe(2);
    expect(lessonMoveSide(lessonById('caro-kann')!, 0)).toBe('white');
  });
  it('returns to the correct track and level from a lesson', () => {
    expect(courseLink('checkmate', 7)).toBe('/learn?category=checkmate&level=7');
    expect(courseLink('opening', 1)).toBe('/learn?category=opening&level=1');
  });
});
