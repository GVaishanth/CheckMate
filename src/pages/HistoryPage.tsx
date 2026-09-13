/**
 * History — local game archive (IndexedDB). Browse, review any game ply by
 * ply, copy/export PGN, import PGN files. Nothing ever leaves the device.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Board, Orientation } from '../components/Board';
import { CapturedPieces } from '../components/CapturedPieces';
import { MoveList } from '../components/MoveList';
import { useToast } from '../components/Toast';
import { IconFlip, IconQuill } from '../components/icons';
import { GameReview } from '../components/GameReview';
import { useOrientation, useHotkeys } from '../game/hooks';
import { useRegisterCommands } from '../game/commands';
import { useReviewController } from '../game/hooks';
import { gamesRepo, StoredGame } from '../storage/db';
import { exportPgn, parsePgn, replayPgn } from '../chess/pgn';
import { moveToSan, sanToMove } from '../chess/san';
import { encodeMoveObj, moveToUci, PieceType, BLACK, START_FEN, WHITE } from '../chess/constants';
import { Position } from '../chess/position';
import { useSettings } from '../storage/settings';
import { formatDuration, formatDate, uid, downloadFile } from '../utils';
import { sound } from '../audio/sound';
import {
  IconClose, IconDownload, IconKnight, IconPlay, IconUndo, IconUpload,
} from '../components/icons';

const MODE_LABEL: Record<StoredGame['mode'], string> = {
  bot: 'BOT',
  local: 'PASS & PLAY',
  p2p: 'P2P',
  import: 'IMPORTED',
  elo: 'ELO TEST',
};

export function HistoryPage() {
  const { id } = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const [games, setGames] = useState<StoredGame[] | null>(null);
  const [review, setReview] = useState<StoredGame | null>(null);
  const [autoReview, setAutoReview] = useState(false);
  const { toast } = useToast();

  const refresh = useCallback(async () => {
    try {
      setGames(await gamesRepo.all());
    } catch {
      setGames([]);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!id) {
      setReview(null);
      return;
    }
    setAutoReview(false);
    void gamesRepo.get(id).then((g) => {
      if (g) setReview(g);
      else {
        toast('That game is not in the archive.', 'danger');
        navigate('/history', { replace: true });
      }
    });
  }, [id, navigate, toast]);

  useRegisterCommands(
    useMemo(
      () => [{ id: 'history-clear-view', label: 'Back to Archive', group: 'History', run: () => navigate('/history') }],
      [navigate],
    ),
  );

  const onImport = async (file: File) => {
    try {
      const text = await file.text();
      const parsed = parsePgn(text);
      const { startFen } = replayPgn(parsed);
      if (parsed.moves.length === 0) throw new Error('no moves found');
      const game: StoredGame = {
        id: uid(),
        mode: 'import',
        date: Date.now(),
        whiteName: parsed.headers.White || 'White',
        blackName: parsed.headers.Black || 'Black',
        startFen,
        moves: replayMoves(startFen, parsed.moves),
        outcome: pgnOutcome(parsed.headers.Result),
        durationMs: 0,
      };
      await gamesRepo.save(game);
      await refresh();
      toast(`Imported ${Math.ceil(parsed.moves.length / 2)} moves.`, 'success');
    } catch (err) {
      toast(err instanceof Error ? `Import failed: ${err.message}` : 'Import failed — not a valid PGN.', 'danger');
    }
  };

  if (review) {
    return (
      <div className="page">
        <div className="container">
          {autoReview ? (
            <GameReview
              key={review.id}
              whiteName={review.whiteName}
              blackName={review.blackName}
              startFen={review.startFen || START_FEN}
              moves={review.moves.map((m) => ({ san: m.san, uci: m.uci }))}
              onExit={() => setAutoReview(false)}
            />
          ) : (
            <ReviewView
              game={review}
              onExit={() => {
                setReview(null);
                navigate('/history');
              }}
              onAutoReview={() => setAutoReview(true)}
            />
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="container">
        <div className="page-head">
          <div>
            <div className="eyebrow">Stored on this device only</div>
            <h1 className="page-title">History</h1>
            <p className="page-sub">
              Every game you finish here — bot duels, P2P matches, imported PGNs — replayable move
              by move.
            </p>
          </div>
          <div className="row">
            <label className="btn btn-sm" style={{ cursor: 'pointer' }}>
              <IconUpload size={14} /> IMPORT PGN
              <input
                type="file"
                accept=".pgn,text/plain"
                className="sr-only"
                aria-label="Import PGN file"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void onImport(f);
                  e.target.value = '';
                }}
              />
            </label>
            <button
              className="btn btn-sm"
              onClick={() => {
                if (!games || games.length === 0) {
                  toast('Nothing to export yet.', 'default');
                  return;
                }
                const pgns = games.map((g) => gameToPgn(g)).join('\n\n');
                downloadFile('checkmate-games.pgn', pgns, 'application/x-chess-pgn');
                toast('Archive exported.', 'success');
              }}
            >
              <IconDownload size={14} /> EXPORT ALL
            </button>
          </div>
        </div>

        {games === null ? (
          <div className="history-list" aria-hidden="true">
            <div className="skeleton skeleton-row" />
            <div className="skeleton skeleton-row" />
            <div className="skeleton skeleton-row" />
          </div>
        ) : games.length === 0 ? (
          <div className="empty">
            <div className="empty-glyph"><IconKnight size={30} /></div>
            <div className="empty-title">No games yet.</div>
            <p className="small muted">Finished games land here automatically.</p>
            <Link to="/bots" className="btn btn-primary" style={{ marginTop: 16 }}>PLAY A BOT</Link>
          </div>
        ) : (
          <div className="history-list" role="list" aria-label="Game history">
            {games.map((g) => (
              <HistoryRow key={g.id} game={g} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ row

function HistoryRow({ game: g }: { game: StoredGame }) {
  const { toast } = useToast();
  const [confirmDel, setConfirmDel] = useState(false);
  const result =
    g.outcome?.result === 'white' ? '1–0' : g.outcome?.result === 'black' ? '0–1' : '½–½';
  const resultTone =
    g.outcome?.result === 'white' ? 'chip-success' : g.outcome?.result === 'black' ? 'chip-danger' : '';

  return (
    <div className="history-row" role="listitem">
      <div className="history-main">
        <div className="spread">
          <span className="history-players">
            <strong>{g.whiteName}</strong> <span className="faint">vs</span> <strong>{g.blackName}</strong>
          </span>
          <span className={`chip ${resultTone}`}>{result}</span>
        </div>
        <div className="tiny faint mt-4">
          {MODE_LABEL[g.mode]} · {Math.ceil(g.moves.length / 2)} moves · {formatDuration(g.durationMs)} ·{' '}
          {formatDate(g.date)}
          {g.botId ? ` · ${g.botId.toUpperCase()}` : ''}
          {g.analysis ? ` · accuracy ${g.analysis.whiteAccuracy ?? g.analysis.blackAccuracy ?? '?'}%` : ''}
        </div>
      </div>
      <div className="history-actions">
        <Link className="btn btn-sm" to={`/review/${g.id}`}>
          <IconPlay size={13} /> REVIEW
        </Link>
        <button
          className="btn btn-sm"
          onClick={() => {
            void navigator.clipboard
              .writeText(gameToPgn(g))
              .then(() => toast('PGN copied.', 'success'))
              .catch(() => toast('Could not copy PGN.', 'danger'));
          }}
        >
          PGN
        </button>
        {confirmDel ? (
          <>
            <button className="btn btn-sm btn-danger" onClick={() => void gamesRepo.remove(g.id).then(() => window.location.reload())}>
              DELETE
            </button>
            <button className="btn btn-sm btn-ghost" onClick={() => setConfirmDel(false)}>KEEP</button>
          </>
        ) : (
          <button className="btn btn-sm btn-ghost" aria-label="Delete game" onClick={() => setConfirmDel(true)}>
            <IconClose size={13} />
          </button>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ review

function ReviewView({ game, onExit, onAutoReview }: { game: StoredGame; onExit: () => void; onAutoReview: () => void }) {
  const { settings } = useSettings();
  const startFen = game.startFen || START_FEN;
  const moves = useMemo(() => game.moves.map((m) => m.uci), [game.moves]);
  const sans = useMemo(() => {
    // Prefer stored SAN; recompute when missing (imported games).
    if (game.moves.every((m) => m.san)) return game.moves.map((m) => m.san);
    return recomputeSans(startFen, moves);
  }, [game.moves, moves, startFen]);
  const review = useReviewController(startFen, moves);
  const [orientation, flip] = useOrientation('white');

  useHotkeys(
    useMemo(
      () => ({
        arrowleft: (e: KeyboardEvent) => {
          e.preventDefault();
          review.prev();
        },
        arrowright: (e: KeyboardEvent) => {
          e.preventDefault();
          review.next();
        },
        arrowup: (e: KeyboardEvent) => {
          e.preventDefault();
          review.first();
        },
        arrowdown: (e: KeyboardEvent) => {
          e.preventDefault();
          review.last();
        },
        home: (e: KeyboardEvent) => {
          e.preventDefault();
          review.first();
        },
        end: (e: KeyboardEvent) => {
          e.preventDefault();
          review.last();
        },
      }),
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [review],
    ),
  );

  const lastUci = review.ply > 0 ? moves[review.ply - 1] : null;
  const lastMove = lastUci ? { from: sqFromUci(lastUci), to: sqToUci(lastUci) } : null;

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">{MODE_LABEL[game.mode]} · {formatDate(game.date)}</div>
          <h1 className="page-title" style={{ fontSize: 'clamp(1.4rem, 3vw, 2rem)' }}>
            {game.whiteName} vs {game.blackName}
          </h1>
        </div>
        <div className="row">
          <button
            className="btn btn-sm"
            onClick={() =>
              void navigator.clipboard
                .writeText(gameToPgn(game))
                .then(() => sound.play('uiTick'))
                .catch(() => undefined)
            }
          >
            COPY PGN
          </button>
          <button className="btn btn-sm" onClick={onAutoReview} disabled={game.moves.length === 0}>
            <IconQuill size={14} /> AUTO-REVIEW
          </button>
          <button className="btn btn-sm btn-ghost" onClick={onExit}>
            <IconUndo size={14} /> ARCHIVE
          </button>
        </div>
      </div>

      <div className="game-layout">
        <div className="game-left-rail stack gap-12">
          <div className="panel panel-pad stack gap-8">
            <div className="spread small">
              <span>Result</span>
              <span className="mono">
                {game.outcome?.result === 'white' ? '1–0' : game.outcome?.result === 'black' ? '0–1' : '½–½'}
              </span>
            </div>
            <div className="spread small">
              <span>Moves</span>
              <span className="mono">{Math.ceil(moves.length / 2)}</span>
            </div>
            <div className="spread small">
              <span>Duration</span>
              <span className="mono">{formatDuration(game.durationMs)}</span>
            </div>
            {game.analysis && (
              <>
                <div className="spread small">
                  <span>Your accuracy</span>
                  <span className="mono">{game.analysis.whiteAccuracy ?? game.analysis.blackAccuracy ?? '—'}%</span>
                </div>
                <div className="spread small">
                  <span>Est. performance</span>
                  <span className="mono">{game.analysis.performance}</span>
                </div>
              </>
            )}
          </div>
          <div className="panel panel-mobile">
            <div className="panel-title">Moves</div>
            <MoveList
              sans={sans}
              currentPly={review.ply}
              onSelectPly={(p) => review.goTo(p)}
            />
          </div>
        </div>

        <div className="game-center stack gap-12">
          <div className="board-wrap">
            <Board
              position={review.position}
              version={review.ply}
              orientation={orientation as Orientation}
              interactive={false}
              selectable={() => false}
              legalFor={() => []}
              onMove={() => false}
              lastMove={lastMove}
              checkSquare={review.position.inCheck() ? review.position.kingSquare(review.position.stm) : null}
              animate={null}
              settings={settings}
              label={`Game review. Move ${Math.ceil(review.ply / 2)} of ${Math.ceil(moves.length / 2)}.`}
            />
            <div className="board-status">
              <span className="turn-indicator">
                <span className={`turn-dot ${review.position.stm === WHITE ? 'white' : 'black'}`} />
                PLY {review.ply}/{moves.length}
              </span>
              <div className="board-tools">
                <button className="tool-btn" onClick={flip} aria-label="Flip board" title="Flip (F)"><IconFlip size={15} /></button>
              </div>
            </div>
          </div>

          <div className="row review-controls">
            <button className="btn btn-sm" onClick={() => review.first()} aria-label="First move">⏮</button>
            <button className="btn btn-sm" onClick={() => review.prev()} aria-label="Previous move">◀</button>
            <button className="btn btn-sm" onClick={() => review.next()} aria-label="Next move">▶</button>
            <button className="btn btn-sm" onClick={() => review.last()} aria-label="Last move">⏭</button>
            <span className="tiny faint">← → step · ↑ ↓ ends</span>
          </div>
        </div>

        <div className="game-side stack gap-12">
          <div className="panel">
            <div className="panel-title">Moves</div>
            <MoveList
              sans={sans}
              currentPly={review.ply}
              onSelectPly={(p) => review.goTo(p)}
            />
          </div>
          <div className="panel panel-pad stack gap-8">
            <div className="field-label">Captured</div>
            <CapturedPieces position={review.position} color={WHITE} settings={settings} />
            <CapturedPieces position={review.position} color={BLACK} settings={settings} />
          </div>
        </div>
      </div>
    </>
  );
}

// ------------------------------------------------------------------ helpers

function gameToPgn(g: StoredGame): string {
  const startFen = g.startFen || START_FEN;
  const pos = Position.fromFen(startFen);
  pos.playUciMoves(g.moves.map((m) => m.uci));
  const result =
    g.outcome?.result === 'white' ? '1-0' : g.outcome?.result === 'black' ? '0-1' : '1/2-1/2';
  return exportPgn(
    pos,
    {
      Event: `CHECKMATE ${MODE_LABEL[g.mode]}`,
      Site: 'browser',
      Date: new Date(g.date).toISOString().slice(0, 10).replace(/-/g, '.'),
      White: g.whiteName,
      Black: g.blackName,
      Result: result,
    },
    result,
  );
}

function recomputeSans(startFen: string, ucis: string[]): string[] {
  const out: string[] = [];
  try {
    const pos = Position.fromFen(startFen);
    for (const uci of ucis) {
      const enc = pos.uciToMove(uci);
      if (enc === null) break;
      const mv = {
        from: enc & 0x7f,
        to: (enc >> 7) & 0x7f,
        promo: ((enc >> 14) & 7 || null) as PieceType | null,
        flag: (enc >> 17) & 7,
      };
      out.push(moveToSan(pos, mv));
      pos.playUci(uci);
    }
  } catch {
    /* partial replay is fine for display */
  }
  return out;
}

function replayMoves(startFen: string, sans: string[]): StoredGame['moves'] {
  const moves: StoredGame['moves'] = [];
  const pos = Position.fromFen(startFen);
  for (const san of sans) {
    const mv = sanToMove(pos, san);
    if (!mv) throw new Error(`Illegal move "${san}" at move ${Math.floor(moves.length / 2) + 1}`);
    const enc = encodeMoveObj(mv);
    const uci = moveToUci(enc);
    pos.makeMove(enc);
    moves.push({ san, uci, fenAfter: pos.fen(), msElapsed: 0, capture: false, check: pos.inCheck() });
  }
  return moves;
}

function pgnOutcome(result?: string): StoredGame['outcome'] {
  if (result === '1-0') return { result: 'white' };
  if (result === '0-1') return { result: 'black' };
  return { result: 'draw', reason: 'agreement' };
}

function sqFromUci(uci: string): number {
  return (uci.charCodeAt(0) - 97) + (Number(uci[1]) - 1) * 16;
}
function sqToUci(uci: string): number {
  return (uci.charCodeAt(2) - 97) + (Number(uci[3]) - 1) * 16;
}
