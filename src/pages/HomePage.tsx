import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { HeroCanvas } from '../components/HeroCanvas';
import { BOTS } from '../engine/bots';
import { gamesRepo, puzzlesRepo, eloRepo } from '../storage/db';
import { IconTrophy } from '../components/icons';

const WORD = 'CHECKMATE';

export function HomePage() {
  const [stats, setStats] = useState<{ games: number; solved: number; bestStreak: number; lastElo: number | null } | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const [games, puzzleSum, elo] = await Promise.all([gamesRepo.all(), puzzlesRepo.summary(), eloRepo.all()]);
        if (!alive) return;
        setStats({
          games: games.length,
          solved: puzzleSum.solved,
          bestStreak: puzzleSum.bestStreak,
          lastElo: elo[0]?.rating ?? null,
        });
      } catch {
        if (alive) setStats({ games: 0, solved: 0, bestStreak: 0, lastElo: null });
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  return (
    <>
      <section className="title-screen">
        <HeroCanvas />
        <div className="container ts-inner">
          <div className="ts-kicker">Browser-native chess arena</div>
          <h1 className="ts-logo" aria-label="CHECKMATE">
            {WORD.split('').map((ch, i) => (
              <span className="ch" key={i} style={{ animationDelay: `${i * 45}ms` }} aria-hidden="true">{ch}</span>
            ))}
            <span className="ch dot" style={{ animationDelay: `${WORD.length * 45}ms` }} aria-hidden="true">.</span>
          </h1>
          <div className="ts-tag">Think. Calculate. Checkmate.</div>
          <div className="ts-cta">
            <Link to="/bots" className="btn btn-primary btn-lg">Enter the arena</Link>
          </div>
          <nav className="mode-strip" aria-label="Game modes">
            <Link className="mode-strip-item" to="/bots">
              <span className="mode-strip-num">01</span>
              <span className="mode-strip-name">BOTS</span>
            </Link>
            <Link className="mode-strip-item" to="/puzzles">
              <span className="mode-strip-num">02</span>
              <span className="mode-strip-name">PUZZLES</span>
            </Link>
            <Link className="mode-strip-item" to="/elo-test">
              <span className="mode-strip-num">03</span>
              <span className="mode-strip-name">ELO TEST</span>
            </Link>
            <Link className="mode-strip-item" to="/multiplayer">
              <span className="mode-strip-num">04</span>
              <span className="mode-strip-name">MULTIPLAYER</span>
            </Link>
            <Link className="mode-strip-item" to="/learn">
              <span className="mode-strip-num">05</span>
              <span className="mode-strip-name">EDUCATION</span>
            </Link>
          </nav>
        </div>
      </section>

      <section className="home-section">
        <div className="container">
          <div className="home-section-head">
            <div>
              <div className="eyebrow">Opponents</div>
              <h2 className="home-section-title">The ladder</h2>
            </div>
            <Link to="/bots" className="mono tiny faint">FULL ROSTER →</Link>
          </div>
          <div className="roster">
            {BOTS.map((bot) => (
              <Link key={bot.id} to="/bots" className="roster-row" aria-label={`${bot.name}, ${bot.elo}`}>
                <span className="roster-pips" aria-hidden="true">
                  {[1, 2, 3, 4, 5, 6].map((i) => (
                    <span key={i} className={`roster-pip${i <= bot.pips ? ' on' : ''}`} />
                  ))}
                </span>
                <span className="roster-identity">
                  <span className="roster-name">{bot.name}</span>
                  <span className="roster-elo">{bot.elo}</span>
                  <span className="roster-tag">{bot.tagline}</span>
                </span>
                <span className="roster-cta">CHALLENGE →</span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="home-section" style={{ borderBottom: 0 }}>
        <div className="container">
          <div className="home-section-head">
            <div>
              <div className="eyebrow">Your record</div>
              <h2 className="home-section-title">Local numbers</h2>
            </div>
          </div>
          {stats && (stats.games > 0 || stats.solved > 0) ? (
            <div className="record-row">
              <div className="record-cell">
                <div className="record-value">{stats.games}</div>
                <div className="record-label">Games</div>
              </div>
              <div className="record-cell">
                <div className="record-value">{stats.solved}</div>
                <div className="record-label">Puzzles</div>
              </div>
              <div className="record-cell">
                <div className="record-value">{stats.bestStreak}</div>
                <div className="record-label">Best streak</div>
              </div>
              <div className="record-cell">
                <div className="record-value">{stats.lastElo ?? '—'}</div>
                <div className="record-label">Last est. Elo</div>
              </div>
            </div>
          ) : (
            <div className="empty">
              <div className="empty-glyph"><IconTrophy size={26} /></div>
              <div className="empty-title">No games yet</div>
              <p className="small muted">Your first match is waiting.</p>
              <Link to="/bots" className="btn btn-primary" style={{ marginTop: 16 }}>Play a game</Link>
            </div>
          )}
        </div>
      </section>
    </>
  );
}
