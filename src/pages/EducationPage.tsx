import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { Board } from '../components/Board';
import type { BoardAnimate, Orientation } from '../components/Board';
import { IconFlip } from '../components/icons';
import { Position } from '../chess/position';
import {
  WHITE, colorOf, decodeMove, encodeMoveObj, fromAlgebraic, moveToUci,
} from '../chess/constants';
import type { PieceType } from '../chess/constants';
import { moveSoundName, sound } from '../audio/sound';
import { useSettings } from '../storage/settings';
import { useHotkeys } from '../game/hooks';
import { educationRepo, dbAvailable } from '../storage/db';
import { LESSONS, lessonById } from '../education/lessons';
import type { Lesson, LessonKind, LessonSide, LessonStage } from '../education/lessons';
import { lessonNotation, lessonPosition, openingMoveMatches, sanForUci } from '../education/position';
import { reviewLabel } from '../education/progress';
import type { LessonProgress } from '../education/progress';
import { MateClient } from '../education/mateClient';

const STAGES: LessonStage[] = ['study', 'practice', 'recall'];
type RecordCompletion = (lessonId: string, stage: LessonStage, clean: boolean) => Promise<LessonProgress>;

export function EducationPage() {
  const { lessonId } = useParams<{ lessonId: string }>();
  const [progress, setProgress] = useState<LessonProgress[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [persistent, setPersistent] = useState(true);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    void Promise.all([educationRepo.all(), dbAvailable()]).then(([rows, available]) => {
      if (alive.current) { setProgress(rows); setLoaded(true); setPersistent(available); }
    });
    return () => { alive.current = false; };
  }, []);
  const record = useCallback<RecordCompletion>(async (id, stage, clean) => {
    const row = await educationRepo.record(id, stage, clean);
    if (alive.current) setProgress((rows) => [...rows.filter((item) => item.lessonId !== id), row]);
    return row;
  }, []);
  const lesson = lessonId ? lessonById(lessonId) : undefined;
  useEffect(() => { window.scrollTo({ top: 0, behavior: 'instant' }); }, [lessonId]);
  return (
    <div className="page learn-page">
      <div className="container">
        {!persistent && <p className="learn-storage-warning" role="status">Saving is unavailable. Lesson progress lasts for this session only.</p>}
        {lessonId ? lesson ? (
          <LessonView key={lesson.id} lesson={lesson} progress={progress.find((row) => row.lessonId === lesson.id)} onComplete={record} />
        ) : (
          <div className="empty">
            <h1 className="empty-title">Lesson not found</h1>
            <p className="muted">Choose an opening or a mating pattern from the library.</p>
            <Link to="/learn" className="btn btn-primary mt-16">Lesson library</Link>
          </div>
        ) : <LessonLibrary progress={progress} loaded={loaded} />}
      </div>
    </div>
  );
}

