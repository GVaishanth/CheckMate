import { ActionButton } from './ActionButton';
/** Settings modal — board, gameplay, audio, accessibility, data. */
import { useEffect, useRef, useState } from 'react';
import { Modal } from './Modal';
import { BoardTheme, PieceStyle, useSettings, loadSettings } from '../storage/settings';
import { resetAll, exportAll, importAll, dbAvailable } from '../storage/db';
import { downloadFile } from '../utils';
import { sound } from '../audio/sound';
import { IconDownload, IconUpload } from './icons';
import { useToast } from './Toast';

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const { settings, update, reset } = useSettings();
  const { toast } = useToast();
  const [confirmReset, setConfirmReset] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const working = useRef(false);
  const [busy, setBusy] = useState(false);
  const begin = () => { if (working.current) return false; working.current = true; setBusy(true); return true; };
  const finish = () => { working.current = false; setBusy(false); };
  const refresh = () => { window.dispatchEvent(new Event('checkmate:data-changed')); onClose(); };

  const doExport = async () => {
    if (!begin()) return;
    try {
      const bundle = await exportAll();
      downloadFile(`checkmate-data-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(bundle, null, 2), 'application/json');
      toast('Data exported.', 'success');
    } catch {
      toast('Export failed.', 'danger');
    } finally { finish(); }
  };

  const doImport = async (file: File) => {
    if (!begin()) return;
    try {
      if (file.size > 50 * 1024 * 1024) throw new Error('The backup exceeds 50 MB.');
      const counts = await importAll(JSON.parse(await file.text()));
      update(loadSettings());
      toast(`Restored ${counts.games} games, ${counts.puzzles} puzzles and ${counts.education} lessons.${counts.persistent ? '' : ' Saving is unavailable; keep your backup.'}`, counts.persistent ? 'success' : 'default');
      refresh();
    } catch (err) {
      toast(err instanceof Error ? `Import failed: ${err.message}` : 'Import failed — not a valid file.', 'danger');
    } finally { finish(); }
  };

  const doReset = async () => {
    if (!begin()) return;
    try {
      const persistent = await resetAll();
      reset();
      toast(persistent ? 'All CHECKMATE data erased.' : 'Session data cleared. Browser storage could not be fully accessed.', persistent ? 'success' : 'default');
      refresh();
    } catch {
      toast('Reset failed. Existing records were not replaced.', 'danger');
    } finally { finish(); }
  };

  return (
    <Modal title="Settings" onClose={() => { if (!working.current) onClose(); }} wide busy={busy} closeLabel="Close settings">
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

      <section className="settings-section" aria-label="Data" aria-busy={busy}>
        <div className="panel-title">Data</div>
        <div className="panel-pad stack gap-12">
          <div className="row">
            <ActionButton className="btn btn-sm" blockedReason={busy && 'A data operation is still running. Wait for it to finish before starting another action.'} onClick={doExport}>
              <IconDownload size={14} /> EXPORT DATA
            </ActionButton>
            <ActionButton className="btn btn-sm" blockedReason={busy && 'A data operation is still running. Wait for it to finish before starting another action.'} onClick={() => fileRef.current?.click()}>
              <IconUpload size={14} /> IMPORT DATA
            </ActionButton>
            <input
              ref={fileRef}
              tabIndex={-1}
              type="file"
              accept="application/json"
              className="sr-only"
              aria-label="Import data file"
              disabled={busy}
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
                <ActionButton className="btn btn-danger btn-sm" blockedReason={busy && 'A data operation is still running. Wait for it to finish before starting another action.'} onClick={doReset}>
                  ERASE EVERYTHING
                </ActionButton>
                <ActionButton className="btn btn-ghost btn-sm" blockedReason={busy && 'A data operation is still running. Wait for it to finish before starting another action.'} onClick={() => setConfirmReset(false)}>
                  KEEP MY DATA
                </ActionButton>
              </div>
            </div>
          ) : (
            <div>
              <ActionButton className="btn btn-danger btn-sm" blockedReason={busy && 'A data operation is still running. Wait for it to finish before starting another action.'} onClick={() => setConfirmReset(true)}>
                RESET ALL DATA
              </ActionButton>
            </div>
          )}
          <StorageNote />
        </div>
      </section>
      <section className="settings-section" aria-label="Licences">
        <div className="panel-title">Licences</div>
        <div className="panel-pad row wrap small">
          <a href="./licenses/project.txt" target="_blank" rel="noopener noreferrer">Project MIT licence</a>
          <a href="./licenses/third-party.txt" target="_blank" rel="noopener noreferrer">Third-party notices</a>
          <a href="./licenses/opening-data.txt" target="_blank" rel="noopener noreferrer">Opening data · CC0</a>
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


