import type { LessonStage } from './lessons';

export interface LessonProgress {
  lessonId: string;
  studied: boolean;
  practices: number;
  recalls: number;
  cleanRecalls: number;
  streak: number;
  lastPlayedAt: number;
  dueAt: number | null;
}

const DAY = 86_400_000;
const INTERVALS = [1, 3, 7, 14, 30];
const count = (value: unknown): number => typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(1_000_000, Math.floor(value))) : 0;
const timestamp = (value: unknown): number => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 8.64e15 ? value : 0;

export function normaliseEducation(value: unknown): LessonProgress[] {
  if (!Array.isArray(value)) return [];
  const rows = new Map<string, LessonProgress>();
  for (const entry of value.slice(0, 500)) {
    if (!entry || typeof entry !== 'object') continue;
    const row = entry as Record<string, unknown>;
    if (typeof row.lessonId !== 'string' || !/^[a-z0-9-]{1,80}$/.test(row.lessonId)) continue;
    rows.set(row.lessonId, {
      lessonId: row.lessonId,
      studied: row.studied === true,
      practices: count(row.practices),
      recalls: count(row.recalls),
      cleanRecalls: count(row.cleanRecalls),
      streak: Math.min(count(row.streak), INTERVALS.length),
      lastPlayedAt: timestamp(row.lastPlayedAt),
      dueAt: row.dueAt === null || !timestamp(row.dueAt) ? null : timestamp(row.dueAt),
    });
  }
  return [...rows.values()];
}

export function recordLesson(
  previous: LessonProgress | undefined,
  lessonId: string,
  stage: LessonStage,
  clean: boolean,
  now = Date.now(),
): LessonProgress {
  const next: LessonProgress = {
    lessonId, studied: false, practices: 0, recalls: 0, cleanRecalls: 0, streak: 0,
    lastPlayedAt: now, dueAt: null, ...previous,
  };
  next.lastPlayedAt = now;
  if (stage === 'study') next.studied = true;
  if (stage === 'practice') next.practices++;
  if (stage === 'recall') {
    next.recalls++;
    if (clean) {
      next.cleanRecalls++;
      // Early replays do not advance the spacing or postpone a scheduled review.
      if (next.dueAt === null || now >= next.dueAt || next.streak === 0) {
        next.streak = Math.min(INTERVALS.length, next.streak + 1);
        next.dueAt = now + INTERVALS[next.streak - 1]! * DAY;
      }
    } else {
      next.streak = 0;
      next.dueAt = now + 10 * 60_000;
    }
  }
  return next;
}

export function reviewLabel(dueAt: number | null, now = Date.now()): string {
  if (dueAt === null) return 'Not tested yet';
  const remaining = dueAt - now;
  if (remaining <= 0) return 'Ready to review';
  if (remaining < 60 * 60_000) return `Review in ${Math.ceil(remaining / 60_000)} min`;
  if (remaining < 22 * 60 * 60_000) return `Review in ${Math.ceil(remaining / (60 * 60_000))} hours`;
  const days = Math.round(remaining / DAY);
  return days === 1 ? 'Review tomorrow' : `Review in ${days} days`;
}
