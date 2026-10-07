/**
 * The one alert that can sit over every screen: the owner's data could not be
 * read, or the last change could not be saved.
 *
 * It exists because both failures used to be silent. A failed read showed the
 * empty starter setup, which looks exactly like deleted data, and a failed
 * save looked like a save. A save failure stays until it is fixed; the read
 * failure can be hidden once seen, because it cannot be fixed from inside the
 * app and would otherwise cover the page all session — the rail keeps saying
 * "Not saving this session" either way.
 */
import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useFinance } from './finance/FinanceContext';

export default function DataAlert() {
  const { loadError, save, retrySave, loading } = useFinance();
  const [hidden, setHidden] = useState(false);
  if (loading) return null;

  if (loadError && !hidden) {
    return (
      <div className="data-alert" role="alert">
        <AlertTriangle size={15} strokeWidth={1.8} aria-hidden="true" />
        <div className="data-alert__text">
          <strong>Your saved data could not be read.</strong>
          <span>
            What you see is an empty setup, and nothing will be saved this session, so your file stays exactly as it is. Close Axonix and check
            %LOCALAPPDATA%\Axonix — every launch keeps a copy in backups. ({loadError})
          </span>
        </div>
        <button type="button" className="data-alert__retry" onClick={() => setHidden(true)}>
          Hide
        </button>
      </div>
    );
  }

  if (!loadError && save.state === 'error') {
    return (
      <div className="data-alert" role="alert">
        <AlertTriangle size={15} strokeWidth={1.8} aria-hidden="true" />
        <div className="data-alert__text">
          <strong>Your last change is not saved yet.</strong>
          <span>{save.message}</span>
        </div>
        <button type="button" className="data-alert__retry" onClick={retrySave}>
          Try again
        </button>
      </div>
    );
  }

  return null;
}
