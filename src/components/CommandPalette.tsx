/** Command palette (Ctrl+K or "/") — keyboard-first navigation + actions. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useCommands, useGlobalCommands, Command } from '../game/commands';
import {
  IconBots, IconFlip, IconGauge, IconHistory, IconKnight, IconLink, IconList, IconPlay,
  IconPuzzle, IconSettings, IconSound, IconMute,
} from './icons';
import { ToastHost } from './Toast';
import { useDialogFocus } from './useDialogFocus';
import { useSettings } from '../storage/settings';
import { sound } from '../audio/sound';

const iconFor = (id: string): React.ReactNode => {
  if (id.startsWith('nav-home')) return <IconKnight size={15} />;
  if (id.startsWith('nav-bots') || id.includes('new-game')) return <IconBots size={15} />;
  if (id.startsWith('nav-mp')) return <IconLink size={15} />;
  if (id.startsWith('nav-puzzles')) return <IconPuzzle size={15} />;
  if (id.startsWith('nav-elo')) return <IconGauge size={15} />;
  if (id.startsWith('nav-history')) return <IconHistory size={15} />;
  if (id.includes('flip')) return <IconFlip size={15} />;
  if (id.includes('moves')) return <IconList size={15} />;
  if (id.includes('sound')) return <IconSound size={15} />;
  if (id.includes('settings')) return <IconSettings size={15} />;
  return <IconPlay size={15} />;
};

export function CommandPalette({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  useDialogFocus(panelRef, onClose);
  const listRef = useRef<HTMLDivElement>(null);
  const { commands: contextual } = useCommands();
  const { settings, update } = useSettings();
  const globalCommands = useGlobalCommands();

  const systemCommands: Command[] = useMemo(() => {
    const cmds: Command[] = [
      {
        id: 'sys-sound',
        label: settings.sound ? 'Mute Sound' : 'Unmute Sound',
        group: 'System',
        icon: settings.sound ? <IconMute size={15} /> : <IconSound size={15} />,
        run: () => {
          update({ sound: !settings.sound });
          sound.setEnabled(!settings.sound);
        },
      },
      {
        id: 'sys-settings',
        label: 'Open Settings',
        group: 'System',
        run: () => window.dispatchEvent(new CustomEvent('checkmate:open-settings')),
      },

    ];
    return cmds;
  }, [settings.sound, update]);

  const all = useMemo(() => [...contextual, ...globalCommands, ...systemCommands], [contextual, globalCommands, systemCommands]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter((c) =>
      `${c.label} ${c.group} ${c.keywords ?? ''}`.toLowerCase().includes(q),
    );
  }, [all, query]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    setSelected(0);
  }, [query]);

  const runCommand = (cmd: Command) => {
    onClose();
    queueMicrotask(() => cmd.run());
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelected((s) => Math.max(0, Math.min(filtered.length - 1, s + 1)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelected((s) => Math.max(0, s - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const cmd = filtered[selected];
      if (cmd) runCommand(cmd);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  useEffect(() => {
    const el = listRef.current?.querySelector('[data-selected="true"]');
    el?.scrollIntoView({ block: 'nearest' });
  }, [selected, filtered]);

  let lastGroup = '';

  return (
    <div className="palette-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="palette" ref={panelRef} role="dialog" aria-modal="true" aria-label="Command palette">
        <ToastHost />
        <input
          ref={inputRef}
          className="palette-input"
          placeholder="Type a command…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          aria-label="Search commands"
        />
        <div className="palette-list" ref={listRef}>
          {filtered.length === 0 && (
            <div className="palette-empty">No command matches “{query}”.</div>
          )}
          {filtered.map((cmd, i) => {
            const showGroup = cmd.group !== lastGroup;
            lastGroup = cmd.group;
            return (
              <div key={cmd.id}>
                {showGroup && <div className="palette-group">{cmd.group}</div>}
                <button
                  className={`palette-item${i === selected ? ' selected' : ''}`}
                  data-selected={i === selected}
                  onMouseEnter={() => setSelected(i)}
                  onClick={() => runCommand(cmd)}
                >
                  <span className="pi-icon">{cmd.icon ?? iconFor(cmd.id)}</span>
                  <span>{cmd.label}</span>
                  {cmd.hint && <kbd>{cmd.hint}</kbd>}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
