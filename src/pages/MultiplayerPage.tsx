/**
 * Multiplayer — pick a mode: a direct peer-to-peer connection (WebRTC, no
 * servers) or pass & play on one device.
 */
import { useMemo, useState } from 'react';
import { useRegisterCommands } from '../game/commands';
import { ModeMenu } from './multiplayer/ModeMenu';
import { P2PGame } from './multiplayer/P2PGame';
import { LocalGame } from './multiplayer/LocalGame';
import type { Mode } from './multiplayer/shared';

export function MultiplayerPage() {
  const [mode, setMode] = useState<Mode>('menu');

  useRegisterCommands(
    useMemo(
      () => [{ id: 'mp-new-game', label: 'New Game', group: 'Game', run: () => setMode('menu') }],
      [],
    ),
  );

  return (
    <div className="page">
      <div className="container">
        {mode === 'menu' && <ModeMenu onPick={setMode} />}
        {mode === 'p2p' && <P2PGame onExit={() => setMode('menu')} />}
        {mode === 'local' && <LocalGame onExit={() => setMode('menu')} />}
      </div>
    </div>
  );
}
