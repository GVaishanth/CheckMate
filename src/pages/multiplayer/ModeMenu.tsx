import { IconLink, IconPlay } from '../../components/icons';
import type { Mode } from './shared';

export function ModeMenu({ onPick }: { onPick: (m: Mode) => void }) {
  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Human opponents</div>
          <h1 className="page-title">Multiplayer</h1>
          <p className="page-sub">
            No accounts, no matchmaking server. Bring your own opponent — over a direct
            browser-to-browser connection, or on the same screen.
          </p>
        </div>
      </div>
      <div className="mp-choices">
        <button className="panel mp-choice" onClick={() => onPick('p2p')}>
          <div className="spread">
            <IconLink size={20} />
            <span className="chip">PEER-TO-PEER</span>
          </div>
          <div className="mp-choice-title">DIRECT CONNECTION</div>
          <p className="small muted" style={{ margin: 0 }}>
            Two browsers, one game. Exchange two short connection codes with your opponent — over
            any chat — then play over a direct WebRTC channel. The host validates every move.
          </p>
          <span className="mp-choice-cta">CREATE ROOM →</span>
        </button>
        <button className="panel mp-choice" onClick={() => onPick('local')}>
          <div className="spread">
            <IconPlay size={20} />
            <span className="chip">SAME DEVICE</span>
          </div>
          <div className="mp-choice-title">PASS &amp; PLAY</div>
          <p className="small muted" style={{ margin: 0 }}>
            Hand the device over after every move. The board turns to face whoever is thinking.
            Perfect for a coffee-shop duel.
          </p>
          <span className="mp-choice-cta">START DUEL →</span>
        </button>
      </div>
    </>
  );
}
