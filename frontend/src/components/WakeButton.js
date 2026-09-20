import { useEffect, useState, useSyncExternalStore } from 'react';
import { API_BASE_URL, getActivitySnapshot, subscribeActivity, trackOperation } from '../api/client';

// Render free tier sleeps the backend; the first request can take ~30-60s. Any HTTP response
// (even a 404) proves the server is up, so only a network error/timeout counts as failure.
//
// While a labelled request runs (proof, print PDF, ...) the same pill shows that request's own
// label with an indeterminate bar. There is no percentage: the server cannot report one, and a
// made-up number would mislead.
function WakeButton() {
  const [state, setState] = useState('idle');
  const operations = useSyncExternalStore(subscribeActivity, getActivitySnapshot);
  const busy = operations.length > 0;
  const [showBusy, setShowBusy] = useState(false);

  // Small delay so quick requests do not flash the bar.
  useEffect(() => {
    if (!busy) {
      setShowBusy(false);
      return undefined;
    }
    const timer = setTimeout(() => setShowBusy(true), 400);
    return () => clearTimeout(timer);
  }, [busy]);

  async function wake() {
    setState('waking');
    try {
      await trackOperation('Waking server', () => fetch(`${API_BASE_URL}/health`, { cache: 'no-store', signal: AbortSignal.timeout(90000) }));
      window.location.reload();
    } catch (error) {
      setState('failed');
    }
  }

  const current = operations[operations.length - 1];
  const extra = operations.length > 1 ? ` (+${operations.length - 1})` : '';
  const label = showBusy && current
    ? `${current.label}… may take a while${extra}`
    : { idle: 'Wake / Refresh', waking: 'Waking server…', failed: 'Retry' }[state];

  return (
    <button
      type="button"
      className="wake-button"
      onClick={wake}
      disabled={busy || state === 'waking'}
      aria-busy={busy}
      title="Wakes the server if it is asleep, then reloads the page"
    >
      {label}
      {showBusy && <span className="wake-button-bar" aria-hidden="true" />}
    </button>
  );
}

export default WakeButton;