function LessonLibrary({ progress, loaded }: { progress: LessonProgress[]; loaded: boolean }) {
  const [params, setParams] = useSearchParams();
  const category: LessonKind = params.get('category') === 'checkmate' ? 'checkmate' : 'opening';
  const [query, setQuery] = useState('');
  const [onlyDue, setOnlyDue] = useState(false);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  const known = progress.filter((row) => lessonById(row.lessonId));
  const due = known.filter((row) => row.dueAt !== null && row.dueAt <= now).sort((a, b) => a.dueAt! - b.dueAt!);
  const recent = [...known].sort((a, b) => b.lastPlayedAt - a.lastPlayedAt)[0];
  const recommended = due[0] ? lessonById(due[0].lessonId) : recent
    ? lessonById(recent.lessonId) : LESSONS[0];
  const rows = LESSONS.filter((lesson) => {
    const row = known.find((entry) => entry.lessonId === lesson.id);
    return lesson.kind === category
      && (!onlyDue || (row?.dueAt !== undefined && row.dueAt !== null && row.dueAt <= now))
      && `${lesson.title} ${lesson.summary} ${lesson.level}`.toLowerCase().includes(query.toLowerCase().trim());
  });
  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Education</div>
          <h1 className="page-title">Learn the idea. Play it back.</h1>
          <p className="page-sub">Short lessons on openings and checkmates. Study a few moves, try them yourself, then return to see what stuck.</p>
        </div>
        <span className="chip">18 lessons · offline</span>
      </div>
      <section className="learn-intro panel" aria-label="Learning path">
        <div className="learn-path">
          <div><span>01</span><h2>Study</h2><p>See each move and why it works.</p></div>
          <div><span>02</span><h2>Practice</h2><p>Play the position. Ask for a hint.</p></div>
          <div><span>03</span><h2>Recall</h2><p>Try without prompts. Review later.</p></div>
        </div>
        <div className="learn-record" aria-live="polite">
          <div><strong>{loaded ? known.filter((row) => row.studied).length : '—'}</strong><span>Studied</span></div>
          <div><strong>{loaded ? known.filter((row) => row.cleanRecalls > 0).length : '—'}</strong><span>Recalled</span></div>
          <div><strong>{loaded ? due.length : '—'}</strong><span>Due now</span></div>
        </div>
      </section>
      {loaded && recommended && (
        <div className="learn-resume">
          <div><span className="tiny mono faint">{due.length ? 'READY TO REVIEW' : recent ? 'YOUR LAST LESSON' : 'A GOOD FIRST LESSON'}</span><h2>{recommended.title}</h2></div>
          <Link className="btn btn-primary btn-sm" to={`/learn/${recommended.id}${due.length ? '?stage=recall' : (recent?.practices || recent?.recalls) ? '?stage=recall' : recent?.studied ? '?stage=practice' : ''}`}>
            {due.length ? 'Review now' : recent ? 'Continue lesson' : 'Start learning'} →
          </Link>
        </div>
      )}
      <div className="learn-library-tools">
        <div className="learn-category" role="group" aria-label="Lesson category">
          <button className="btn" aria-pressed={category === 'opening'} onClick={() => { setParams({ category: 'opening' }, { replace: true }); setOnlyDue(false); }}>Openings <span>10</span></button>
          <button className="btn" aria-pressed={category === 'checkmate'} onClick={() => { setParams({ category: 'checkmate' }, { replace: true }); setOnlyDue(false); }}>Checkmates <span>8</span></button>
        </div>
        <div className="learn-filters">
          <input className="input" type="search" aria-label="Search lessons" placeholder="Find a lesson" value={query} onChange={(event) => setQuery(event.target.value)} />
          <button className="btn btn-sm" aria-pressed={onlyDue} onClick={() => setOnlyDue((value) => !value)}>Due only</button>
        </div>
      </div>
      <details className="learn-primer">
        <summary>{category === 'opening' ? 'New to openings? Start with three ideas.' : 'What makes a position checkmate?'}</summary>
        {category === 'opening' ? (
          <p>Control the centre, develop your knights and bishops, and get your king safe. These lessons teach one common line, not every possible response. Remember the reason for a move rather than treating it as a rule for every game.</p>
        ) : (
          <p>The king must be in check, with no legal way to escape, capture the attacker or block the check. If the king is not in check and its side has no legal move, that is stalemate: a draw. In the exercises, any move that forces mate within the goal is accepted.</p>
        )}
      </details>
      <div className="learn-grid" aria-label={category === 'opening' ? 'Opening lessons' : 'Checkmate lessons'}>
        {rows.map((lesson) => {
          const row = known.find((entry) => entry.lessonId === lesson.id);
          const isDue = row?.dueAt !== undefined && row.dueAt !== null && row.dueAt <= now;
          const status = isDue ? 'Review due' : row?.cleanRecalls ? 'Recalled' : row?.practices ? 'Practised' : row?.studied ? 'Studied' : 'New';
          return (
            <Link to={`/learn/${lesson.id}`} key={lesson.id} className="learn-card">
              <div className="spread"><span className="tiny mono faint">{lesson.level}</span><span className={`learn-badge${isDue ? ' due' : row?.cleanRecalls ? ' done' : ''}`}>{status}</span></div>
              <h2>{lesson.title}</h2>
              <p>{lesson.summary}</p>
              <div className="learn-card-meta"><span>{lesson.kind === 'opening' ? `${lesson.steps.length / 2} moves · ${lesson.side}` : `Mate in ${lesson.mateIn}`}</span><span>Study & play →</span></div>
              <div className="learn-card-progress" aria-label={`${row?.studied ? 'Studied' : 'Not yet studied'}, ${row?.practices ? 'practised' : 'not yet practised'}, ${row?.cleanRecalls ? 'recalled without help' : 'not yet recalled without help'}`}>
                <span className={row?.studied ? 'done' : ''} /><span className={row?.practices ? 'done' : ''} /><span className={row?.cleanRecalls ? 'done' : ''} />
              </div>
            </Link>
          );
        })}
      </div>
      {rows.length === 0 && <div className="empty"><h2 className="empty-title">{onlyDue ? 'No reviews due in this category' : 'No matching lessons'}</h2><p className="small muted">{onlyDue ? 'You can still rehearse any lesson whenever you like.' : 'Try another name, or clear the search.'}</p><button className="btn btn-sm mt-16" onClick={() => { setOnlyDue(false); setQuery(''); }}>Show all lessons</button></div>}
      <details className="learn-primer learn-notation-key">
        <summary>Reading the moves</summary>
        <p>K = king, Q = queen, R = rook, B = bishop, N = knight. A pawn uses just its destination, such as e4. × or x means capture, + means check, # means checkmate, and O-O means kingside castling. You can tap a move in Study to see its position; no notation knowledge is needed to play.</p>
      </details>
      <p className="tiny muted learn-storage-note">Progress stays in this browser and is included in Settings → Export data. Recall reviews space out to 1, 3, 7, 14 and 30 days; asking for help schedules a short retry instead.</p>
    </>
  );
}

