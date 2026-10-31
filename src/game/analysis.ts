/**
 * Analysis math — accuracy from centipawn loss, performance rating estimate.
 * Used by bot games (post-game), history review and the Elo test. Kept free
 * of DOM/audio imports so the tools project can typecheck it.
 */
/** Accuracy 0..100 from average centipawn loss (smooth exponential decay). */
export function accuracyFromLoss(avgLossCp: number): number {
  const capped = Math.max(0, Math.min(1200, avgLossCp));
  return 100 * Math.exp(-capped / 400);
}

/**
 * Estimated performance rating from average centipawn loss.
 * Anchors: 30cp ≈ 2000, 60cp ≈ 1650, 120cp ≈ 1300, 250cp ≈ 925.
 * Formula: PR = 2450 − 500·ln(loss/12), clamped to [400, 2400].
 */
export function performanceRating(avgLossCp: number): number {
  const loss = Math.max(12, avgLossCp);
  const pr = 2450 - 500 * Math.log(loss / 12);
  return Math.round(Math.max(400, Math.min(2400, pr)));
}

/** Human label for a game-end reason (shared by all modes). */
export function endReasonText(reason?: string): string {
  switch (reason) {
    case 'checkmate': return 'CHECKMATE';
    case 'king-of-the-hill': return 'KING OF THE HILL';
    case 'three-check': return 'THREE-CHECK';
    case 'stalemate': return 'STALEMATE';
    case 'threefold': return 'THREEFOLD REPETITION';
    case 'fifty-move': return 'FIFTY-MOVE RULE';
    case 'insufficient': return 'INSUFFICIENT MATERIAL';
    case 'agreement': return 'DRAW AGREED';
    case 'resign': return 'RESIGNATION';
    case 'disconnect': return 'CONNECTION LOST';
    default: return 'GAME OVER';
  }
}
