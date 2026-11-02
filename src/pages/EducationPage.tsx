import { ActionButton } from '../components/ActionButton';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { Board } from '../components/Board';
import type { BoardAnimate, Orientation } from '../components/Board';
import { IconFlip } from '../components/icons';
import { Position } from '../chess/position';
import {
  WHITE, FLAG_EN_PASSANT, colorOf, decodeMove, encodeMoveObj, fromAlgebraic, moveToUci,
} from '../chess/constants';
import type { PieceType } from '../chess/constants';
import { moveSoundName, sound } from '../audio/sound';
import { useSettings } from '../storage/settings';
import { useRegisterCommands } from '../game/commands';
import { useHotkeys } from '../game/hooks';
import { educationRepo, dbAvailable, dataRevision } from '../storage/db';
import { LESSONS, lessonById } from '../education/lessons';
import type { Lesson, LessonKind, LessonSide, LessonStage } from '../education/lessons';
import { lessonMoveSide, lessonMoveNumber, lessonNotation, lessonPosition, openingMoveMatches, sanForUci } from '../education/position';
import { reviewLabel } from '../education/progress';
import type { LessonProgress } from '../education/progress';
import { courseLevels, levelLockReason, courseLink, courseRecommendation, lessonAccessible, topicCompleted, topicRecalled } from '../education/courses';
import type { CourseLevel } from '../education/courses';
import { MateClient } from '../education/mateClient';

