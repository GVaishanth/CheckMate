/** Connection-code exchange UI for the host and guest flows. */
import { useState } from 'react';
import { useToast } from '../../components/Toast';
import { sound } from '../../audio/sound';
import { BLACK, Color, WHITE } from '../../chess/constants';
import { PeerState } from '../../multiplayer/peer';
import { IconCopy } from '../../components/icons';

export function CodeBox({ code, label }: { code: string; label: string }) {
  const { toast } = useToast();
  return (
    <div className="code-box">
      <div className="tiny faint">{label}</div>
      <textarea readOnly value={code} aria-label={label} onFocus={(e) => e.currentTarget.select()} />
      <button
        className="btn btn-sm"
        onClick={() =>
          void navigator.clipboard
            .writeText(code)
            .then(() => toast('Code copied — send it to your opponent.', 'success'))
            .catch(() => {
              // Fallback for non-secure contexts.
              const el = document.querySelector<HTMLTextAreaElement>('.code-box textarea');
              el?.select();
              if (el && document.execCommand('copy')) toast('Code copied.', 'success');
              else toast('Select the code and copy it manually.', 'default');
            })
        }
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
          <input value={name} onChange={(e) => setName(e.target.value.slice(0, 18))} aria-label="Your name" />
        </div>
        <div className="field">
          <span className="field-label">Your side</span>
          <div className="seg" role="group" aria-label="Choose side">
            {(['white', 'random', 'black'] as const).map((c) => (
              <button key={c} aria-pressed={color === c} onClick={() => setColor(c)}>
                {c.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
        {!created ? (
          <div>
            <button
              className="btn btn-primary"
              disabled={state === 'creating'}
              onClick={() => {
                const resolved: Color = color === 'random' ? (Math.random() < 0.5 ? WHITE : BLACK) : color === 'white' ? WHITE : BLACK;
                sound.unlock();
                void onCreate(name, resolved);
              }}
            >
              CREATE ROOM
            </button>
          </div>
        ) : (
          <>
            <CodeBox code={code} label="Step 1 — send this room code to your opponent" />
            <div className="field">
              <span className="field-label">Step 2 — paste your opponent's reply code</span>
              <textarea
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                placeholder="Paste the reply code here…"
                aria-label="Opponent reply code"
                rows={3}
              />
            </div>
            <div className="row">
              <button className="btn btn-primary" disabled={reply.trim().length === 0} onClick={() => void onAnswer(reply)}>
                CONNECT
              </button>
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
              <input value={name} onChange={(e) => setName(e.target.value.slice(0, 18))} aria-label="Your name" />
            </div>
            <div className="field">
              <span className="field-label">Host's room code</span>
              <textarea
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="Paste the room code here…"
                aria-label="Host room code"
                rows={3}
              />
            </div>
            <div>
              <button className="btn btn-primary" disabled={code.trim().length === 0} onClick={() => { sound.unlock(); void onJoin(code, name); }}>
                GENERATE REPLY
              </button>
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