function LessonView({ lesson, progress, onComplete }: { lesson: Lesson; progress?: LessonProgress; onComplete: RecordCompletion }) {
  const [params, setParams] = useSearchParams();
  const rawStage = params.get('stage');
  const stage: LessonStage = rawStage === 'practice' || rawStage === 'recall' ? rawStage : 'study';
  const [side, setSide] = useState<LessonSide>(lesson.side);
  const [run, setRun] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, [stage]);
  const setStage = (next: LessonStage) => { sound.play('uiTick'); setParams({ stage: next }, { replace: true }); };
  const nextLesson = LESSONS[LESSONS.indexOf(lesson) + 1];
  return (
    <>
      <div className="learn-lesson-head">
        <Link to={`/learn?category=${lesson.kind}`} className="learn-back">← Lesson library</Link>
        <span className="tiny muted">{progress ? reviewLabel(progress.dueAt) : lesson.level}</span>
      </div>
      <div className="page-head learn-heading">
        <div className="learn-title-block"><Link to={`/learn?category=${lesson.kind}`} className="learn-compact-back" aria-label="Back to lesson library">←</Link><div><div className="eyebrow">{lesson.kind === 'opening' ? 'Opening' : 'Mating pattern'}</div><h1 ref={heading} tabIndex={-1} className="page-title">{lesson.title}</h1></div></div>
        <div className="learn-stages" role="group" aria-label="Lesson stage">
          {STAGES.map((item, index) => <button key={item} className="btn btn-sm" aria-pressed={item === stage} onClick={() => setStage(item)}><span aria-hidden="true">0{index + 1}</span>{item}</button>)}
        </div>
      </div>
      {stage === 'study' ? (
        <StudySession key={`${lesson.id}-study-${run}`} lesson={lesson} onComplete={onComplete} onPractice={() => setStage('practice')} />
      ) : (
        <PracticeSession key={`${lesson.id}-${stage}-${side}-${run}`} lesson={lesson} side={side} stage={stage} onComplete={onComplete} onRestart={() => setRun((value) => value + 1)} onStudy={() => setStage('study')} onRecall={() => setStage('recall')} nextLesson={nextLesson} onSideChange={setSide} />
      )}
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
          animate={animate} settings={settings} label={`Lesson board. ${status}.`} />
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
          <button className="btn btn-sm" disabled={ply === 0} onClick={() => jump(ply - 1)} aria-label="Previous move">← Back</button>
          <button className="btn btn-sm" aria-pressed={playing} onClick={() => { sound.unlock(); if (ply === total) { setPly(0); setAnimate(null); } setPlaying((value) => !value); }}>{playing ? 'Pause' : 'Play line'}</button>
          <button className="btn btn-sm" disabled={ply === total} onClick={() => jump(ply + 1)} aria-label="Next move">Next →</button>
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
          <div className="learn-step-label">{ply === 0 ? 'The starting idea' : `${ply % 2 ? 'White' : 'Black'} played`}</div>
          {ply > 0 && <div className="learn-san">{notation[ply - 1]}</div>}
          <p>{ply === 0 ? lesson.summary : lesson.steps[ply - 1]!.note}</p>
        </div>
        <MemoryCue text={lesson.remember} />
        <div className="learn-move-strip" role="group" aria-label="Demonstration moves">
          <button className={ply === 0 ? 'active' : ''} aria-pressed={ply === 0} onClick={() => jump(0)}>Start</button>
          {notation.map((san, index) => <button key={index} className={ply === index + 1 ? 'active' : ''} aria-pressed={ply === index + 1} onClick={() => jump(index + 1)} aria-label={`Jump to ${index % 2 ? 'Black' : 'White'} move ${Math.floor(index / 2) + 1}: ${san}`}><span>{index % 2 === 0 ? `${Math.floor(index / 2) + 1}.` : ''}</span>{san}</button>)}
        </div>
        <LessonNotes lesson={lesson} />
        <div className="learn-ready"><p className="small muted">{ply === total ? 'Seen the idea? Make the moves yourself.' : 'You can start practising whenever you are ready.'}</p><button className="btn btn-primary btn-block" onClick={onPractice}>Practice on the board →</button></div>
      </div>
    </div>
  );
}