const STAGES: LessonStage[] = ['study', 'practice', 'recall'];
type RecordCompletion = (lessonId: string, stage: LessonStage, clean: boolean) => Promise<LessonProgress>;
const searchText = (text: string): string => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[–—-]/g, ' ').replace(/[’']/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

export function EducationPage() {
  const { lessonId } = useParams<{ lessonId: string }>();
  const [progress, setProgress] = useState<LessonProgress[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [persistent, setPersistent] = useState(true);
  const alive = useRef(true);
  const revision = useRef(dataRevision());
  useEffect(() => {
    alive.current = true;
    void educationRepo.all().then(async (rows) => {
      const available = await dbAvailable();
      if (alive.current) { setProgress(rows); setLoaded(true); setPersistent(available); }
    }).catch(() => {
      if (alive.current) { setLoaded(true); setPersistent(false); }
    });
    return () => { alive.current = false; };
  }, []);
  const record = useCallback<RecordCompletion>(async (id, stage, clean) => {
    const row = await educationRepo.record(id, stage, clean, revision.current);
    const available = await dbAvailable();
    if (alive.current) { setProgress((rows) => [...rows.filter((item) => item.lessonId !== id), row]); setPersistent(available); }
    return row;
  }, []);
  const lesson = lessonId ? lessonById(lessonId) : undefined;
  useEffect(() => { window.scrollTo({ top: 0, behavior: 'instant' }); }, [lessonId]);
  return (
    <div className="page learn-page">
      <div className="container">
        {!persistent && <p className="learn-storage-warning" role="status">Saving is unavailable. Lesson progress lasts for this session only.</p>}
        {!loaded ? <p className="muted" role="status">Loading your course…</p> : lessonId ? lesson ? (
          lessonAccessible(lesson, progress)
            ? <LessonView key={lesson.id} lesson={lesson} progress={progress} onComplete={record} />
            : <LockedLesson lesson={lesson} progress={progress} />
        ) : (
          <div className="empty">
            <h1 className="empty-title">Lesson not found</h1>
            <p className="muted">Choose an opening or a mating pattern from the library.</p>
            <Link to="/learn" className="btn btn-primary mt-16">Lesson library</Link>
          </div>
        ) : <LessonLibrary progress={progress} />}
      </div>
    </div>
  );
}

function LockedLesson({ lesson, progress }: { lesson: Lesson; progress: LessonProgress[] }) {
  const levels = courseLevels(lesson.kind, progress);
  const current = levels.find((level) => level.unlocked && !level.cleared)!;
  return (
    <section className="learn-locked panel" aria-labelledby="locked-lesson-title">
      <span className="learn-step-label">{lesson.kind === 'opening' ? 'Opening course' : 'Checkmate course'} · Level {lesson.courseLevel}</span>
      <h1 id="locked-lesson-title" className="page-title">This level is locked.</h1>
      <p><strong>{lesson.title}</strong> belongs to Level {lesson.courseLevel}. Clear Level {current.number} first, then work forward one level at a time.</p>
      <LevelProgress level={current} />
      <Link className="btn btn-primary" to={courseLink(lesson.kind, current.number)}>Continue Level {current.number} →</Link>
      <Link className="learn-back" to={courseLink(lesson.kind, current.number)}>← Lesson library</Link>
    </section>
  );
}

function LevelProgress({ level, compact = false }: { level: CourseLevel; compact?: boolean }) {
  return (
    <div className={`learn-level-progress${compact ? ' compact' : ''}`} aria-label={`Level ${level.number} requirements`}>
      <div className="learn-level-counts">
        {([
          [level.completed, level.completionTarget, 'Topics completed'],
          [level.recalled, level.recallTarget, 'Unaided recalls'],
        ] as const).map(([value, target, label]) => (
          <div key={label}>
            <div className="spread"><span><strong>{value} / {level.lessons.length}</strong> {label}</span><small>{target} needed {value >= target ? '✓' : ''}</small></div>
            <div className="learn-meter" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={target} aria-valuenow={Math.min(value, target)} aria-valuetext={`${value} of ${level.lessons.length}; ${target} required`}><span style={{ width: `${Math.min(100, 100 * value / Math.max(1, target))}%` }} /></div>
          </div>
        ))}
      </div>
      {!compact && <p>Practice completes a topic. To clear this level, complete <strong>{level.completionTarget} different topics</strong> and finish an unaided Recall on <strong>{level.recallTarget} of those topics</strong>. Unaided means no hints and no retries. Repeats do not add extra topic credit.</p>}
    </div>
  );
}

function LessonLibrary({ progress }: { progress: LessonProgress[] }) {
  const [params, setParams] = useSearchParams();
  const category: LessonKind = params.get('category') === 'checkmate' ? 'checkmate' : 'opening';
  const [query, setQuery] = useState('');
  const [onlyDue, setOnlyDue] = useState(false);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  const courses = useMemo(() => ({ opening: courseLevels('opening', progress), checkmate: courseLevels('checkmate', progress) }), [progress]);
  const levels = courses[category];
  const requestedLevel = Number(params.get('level'));
  const currentLevel = levels.find((level) => level.unlocked && !level.cleared) ?? levels[levels.length - 1]!;
  const selected = Number.isInteger(requestedLevel) && requestedLevel >= 1 && requestedLevel <= levels.length ? levels[requestedLevel - 1]! : currentLevel;
  const records = new Map(progress.filter((row) => lessonById(row.lessonId)).map((row) => [row.lessonId, row]));
  const known = [...records.values()];
  const accessible = (lesson: Lesson) => courses[lesson.kind][lesson.courseLevel - 1]!.unlocked;
  const due = known.filter((row) => row.dueAt !== null && row.dueAt <= now && accessible(lessonById(row.lessonId)!)).sort((a, b) => a.dueAt! - b.dueAt!);
  const dueHere = due.find((row) => lessonById(row.lessonId)!.kind === category);
  const recommendation = dueHere ? { lesson: lessonById(dueHere.lessonId)!, stage: 'recall' as const } : courseRecommendation(category, progress);
  const needle = searchText(query);
  const rows = LESSONS.filter((lesson) => lesson.kind === category
    && (needle ? searchText(`${lesson.title} ${lesson.summary} ${lesson.topic ?? ''} ${lesson.eco ?? ''} level ${lesson.courseLevel}`).includes(needle) : lesson.courseLevel === selected.number)
    && (!onlyDue || (accessible(lesson) && (records.get(lesson.id)?.dueAt ?? Infinity) <= now)));
  const chooseLevel = (level: number, kind = category) => {
    setParams({ category: kind, level: String(level) }, { replace: true }); setQuery(''); setOnlyDue(false);
  };
  const changeCategory = (kind: LessonKind) => chooseLevel(courses[kind].find((level) => level.unlocked && !level.cleared)?.number ?? levels.length, kind);
  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Education</div>
          <h1 className="page-title">Learn the idea. Play it back.</h1>
          <p className="page-sub">Openings and mating patterns, one level at a time. Study the idea, complete the topic, then prove what you remember.</p>
        </div>
        <span className="chip">{LESSONS.length} lessons · offline</span>
      </div>
      <section className="learn-intro panel" aria-label="Learning path">
        <div className="learn-path">
          <div><span>01</span><h2>Study</h2><p>See each move and why it works.</p></div>
          <div><span>02</span><h2>Practice</h2><p>Play the line. Complete the topic.</p></div>
          <div><span>03</span><h2>Recall</h2><p>Remember it unaided. Unlock more.</p></div>
        </div>
        <div className="learn-record" aria-live="polite">
          <div><strong>{known.filter(topicCompleted).length}</strong><span>Completed</span></div>
          <div><strong>{known.filter(topicRecalled).length}</strong><span>Recalled</span></div>
          <div><strong>{due.length}</strong><span>Due now</span></div>
        </div>
      </section>
      {recommendation && (
        <div className="learn-resume">
          <div><span className="tiny mono faint">{dueHere ? 'READY TO REVIEW' : 'NEXT IN YOUR COURSE'} · LEVEL {recommendation.lesson.courseLevel}</span><h2>{recommendation.lesson.title}</h2></div>
          <Link className="btn btn-primary btn-sm" to={`/learn/${recommendation.lesson.id}?stage=${recommendation.stage}`}>{dueHere ? 'Review now' : known.length ? 'Continue learning' : 'Start learning'} →</Link>
        </div>
      )}
      <div className="learn-library-tools">
        <div className="learn-category" role="group" aria-label="Lesson category">
          {(['opening', 'checkmate'] as const).map((kind) => <button key={kind} className="btn" aria-pressed={category === kind} onClick={() => changeCategory(kind)}>{kind === 'opening' ? 'Openings' : 'Checkmates'} <span>{LESSONS.filter((lesson) => lesson.kind === kind).length}</span></button>)}
        </div>
        <div className="learn-filters">
          <input className="input" type="search" aria-label="Search lessons" placeholder="Search all 10 levels" value={query} onChange={(event) => setQuery(event.target.value)} />
          <button className="btn btn-sm" aria-pressed={onlyDue} onClick={() => setOnlyDue((value) => !value)}>Due only</button>
        </div>
      </div>
      <nav className="learn-level-nav" aria-label="Course levels" tabIndex={0}>
        {levels.map((level) => <ActionButton key={level.number} className={selected.number === level.number ? 'active' : ''} aria-pressed={selected.number === level.number} blockedReason={levelLockReason(levels, level.number)} aria-label={`Level ${level.number}: ${level.title}. ${level.cleared ? 'Cleared' : level.unlocked ? 'Unlocked' : 'Locked'}`} onClick={() => chooseLevel(level.number)}><span>Level {String(level.number).padStart(2, '0')}</span><strong>{level.title}</strong><small>{level.cleared ? '✓ Cleared' : level.unlocked ? 'Unlocked' : 'Locked'}</small></ActionButton>)}
      </nav>
      <section className={`learn-level panel${selected.cleared ? ' is-cleared' : ''}`} aria-label={`Level ${selected.number} overview`}>
        <div className="spread learn-level-title"><div><span className="learn-step-label">{category === 'opening' ? 'Opening course' : 'Checkmate course'} · Level {selected.number} of {levels.length}</span><h2>{selected.title}</h2><p>{selected.description}</p></div><span className={`learn-badge${selected.cleared ? ' done' : ''}`}>{selected.cleared ? '✓ Level cleared' : selected.unlocked ? selected.completed || selected.recalled ? 'In progress' : 'Ready to start' : 'Locked'}</span></div>
        {selected.unlocked ? <><LevelProgress level={selected} />{selected.cleared && <p className="learn-level-unlocked">{selected.number < levels.length ? `Level ${selected.number + 1} is unlocked. You can still finish or review every topic here.` : 'Course cleared. Any remaining topics and every review stay available.'}</p>}</> : <div className="learn-level-lock"><p>Clear Level {currentLevel.number} first. Each level opens only after the previous one is cleared.</p><button className="btn btn-sm" onClick={() => chooseLevel(currentLevel.number)}>Continue Level {currentLevel.number} →</button></div>}
      </section>
      <details className="learn-primer">
        <summary>{category === 'opening' ? 'New to openings? Start with three ideas.' : 'What makes a position checkmate?'}</summary>
        {category === 'opening' ? <p>Control the centre, develop your knights and bishops, and get your king safe. These lessons teach selected lines, not every possible response. Remember the reason for a move rather than treating it as a rule for every game.</p> : <p>The king must be in check, with no legal escape, capture or blocking defence. A king with no legal move and no check is stalemated: a draw. Any move that forces mate within the exercise’s goal counts. Pattern variations let you practise from changed positions and from the other colour.</p>}
      </details>
      {needle && <p className="learn-search-count small muted">{rows.length} {rows.length === 1 ? 'match' : 'matches'} across all {levels.length} levels. Locked topics become playable as you progress.</p>}
      <div className="learn-grid" aria-label={category === 'opening' ? 'Opening lessons' : 'Checkmate lessons'}>
        {rows.map((lesson) => {
          const row = records.get(lesson.id), unlocked = accessible(lesson), completed = topicCompleted(row);
          const isDue = unlocked && row?.dueAt !== undefined && row.dueAt !== null && row.dueAt <= now;
          const status = !unlocked ? 'Locked' : completed ? '✓ Completed' : row?.cleanRecalls ? 'Recall logged' : row?.studied ? 'Studied' : row?.recalls ? 'In progress' : 'New';
          const content = <>
            <div className="spread"><span className="tiny mono faint">Level {lesson.courseLevel}{lesson.eco ? ` · ${lesson.eco}` : ''}</span><span className={`learn-badge${completed && unlocked ? ' done' : ''}`}>{status}</span></div>
            <h2>{lesson.title}</h2><p>{lesson.summary}</p>
            <div className="learn-card-meta"><span>{lesson.kind === 'opening' ? `${Math.ceil(lesson.steps.length / 2)} moves · either colour` : `Mate in ${lesson.mateIn} · ${lesson.side}`}</span><span>{!unlocked ? `Unlock Level ${lesson.courseLevel}` : isDue ? 'Review due' : row?.cleanRecalls ? 'Recalled unaided' : 'Study → Practice → Recall'}</span></div>
            <div className="learn-card-progress" role="img" aria-label={`Study ${row?.studied ? 'completed' : 'not completed'}, Practice ${completed ? 'completed' : 'not completed'}, Recall ${row?.cleanRecalls ? 'unaided' : 'not yet unaided'}`}><span className={row?.studied ? 'done' : ''} /><span className={completed ? 'done' : ''} /><span className={row?.cleanRecalls ? 'done' : ''} /></div>
          </>;
          const className = `learn-card${completed ? ' is-complete' : ''}${unlocked ? '' : ' is-locked'}`;
          return unlocked ? <Link to={`/learn/${lesson.id}`} key={lesson.id} className={className}>{content}</Link> : <article key={lesson.id} className={className}>{content}<ActionButton className="learn-locked-action" blockedReason={levelLockReason(courses[lesson.kind], lesson.courseLevel)} aria-label={`Why ${lesson.title} is locked`} /></article>;
        })}
      </div>
      {rows.length === 0 && <div className="empty"><h2 className="empty-title">{onlyDue ? 'No reviews due here' : 'No matching lessons'}</h2><p className="small muted">{onlyDue ? 'You can still rehearse an unlocked topic whenever you like.' : 'Try an opening name, a mating pattern or an ECO code.'}</p><button className="btn btn-sm mt-16" onClick={() => { setOnlyDue(false); setQuery(''); }}>Clear filters</button></div>}
      <details className="learn-primer learn-notation-key"><summary>Reading the moves</summary><p>K = king, Q = queen, R = rook, B = bishop, N = knight. A pawn uses just its destination, such as e4. x means capture, + means check, # means checkmate, O-O means kingside castling, and O-O-O means queenside castling. Tap a move in Study to see its position; no notation knowledge is needed to play.</p></details>
      <p className="tiny muted learn-storage-note">Progress stays in this browser and travels with Settings → Export data. Each track unlocks independently. A later assisted review does not remove an earned unlock. Recall reviews space out to 1, 3, 7, 14 and 30 days; help schedules a short retry.</p>
    </>
  );
}

function LessonView({ lesson, progress, onComplete }: { lesson: Lesson; progress: LessonProgress[]; onComplete: RecordCompletion }) {
  const [params, setParams] = useSearchParams();
  const rawStage = params.get('stage');
  const stage: LessonStage = rawStage === 'practice' || rawStage === 'recall' ? rawStage : 'study';
  const [side, setSide] = useState<LessonSide>(lesson.side);
  const [run, setRun] = useState(0);
  const row = progress.find((entry) => entry.lessonId === lesson.id);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, [stage]);
  const setStage = (next: LessonStage) => { sound.play('uiTick'); setParams({ stage: next }, { replace: true }); };
  return (
    <>
      <div className="learn-lesson-head"><Link to={courseLink(lesson.kind, lesson.courseLevel)} className="learn-back">← Lesson library</Link><span className="tiny muted">{row ? reviewLabel(row.dueAt) : `Level ${lesson.courseLevel}`}</span></div>
      <div className="page-head learn-heading">
        <div className="learn-title-block"><Link to={courseLink(lesson.kind, lesson.courseLevel)} className="learn-compact-back" aria-label="Back to lesson library">←</Link><div><div className="eyebrow">{lesson.kind === 'opening' ? 'Opening' : 'Mating pattern'} · Level {lesson.courseLevel}{topicCompleted(row) ? ' · ✓ Topic completed' : ''}</div><h1 ref={heading} tabIndex={-1} className="page-title">{lesson.title}</h1></div></div>
        <div className="learn-stages" role="group" aria-label="Lesson stage">
          {STAGES.map((item, index) => <button key={item} className="btn btn-sm" aria-pressed={item === stage} onClick={() => setStage(item)}><span aria-hidden="true">0{index + 1}</span>{item}{(item === 'study' ? row?.studied : item === 'practice' ? topicCompleted(row) : (row?.cleanRecalls ?? 0) > 0) ? <span className="learn-stage-done" aria-label="completed">✓</span> : null}</button>)}
        </div>
      </div>
      {stage === 'study' ? <StudySession key={`${lesson.id}-study-${run}`} lesson={lesson} onComplete={onComplete} onPractice={() => setStage('practice')} /> : <PracticeSession key={`${lesson.id}-${stage}-${side}-${run}`} lesson={lesson} side={side} stage={stage} progress={progress} onComplete={onComplete} onRestart={() => setRun((value) => value + 1)} onStudy={() => setStage('study')} onPractice={() => setStage('practice')} onRecall={() => setStage('recall')} onSideChange={setSide} />}
    </>
  );
}

function LessonBoard({
  position, version, orientation, onFlip, lastUci, animate, interactive = false, onMove, status, hintUci,
}: {
  position: Position; version: number; orientation: Orientation; onFlip: () => void;
  lastUci?: string; animate?: BoardAnimate | null; interactive?: boolean;
  onMove?: (from: number, to: number, promo: PieceType | null) => boolean;
  status: string; hintUci?: string;
}) {
  const { settings } = useSettings();
  useHotkeys({ f: () => { sound.play('uiTick'); onFlip(); } });
  useRegisterCommands([{ id: 'board-flip', label: 'Flip Board', group: 'Education', hint: 'F', run: onFlip }]);
  const highlighted = hintUci ?? lastUci;
  return (
    <>
      <div className="board-wrap">
        <Board position={position} version={version} orientation={orientation} interactive={interactive}
          selectable={(sq) => interactive && position.pieceAt(sq) !== 0 && colorOf(position.pieceAt(sq)) === position.stm}
          legalFor={(sq) => interactive ? position.movesFrom(sq) : []}
          onMove={onMove ?? (() => false)} onIllegal={() => sound.play('illegal')}
          lastMove={highlighted ? { from: fromAlgebraic(highlighted.slice(0, 2)), to: fromAlgebraic(highlighted.slice(2, 4)) } : null}
          checkSquare={position.inCheck() ? position.kingSquare(position.stm) : null}
          animate={animate} settings={{ ...settings, autoQueen: false }} label={`Lesson board. ${status}.`} />
        <div className="board-status">
          <span className={`turn-indicator${interactive ? ' active' : ''}`}><span className={`turn-dot ${position.stm === WHITE ? 'white' : 'black'}`} />{status}</span>
          <button className="tool-btn" onClick={() => { sound.play('uiTick'); onFlip(); }} aria-label="Flip lesson board"><IconFlip size={15} /></button>
        </div>
      </div>
    </>
  );
}

function StudySession({ lesson, onComplete, onPractice }: { lesson: Lesson; onComplete: RecordCompletion; onPractice: () => void }) {
  const { settings } = useSettings();
  const [ply, setPly] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [orientation, setOrientation] = useState<Orientation>(lesson.side);
  const [animate, setAnimate] = useState<BoardAnimate | null>(null);
  const position = useMemo(() => lessonPosition(lesson, ply), [lesson, ply]);
  const notation = useMemo(() => lessonNotation(lesson), [lesson]);
  const recorded = useRef(false);
  const total = lesson.steps.length;
  useEffect(() => {
    if (ply !== total || recorded.current) return;
    recorded.current = true;
    void onComplete(lesson.id, 'study', true);
  }, [ply, total, lesson.id, onComplete]);
  useEffect(() => {
    if (!playing) return;
    if (ply >= total) { setPlaying(false); return; }
    const timer = window.setTimeout(() => {
      const uci = lesson.steps[ply]!.uci;
      setAnimate(settings.animateMoves ? animationFor(position, uci) : null);
      playMoveSound(position, uci);
      setPly((value) => value + 1);
    }, 1800);
    return () => window.clearTimeout(timer);
  }, [playing, ply, total, lesson, position, settings.animateMoves]);
  const jump = (next: number) => {
    setPlaying(false);
    const uci = next === ply + 1 ? lesson.steps[ply]?.uci : undefined;
    setAnimate(uci && settings.animateMoves ? animationFor(position, uci) : null);
    if (uci) playMoveSound(position, uci);
    setPly(Math.max(0, Math.min(total, next)));
  };
  const controls = (
<div className="learn-playback" role="group" aria-label="Study controls">
          <ActionButton className="btn btn-sm" blockedReason={ply === 0 && 'You are at the starting position. Press Next or Play line to see the first move.'} onClick={() => jump(ply - 1)} aria-label="Previous move">← Back</ActionButton>
          <button className="btn btn-sm" aria-pressed={playing} onClick={() => { sound.unlock(); if (ply === total) { setPly(0); setAnimate(null); } setPlaying((value) => !value); }}>{playing ? 'Pause' : 'Play line'}</button>
          <ActionButton className="btn btn-sm" blockedReason={ply === total && 'The demonstration is complete. Choose Practice, or Play line to watch it again.'} onClick={() => jump(ply + 1)} aria-label="Next move">Next →</ActionButton>
        </div>
  );
  return (
    <div className="learn-session">
      <div className="learn-board-column">
        <LessonBoard position={position} version={ply} orientation={orientation} onFlip={() => setOrientation((value) => value === 'white' ? 'black' : 'white')}
          lastUci={lesson.steps[ply - 1]?.uci} animate={animate} status={ply === total ? 'Demonstration complete' : `Study · step ${ply} / ${total}`} />
        {controls}
        <p className="tiny muted center">Tap Next, or play the line at your own pace.</p>
      </div>
      <div className="learn-reading">
        <div className="learn-landscape-tools">{controls}</div>
        <div className="learn-step-card panel" aria-live="polite" aria-atomic="true">
          <div className="learn-step-label">{ply === 0 ? 'The starting idea' : `${lessonMoveSide(lesson, ply - 1)} played`}</div>
          {ply > 0 && <div className="learn-san">{notation[ply - 1]}</div>}
          <p>{ply === 0 ? lesson.summary : lesson.steps[ply - 1]!.note}</p>
        </div>
        <MemoryCue text={lesson.remember} />
        <div className="learn-move-strip" role="group" aria-label="Demonstration moves">
          <button className={ply === 0 ? 'active' : ''} aria-pressed={ply === 0} onClick={() => jump(0)}>Start</button>
          {notation.map((san, index) => <button key={index} className={ply === index + 1 ? 'active' : ''} aria-pressed={ply === index + 1} onClick={() => jump(index + 1)} aria-label={`Jump to ${lessonMoveSide(lesson, index)} move ${lessonMoveNumber(lesson, index)}: ${san}`}><span>{lessonMoveSide(lesson, index) === 'white' ? `${lessonMoveNumber(lesson, index)}.` : index === 0 ? `${lessonMoveNumber(lesson, index)}...` : ''}</span>{san}</button>)}
        </div>
        <LessonNotes lesson={lesson} />
        <div className="learn-ready"><p className="small muted">{ply === total ? 'Study completed. Finish Practice to mark this topic completed.' : 'You can start practising whenever you are ready.'}</p><button className="btn btn-primary btn-block" onClick={onPractice}>Practice on the board →</button></div>
      </div>
    </div>
  );
}

function PracticeSession({ lesson, side, stage, progress, onComplete, onRestart, onStudy, onPractice, onRecall, onSideChange }: {
  lesson: Lesson; side: LessonSide; stage: 'practice' | 'recall'; progress: LessonProgress[]; onComplete: RecordCompletion;
  onRestart: () => void; onStudy: () => void; onPractice: () => void; onRecall: () => void; onSideChange: (side: LessonSide) => void;
}) {
  const { settings } = useSettings();
  const [history, setHistory] = useState<string[]>([]);
  const [orientation, setOrientation] = useState<Orientation>(side);
  const [animate, setAnimate] = useState<BoardAnimate | null>(null);
  const [feedback, setFeedback] = useState<{ text: string; tone: 'ok' | 'bad' | 'neutral' } | null>(null);
  const [hintLevel, setHintLevel] = useState(0);
  const [hintUci, setHintUci] = useState<string>();
  const [hints, setHints] = useState(0);
  const [mistakes, setMistakes] = useState(0);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [pendingReply, setPendingReply] = useState<string>();
  const [saved, setSaved] = useState<LessonProgress>();
  const [saveFailed, setSaveFailed] = useState(false);
  const levels = useMemo(() => courseLevels(lesson.kind, progress), [lesson.kind, progress]);
  const level = levels[lesson.courseLevel - 1]!;
  const wasCleared = useRef(level.cleared);
  const newlyCleared = done && !!saved && level.cleared && !wasCleared.current;
  const completed = stage === 'practice' || topicCompleted(progress.find((row) => row.lessonId === lesson.id));
  const next = courseRecommendation(lesson.kind, progress, lesson.id);
  const lock = useRef(false);
  const alive = useRef(true);
  const recorded = useRef(false);
  const client = useRef<MateClient | null>(null);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; client.current?.dispose(); client.current = null; };
  }, []);
  const position = useMemo(() => {
    const current = Position.fromFen(lesson.startFen);
    current.playUciMoves(history);
    return current;
  }, [lesson.startFen, history]);
  const learner = side === 'white' ? 0 : 1;
  const isMate = lesson.kind === 'checkmate';
  const movesPlayed = isMate ? Math.ceil(history.length / 2) : history.filter((_, index) => index % 2 === learner).length;
  const movesLeft = (lesson.mateIn ?? 1) - movesPlayed;
  const interactive = !done && !busy && position.stm === learner;
  const clean = hints === 0 && mistakes === 0;
  const mateRequest = async (type: 'hint' | 'verify', uci?: string) => {
    client.current ??= new MateClient();
    return client.current.request({ type, fen: position.fen(), movesLeft, uci });
  };
  const finish = useCallback(() => {
    if (recorded.current) return;
    recorded.current = true;
    setDone(true);
    sound.play(isMate ? 'checkmate' : 'solved');
    void onComplete(lesson.id, stage, clean).then((row) => { if (alive.current) setSaved(row); }).catch(() => { if (alive.current) setSaveFailed(true); });
  }, [onComplete, lesson.id, stage, clean, isMate]);
  const commit = useCallback((uci: string) => {
    setAnimate(settings.animateMoves ? animationFor(position, uci) : null);
    playMoveSound(position, uci);
    setHistory((rows) => [...rows, uci]);
    setHintLevel(0);
    setHintUci(undefined);
  }, [position, settings.animateMoves]);
  useEffect(() => {
    if (!isMate && history.length === lesson.steps.length) finish();
  }, [isMate, history.length, lesson.steps.length, finish]);
  useEffect(() => {
    if (done || busy || position.stm === learner) return;
    const reply = isMate ? pendingReply : lesson.steps[history.length]?.uci;
    if (!reply) return;
    const timer = window.setTimeout(() => {
      commit(reply);
      setPendingReply(undefined);
      if (!isMate && stage === 'practice') setFeedback({ text: lesson.steps[history.length]!.note, tone: 'neutral' });
    }, 650);
    return () => window.clearTimeout(timer);
  }, [done, busy, position, learner, isMate, pendingReply, lesson, history.length, commit, stage]);
  const tryMove = (from: number, to: number, promo: PieceType | null): boolean => {
    if (!interactive || lock.current) return false;
    const move = position.findMove(from, to, promo);
    if (!move) return false;
    const uci = moveToUci(encodeMoveObj(move));
    if (!isMate) {
      if (!openingMoveMatches(lesson, history.length, uci)) {
        setMistakes((value) => value + 1);
        setFeedback({ text: 'That is legal, but this lesson rehearses a different move. Try again, or ask for a hint.', tone: 'bad' });
        sound.play('wrong');
        return false;
      }
      if (stage === 'practice') setFeedback({ text: lesson.steps[history.length]!.note, tone: 'ok' });
      else setFeedback({ text: 'That is the move. Keep going.', tone: 'ok' });
      commit(uci);
      return true;
    }
    lock.current = true;
    setBusy(true);
    void mateRequest('verify', uci).then((answer) => {
      if (!alive.current) return;
      if (answer.status === 'accepted') {
        commit(uci);
        if (answer.complete) finish();
        else {
          setPendingReply(answer.reply);
          setFeedback({ text: 'The mate is still forced. Watch the defence, then finish the job.', tone: 'ok' });
        }
      } else if (answer.status === 'rejected') {
        setMistakes((value) => value + 1);
        setFeedback({ text: `That does not force mate within ${movesLeft === 1 ? 'one more move' : `${movesLeft} more moves`}. The position is unchanged—try again.`, tone: 'bad' });
        sound.play('wrong');
      } else {
        setFeedback({ text: 'Could not finish checking that route. Try again, or use a hint; this does not count as a retry.', tone: 'neutral' });
      }
    }).catch(() => {
      if (alive.current) setFeedback({ text: 'Could not check that move. The position is unchanged; try again.', tone: 'neutral' });
    }).finally(() => { if (alive.current) { setBusy(false); lock.current = false; } });
    return true;
  };
  const showHint = async () => {
    if (!interactive || lock.current || hintLevel >= 2) return;
    if (hintLevel === 0) {
      setHints((value) => value + 1);
      setHintLevel(1);
      return;
    }
    lock.current = true;
    setBusy(true);
    try {
      const answer = isMate ? await mateRequest('hint') : { status: 'accepted', hint: lesson.steps[history.length]?.uci };
      if (!alive.current) return;
      if (answer.status === 'accepted' && answer.hint) {
        setHintUci(answer.hint);
        setHintLevel(2);
        setHints((value) => value + 1);
      } else setFeedback({ text: 'Could not find a hint in time. Try again, or revisit the demonstration.', tone: 'neutral' });
    } finally { if (alive.current) { setBusy(false); lock.current = false; } }
  };
  const status = done ? isMate ? 'Checkmate' : 'Line complete' : busy ? 'Checking the position' : position.stm === learner ? `${side} to move` : 'Opponent replies';
  const totalMoves = lesson.steps.filter((_, index) => index % 2 === learner).length;
  const exerciseTools = (
<div className="learn-exercise-tools">
          <span className="tiny mono muted">{isMate ? `${movesPlayed} / ${lesson.mateIn} moves` : `${movesPlayed} / ${totalMoves} moves`}</span>
          <button className="btn btn-sm" onClick={onRestart}>Restart</button>
          <ActionButton className="btn btn-sm" blockedReason={done ? 'This exercise is complete. Restart it to practise again.' : busy ? 'The position is being checked. Wait for verification to finish.' : position.stm !== learner ? 'Wait for the opponent’s reply before asking for a hint.' : hintLevel >= 2 && 'The move is already shown and highlighted on the board. Play it to continue.'} onClick={() => void showHint()}>{hintLevel === 0 ? 'Hint' : hintLevel === 1 ? 'Show move' : 'Move shown'}</ActionButton>
        </div>
  );
  const exerciseFeedback = (
<div className="learn-feedback" data-tone={feedback?.tone ?? 'neutral'} role="status" aria-live="polite">{done ? isMate ? 'Checkmate. Every escape is covered.' : 'You played the whole lesson line.' : feedback?.text ?? (stage === 'recall' ? 'Play from memory. Hints are here if you need them.' : 'Tap a piece, then its destination. Dragging and keyboard moves work too.')}</div>
  );
  return (
    <div className="learn-session">
      <div className="learn-board-column">
        <LessonBoard position={position} version={history.length} orientation={orientation} onFlip={() => setOrientation((value) => value === 'white' ? 'black' : 'white')}
          interactive={interactive} onMove={tryMove} lastUci={history[history.length - 1]} animate={animate} status={status} hintUci={hintUci} />
        {exerciseTools}
        {exerciseFeedback}
      </div>
      <div className="learn-reading">
        {!isMate && !done && <div className="learn-role"><span className="small muted">Play the line as</span><div className="row" role="group" aria-label="Practice side">{(['white', 'black'] as const).map((value) => <button key={value} className="chip" aria-pressed={side === value} onClick={() => onSideChange(value)}>{value}</button>)}</div></div>}
        <div className="learn-landscape-tools">{exerciseTools}{exerciseFeedback}</div>
        {done ? (
          <section className="learn-result panel" aria-label="Lesson complete" aria-live="polite">
            <span className="learn-completed-label">{completed ? '✓ Topic completed' : '✓ Recall completed'}</span>
            <h2>{stage === 'practice' ? `${lesson.title} completed.` : clean ? 'You remembered it unaided.' : 'Recall completed with help.'}</h2>
            {stage === 'recall' && <p className="learn-result-topic">{lesson.title}</p>}
            <p>{stage === 'practice' ? 'This topic is now marked Completed in your course. Try Recall without hints or retries to add an unaided recall towards the next level.' : clean ? completed ? 'No hints and no retries. Your unaided recall counts towards this level’s unlock requirement.' : 'No hints and no retries. Finish Practice as well to complete this topic and count its recall towards the level.' : completed ? 'The topic stays completed, but this assisted rehearsal does not add an unaided recall. Try again when you are ready.' : 'This assisted rehearsal does not add an unaided recall. Finish Practice to complete the topic, then try Recall again.'}</p>
            <div className="learn-result-stats"><div><strong>{movesPlayed}</strong><span>Moves</span></div><div><strong>{hints}</strong><span>Hints</span></div><div><strong>{mistakes}</strong><span>Retries</span></div></div>
            {!saved && !saveFailed && <p className="tiny muted">Saving progress…</p>}
            {saveFailed && <p className="small danger" role="alert">The attempt finished, but progress could not be saved. Restart the exercise to try saving again.</p>}
            {stage === 'recall' && saved && <p className="learn-schedule">{reviewLabel(saved.dueAt)}</p>}
            {newlyCleared && <div className="learn-unlocked" role="status"><strong>✓ Level {level.number} cleared</strong><p>{level.number < levels.length ? `Level ${level.number + 1} is now unlocked.` : `Every level of the ${lesson.kind === 'opening' ? 'opening' : 'checkmate'} course is cleared.`}</p>{level.number < levels.length && <Link className="btn btn-primary btn-sm" to={courseLink(lesson.kind, level.number + 1)}>Start Level {level.number + 1} →</Link>}</div>}
            <LevelProgress level={level} compact />
            {stage === 'practice' ? <button className="btn btn-primary btn-block" onClick={onRecall}>Recall without prompts →</button> : !completed ? <button className="btn btn-primary btn-block" onClick={onPractice}>Complete this topic in Practice →</button> : <button className="btn btn-block" onClick={onRestart}>Recall again</button>}
            {next && <Link className="btn btn-sm btn-block" to={`/learn/${next.lesson.id}?stage=${next.stage}`}>{next.stage === 'recall' ? 'Recall' : 'Next'}: {next.lesson.title} →</Link>}
            <Link className="btn btn-ghost btn-sm btn-block" to={courseLink(lesson.kind, lesson.courseLevel)}>Back to Level {lesson.courseLevel}</Link>
            <button className="btn btn-ghost btn-sm" onClick={onStudy}>Revisit the explanation</button>
          </section>
        ) : (
          <div className="learn-task panel">
            <span className="learn-step-label">{stage === 'recall' ? 'From memory' : 'Your turn to play'}</span>
            <h2>{isMate ? movesLeft === 1 ? 'Find the finishing move.' : `Mate in at most ${movesLeft}.` : `Play as ${side}.`}</h2>
            <p>{stage === 'practice' ? lesson.goal : isMate ? 'Find a forced mate. No move prompts unless you ask.' : 'Rebuild this lesson’s line. The other side will reply for you.'}</p>
            <div className="learn-meter" role="progressbar" aria-label="Exercise progress" aria-valuemin={0} aria-valuemax={isMate ? lesson.mateIn : totalMoves} aria-valuenow={movesPlayed}><span style={{ width: `${100 * movesPlayed / (isMate ? lesson.mateIn! : totalMoves)}%` }} /></div>
            {isMate ? <p className="tiny muted">Any forced mate within the move limit counts. The defence may differ from the demonstration.</p> : <p className="tiny muted">One common line, not the only good moves. This exercise checks the line you studied.</p>}
          </div>
        )}
        {hintLevel > 0 && !done && <div className="learn-hint panel" role="status"><span className="learn-step-label">{hintUci ? 'Try this move' : 'A nudge'}</span>{hintUci ? <><strong>{sanForUci(position, hintUci)}</strong><p>Move from {hintUci.slice(0, 2)} to {hintUci.slice(2, 4)}. Both squares are highlighted.</p></> : <p>{!isMate ? lesson.steps[history.length]?.note : lesson.remember}</p>}</div>}
        {(stage === 'practice' || done) && <MemoryCue text={lesson.remember} />}
        {stage === 'practice' && !done && <LessonNotes lesson={lesson} />}
        {stage === 'recall' && !done && <p className="learn-recall-note small muted">The explanation and move list are hidden for recall. A hint is always allowed; using one simply schedules a sooner review.</p>}
        {!done && <div className="learn-attempts tiny mono muted">{hints} hints · {mistakes} retries · no time limit</div>}
      </div>
    </div>
  );
}

function MemoryCue({ text }: { text: string }) {
  return <div className="learn-memory"><span className="learn-step-label">Remember the idea</span><p>{text}</p></div>;
}

function LessonNotes({ lesson }: { lesson: Lesson }) {
  return <details className="learn-notes"><summary>The plan & the common trap</summary><ul>{lesson.ideas.map((idea) => <li key={idea}>{idea}</li>)}</ul><div className="learn-caution"><strong>Watch out</strong><p>{lesson.watchOut}</p></div></details>;
}

function animationFor(position: Position, uci: string): BoardAnimate | null {
  const encoded = position.uciToMove(uci);
  if (encoded === null) return null;
  const move = decodeMove(encoded);
  const capturedSquare = move.flag === FLAG_EN_PASSANT ? move.to + (position.stm === WHITE ? -16 : 16) : move.to;
  return { from: move.from, to: move.to, capturedPiece: position.pieceAt(capturedSquare), capturedSquare, promoted: move.promo !== null };
}

function playMoveSound(position: Position, uci: string): void {
  const san = sanForUci(position, uci);
  sound.play(moveSoundName({ capture: san.includes('x'), check: san.includes('+') || san.includes('#'), san }));
}
