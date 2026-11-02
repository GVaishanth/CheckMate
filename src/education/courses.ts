import { LESSONS } from './lessons';
import type { Lesson, LessonKind, LessonStage } from './lessons';
import type { LessonProgress } from './progress';

export interface CourseLevel {
  number: number;
  title: string;
  description: string;
  lessons: Lesson[];
  completed: number;
  recalled: number;
  completionTarget: number;
  recallTarget: number;
  unlocked: boolean;
  cleared: boolean;
}

const OPENING_LEVELS = [
  ['A sound start', 'Centre, development and a safe king.'],
  ['Open games & initiative', 'Open files, gambits and development with tempo.'],
  ['The Spanish & its neighbours', 'Bishop pressure, central tension and timely exchanges.'],
  ['French & Caro–Kann', 'Read pawn chains and choose the right central break.'],
  ['The Sicilian family', 'Recognise the structures behind Black’s counterplay.'],
  ['Queen’s-pawn structures', 'Gambits, the Slav family and central pawn tension.'],
  ['Indian defences', 'Fianchettos, pins and counterattacks against a big centre.'],
  ['Flank openings', 'Build from the wings without surrendering the centre.'],
  ['Gambits & active systems', 'Weigh development, space and the price of a pawn.'],
  ['Flexible & fighting defences', 'Meet the unexpected with a coherent development plan.'],
];
const MATE_LEVELS = [
  ['Spot the finish', 'Recognise a closed king cage and give the final check.'],
  ['Knights around the king', 'Use jumps, protected rooks and blocked escape squares.'],
  ['Bishop & rook nets', 'Combine a checking line with control of the flight squares.'],
  ['Queen cages', 'Recognise dovetail, swallow’s-tail and epaulette patterns.'],
  ['Teamwork', 'Coordinate knights, bishops, pawns and rooks around the king.'],
  ['Edge-of-board technique', 'Use waiting moves, opposition and the rook ladder.'],
  ['Sacrifice & clearance', 'Give something up or move it away to force the finish.'],
  ['Promotion finishes', 'Choose the right new piece, including a knight underpromotion.'],
  ['Special-move mates', 'Find castling, en passant and double-check finishes.'],
  ['Calculate the whole net', 'Solve full-board combinations with a forced mate in three.'],
];

export const topicCompleted = (row: LessonProgress | undefined): boolean => (row?.practices ?? 0) > 0;
export const topicRecalled = (row: LessonProgress | undefined): boolean => topicCompleted(row) && (row?.cleanRecalls ?? 0) > 0;

export function courseLevels(kind: LessonKind, progress: LessonProgress[]): CourseLevel[] {
  const records = new Map(progress.map((row) => [row.lessonId, row]));
  let previousCleared = true;
  return (kind === 'opening' ? OPENING_LEVELS : MATE_LEVELS).map(([title, description], index) => {
    const number = index + 1;
    const lessons = LESSONS.filter((lesson) => lesson.kind === kind && lesson.courseLevel === number);
    const completed = lessons.filter((lesson) => topicCompleted(records.get(lesson.id))).length;
    const recalled = lessons.filter((lesson) => topicRecalled(records.get(lesson.id))).length;
    const completionTarget = Math.ceil(lessons.length * 0.8);
    const recallTarget = Math.ceil(lessons.length * 0.5);
    const unlocked = previousCleared;
    const cleared = unlocked && lessons.length > 0 && completed >= completionTarget && recalled >= recallTarget;
    previousCleared = cleared;
    return { number, title, description, lessons, completed, recalled, completionTarget, recallTarget, unlocked, cleared };
  });
}

export function levelLockReason(levels: CourseLevel[], number: number): string | undefined {
  if (levels.find((level) => level.number === number)?.unlocked) return undefined;
  const current = levels.find((level) => level.unlocked && !level.cleared);
  if (!current) return undefined;
  const practices = Math.max(0, current.completionTarget - current.completed);
  const recalls = Math.max(0, current.recallTarget - current.recalled);
  const remaining = [
    practices ? `complete ${practices} more distinct ${practices === 1 ? 'topic' : 'topics'} in Practice` : '',
    recalls ? `finish unaided Recall on ${recalls} more completed ${recalls === 1 ? 'topic' : 'topics'}` : '',
  ].filter(Boolean).join(' and ');
  return `Level ${number} is locked. In Level ${current.number}, ${remaining}. Levels unlock in order.`;
}

export function lessonAccessible(lesson: Lesson, progress: LessonProgress[]): boolean {
  return courseLevels(lesson.kind, progress)[lesson.courseLevel - 1]?.unlocked ?? false;
}

export function courseRecommendation(kind: LessonKind, progress: LessonProgress[], skipId?: string): { lesson: Lesson; stage: LessonStage } | undefined {
  const records = new Map(progress.map((row) => [row.lessonId, row]));
  const levels = courseLevels(kind, progress);
  const current = levels.find((level) => level.unlocked && !level.cleared);
  const pool = current?.lessons ?? levels.filter((level) => level.unlocked).flatMap((level) => level.lessons);
  const eligible = pool.filter((lesson) => lesson.id !== skipId);
  const unfinished = eligible.find((lesson) => !topicCompleted(records.get(lesson.id)));
  if (unfinished) return { lesson: unfinished, stage: records.get(unfinished.id)?.studied ? 'practice' : 'study' };
  const recall = eligible.find((lesson) => !topicRecalled(records.get(lesson.id)));
  if (recall) return { lesson: recall, stage: 'recall' };
  const fallback = eligible[0];
  return fallback ? { lesson: fallback, stage: 'recall' } : undefined;
}

export const courseLink = (kind: LessonKind, level: number): string => `/learn?category=${kind}&level=${level}`;
