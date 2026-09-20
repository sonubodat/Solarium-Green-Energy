import { useState } from 'react';
import { API_BASE_URL } from '../api/client';

// Render free tier sleeps the backend; the first request can take ~30-60s. Any HTTP response
// (even a 404) proves the server is up, so only a network error/timeout counts as failure.
function WakeButton() {
  const [state, setState] = useState('idle');

  async function wake() {
    setState('waking');
    try {
      await fetch(`${API_BASE_URL}/health`, { cache: 'no-store', signal: AbortSignal.timeout(90000) });
      window.location.reload();
    } catch (error) {
      setState('failed');
    }
  }

  const label = { idle: 'Wake / Refresh', waking: 'Waking server…', failed: 'Retry' }[state];
  return (
    <button type="button" className="wake-button" onClick={wake} disabled={state === 'waking'} title="Wakes the server if it is asleep, then reloads the page">
      {label}
    </button>
  );
}

export default WakeButton;
