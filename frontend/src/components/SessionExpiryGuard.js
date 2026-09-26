import { useEffect, useRef, useState } from 'react';
import { apiRequest, subscribeSessionExpired } from '../api/client';
import './SessionExpiryGuard.css';

// Shows a blocking "Session expired" popup when the server rejects a signed-in request as
// unauthenticated (the login ran out, was revoked, or the browser dropped its cookie). Mount it ONLY
// in a portal page's signed-in view: it is subscribed while mounted, so a 401 seen on the sign-in
// screen never triggers it. The single button signs out locally (onSignOut) and lands on the sign-in form.
// Some views (a Solar Mitra's tabs) show already-loaded data and make no request when clicked, so a
// tab that was left open would look signed in long after the login ran out. When the tab becomes
// visible again the guard therefore checks the session once (no polling, so an idle tab never keeps a
// sleeping free-tier backend awake). `portal` is 'admin' | 'sales' | 'vendor'.
function SessionExpiryGuard({ portal, onSignOut }) {
  const [expired, setExpired] = useState(false);
  const buttonRef = useRef(null);

  useEffect(() => subscribeSessionExpired(() => setExpired(true)), []);
  useEffect(() => {
    let lastCheck = 0;
    async function checkWhenVisible() {
      if (document.visibilityState !== 'visible' || Date.now() - lastCheck < 30000) return;
      lastCheck = Date.now();
      try {
        await apiRequest(`/auth/session?portal=${portal}`, { forceRefresh: true });
      } catch (error) {
        if (error?.status === 401) setExpired(true); // a network error or 5xx says nothing about the login
      }
    }
    document.addEventListener('visibilitychange', checkWhenVisible);
    return () => document.removeEventListener('visibilitychange', checkWhenVisible);
  }, [portal]);
  useEffect(() => {
    if (expired) buttonRef.current?.focus();
  }, [expired]);

  if (!expired) return null;
  return (
    <div className="session-expired-overlay">
      <div
        className="session-expired-card"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="session-expired-title"
        aria-describedby="session-expired-text"
      >
        <h2 id="session-expired-title">Session expired</h2>
        <p id="session-expired-text">For your security you were signed out. Please sign in again to continue.</p>
        <button
          ref={buttonRef}
          type="button"
          className="session-expired-button"
          onClick={() => {
            setExpired(false);
            onSignOut();
          }}
        >
          Sign in again
        </button>
      </div>
    </div>
  );
}

export default SessionExpiryGuard;
