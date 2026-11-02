/**
 * App root — routing, settings provider, global overlays (settings modal,
 * command palette, toasts), hotkeys, error boundary and PWA registration.
 */
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { HashRouter, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { sound } from './audio/sound';
import { ToastProvider } from './components/Toast';
import { SettingsModal } from './components/SettingsModal';
import { CommandPalette } from './components/CommandPalette';
import { ErrorScreen } from './components/ErrorScreen';
import {
  DEFAULT_SETTINGS, Settings, SettingsContext, loadSettings, saveSettings, normaliseSettings,
} from './storage/settings';
import { HomePage } from './pages/HomePage';
import { BotsPage } from './pages/BotsPage';
import { MultiplayerPage } from './pages/MultiplayerPage';
import { PuzzlesPage } from './pages/PuzzlesPage';
import { EloTestPage } from './pages/EloTestPage';
import { HistoryPage } from './pages/HistoryPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { CommandRegistry } from './game/commands';

const EducationPage = lazy(() => import('./pages/EducationPage').then((module) => ({ default: module.EducationPage })));

export function App() {
  const [settings, setSettings] = useState<Settings>(() => {
    try {
      return loadSettings();
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [storageOk, setStorageOk] = useState(true);
  const [dataVersion, setDataVersion] = useState(0);
  useEffect(() => {
    const changed = () => setDataVersion((value) => value + 1);
    window.addEventListener('checkmate:data-changed', changed);
    return () => window.removeEventListener('checkmate:data-changed', changed);
  }, []);

  useEffect(() => {
    setStorageOk(saveSettings(settings));
    document.documentElement.dataset.boardTheme = settings.boardTheme;
    document.documentElement.dataset.highContrast = String(settings.highContrast);
    document.documentElement.dataset.reducedMotion = String(settings.reducedMotion === 'on');
  }, [settings]);

  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => normaliseSettings({ ...prev, ...patch }));
  }, []);

  const resetSettings = useCallback(() => setSettings({ ...DEFAULT_SETTINGS }), []);

  const settingsValue = useMemo(
    () => ({ settings, update, reset: resetSettings, storageOk }),
    [settings, update, resetSettings, storageOk],
  );

  // Global hotkeys: Ctrl+K / "/" command palette, Esc closes overlays.
  useEffect(() => {
    const openSettings = () => setSettingsOpen(true);
    window.addEventListener('checkmate:open-settings', openSettings);
    return () => window.removeEventListener('checkmate:open-settings', openSettings);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((v) => !v);
        return;
      }
      if (e.key === 'Escape') {
        setPaletteOpen(false);
        return;
      }
      if (typing) return;
      if (e.key === '/' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        setPaletteOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    sound.setEnabled(settings.sound);
    sound.setUiSounds(settings.uiSounds);
    sound.setVolume(settings.volume);
  }, [settings.sound, settings.uiSounds, settings.volume]);

  // Register service worker in production builds only.
  useEffect(() => {
    if (import.meta.env.PROD && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').catch(() => {
        /* offline caching unavailable — the app still works online */
      });
    }
  }, []);

  return (
    <ErrorScreen>
      <SettingsContext.Provider value={settingsValue}>
        <ToastProvider>
          <CommandRegistry>
            <HashRouter>
              <AppShell onOpenSettings={() => setSettingsOpen(true)}>
                <Routes key={dataVersion}>
                  <Route path="/" element={<HomePage />} />
                  <Route path="/bots" element={<BotsPage />} />
                  <Route path="/multiplayer" element={<MultiplayerPage />} />
                  <Route path="/puzzles" element={<PuzzlesPage />} />
                  <Route path="/learn" element={<Suspense fallback={<div className="page container" role="status">Loading your course…</div>}><EducationPage /></Suspense>} />
                  <Route path="/learn/:lessonId" element={<Suspense fallback={<div className="page container" role="status">Loading your course…</div>}><EducationPage /></Suspense>} />
                  <Route path="/elo-test" element={<EloTestPage />} />
                  <Route path="/history" element={<HistoryPage />} />
                  <Route path="/review/:id" element={<HistoryPage />} />
                  <Route path="*" element={<NotFoundPage />} />
                </Routes>
              </AppShell>
              {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
              {paletteOpen && <CommandPalette onClose={() => setPaletteOpen(false)} />}
            </HashRouter>
          </CommandRegistry>
        </ToastProvider>
      </SettingsContext.Provider>
    </ErrorScreen>
  );
}
