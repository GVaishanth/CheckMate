/**
 * Direct peer-to-peer game. The host is authoritative — it validates every
 * guest move and broadcasts the full state; the guest mirrors it into its own
 * GameController. Signaling is two pasted connection codes (see peer.ts).
 */
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { BoardAnimate } from '../../components/Board';
import { GameOver } from '../../components/GameOver';
import { useToast } from '../../components/Toast';
import { GameController } from '../../game/GameController';
import { useControllerVersion, useOrientation } from '../../game/hooks';
import { endReasonText } from '../../game/analysis';
import { PeerConnection, PeerRole, PeerState } from '../../multiplayer/peer';
import { BLACK, Color, WHITE } from '../../chess/constants';
import { endSoundFor, moveSoundName, sound } from '../../audio/sound';
import { useSettings } from '../../storage/settings';
import { gamesRepo, StoredGame } from '../../storage/db';
import { exportPgn } from '../../chess/pgn';
import { uid } from '../../utils';
import { IconWifiOff } from '../../components/icons';
import { ConnChip, DuelChrome } from './DuelChrome';
import { GuestFlow, HostFlow } from './flows';
import { fmtDur, outcomeOf, promoLetter, resultString, sqAlg, uciToAnim } from './shared';

export function P2PGame({ onExit }: { onExit: () => void }) {
  const { toast } = useToast();
  const { settings } = useSettings();
  const [stage, setStage] = useState<'lobby' | 'host-setup' | 'host-wait' | 'guest-setup' | 'guest-wait' | 'game'>('lobby');
  const [peerState, setPeerState] = useState<PeerState>('idle');
  const [peerError, setPeerError] = useState<string | null>(null);
  const [hostCode, setHostCode] = useState('');
  const [replyCode, setReplyCode] = useState('');

  const [myColor, setMyColor] = useState<Color>(WHITE);
  const [peerName, setPeerName] = useState('Opponent');
  const [isHost, setIsHost] = useState(true);
  const [drawOfferedBy, setDrawOfferedBy] = useState<'me' | 'peer' | null>(null);
  const [rematchOfferedBy, setRematchOfferedBy] = useState<'me' | 'peer' | null>(null);

  const peerRef = useRef<PeerConnection | null>(null);
  const roleRef = useRef<PeerRole>('host');
  const colorRef = useRef<Color>(WHITE);
  const nameRef = useRef('Player');
  const savedRef = useRef(false);

  // One controller each side; guests replay the host's broadcast state.
  const controller = useMemo(() => new GameController({ whiteName: 'White', blackName: 'Black' }), []);
  const version = useControllerVersion(controller);
  const [, bumpRender] = useReducer((c: number) => c + 1, 0);
  const [animate, setAnimate] = useState<BoardAnimate | null>(null);
  const [orientation, flip] = useOrientation('white');
  const [gameOverOpen, setGameOverOpen] = useState(false);

  const send = useCallback((msg: Record<string, unknown>): boolean => {
    if (!peerRef.current?.send(msg)) {
      toast('Connection lost — nothing was sent.', 'danger');
      return false;
    }
    return true;
  }, [toast]);

  const broadcastState = useCallback(() => {
    send({
      t: 'state',
      moves: controller.moves.map((m) => ({ san: m.san, uci: m.uci })),
      whiteName: controller.config.whiteName,
      blackName: controller.config.blackName,
      winner: controller.end?.winner ?? null,
      reason: controller.end?.reason ?? '',
      turn: controller.turn,
    });
  }, [controller, send]);

  const applyNetState = useCallback(
    (net: {
      moves: { san: string; uci: string }[];
      whiteName: string;
      blackName: string;
      winner: 'white' | 'black' | null;
      reason: string;
      turn: Color;
    }) => {
      if (net.moves.length >= controller.moves.length) {
        // Replay any new plies (usually just one).
        for (let i = controller.moves.length; i < net.moves.length; i++) {
          const rec = controller.applyUci(net.moves[i]!.uci);
          if (!rec) break;
          if (i === net.moves.length - 1) {
            sound.play(moveSoundName(rec));
            setAnimate(
              settings.animateMoves
                ? uciToAnim(net.moves[i]!.uci, rec.capture)
                : null,
            );
          }
        }
      } else {
        // Fewer plies than we have → rematch/reset.
        controller.reset();
      }
      controller.rename(net.whiteName, net.blackName);
      bumpRender();

      // Terminal states the move replay can't detect (checkmate/stalemate/
      // repetition are found organically while replaying the moves).
      if (net.reason && controller.phase === 'playing') {
        if (net.reason === 'resign') {
          controller.resign(colorRef.current === WHITE ? BLACK : WHITE);
        } else if (net.reason === 'disconnect') {
          controller.endByDisconnect(colorRef.current);
        } else {
          controller.drawByAgreement();
        }
      }
      if (controller.phase === 'ended' && !savedRef.current) {
        savedRef.current = true;
        setGameOverOpen(true);
        sound.play(endSoundFor(controller.end, colorRef.current === WHITE ? 'white' : 'black'));
        const game: StoredGame = {
          id: uid(),
          mode: 'p2p',
          date: Date.now(),
          whiteName: controller.config.whiteName,
          blackName: controller.config.blackName,
          startFen: controller.position.startFen,
          moves: controller.moves,
          outcome: outcomeOf(controller),
          durationMs: controller.durationMs,
        };
        void gamesRepo.save(game);
      }
    },
    [controller, settings.animateMoves],
  );

  const startRematchAsHost = useCallback(() => {
    const next: Color = colorRef.current === WHITE ? BLACK : WHITE;
    colorRef.current = next;
    setMyColor(next);
    controller.reset();
    savedRef.current = false;
    setGameOverOpen(false);
    setDrawOfferedBy(null);
    setRematchOfferedBy(null);
    controller.rename(
      next === WHITE ? nameRef.current : peerName,
      next === WHITE ? peerName : nameRef.current,
    );
    sound.play('gameStart');
    send({ t: 'start', guestColor: next === WHITE ? BLACK : WHITE, hostName: nameRef.current });
    broadcastState();
  }, [controller, peerName, broadcastState, send]);

  const handleMessage = useCallback(
    (msg: Record<string, unknown>) => {
      const t = msg.t as string;
      switch (t) {
        // ---- handshake
        case 'hello': {
          // Host receives the guest's name → start the match.
          if (roleRef.current === 'host') {
            const guest = (msg.name as string) || 'Guest';
            setPeerName(guest);
            controller.rename(
              colorRef.current === WHITE ? nameRef.current : guest,
              colorRef.current === WHITE ? guest : nameRef.current,
            );
            send({ t: 'start', guestColor: colorRef.current === WHITE ? BLACK : WHITE, hostName: nameRef.current });
            broadcastState();
            setStage('game');
            sound.play('gameStart');
          }
          break;
        }
        case 'start': {
          // Guest receives match parameters (also used for rematch).
          const guestColor = (msg.guestColor as Color) ?? BLACK;
          colorRef.current = guestColor;
          setMyColor(guestColor);
          setPeerName((msg.hostName as string) || 'Host');
          controller.reset();
          savedRef.current = false;
          setGameOverOpen(false);
          setDrawOfferedBy(null);
          setRematchOfferedBy(null);
          setStage('game');
          sound.play('gameStart');
          break;
        }
        // ---- moves
        case 'try': {
          if (roleRef.current !== 'host' || controller.phase !== 'playing') break;
          const rec = controller.applyUci(msg.uci as string);
          if (rec) {
            sound.play(moveSoundName(rec));
            setAnimate(settings.animateMoves ? uciToAnim(rec.uci, rec.capture) : null);
            broadcastState();
            if (controller.end && !savedRef.current) {
              savedRef.current = true;
              setGameOverOpen(true);
              sound.play(endSoundFor(controller.end, colorRef.current === WHITE ? 'white' : 'black'));
              void gamesRepo.save({
                id: uid(),
                mode: 'p2p',
                date: Date.now(),
                whiteName: controller.config.whiteName,
                blackName: controller.config.blackName,
                startFen: controller.position.startFen,
                moves: controller.moves,
                outcome: outcomeOf(controller),
                durationMs: controller.durationMs,
              });
            }
          } else {
            send({ t: 'rejected' });
          }
          break;
        }
        case 'state': {
          if (roleRef.current === 'guest') {
            applyNetState({
              moves: (msg.moves as { san: string; uci: string }[]) ?? [],
              whiteName: (msg.whiteName as string) || 'White',
              blackName: (msg.blackName as string) || 'Black',
              winner: (msg.winner as 'white' | 'black' | null) ?? null,
              reason: (msg.reason as string) ?? '',
              turn: (msg.turn as Color) ?? WHITE,
            });
          }
          break;
        }
        case 'rejected': {
          toast('The host rejected that move.', 'danger');
          break;
        }
        // ---- protocol
        case 'resign': {
          // The sender resigned → their color loses.
          controller.resign(colorRef.current === WHITE ? BLACK : WHITE);
          if (roleRef.current === 'host') broadcastState();
          if (!savedRef.current) {
            savedRef.current = true;
            setGameOverOpen(true);
            sound.play(endSoundFor(controller.end, colorRef.current === WHITE ? 'white' : 'black'));
            void gamesRepo.save({
              id: uid(),
              mode: 'p2p',
              date: Date.now(),
              whiteName: controller.config.whiteName,
              blackName: controller.config.blackName,
              startFen: controller.position.startFen,
              moves: controller.moves,
              outcome: outcomeOf(controller),
              durationMs: controller.durationMs,
            });
          }
          break;
        }
        case 'draw-offer': {
          setDrawOfferedBy('peer');
          sound.play('notify');
          break;
        }
        case 'draw-accept': {
          controller.drawByAgreement();
          setDrawOfferedBy(null);
          if (roleRef.current === 'host') broadcastState();
          break;
        }
        case 'draw-decline': {
          setDrawOfferedBy(null);
          toast('Draw declined.', 'default');
          break;
        }
        case 'rematch-offer': {
          setRematchOfferedBy('peer');
          sound.play('notify');
          break;
        }
        case 'rematch-accept': {
          if (roleRef.current === 'host') startRematchAsHost();
          break;
        }
        case 'rematch-decline': {
          setRematchOfferedBy(null);
          toast('Rematch declined.', 'default');
          break;
        }
        default:
          break;
      }
    },
    [applyNetState, broadcastState, controller, send, settings.animateMoves, startRematchAsHost, toast],
  );

  const makePeer = useCallback(
    (role: PeerRole) => {
      peerRef.current?.teardown();
      const peer = new PeerConnection(role, {
        onState: (st, detail) => {
          setPeerState(st);
          if (st === 'failed' || st === 'disconnected') {
            setPeerError(detail ?? null);
            // End any live game — moves can no longer sync.
            if (controller.phase === 'playing' && stage === 'game') {
              controller.endByDisconnect(colorRef.current);
              if (roleRef.current === 'host') broadcastState();
              if (!savedRef.current) {
                savedRef.current = true;
                setGameOverOpen(true);
                sound.play(endSoundFor(controller.end, colorRef.current === WHITE ? 'white' : 'black'));
                void gamesRepo.save({
                  id: uid(),
                  mode: 'p2p',
                  date: Date.now(),
                  whiteName: controller.config.whiteName,
                  blackName: controller.config.blackName,
                  startFen: controller.position.startFen,
                  moves: controller.moves,
                  outcome: outcomeOf(controller),
                  durationMs: controller.durationMs,
                });
              }
            }
          }
        },
        onMessage: handleMessage,
      });
      peerRef.current = peer;
      roleRef.current = role;
      return peer;
    },
    [broadcastState, controller, handleMessage, stage],
  );

  useEffect(() => () => peerRef.current?.teardown(), []);

  const saveOnEnd = () => {
    if (savedRef.current) return;
    savedRef.current = true;
    setGameOverOpen(true);
    sound.play(endSoundFor(controller.end, colorRef.current === WHITE ? 'white' : 'black'));
    void gamesRepo.save({
      id: uid(),
      mode: 'p2p',
      date: Date.now(),
      whiteName: controller.config.whiteName,
      blackName: controller.config.blackName,
      startFen: controller.position.startFen,
      moves: controller.moves,
      outcome: outcomeOf(controller),
      durationMs: controller.durationMs,
    });
  };

  // --- lobby (pre-connection) ---
  if (stage !== 'game') {
    return (
      <>
        <div className="page-head">
          <div>
            <div className="eyebrow">Direct connection · no servers</div>
            <h1 className="page-title">Peer-to-Peer</h1>
            <p className="page-sub">
              One of you creates a room and shares a connection code; the other answers with a
              second code. After that the game runs browser-to-browser.
            </p>
          </div>
          <button className="btn btn-sm btn-ghost" onClick={onExit}>EXIT</button>
        </div>

        {stage === 'lobby' && (
          <div className="mp-choices">
            <button
              className="panel mp-choice"
              onClick={() => {
                setIsHost(true);
                setStage('host-setup');
              }}
            >
              <div className="mp-choice-title">CREATE ROOM</div>
              <p className="small muted">You become the host. You pick your color and the game validates moves.</p>
            </button>
            <button
              className="panel mp-choice"
              onClick={() => {
                setIsHost(false);
                setStage('guest-setup');
              }}
            >
              <div className="mp-choice-title">JOIN ROOM</div>
              <p className="small muted">Paste the host's connection code and answer with yours.</p>
            </button>
          </div>
        )}

        {(stage === 'host-setup' || stage === 'host-wait') && (
          <HostFlow
            code={hostCode}
            state={peerState}
            error={peerError}
            onCreate={async (name, color) => {
              nameRef.current = name;
              colorRef.current = color;
              setMyColor(color);
              const peer = makePeer('host');
              try {
                setPeerError(null);
                const code = await peer.createOffer(name);
                setHostCode(code);
                setStage('host-wait');
              } catch (err) {
                setPeerError(err instanceof Error ? err.message : 'Could not create the room.');
                setPeerState('failed');
              }
            }}
            onAnswer={async (reply) => {
              try {
                setPeerError(null);
                await peerRef.current?.acceptAnswer(reply);
              } catch (err) {
                setPeerError(err instanceof Error ? err.message : 'That reply code was not accepted.');
              }
            }}
          />
        )}

        {(stage === 'guest-setup' || stage === 'guest-wait') && (
          <GuestFlow
            reply={replyCode}
            state={peerState}
            error={peerError}
            onJoin={async (code, name) => {
              nameRef.current = name;
              const peer = makePeer('guest');
              try {
                setPeerError(null);
                const replyCode = await peer.acceptOffer(code, name);
                setReplyCode(replyCode);
                setStage('guest-wait');
                setPeerState('connecting');
                // Greet the host as soon as the channel opens.
                const iv = window.setInterval(() => {
                  if (peerRef.current?.isOpen) {
                    send({ t: 'hello', name });
                    window.clearInterval(iv);
                  }
                }, 150);
                window.setTimeout(() => window.clearInterval(iv), 20000);
              } catch (err) {
                setPeerError(err instanceof Error ? err.message : 'Could not join with that code.');
                setPeerState('failed');
              }
            }}
          />
        )}

        <div className="panel mt-24">
          <div className="panel-title">How the connection works</div>
          <div className="panel-pad">
            <ol className="flow-steps">
              <li><strong>Host creates a room.</strong> CHECKMATE generates a connection code — a compressed description of how to reach the host's browser.</li>
              <li><strong>Host sends the code</strong> to the guest — any chat app, email, or across the table.</li>
              <li><strong>Guest pastes the code</strong> and answers with a reply code.</li>
              <li><strong>Host pastes the reply.</strong> The two browsers open a direct WebRTC data channel. Every move then travels peer-to-peer — no server sees the game.</li>
            </ol>
            <p className="small muted mt-8">
              Because there is no relay or matchmaking service at all, both browsers must be able to
              reach each other directly — the same machine or the same local network works best. If
              the connection fails, fall back to pass-and-play.
            </p>
          </div>
        </div>
      </>
    );
  }

  // --- game ---
  const myTurn = controller.phase === 'playing' && controller.turn === myColor;
  const connected = peerState === 'connected';
  const interactive = myTurn && connected;

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">{isHost ? 'Host · authoritative' : 'Guest'} · direct P2P</div>
          <h1 className="page-title">
            {controller.config.whiteName} vs {controller.config.blackName}
          </h1>
        </div>
        <div className="row">
          <ConnChip state={peerState} />
          <button className="btn btn-sm btn-ghost" onClick={onExit}>EXIT</button>
        </div>
      </div>

      <DuelChrome
        controller={controller}
        version={version}
        orientation={myColor === WHITE ? orientation : orientation === 'white' ? 'black' : 'white'}
        animate={animate}
        interactive={interactive}
        onMove={(from, to, promo) => {
          if (roleRef.current === 'host') {
            const captured = controller.position.pieceAt(to);
            const ok = controller.tryMove(from, to, promo);
            if (!ok) return false;
            const rec = controller.moves[controller.moves.length - 1]!;
            setAnimate(
              settings.animateMoves
                ? { from, to, capturedPiece: captured, capturedSquare: to }
                : { from: to, to, capturedPiece: 0, capturedSquare: -1 },
            );
            sound.play(moveSoundName(rec));
            broadcastState();
            if (controller.end) saveOnEnd();
            return true;
          }
          // Guest: ask the host to validate and apply.
          return send({ t: 'try', uci: sqAlg(from) + sqAlg(to) + promoLetter(promo) });
        }}
        onFlip={flip}
        onIllegal={() => sound.play('illegal')}
        banner={
          !connected ? (
            <div className="conn-banner danger panel panel-pad row spread">
              <span className="row gap-8"><IconWifiOff size={16} /> {peerError ?? 'Connection lost — moves cannot sync.'}</span>
              <div className="row">
                <button
                  className="btn btn-sm"
                  onClick={() => {
                    peerRef.current?.teardown();
                    setStage('lobby');
                    setPeerState('idle');
                    setPeerError(null);
                  }}
                >
                  RECONNECT
                </button>
              </div>
            </div>
          ) : drawOfferedBy === 'peer' ? (
            <div className="conn-banner panel panel-pad row spread">
              <span>{peerName} offers a draw.</span>
              <div className="row">
                <button
                  className="btn btn-sm btn-primary"
                  onClick={() => {
                    controller.drawByAgreement();
                    send({ t: 'draw-accept' });
                    if (roleRef.current === 'host') broadcastState();
                    setDrawOfferedBy(null);
                  }}
                >
                  ACCEPT
                </button>
                <button
                  className="btn btn-sm"
                  onClick={() => {
                    send({ t: 'draw-decline' });
                    setDrawOfferedBy(null);
                  }}
                >
                  DECLINE
                </button>
              </div>
            </div>
          ) : rematchOfferedBy === 'peer' ? (
            <div className="conn-banner panel panel-pad row spread">
              <span>{peerName} wants a rematch.</span>
              <div className="row">
                <button
                  className="btn btn-sm btn-primary"
                  onClick={() => {
                    send({ t: 'rematch-accept' });
                    if (roleRef.current === 'host') startRematchAsHost();
                    else {
                      controller.reset();
                      savedRef.current = false;
                      setGameOverOpen(false);
                      setRematchOfferedBy(null);
                    }
                  }}
                >
                  ACCEPT
                </button>
                <button
                  className="btn btn-sm"
                  onClick={() => {
                    send({ t: 'rematch-decline' });
                    setRematchOfferedBy(null);
                  }}
                >
                  DECLINE
                </button>
              </div>
            </div>
          ) : null
        }
        gameOver={
          gameOverOpen ? (
            <GameOver
              winner={controller.end?.winner ?? null}
              outcome={
                controller.end?.winner === null
                  ? 'draw'
                  : controller.end?.winner === (myColor === WHITE ? 'white' : 'black')
                    ? 'win'
                    : 'loss'
              }
              reason={endReasonText(controller.end?.reason)}
              headline={
                controller.end?.winner === null
                  ? 'A hard-fought draw.'
                  : controller.end?.winner === (myColor === WHITE ? 'white' : 'black')
                    ? 'You take the duel.'
                    : `${peerName} takes the duel.`
              }
              stats={[
                { label: 'Moves', value: String(Math.ceil(controller.moves.length / 2)) },
                { label: 'Duration', value: fmtDur(controller.durationMs) },
                { label: 'Mode', value: 'P2P' },
              ]}
            >
              {rematchOfferedBy === 'me' ? (
                <div className="tiny faint">Waiting for {peerName} to accept…</div>
              ) : (
                <button
                  className="btn btn-primary"
                  onClick={() => {
                    setRematchOfferedBy('me');
                    send({ t: 'rematch-offer' });
                  }}
                >
                  REMATCH
                </button>
              )}
              <button
                className="btn"
                onClick={() =>
                  void navigator.clipboard
                    .writeText(
                      exportPgn(
                        controller.position,
                        {
                          Event: 'CHECKMATE P2P',
                          White: controller.config.whiteName,
                          Black: controller.config.blackName,
                          Result: resultString(controller),
                        },
                        resultString(controller),
                      ),
                    )
                    .then(() => toast('PGN copied.', 'success'))
                    .catch(() => toast('Could not copy PGN.', 'danger'))
                }
              >
                COPY PGN
              </button>
              <button
                className="btn btn-ghost"
                onClick={() => {
                  peerRef.current?.teardown();
                  setStage('lobby');
                  setPeerState('idle');
                  setPeerError(null);
                }}
              >
                NEW GAME
              </button>
            </GameOver>
          ) : null
        }
      >
        <div className="row wrap">
          <button
            className="btn btn-sm btn-danger"
            disabled={controller.phase !== 'playing' || !connected}
            onClick={() => {
              controller.resign(myColor);
              send({ t: 'resign' });
              if (roleRef.current === 'host') broadcastState();
              saveOnEnd();
            }}
          >
            RESIGN
          </button>
          {drawOfferedBy === 'me' ? (
            <span className="tiny faint" style={{ alignSelf: 'center' }}>Draw offer sent…</span>
          ) : (
            <button
              className="btn btn-sm"
              disabled={controller.phase !== 'playing' || !connected}
              onClick={() => {
                setDrawOfferedBy('me');
                send({ t: 'draw-offer' });
              }}
            >
              OFFER DRAW
            </button>
          )}
        </div>
      </DuelChrome>
    </>
  );
}