function PracticeSession({ lesson, side, stage, onComplete, onRestart, onStudy, onRecall, nextLesson, onSideChange }: {
  lesson: Lesson; side: LessonSide; stage: 'practice' | 'recall'; onComplete: RecordCompletion;
  onRestart: () => void; onStudy: () => void; onRecall: () => void; nextLesson?: Lesson; onSideChange: (side: LessonSide) => void;
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
    void onComplete(lesson.id, stage, clean).then((row) => { if (alive.current) setSaved(row); });
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
          <button className="btn btn-sm" disabled={!interactive || hintLevel >= 2} onClick={() => void showHint()}>{hintLevel === 0 ? 'Hint' : hintLevel === 1 ? 'Show move' : 'Move shown'}</button>
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
            <span className="learn-step-label">{stage === 'recall' ? 'Recall complete' : 'Practice complete'}</span>
            <h2>{stage === 'recall' && clean ? 'You remembered it.' : isMate ? 'Checkmate found.' : 'You played the line.'}</h2>
            <p>{stage === 'practice' ? 'Now hide the prompts and see what you remember.' : clean ? 'No hints and no retries. Give the idea time to settle, then return for a review.' : 'A useful rehearsal. Try it again without help when you are ready.'}</p>
            <div className="learn-result-stats"><div><strong>{movesPlayed}</strong><span>Moves</span></div><div><strong>{hints}</strong><span>Hints</span></div><div><strong>{mistakes}</strong><span>Retries</span></div></div>
            {stage === 'recall' && saved && <p className="learn-schedule">{reviewLabel(saved.dueAt)}</p>}
            {stage === 'practice' ? <button className="btn btn-primary btn-block" onClick={onRecall}>Recall without prompts →</button> : <button className="btn btn-block" onClick={onRestart}>Recall again</button>}
            {nextLesson && <Link className="btn btn-sm btn-block" to={`/learn/${nextLesson.id}`}>Next: {nextLesson.title} →</Link>}
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
  return { from: move.from, to: move.to, capturedPiece: position.pieceAt(move.to), capturedSquare: move.to, promoted: move.promo !== null };
}

function playMoveSound(position: Position, uci: string): void {
  const san = sanForUci(position, uci);
  sound.play(moveSoundName({ capture: san.includes('x'), check: san.includes('+') || san.includes('#'), san }));
}
