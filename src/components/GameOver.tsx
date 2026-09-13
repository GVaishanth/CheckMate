/** Cinematic game-over panel. */
import { useEffect, useState } from 'react';

export interface GameOverProps {
  /** Endgame winner color (used for the "side" outcome title). */
  winner: 'white' | 'black' | null;
  /**
   * Perspective for the big title: "win"/"loss"/"draw" from the local
   * player's viewpoint, or "side" for shared-screen games where the
   * headline names the winning color instead.
   */
  outcome: 'win' | 'loss' | 'draw' | 'side';
  reason: string;
  /** e.g. "You defeated COMPETITOR" / "The position slipped away" */
  headline: string;
  subline?: string;
  stats: Array<{ label: string; value: string }>;
  children?: React.ReactNode; // action buttons
}

export function GameOver({ winner, outcome, reason, headline, subline, stats, children }: GameOverProps) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setShown(true), 40);
    return () => window.clearTimeout(t);
  }, []);

  const title =
    outcome === 'win' ? 'VICTORY'
    : outcome === 'loss' ? 'DEFEAT'
    : outcome === 'draw' || winner === null ? 'DRAW'
    : winner === 'white' ? 'WHITE WINS' : 'BLACK WINS';
  const tone = outcome === 'win' ? 'win' : outcome === 'loss' ? 'loss' : 'neutral';

  return (
    <div className={`gameover-scrim${shown ? ' shown' : ''}`} role="dialog" aria-modal="true" aria-label="Game over">
      <div className="gameover">
        <div className="gameover-reason mono">{reason}</div>
        <h2 className={`gameover-title ${tone}`}>{title}</h2>
        <p className="gameover-headline">{headline}</p>
        {subline && <p className="gameover-subline muted">{subline}</p>}
        <div className="gameover-stats">
          {stats.map((s, i) => (
            <div className="gameover-stat" key={s.label} style={{ '--i': i } as React.CSSProperties}>
              <div className="gameover-stat-value mono">{s.value}</div>
              <div className="gameover-stat-label mono">{s.label}</div>
            </div>
          ))}
        </div>
        <div className="gameover-actions">{children}</div>
      </div>
    </div>
  );
}
