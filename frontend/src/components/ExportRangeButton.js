import { useEffect, useRef, useState } from 'react';
import { API_BASE_URL, downloadFile } from '../api/client';

// "Export" with a format choice (Excel, CSV, or copy-to-clipboard for pasting into Google Sheets) and a date choice:
// all time, or a From/To range (either may be left empty). Used by the Leads,
// Solar Mitras, Print History and Audit Logs screens in routes/AdminPage.js. The server decides what the dates
// mean (Indian calendar days, see backend/src/lib/date-range.js); this only collects them and downloads.

const IST_DAY = (date) => date.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }); // YYYY-MM-DD in India
const daysAgo = (count) => IST_DAY(new Date(Date.now() - count * 24 * 60 * 60 * 1000));

function presets() {
  const today = IST_DAY(new Date());
  return [
    ['Today', today, today],
    ['Last 7 days', daysAgo(6), today],
    ['Last 30 days', daysAgo(29), today],
    ['This month', `${today.slice(0, 7)}-01`, today],
  ];
}

export default function ExportRangeButton({ path, params = {}, fallbackName, dateLabel, note, disabled, allowCopy = true }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [format, setFormat] = useState('xlsx'); // xlsx | csv | copy
  const [copied, setCopied] = useState('');
  const [manualText, setManualText] = useState('');
  const wrapper = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => { if (wrapper.current && !wrapper.current.contains(event.target)) setOpen(false); };
    const onKey = (event) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', onKey); };
  }, [open]);

  async function download() {
    if (mode === 'range' && !from && !to) { setError('Pick a From date, a To date, or both.'); return; }
    if (mode === 'range' && from && to && from > to) { setError('The From date must not be after the To date.'); return; }
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => { if (value) query.set(key, value); });
    if (mode === 'range') {
      if (from) query.set('from', from);
      if (to) query.set('to', to);
    }
    setBusy(true);
    setError('');
    setCopied('');
    setManualText('');
    try {
      if (format === 'copy') {
        query.set('format', 'tsv');
        const response = await fetch(`${API_BASE_URL}${path}?${query.toString()}`, { credentials: 'include' });
        if (!response.ok) {
          const payload = await response.json().catch(() => null);
          throw new Error(payload?.error?.message || 'Could not prepare the data. Try again.');
        }
        const text = await response.text();
        const rowCount = Math.max(text.split('\n').length - 1, 0);
        try {
          await navigator.clipboard.writeText(text);
          setCopied(`Copied ${rowCount} row${rowCount === 1 ? '' : 's'} with headers. Open your Google Sheet, click cell A1 and press Ctrl+V (Cmd+V on Mac).`);
        } catch (clipboardError) {
          // Some browsers block clipboard access: show the text so it can be selected and copied by hand.
          setManualText(text);
        }
        return;
      }
      if (format === 'xlsx') query.set('format', 'xlsx');
      const text = query.toString();
      await downloadFile(`${path}${text ? `?${text}` : ''}`, format === 'xlsx' ? fallbackName.replace(/\.csv$/, '.xlsx') : fallbackName, 'Preparing export');
      setOpen(false);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="admin-export" ref={wrapper}>
      <button type="button" className="admin-outline-button" disabled={disabled} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((current) => !current)}>
        Export
      </button>
      {open && (
        <div className="admin-export-panel" role="dialog" aria-label="Export">
          <fieldset>
            <legend>Format</legend>
            <label className="admin-check"><input type="radio" name="export-format" checked={format === 'xlsx'} onChange={() => { setFormat('xlsx'); setCopied(''); setManualText(''); }} /> Excel (.xlsx)</label>
            <label className="admin-check"><input type="radio" name="export-format" checked={format === 'csv'} onChange={() => { setFormat('csv'); setCopied(''); setManualText(''); }} /> CSV</label>
            {allowCopy && <label className="admin-check"><input type="radio" name="export-format" checked={format === 'copy'} onChange={() => { setFormat('copy'); setCopied(''); setManualText(''); }} /> Copy for Google Sheets</label>}
          </fieldset>
          <fieldset>
            <legend>What to export</legend>
            <label className="admin-check"><input type="radio" name="export-mode" checked={mode === 'all'} onChange={() => { setMode('all'); setError(''); }} /> All time</label>
            <label className="admin-check"><input type="radio" name="export-mode" checked={mode === 'range'} onChange={() => { setMode('range'); setError(''); }} /> Date range</label>
          </fieldset>
          {mode === 'range' && (
            <>
              <div className="admin-export-dates">
                <label>From<input type="date" value={from} max={to || undefined} onChange={(event) => setFrom(event.target.value)} /></label>
                <label>To<input type="date" value={to} min={from || undefined} onChange={(event) => setTo(event.target.value)} /></label>
              </div>
              <div className="admin-export-presets">
                {presets().map(([label, start, end]) => (
                  <button key={label} type="button" className="admin-mini-button" onClick={() => { setFrom(start); setTo(end); setError(''); }}>{label}</button>
                ))}
              </div>
              <small>Filtered {dateLabel}. Dates are India time; the From and To days are both included.</small>
            </>
          )}
          {note && <small>{note}</small>}
          {error && <div className="admin-message error" role="alert">{error}</div>}
          {copied && <div className="admin-message success" role="status">{copied}</div>}
          {manualText && (
            <>
              <small>Your browser blocked automatic copying. Select all of this text, copy it, and paste it into the sheet.</small>
              <textarea readOnly rows="5" value={manualText} onFocus={(event) => event.target.select()} />
            </>
          )}
          <div className="admin-form-actions">
            <button type="button" className="admin-outline-button" onClick={() => setOpen(false)}>Cancel</button>
            <button type="button" className="admin-primary-button" disabled={busy} onClick={download}>{busy ? 'Preparing...' : format === 'copy' ? 'Copy' : 'Download'}</button>
          </div>
        </div>
      )}
    </span>
  );
}
