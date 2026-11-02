/**
 * Command registry — contextual actions for the command palette (Ctrl+K).
 * Pages register game-context commands (flip board, new game…) while mounted.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

export interface Command {
  id: string;
  label: string;
  group: string;
  hint?: string;
  icon?: React.ReactNode;
  keywords?: string;
  run: () => void;
}

interface CommandContextValue {
  register: (cmds: Command[]) => () => void;
  commands: Command[];
}

const CommandContext = createContext<CommandContextValue>({
  register: () => () => undefined,
  commands: [],
});

export const useCommands = (): CommandContextValue => useContext(CommandContext);

export function CommandRegistry({ children }: { children: React.ReactNode }) {
  const [registrations, setRegistrations] = useState<Array<{ token: number; commands: Command[] }>>([]);
  const seq = useRef(0);
  const register = useCallback((commands: Command[]) => {
    const token = ++seq.current;
    setRegistrations((previous) => [...previous, { token, commands }]);
    return () => setRegistrations((previous) => previous.filter((entry) => entry.token !== token));
  }, []);
  const contextual = useMemo(() => {
    const unique = new Map<string, Command>();
    for (const entry of registrations) for (const command of entry.commands) unique.set(command.id, command);
    return [...unique.values()];
  }, [registrations]);

  const value = useMemo(() => ({ register, commands: contextual }), [register, contextual]);
  return <CommandContext.Provider value={value}>{children}</CommandContext.Provider>;
}

/** Hook pages use to expose their contextual commands. */
export function useRegisterCommands(cmds: Command[]): void {
  const { register } = useCommands();
  const key = JSON.stringify(cmds.map(({ id, label, group, hint, keywords }) => ({ id, label, group, hint, keywords })));
  const latest = useRef(cmds);
  latest.current = cmds;
  useEffect(() => register(latest.current.map((command) => ({ ...command, run: () => latest.current.find((item) => item.id === command.id)?.run() }))), [key, register]);
}

/** Global navigation commands (used by the palette everywhere). */
export function useGlobalCommands(): Command[] {
  const navigate = useNavigate();
  return useMemo(
    () => [
      { id: 'nav-home', label: 'Home', group: 'Navigate', keywords: 'start hub', run: () => navigate('/') },
      { id: 'nav-bots', label: 'Play vs Bot', group: 'Navigate', keywords: 'play game computer opponent', run: () => navigate('/bots') },
      { id: 'nav-mp', label: 'Multiplayer', group: 'Navigate', keywords: 'p2p friend webrtc local', run: () => navigate('/multiplayer') },
      { id: 'nav-puzzles', label: 'Puzzles', group: 'Navigate', keywords: 'tactics training', run: () => navigate('/puzzles') },
      { id: 'nav-learn', label: 'Education', group: 'Navigate', keywords: 'learn study opening checkmate practice recall lesson', run: () => navigate('/learn') },
      { id: 'nav-elo', label: 'Test Elo', group: 'Navigate', keywords: 'rating strength estimate', run: () => navigate('/elo-test') },
      { id: 'nav-history', label: 'Game History', group: 'Navigate', keywords: 'pgn games archive', run: () => navigate('/history') },
    ],
    [navigate],
  );
}
