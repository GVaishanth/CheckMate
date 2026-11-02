import { ActionButton } from '../../components/ActionButton';
/** Host-validated direct play over an ordered WebRTC channel. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { BoardAnimate } from '../../components/Board';
import { GameOver } from '../../components/GameOver';
import { GameReview } from '../../components/GameReview';
import { useToast } from '../../components/Toast';
import { GameController } from '../../game/GameController';
import { useControllerVersion, useOrientation } from '../../game/hooks';
import { endReasonText } from '../../game/analysis';
import { PeerConnection, PeerRole, PeerState } from '../../multiplayer/peer';
import { PeerMessage, acceptGuestMove, applyPeerState, cleanPeerName } from '../../multiplayer/protocol';
import { Color, WHITE, other } from '../../chess/constants';
import { endSoundFor, moveSoundName, sound } from '../../audio/sound';
import { useSettings } from '../../storage/settings';
import { dataRevision, gamesRepo } from '../../storage/db';
import { exportPgn } from '../../chess/pgn';
import { uid, copyText } from '../../utils';
import { IconWifiOff } from '../../components/icons';
import { ConnChip, DuelChrome } from './DuelChrome';
import { GuestFlow, HostFlow } from './flows';
import { fmtDur, outcomeOf, promoLetter, resultString, sqAlg, uciToAnim } from './shared';

type Stage = 'lobby' | 'host-setup' | 'host-wait' | 'guest-setup' | 'guest-wait' | 'game';

export function P2PGame({ onExit }: { onExit: () => void }) {
  const { toast } = useToast();
  const { settings } = useSettings();
  const [stage, renderStage] = useState<Stage>('lobby');
  const stageRef = useRef<Stage>('lobby');
  const setStage = (value: Stage) => { stageRef.current = value; renderStage(value); };
  const [peerState, setPeerState] = useState<PeerState>('idle');
  const [peerError, setPeerError] = useState<string | null>(null);
  const [hostCode, setHostCode] = useState('');
  const [replyCode, setReplyCode] = useState('');
  const [myColor, setMyColor] = useState<Color>(WHITE);
  const [peerName, renderPeerName] = useState('Opponent');
  const peerNameRef = useRef('Opponent');
  const setPeerName = (name: string) => { peerNameRef.current = name; renderPeerName(name); };
  const [isHost, setIsHost] = useState(true);
  const [drawOfferedBy, renderDraw] = useState<'me' | 'peer' | null>(null);
  const drawRef = useRef<'me' | 'peer' | null>(null);
  const setDrawOfferedBy = (value: 'me' | 'peer' | null) => { drawRef.current = value; renderDraw(value); };
  const [rematchOfferedBy, renderRematch] = useState<'me' | 'peer' | null>(null);
  const rematchRef = useRef<'me' | 'peer' | null>(null);
  const setRematchOfferedBy = (value: 'me' | 'peer' | null) => { rematchRef.current = value; renderRematch(value); };
  const rematchReady = useRef(false);
  const [pending, renderPending] = useState(false);
  const pendingMove = useRef<string | null>(null);
  const setPending = (uci: string | null) => { pendingMove.current = uci; renderPending(uci !== null); };
  const peerRef = useRef<PeerConnection | null>(null);
  const roleRef = useRef<PeerRole>('host');
  const colorRef = useRef<Color>(WHITE);
  const nameRef = useRef('Player');
  const gameIdRef = useRef('');
  const savedRef = useRef(false);
  const revision = useRef(dataRevision());
  const helloSent = useRef(false);
  const alive = useRef(true);
  const controller = useMemo(() => new GameController({ whiteName: 'White', blackName: 'Black' }), []);
  const version = useControllerVersion(controller);
  const [animate, setAnimate] = useState<BoardAnimate | null>(null);
  const [orientation, flip] = useOrientation('white');
  const [gameOverOpen, setGameOverOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);

  const send = (message: PeerMessage): boolean => {
    if (peerRef.current?.send(message)) return true;
    toast('The message could not be sent. Check the connection.', 'danger');
    return false;
  };
  const broadcastState = () => {
    if (!gameIdRef.current) return;
    send({ t: 'state', gameId: gameIdRef.current, moves: controller.moves.map((m) => m.uci),
      whiteName: controller.config.whiteName, blackName: controller.config.blackName,
      winner: controller.end?.winner ?? null, reason: controller.end?.reason ?? '', turn: controller.turn });
  };
  const saveOnEnd = (show = true) => {
    if (!controller.end || savedRef.current) return;
    savedRef.current = true;
    if (show) {
      setGameOverOpen(true); setDrawOfferedBy(null); setPending(null);
      sound.play(endSoundFor(controller.end, colorRef.current === WHITE ? 'white' : 'black'));
    }
    void gamesRepo.save({ id: uid(), mode: 'p2p', date: Date.now(),
      whiteName: controller.config.whiteName, blackName: controller.config.blackName,
      startFen: controller.position.startFen, moves: controller.moves.map((m) => ({ ...m })),
      outcome: outcomeOf(controller), durationMs: controller.durationMs }, revision.current);
  };
  const endRef = useRef(() => saveOnEnd()); endRef.current = () => saveOnEnd();
  useEffect(() => controller.subscribe(() => {
    if (stageRef.current === 'game' && controller.phase === 'ended') endRef.current();
  }), [controller]);

  const clearRound = () => {
    savedRef.current = false; setGameOverOpen(false); setReviewOpen(false); setAnimate(null);
    setDrawOfferedBy(null); setRematchOfferedBy(null); rematchReady.current = false; setPending(null);
    controller.reset();
  };
  const expireDraw = (mover: Color) => {
    if ((drawRef.current === 'me' && mover !== colorRef.current) || (drawRef.current === 'peer' && mover === colorRef.current)) setDrawOfferedBy(null);
  };
  const startRematchAsHost = () => {
    if (roleRef.current !== 'host' || controller.phase !== 'ended' || !peerRef.current?.isOpen) return;
    const next = other(colorRef.current); colorRef.current = next; setMyColor(next);
    gameIdRef.current = uid(); clearRound();
    controller.rename(next === WHITE ? nameRef.current : peerNameRef.current, next === WHITE ? peerNameRef.current : nameRef.current);
    send({ t: 'start', gameId: gameIdRef.current, guestColor: other(next), hostName: nameRef.current });
    broadcastState(); sound.play('gameStart');
  };
  const respondToRematch = (accept: boolean) => {
    if (rematchRef.current !== 'peer' || controller.phase !== 'ended') return;
    if (!send({ t: accept ? 'rematch-accept' : 'rematch-decline', gameId: gameIdRef.current })) return;
    if (accept) {
      rematchReady.current = true;
      if (roleRef.current === 'host') startRematchAsHost();
    }
    setRematchOfferedBy(null);
  };
  const handleMessage = (message: PeerMessage) => {
    if (!alive.current) return;
    if (message.t === 'hello') {
      if (roleRef.current !== 'host' || stageRef.current !== 'host-wait') return;
      setPeerName(message.name);
      controller.rename(colorRef.current === WHITE ? nameRef.current : message.name, colorRef.current === WHITE ? message.name : nameRef.current);
      setStage('game');
      send({ t: 'start', gameId: gameIdRef.current, guestColor: other(colorRef.current), hostName: nameRef.current });
      broadcastState(); sound.play('gameStart'); return;
    }
    if (message.t === 'start') {
      if (roleRef.current !== 'guest' || message.gameId === gameIdRef.current) return;
      const initial = stageRef.current === 'guest-wait' && !gameIdRef.current;
      if (!initial && !(stageRef.current === 'game' && controller.phase === 'ended' && rematchReady.current)) return;
      colorRef.current = message.guestColor; setMyColor(message.guestColor); setPeerName(message.hostName);
      gameIdRef.current = message.gameId; clearRound();
      controller.rename(message.guestColor === WHITE ? nameRef.current : message.hostName, message.guestColor === WHITE ? message.hostName : nameRef.current);
      setStage('game'); sound.play('gameStart'); return;
    }
    if (stageRef.current !== 'game' || message.gameId !== gameIdRef.current) return;
    switch (message.t) {
      case 'try': {
        if (roleRef.current !== 'host') return;
        const mover = controller.turn;
        const rec = acceptGuestMove(controller, message, colorRef.current, gameIdRef.current);
        if (!rec) { send({ t: 'rejected', gameId: gameIdRef.current }); return; }
        expireDraw(mover); sound.play(moveSoundName(rec));
        setAnimate(settings.animateMoves ? uciToAnim(rec.uci, rec.capture) : null);
        broadcastState(); break;
      }
      case 'state': {
        if (roleRef.current !== 'guest') return;
        const count = controller.moveCount, mover = controller.turn;
        if (!applyPeerState(controller, message, gameIdRef.current, colorRef.current, pendingMove.current)) {
          setPeerError('The game state did not match. Create a new room to reconnect.'); setPeerState('failed'); return;
        }
        if (controller.moveCount > count) {
          const rec = controller.moves[controller.moveCount - 1]!;
          setPending(null); expireDraw(mover); sound.play(moveSoundName(rec));
          setAnimate(settings.animateMoves ? uciToAnim(rec.uci, rec.capture) : null);
        }
        break;
      }
      case 'rejected':
        if (roleRef.current === 'guest') { setPending(null); toast('That move was rejected.', 'danger'); } break;
      case 'resign':
        if (controller.phase === 'playing') { controller.resign(other(colorRef.current)); if (roleRef.current === 'host') broadcastState(); } break;
      case 'draw-offer':
        if (controller.phase !== 'playing') return;
        if (drawRef.current === 'me') {
          send({ t: 'draw-accept', gameId: gameIdRef.current }); controller.drawByAgreement();
          if (roleRef.current === 'host') broadcastState();
        } else { setDrawOfferedBy('peer'); sound.play('notify'); } break;
      case 'draw-accept':
        if (controller.phase === 'playing' && drawRef.current === 'me') {
          controller.drawByAgreement(); setDrawOfferedBy(null); if (roleRef.current === 'host') broadcastState();
        } break;
      case 'draw-decline':
        if (drawRef.current === 'me') { setDrawOfferedBy(null); toast('Draw declined.'); } break;
      case 'rematch-offer':
        if (controller.phase !== 'ended') return;
        if (rematchRef.current === 'me') {
          rematchReady.current = true;
          if (roleRef.current === 'host') startRematchAsHost();
          else send({ t: 'rematch-accept', gameId: gameIdRef.current });
        } else { setRematchOfferedBy('peer'); sound.play('notify'); } break;
      case 'rematch-accept':
        if (controller.phase === 'ended' && rematchRef.current === 'me') {
          rematchReady.current = true;
          if (roleRef.current === 'host') startRematchAsHost();
        } break;
      case 'rematch-decline':
        if (rematchRef.current === 'me') { setRematchOfferedBy(null); rematchReady.current = false; toast('Rematch declined.'); } break;
    }
  };
  const messageRef = useRef(handleMessage); messageRef.current = handleMessage;
  const stateHandler = (state: PeerState, detail?: string) => {
    if (!alive.current) return;
    setPeerState(state);
    if (state === 'connected' && roleRef.current === 'guest' && peerRef.current?.isOpen && !helloSent.current) {
      helloSent.current = true; send({ t: 'hello', name: nameRef.current });
    }
    if (state === 'failed' || state === 'disconnected') {
      setPeerError(detail ?? 'Connection lost.');
      if (controller.phase === 'playing' && stageRef.current === 'game') controller.endByDisconnect(other(colorRef.current));
    }
  };
  const stateRef = useRef(stateHandler); stateRef.current = stateHandler;
  const makePeer = (role: PeerRole) => {
    peerRef.current?.teardown(); roleRef.current = role; helloSent.current = false;
    gameIdRef.current = role === 'host' ? uid() : ''; clearRound();
    const peer = new PeerConnection(role, {
      onState: (state, detail) => stateRef.current(state, detail),
      onMessage: (message) => messageRef.current(message),
    });
    peerRef.current = peer; return peer;
  };
  const leaveRoom = () => {
    if (stageRef.current === 'game' && controller.phase === 'playing') {
      controller.resign(colorRef.current);
      peerRef.current?.send({ t: 'resign', gameId: gameIdRef.current });
      saveOnEnd(false);
    }
    setStage('lobby'); peerRef.current?.teardown(); peerRef.current = null;
    setHostCode(''); setReplyCode(''); setPeerState('idle'); setPeerError(null);
    gameIdRef.current = ''; setPeerName('Opponent'); clearRound();
  };
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (stageRef.current === 'game' && controller.phase === 'playing') {
        controller.resign(colorRef.current);
        peerRef.current?.send({ t: 'resign', gameId: gameIdRef.current });
        saveOnEnd(false);
      }
      peerRef.current?.teardown(); peerRef.current = null;
    };
  }, [controller]);

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
              nameRef.current = cleanPeerName(name, 'Host');
              colorRef.current = color;
              setMyColor(color);
              const peer = makePeer('host');
              try {
                setPeerError(null);
                const code = await peer.createOffer(nameRef.current);
                if (!alive.current || peerRef.current !== peer) return;
                setHostCode(code);
                setStage('host-wait');
              } catch (err) {
                if (!alive.current || peerRef.current !== peer) return;
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
              nameRef.current = cleanPeerName(name, 'Guest');
              const peer = makePeer('guest');
              try {
                setPeerError(null);
                const reply = await peer.acceptOffer(code, nameRef.current);
                if (!alive.current || peerRef.current !== peer) return;
                setReplyCode(reply); setStage('guest-wait');
              } catch (err) {
                if (!alive.current || peerRef.current !== peer) return;
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
              <li><strong>Host creates a room.</strong> CHECKMATE generates a connection code — an encoded description of how to reach the host's browser.</li>
              <li><strong>Host sends the code</strong> to the guest — any chat app, email, or across the table.</li>
              <li><strong>Guest pastes the code</strong> and answers with a reply code.</li>
              <li><strong>Host pastes the reply.</strong> The two browsers open a direct WebRTC data channel. Every move then travels peer-to-peer — no server sees the game.</li>
            </ol>
            <p className="small muted mt-8">Connection codes can contain temporary network addresses. Share them only with the person you intend to play.</p>
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
  const interactive = myTurn && connected && !pending;

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
          if (!peerRef.current?.isOpen || controller.phase !== 'playing' || controller.turn !== colorRef.current || pendingMove.current) return false;
          if (roleRef.current === 'host') {
            const mover = controller.turn;
            const captured = controller.position.pieceAt(to);
            const ok = controller.tryMove(from, to, promo);
            if (!ok) return false;
            const rec = controller.moves[controller.moves.length - 1]!;
            setAnimate(
              settings.animateMoves
                ? { from, to, capturedPiece: captured, capturedSquare: to }
                : { from: to, to, capturedPiece: 0, capturedSquare: -1 },
            );
            expireDraw(mover); sound.play(moveSoundName(rec));
            broadcastState();
            if (controller.end) saveOnEnd();
            return true;
          }
          // Guest: ask the host to validate and apply.
          const uci = sqAlg(from) + sqAlg(to) + promoLetter(promo);
          if (!send({ t: 'try', gameId: gameIdRef.current, ply: controller.moveCount, uci })) return false;
          setPending(uci); return true;
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
                    leaveRoom();
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
                    if (!send({ t: 'draw-accept', gameId: gameIdRef.current })) return;
                    controller.drawByAgreement();
                    if (roleRef.current === 'host') broadcastState();
                    setDrawOfferedBy(null);
                  }}
                >
                  ACCEPT
                </button>
                <button
                  className="btn btn-sm"
                  onClick={() => {
                    send({ t: 'draw-decline', gameId: gameIdRef.current });
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
                    respondToRematch(true);
                  }}
                >
                  ACCEPT
                </button>
                <button
                  className="btn btn-sm"
                  onClick={() => {
                    respondToRematch(false);
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
              onClose={() => setGameOverOpen(false)}
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
              {controller.moves.length > 0 && (
                <button className="btn" onClick={() => setReviewOpen(true)}>AUTO-REVIEW</button>
              )}
              {rematchOfferedBy === 'peer' ? (
                <div className="stack gap-8">
                  <p className="small muted">{peerName} wants a rematch.</p>
                  <div className="row">
                    <ActionButton className="btn btn-primary" blockedReason={!connected && 'The peer connection is closed. Choose NEW GAME to exchange fresh connection codes.'} onClick={() => respondToRematch(true)}>ACCEPT REMATCH</ActionButton>
                    <ActionButton className="btn" blockedReason={!connected && 'The peer connection is closed. Choose NEW GAME to exchange fresh connection codes.'} onClick={() => respondToRematch(false)}>DECLINE REMATCH</ActionButton>
                  </div>
                </div>
              ) : rematchOfferedBy === 'me' ? (
                <div className="tiny faint">Waiting for {peerName} to accept…</div>
              ) : (
                <ActionButton
                  className="btn btn-primary"
                  blockedReason={!connected && 'The peer connection is closed. Choose NEW GAME to exchange fresh connection codes.'}
                  onClick={() => {
                    if (send({ t: 'rematch-offer', gameId: gameIdRef.current })) setRematchOfferedBy('me');
                  }}
                >
                  REMATCH
                </ActionButton>
              )}
              <button
                className="btn"
                onClick={() =>
                  void copyText(
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
                    .then((ok) => toast(ok ? 'PGN copied.' : 'Could not copy PGN.', ok ? 'success' : 'danger'))
                }
              >
                COPY PGN
              </button>
              <button
                className="btn btn-ghost"
                onClick={() => {
                  leaveRoom();
                }}
              >
                NEW GAME
              </button>
            </GameOver>
          ) : null
        }
      >
        <div className="row wrap">
          {controller.phase === 'ended' && !gameOverOpen && <button className="btn btn-sm" onClick={() => setGameOverOpen(true)}>RESULT</button>}
          <ActionButton
            className="btn btn-sm btn-danger"
            blockedReason={!connected ? 'The peer connection is closed. Choose RECONNECT to create a fresh room.' : controller.phase !== 'playing' && 'This game has already ended. Open RESULT to arrange a rematch or start a new game.'}
            onClick={() => {
              controller.resign(myColor);
              send({ t: 'resign', gameId: gameIdRef.current });
              if (roleRef.current === 'host') broadcastState();
              saveOnEnd();
            }}
          >
            RESIGN
          </ActionButton>
          {drawOfferedBy === 'me' ? (
            <span className="tiny faint" style={{ alignSelf: 'center' }}>Draw offer sent…</span>
          ) : (
            <ActionButton
              className="btn btn-sm"
              blockedReason={!connected ? 'The peer connection is closed. Choose RECONNECT to create a fresh room.' : controller.phase !== 'playing' && 'This game has already ended. Open RESULT to arrange a rematch or start a new game.'}
              onClick={() => {
                if (send({ t: 'draw-offer', gameId: gameIdRef.current })) setDrawOfferedBy('me');
              }}
            >
              OFFER DRAW
            </ActionButton>
          )}
        </div>
      </DuelChrome>
      {reviewOpen && controller.phase === 'ended' && (
        <GameReview
          whiteName={controller.config.whiteName}
          blackName={controller.config.blackName}
          startFen={controller.position.startFen}
          moves={controller.moves.map((m) => ({ san: m.san, uci: m.uci }))}
          myColor={myColor === WHITE ? 'white' : 'black'}
          onExit={() => setReviewOpen(false)}
        />
      )}
    </>
  );
}
