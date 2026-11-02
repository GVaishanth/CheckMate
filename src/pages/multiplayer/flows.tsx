import { ActionButton } from '../../components/ActionButton';
/** Connection-code exchange UI for the host and guest flows. */
import { useState } from 'react';
import { useToast } from '../../components/Toast';
import { sound } from '../../audio/sound';
import { BLACK, Color, WHITE } from '../../chess/constants';
import { PeerState } from '../../multiplayer/peer';
import { IconCopy } from '../../components/icons';
import { copyText } from '../../utils';

export function CodeBox({ code, label }: { code: string; label: string }) {
  const { toast } = useToast();
  return (
    <div className="code-box">
      <div className="tiny faint">{label}</div>
      <textarea readOnly value={code} aria-label={label} onFocus={(e) => e.currentTarget.select()} />
      <button
        className="btn btn-sm"
        onClick={() => void copyText(code).then((ok) => toast(ok ? 'Code copied — send it to your opponent.' : 'Select the code and copy it manually.', ok ? 'success' : 'default'))}
      >
        <IconCopy size={14} /> COPY CODE
      </button>
    </div>
  );
}

export function HostFlow({
  code, state, error, onCreate, onAnswer,
}: {
  code: string;
  state: PeerState;
  error: string | null;
  onCreate: (name: string, color: Color) => Promise<void>;
  onAnswer: (reply: string) => Promise<void>;
}) {
  const [name, setName] = useState('Host');
  const [color, setColor] = useState<'white' | 'black' | 'random'>('white');
  const [reply, setReply] = useState('');
  const created = code !== '';

  return (
    <div className="panel mt-16" style={{ maxWidth: 640 }}>
      <div className="panel-title">Create room</div>
      <div className="panel-pad stack gap-16">
        <div className="field">
          <span className="field-label">Your name</span>
          <input value={name} disabled={created || state === 'creating'} onChange={(e) => setName(e.target.value.slice(0, 18))} aria-label="Your name" />
        </div>
        <div className="field">
          <span className="field-label">Your side</span>
          <div className="seg" role="group" aria-label="Choose side">
            {(['white', 'random', 'black'] as const).map((c) => (
              <ActionButton key={c} blockedReason={created ? 'Your side is fixed in the room code. Start a new room to choose another side.' : state === 'creating' && 'The room code is being created. Wait for it to finish before changing sides.'} aria-pressed={color === c} onClick={() => setColor(c)}>
                {c.toUpperCase()}
              </ActionButton>
            ))}
          </div>
        </div>
        {!created ? (
          <div>
            <ActionButton
              className="btn btn-primary"
              blockedReason={state === 'creating' && 'The room code is being created. Wait for it to finish.'}
              onClick={() => {
                const resolved: Color = color === 'random' ? (Math.random() < 0.5 ? WHITE : BLACK) : color === 'white' ? WHITE : BLACK;
                sound.unlock();
                void onCreate(name, resolved);
              }}
            >
              CREATE ROOM
            </ActionButton>
          </div>
        ) : (
          <>
            <CodeBox code={code} label="Step 1 — send this room code to your opponent" />
            <div className="field">
              <span className="field-label">Step 2 — paste your opponent's reply code</span>
              <textarea
                value={reply}
                maxLength={65536}
                onChange={(e) => setReply(e.target.value)}
                placeholder="Paste the reply code here…"
                aria-label="Opponent reply code"
                rows={3}
              />
            </div>
            <div className="row">
              <ActionButton className="btn btn-primary" blockedReason={state === 'connected' ? 'The room is already connected.' : state === 'connecting' ? 'The connection is being established. Keep this tab open and wait for the peer.' : reply.trim().length === 0 && 'Paste your opponent’s reply code before connecting.'} onClick={() => void onAnswer(reply)}>
                CONNECT
              </ActionButton>
              <span className="tiny faint" style={{ alignSelf: 'center' }}>
                {state === 'connecting' ? 'Exchanging handshake…' : 'The game starts the moment the channel opens.'}
              </span>
            </div>
          </>
        )}
        {error && <div className="chip chip-danger">{error}</div>}
      </div>
    </div>
  );
}

export function GuestFlow({
  reply, state, error, onJoin,
}: {
  reply: string;
  state: PeerState;
  error: string | null;
  onJoin: (code: string, name: string) => Promise<void>;
}) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('Guest');
  const joined = reply !== '';

  return (
    <div className="panel mt-16" style={{ maxWidth: 640 }}>
      <div className="panel-title">Join room</div>
      <div className="panel-pad stack gap-16">
        {!joined ? (
          <>
            <div className="field">
              <span className="field-label">Your name</span>
              <input value={name} disabled={state === 'joining'} onChange={(e) => setName(e.target.value.slice(0, 18))} aria-label="Your name" />
            </div>
            <div className="field">
              <span className="field-label">Host's room code</span>
              <textarea
                value={code}
                maxLength={65536}
                onChange={(e) => setCode(e.target.value)}
                placeholder="Paste the room code here…"
                aria-label="Host room code"
                rows={3}
              />
            </div>
            <div>
              <ActionButton className="btn btn-primary" blockedReason={state === 'joining' ? 'The reply code is being generated. Wait for it to finish.' : code.trim().length === 0 && 'Paste the host’s room code before generating a reply.'} onClick={() => { sound.unlock(); void onJoin(code, name); }}>
                GENERATE REPLY
              </ActionButton>
            </div>
          </>
        ) : (
          <>
            <CodeBox code={reply} label="Send this reply code back to the host" />
            <div className="tiny faint">
              {state === 'connected'
                ? 'Connected! The host starts the game.'
                : 'Waiting for the host to paste your reply — keep this tab open.'}
            </div>
          </>
        )}
        {error && <div className="chip chip-danger">{error}</div>}
      </div>
    </div>
  );
}
