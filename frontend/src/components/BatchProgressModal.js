import { useEffect } from 'react';

// Blocks the page while a bulk upload runs. It has no close button, ignores clicks outside and
// Escape, and while mounted it asks the browser to confirm before the tab is refreshed or closed
// (an upload cut off mid-way is safe to redo, but the person should know that). Styled by the
// .batch-progress-* rules in routes/AdminPage.css.
// progress: { done, total, batch, batches, attempt }; `done` counts only rows the server confirmed.
function BatchProgressModal({ title, progress }) {
  useEffect(() => {
    function warnBeforeLeaving(event) {
      event.preventDefault();
      event.returnValue = '';
    }
    window.addEventListener('beforeunload', warnBeforeLeaving);
    return () => window.removeEventListener('beforeunload', warnBeforeLeaving);
  }, []);

  const percent = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
  return (
    <div className="admin-modal-overlay batch-progress-overlay">
      <div
        className="admin-modal batch-progress-modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="batch-progress-title"
        aria-describedby="batch-progress-warning"
      >
        <div className="admin-modal-header">
          <div>
            <span className="admin-eyebrow">PLEASE WAIT</span>
            <h2 id="batch-progress-title">{title}</h2>
          </div>
        </div>
        <div className="admin-modal-body">
          <p id="batch-progress-warning" className="batch-progress-warning">
            <strong>Do not close or refresh this page</strong> until this finishes. Rows are saved in small batches; leaving now stops the upload part-way.
          </p>
          <div
            className="batch-progress-bar"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={progress.total}
            aria-valuenow={progress.done}
            aria-label={title}
          >
            <span style={{ width: `${percent}%` }} />
          </div>
          <small aria-live="polite">
            Batch {progress.batch} of {progress.batches} · {progress.done.toLocaleString()} of {progress.total.toLocaleString()} rows saved ({percent}%)
          </small>
          {progress.attempt > 1 && (
            <small role="status" className="batch-progress-retry">
              Connection problem. Retrying this batch (attempt {progress.attempt} of 3)…
            </small>
          )}
        </div>
      </div>
    </div>
  );
}

export default BatchProgressModal;
