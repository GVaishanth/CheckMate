import { useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { IconKnight, IconSettings } from './icons';

const NAV = [
  { to: '/bots', label: 'PLAY' },
  { to: '/puzzles', label: 'PUZZLES' },
  { to: '/elo-test', label: 'ELO TEST' },
  { to: '/multiplayer', label: 'MULTIPLAYER' },
  { to: '/history', label: 'HISTORY' },
] as const;

export function AppShell({ children, onOpenSettings }: { children: React.ReactNode; onOpenSettings: () => void }) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <>
      <a href="#main" className="skip-link">Skip to content</a>
      <header className="nav">
        <div className="container nav-inner">
          <Link to="/" className="nav-logo" aria-label="CHECKMATE — home">
            <IconKnight size={21} />
            <span className="nav-wordmark">CHECKMATE</span>
          </Link>

          <nav className="nav-links" aria-label="Primary">
            {NAV.map(({ to, label }) => (
              <NavLink key={to} to={to} className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
                {label}
              </NavLink>
            ))}
          </nav>

          <div className="nav-actions">
            <button className="tool-btn" onClick={onOpenSettings} aria-label="Settings">
              <IconSettings size={16} />
            </button>
            <button
              className="nav-burger"
              onClick={() => setMenuOpen((v) => !v)}
              aria-expanded={menuOpen}
              aria-label="Menu"
            >
              <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
                <path d={menuOpen ? 'M3 3l12 12M15 3L3 15' : 'M3 5h12M3 9h12M3 13h12'} stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </div>

        {menuOpen && (
          <nav className="nav-mobile" aria-label="Mobile">
            {NAV.map(({ to, label }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) => `nav-mobile-link${isActive ? ' active' : ''}`}
                onClick={() => setMenuOpen(false)}
              >
                {label}
              </NavLink>
            ))}
            <button className="nav-mobile-link" onClick={() => { setMenuOpen(false); onOpenSettings(); }}>
              <IconSettings size={15} />
              SETTINGS
            </button>
            <button className="nav-mobile-link" onClick={() => setMenuOpen(false)}>
              CLOSE MENU
            </button>
          </nav>
        )}
      </header>

      <main id="main" className="main">
        {children}
      </main>

      <footer className="footer">
        <div className="container footer-inner">
          <span className="tiny faint mono">CHECKMATE · runs entirely in your browser</span>
          <span className="tiny faint">
            <kbd>Ctrl</kbd> <kbd>K</kbd> commands · <kbd>F</kbd> flip · <kbd>M</kbd> moves
          </span>
        </div>
      </footer>
    </>
  );
}
