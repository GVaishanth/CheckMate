/** Top-level error boundary — never show raw crashes. */
import { Component, ErrorInfo, ReactNode } from 'react';

interface State {
  error: Error | null;
}

export class ErrorScreen extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('CHECKMATE crashed:', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-0)', padding: 24 }}>
          <div className="panel panel-pad" style={{ maxWidth: 460, textAlign: 'center' }} role="alert">
            <div className="mono tiny" style={{ color: 'var(--danger)', letterSpacing: '0.2em' }}>SYSTEM FAULT</div>
            <h2 style={{ margin: '10px 0', fontFamily: 'var(--font-display)' }}>Something broke mid-game.</h2>
            <p className="muted small">
              An unexpected error stopped the interface. Restart to try again; unsaved games and session-only progress may be lost.
            </p>
            <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={() => window.location.reload()}>
              Restart CHECKMATE
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
