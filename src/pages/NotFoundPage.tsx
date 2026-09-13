import { Link } from 'react-router-dom';
import { IconKnight } from '../components/icons';

export function NotFoundPage() {
  return (
    <div className="page">
      <div className="container" style={{ paddingTop: 64 }}>
        <div className="empty">
          <div className="empty-glyph"><IconKnight size={34} /></div>
          <div className="empty-title">This square doesn't exist.</div>
          <p className="small muted">
            The page you tried to reach is off the board.
          </p>
          <Link to="/" className="btn btn-primary" style={{ marginTop: 16 }}>Back to the arena</Link>
        </div>
      </div>
    </div>
  );
}
