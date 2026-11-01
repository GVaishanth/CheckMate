/** Settings modal — board, gameplay, audio, accessibility, data. */
import { useEffect, useRef, useState } from 'react';
import { Modal } from './Modal';
import { BoardTheme, PieceStyle, useSettings } from '../storage/settings';
import { clearAll, exportAll, importAll, dbAvailable } from '../storage/db';
import type { ExportBundle } from '../storage/db';
import { wipeSettings } from '../storage/settings';
import { downloadFile } from '../utils';
import { sound } from '../audio/sound';
import { IconDownload, IconUpload } from './icons';
import { useToast } from './Toast';

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const { settings, update } = useSettings();
  const { toast } = useToast();
  const [confirmReset, setConfirmReset] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const doExport = async () => {
    try {
      const bundle = await exportAll();
      downloadFile(`checkmate-data-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(bundle, null, 2), 'application/json');
      toast('Data exported.', 'success');
    } catch {
      toast('Export failed.', 'danger');
    }
  };

  const doImport = async (file: File) => {
    try {
      const text = await file.text();
      const bundle = JSON.parse(text) as ExportBundle;
      const counts = await importAll(bundle);
      toast(`Imported ${counts.games} games, ${counts.puzzles} puzzles and ${counts.education} lessons. Reloading…`, 'success');
      setTimeout(() => window.location.reload(), 900);
    } catch (err) {
      toast(err instanceof Error ? `Import failed: ${err.message}` : 'Import failed — not a valid file.', 'danger');
    }
  };

  const doReset = async () => {
    try {
      await clearAll();
      wipeSettings();
      toast('All local data erased.');
      setTimeout(() => window.location.reload(), 700);
    } catch {
      toast('Reset failed.', 'danger');
    }
  };

  return (
    <Modal title="Settings" onClose={onClose} wide closeLabel="Close settings">
      <section className="settings-section" aria-label="Board">
        <div className="panel-title">Board</div>
        <div className="panel-pad stack gap-12">
          <div className="spread">
            <div>
              <div className="settings-row-label">Board theme</div>
              <div className="settings-row-desc">Square color palette</div>
            </div>
            <div className="board-theme-swatches" role="group" aria-label="Board theme">
              {(['carbon', 'tournament', 'walnut', 'fog'] as BoardTheme[]).map((t) => (
                <button
                  key={t}
                  className={`theme-swatch ${t}`}
                  aria-pressed={settings.boardTheme === t}
                  aria-label={`${t} theme`}
                  title={t}
                  onClick={() => update({ boardTheme: t })}
                />
              ))}
            </div>
          </div>

          <SettingToggle
            label="Piece style"
            desc="Vanguard (custom) or classic glyphs"
            checked={settings.pieceStyle === 'glyph'}
            onChange={(on) => update({ pieceStyle: (on ? 'glyph' : 'vanguard') as PieceStyle })}
            onLabel="GLYPHS"
            offLabel="VANGUARD"
          />
          <SettingToggle
            label="Coordinates"
            desc="File and rank labels on the board"
            checked={settings.showCoordinates}
            onChange={(on) => update({ showCoordinates: on })}
          />
          <SettingToggle
            label="Default orientation"
            desc="Which side faces you when a game starts"
            checked={settings.defaultOrientation === 'black'}
            onChange={(on) => update({ defaultOrientation: on ? 'black' : 'white' })}
            onLabel="BLACK"
            offLabel="WHITE"
          />
        </div>
      </section>

      <section className="settings-section" aria-label="Gameplay">
        <div className="panel-title">Gameplay</div>
        <div className="panel-pad stack gap-12">
          <SettingToggle
            label="Move animation"
            desc="Slide pieces to their squares"
            checked={settings.animateMoves}
            onChange={(on) => update({ animateMoves: on })}
          />
          <SettingToggle
            label="Auto-queen"
            desc="Skip the promotion dialog"
            checked={settings.autoQueen}
            onChange={(on) => update({ autoQueen: on })}
          />
          <SettingToggle
            label="Confirm moves"
            desc="Stage each move before it commits"
            checked={settings.confirmMoves}
            onChange={(on) => update({ confirmMoves: on })}
          />
          <SettingToggle
            label="Show legal moves"
            desc="Dots on squares the selected piece can reach"
            checked={settings.showLegalMoves}
            onChange={(on) => update({ showLegalMoves: on })}
          />
        </div>
      </section>

      <section className="settings-section" aria-label="Audio">
        <div className="panel-title">Audio</div>
        <div className="panel-pad stack gap-12">
          <SettingToggle
            label="Sound effects"
            desc="Synthesized move, capture and check cues"
            checked={settings.sound}
            onChange={(on) => {
              update({ sound: on });
              sound.setEnabled(on);
              if (on) sound.play('uiTick');
            }}
          />
          <SettingToggle
            label="Interface sounds"
            desc="Tiny clicks for buttons and copy actions"
            checked={settings.uiSounds}
            onChange={(on) => {
              update({ uiSounds: on });
              sound.setUiSounds(on);
              if (on) sound.play('uiTick');
            }}
          />
          <div className="spread">
            <div>
              <div className="settings-row-label">Volume</div>
              <div className="settings-row-desc">Applies to all effects</div>
            </div>
            <div style={{ width: 180 }}>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={settings.volume}
                aria-label="Volume"
                onChange={(e) => {
                  const v = Number(e.target.value);
                  update({ volume: v });
                  sound.setVolume(v);
                }}
              />
            </div>
          </div>
        </div>
      </section>

      <section className="settings-section" aria-label="Accessibility">
        <div className="panel-title">Accessibility</div>
        <div className="panel-pad stack gap-12">
          <SettingToggle
            label="Reduced motion"
            desc="Minimize animation (also follows your OS setting)"
            checked={settings.reducedMotion === 'on'}
            onChange={(on) => update({ reducedMotion: on ? 'on' : 'auto' })}
          />
          <SettingToggle
            label="High contrast"
            desc="Stronger surfaces, text and focus outlines"
            checked={settings.highContrast}
            onChange={(on) => update({ highContrast: on })}
          />
          <div className="small muted">
            Keyboard: arrows move the board cursor, <kbd>Enter</kbd> picks a piece, <kbd>Esc</kbd> clears,{' '}
            <kbd>F</kbd> flips the board, <kbd>M</kbd> toggles the move list.
          </div>
        </div>
      </section>

      <section className="settings-section" aria-label="Data">
        <div className="panel-title">Data</div>
        <div className="panel-pad stack gap-12">
          <div className="row">
            <button className="btn btn-sm" onClick={doExport}>
              <IconDownload size={14} /> EXPORT DATA
            </button>
            <button className="btn btn-sm" onClick={() => fileRef.current?.click()}>
              <IconUpload size={14} /> IMPORT DATA
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json"
              className="sr-only"
              aria-label="Import data file"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void doImport(f);
                e.target.value = '';
              }}
            />
          </div>
          <div className="small muted">
            Everything lives in this browser (IndexedDB + localStorage). Nothing is ever uploaded.
          </div>
          {confirmReset ? (
            <div className="panel panel-pad stack gap-12" style={{ borderColor: 'rgba(224,91,82,0.5)' }}>
              <div className="small">
                Erase <strong>all</strong> local data — games, puzzle progress, lesson progress, Elo history and settings? This cannot be undone.
              </div>
              <div className="row">
                <button className="btn btn-danger btn-sm" onClick={doReset}>
                  ERASE EVERYTHING
                </button>
                <button className="btn btn-ghost btn-sm" onClick={() => setConfirmReset(false)}>
                  KEEP MY DATA
                </button>
              </div>
            </div>
          ) : (
            <div>
              <button className="btn btn-danger btn-sm" onClick={() => setConfirmReset(true)}>
                RESET ALL DATA
              </button>
            </div>
          )}
          <StorageNote />
        </div>
      </section>
    </Modal>
  );
}

function StorageNote() {
  const [ok, setOk] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    void dbAvailable().then((v) => {
      if (alive) setOk(!v);
    });
    return () => {
      alive = false;
    };
  }, []);
  if (!ok) return null;
  return (
    <div className="chip chip-danger" role="status">
      Persistent storage unavailable — progress lives only for this session.
    </div>
  );
}

function SettingToggle({
  label, desc, checked, onChange, onLabel, offLabel,
}: {
  label: string;
  desc?: string;
  checked: boolean;
  onChange: (on: boolean) => void;
  onLabel?: string;
  offLabel?: string;
}) {
  const id = `tg-${label.replace(/\s+/g, '-')}`;
  return (
    <div className="spread">
      <div>
        <label className="settings-row-label" htmlFor={id}>{label}</label>
        {desc && <div className="settings-row-desc">{desc}</div>}
      </div>
      <label className="toggle">
        {onLabel && <span className="mono tiny muted">{checked ? onLabel : offLabel ?? 'OFF'}</span>}
        <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span className="toggle-track">
          <span className="toggle-thumb" />
        </span>
      </label>
    </div>
  );
}


