import { useEffect, useMemo, useRef, useState } from 'react';
import { apiRequest, downloadFile } from '../api/client';
import { POSTER_TEMPLATE_STORAGE_KEY, pickDefaultTemplate, splitIntoPosterBatches } from '../lib/auto-poster';

// Admin > Solar Mitras > "Auto-QR posters": print files for the Solar Mitras whose QR was created
// automatically when they logged in. Self-contained: it does not touch the Print QR Codes wizard, it
// only reuses that flow's proof / approve / download endpoints. Styled with the .admin-* modal rules
// and the .auto-poster-* rules in routes/AdminPage.css.

// Mirrors PDF_CHUNK_PAGES in the backend: a batch bigger than this downloads as a ZIP of PDFs.
const PDF_CHUNK_PAGES = 50;

function readStoredTemplate() {
  try {
    return window.localStorage.getItem(POSTER_TEMPLATE_STORAGE_KEY) || '';
  } catch (error) {
    return ''; // storage unavailable: the newest published template is the default
  }
}

function rememberTemplate(templateId) {
  try {
    window.localStorage.setItem(POSTER_TEMPLATE_STORAGE_KEY, templateId);
  } catch (error) {
    // Only a convenience; nothing depends on it.
  }
}

const NO_PROOF = { loading: false, error: '', url: '', checked: 0 };

function AutoPosterModal({ onClose }) {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [templates, setTemplates] = useState([]);
  const [templateId, setTemplateId] = useState('');
  const [includePrepared, setIncludePrepared] = useState(false);
  const [summary, setSummary] = useState(null);
  const [batchIndex, setBatchIndex] = useState(0);
  const [job, setJob] = useState(null);
  const [proof, setProof] = useState(NO_PROOF);
  const [proofConfirmed, setProofConfirmed] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [downloaded, setDownloaded] = useState(false);
  const nonce = useRef(`${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);
  const busyRef = useRef(false);

  const batches = useMemo(() => (summary ? splitIntoPosterBatches(summary.codes, summary.batchSize) : []), [summary]);
  const current = batches[batchIndex];
  const selectedTemplate = templates.find((template) => template.id === templateId);

  function resetBatch() {
    setJob(null);
    setProof(NO_PROOF);
    setProofConfirmed(false);
    setDownloaded(false);
    setError('');
  }

  async function loadSummary(include) {
    setLoading(true);
    setLoadError('');
    try {
      const data = await apiRequest(`/admin/auto-posters/summary?include_prepared=${include}`, { forceRefresh: true });
      setSummary(data);
      setBatchIndex(0);
      resetBatch();
    } catch (requestError) {
      setLoadError(requestError.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [templateResult, summaryResult] = await Promise.all([
          apiRequest('/admin/qr/templates', { forceRefresh: true }),
          apiRequest('/admin/auto-posters/summary?include_prepared=false', { forceRefresh: true }),
        ]);
        if (cancelled) return;
        setTemplates(templateResult.templates || []);
        setTemplateId(pickDefaultTemplate(templateResult.templates || [], readStoredTemplate()));
        setSummary(summaryResult);
      } catch (requestError) {
        if (!cancelled) setLoadError(requestError.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  function changeTemplate(event) {
    setTemplateId(event.target.value);
    rememberTemplate(event.target.value);
    resetBatch(); // a batch made for another design is not valid for this one
  }

  function changeIncludePrepared(event) {
    setIncludePrepared(event.target.checked);
    loadSummary(event.target.checked);
  }

  async function runProof(jobId) {
    setProof({ ...NO_PROOF, loading: true });
    try {
      // POST renders and verifies the proof; the signed URL to view it only comes from the GET.
      const generated = await apiRequest(`/admin/qr/print-batch/${encodeURIComponent(jobId)}/proof`, { method: 'POST', body: '{}', label: 'Generating proof', dedupe: true });
      const signed = await apiRequest(`/admin/qr/print-batch/${encodeURIComponent(jobId)}/proof`, { forceRefresh: true });
      setJob(generated.job);
      setProof({ loading: false, error: '', url: signed.proof_url, checked: generated.verification?.length || 0 });
    } catch (requestError) {
      setProof({ ...NO_PROOF, error: requestError.message });
    }
  }

  async function createBatch() {
    if (busyRef.current || !current || !templateId) return;
    busyRef.current = true;
    setBusy('creating');
    setError('');
    try {
      const result = await apiRequest('/admin/auto-posters/batch', {
        method: 'POST',
        body: JSON.stringify({
          template_id: templateId,
          codes: current.codes,
          // Same codes + same template = the same batch, so a double click or a retry never makes a second one.
          idempotency_key: `auto-poster-${nonce.current}-${templateId}-${current.first}-${current.last}`,
        }),
        label: 'Creating poster batch',
        dedupe: true,
      });
      setJob(result.job);
      await runProof(result.job.id);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      busyRef.current = false;
      setBusy('');
    }
  }

  async function approveAndDownload() {
    if (busyRef.current || !job) return;
    busyRef.current = true;
    setBusy('approving');
    setError('');
    try {
      if (job.status !== 'APPROVED') {
        const approved = await apiRequest(`/admin/qr/print-batch/${encodeURIComponent(job.id)}/approve`, { method: 'POST', body: '{}', label: 'Approving proof', dedupe: true });
        setJob(approved.job);
      }
      setBusy('downloading');
      const asZip = job.itemCount > PDF_CHUNK_PAGES;
      await downloadFile(
        `/admin/qr/print-batch/${encodeURIComponent(job.id)}/pdf`,
        asZip ? `${job.rangeStart}-print-files.zip` : `${job.rangeStart}-template.pdf`,
        asZip ? 'Preparing print files' : 'Generating PDF',
      );
      setDownloaded(true);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      busyRef.current = false;
      setBusy('');
    }
  }

  function nextBatch() {
    if (batchIndex + 1 < batches.length) {
      setBatchIndex(batchIndex + 1);
      resetBatch();
    } else {
      loadSummary(includePrepared); // all batches done: refresh the counts
    }
  }

  const lastBatchDone = downloaded && batchIndex + 1 >= batches.length;
  const noPublishedTemplate = !loading && !loadError && !templateId;

  return (
    <div className="admin-modal-overlay">
      <div className="admin-modal auto-poster-modal" role="dialog" aria-modal="true" aria-label="Auto-QR posters">
        <div className="admin-modal-header">
          <div>
            <span className="admin-eyebrow">SOLAR MITRA MANAGEMENT</span>
            <h2>Auto-QR posters</h2>
          </div>
          <button type="button" className="admin-mini-button" onClick={onClose} disabled={Boolean(busy)} aria-label="Close">×</button>
        </div>

        <div className="admin-modal-body">
          <p>
            Print files for the Solar Mitras whose QR was created automatically when they logged in.
            Pick a template, check the proof, download. Batches of up to {summary?.batchSize || 500} posters.
          </p>

          {loading && <p role="status">Loading…</p>}
          {loadError && (
            <p className="admin-field-error" role="alert">
              {loadError}{' '}
              <button type="button" className="admin-outline-button" onClick={() => loadSummary(includePrepared)}>Retry</button>
            </p>
          )}

          {summary && !loading && (
            <>
              <div className="auto-poster-stats">
                <strong>{summary.total.toLocaleString()}</strong> Solar Mitras have an automatic QR ·{' '}
                <strong>{summary.prepared.toLocaleString()}</strong> poster{summary.prepared === 1 ? '' : 's'} already produced ·{' '}
                <strong>{summary.pending.toLocaleString()}</strong> not yet
              </div>

              <label className="admin-form-field">
                <span>Poster template</span>
                <select value={templateId} onChange={changeTemplate} disabled={Boolean(busy) || !templates.some((template) => template.status === 'PUBLISHED')}>
                  {templates.filter((template) => template.status === 'PUBLISHED').map((template) => (
                    <option key={template.id} value={template.id}>{template.name}</option>
                  ))}
                </select>
                <small>Selected for you automatically: the template you used last here, or the newest published one. Change it any time.</small>
              </label>
              {noPublishedTemplate && <p className="admin-field-error" role="alert">There is no published template. Publish one on the Templates page first.</p>}

              <label className="admin-toggle-row">
                <input type="checkbox" checked={includePrepared} onChange={changeIncludePrepared} disabled={Boolean(busy)} />
                Also include Solar Mitras whose poster was already produced
              </label>

              {summary.total === 0 && <p>No Solar Mitra has an automatic QR yet. They get one the first time they log in without a QR.</p>}
              {summary.total > 0 && summary.codes.length === 0 && <p>Every automatic QR already has a produced poster. Tick the box above to print them again.</p>}

              {current && (
                <div className="auto-poster-batch">
                  <strong>Batch {batchIndex + 1} of {batches.length}</strong>
                  <span>{current.codes.length.toLocaleString()} posters · {current.first} → {current.last}</span>
                </div>
              )}

              {error && <p className="admin-field-error" role="alert">{error}</p>}

              {current && !job && (
                <div className="admin-form-actions">
                  <button type="button" className="admin-primary-button" onClick={createBatch} disabled={Boolean(busy) || !templateId}>
                    {busy === 'creating' ? 'Creating…' : `Create batch ${batchIndex + 1} and check proof`}
                  </button>
                </div>
              )}

              {job && (
                <div className="auto-poster-review">
                  {proof.loading && <p role="status">Generating the proof with the real artwork and QR placement…</p>}
                  {proof.error && (
                    <p className="admin-field-error" role="alert">
                      {proof.error}{' '}
                      <button type="button" className="admin-outline-button" onClick={() => runProof(job.id)} disabled={Boolean(busy)}>Retry proof</button>
                    </p>
                  )}
                  {proof.url && (
                    <>
                      <iframe className="auto-poster-proof" src={proof.url} title="Poster proof" />
                      <p role="status">
                        QR check passed for {proof.checked} sample poster{proof.checked === 1 ? '' : 's'} (each QR was read back and matched its own link).
                        {selectedTemplate ? ` Template: ${selectedTemplate.name}.` : ''}
                      </p>
                      {!downloaded && (
                        <>
                          <label className="admin-toggle-row">
                            <input type="checkbox" checked={proofConfirmed} onChange={(event) => setProofConfirmed(event.target.checked)} disabled={Boolean(busy)} />
                            I checked the proof: the artwork and QR placement are correct
                          </label>
                          <div className="admin-form-actions">
                            <button type="button" className="admin-primary-button" onClick={approveAndDownload} disabled={!proofConfirmed || Boolean(busy)}>
                              {busy === 'approving' ? 'Approving…' : busy === 'downloading' ? 'Preparing download…' : job.itemCount > PDF_CHUNK_PAGES ? 'Approve and download ZIP' : 'Approve and download PDF'}
                            </button>
                          </div>
                        </>
                      )}
                    </>
                  )}
                </div>
              )}

              {downloaded && (
                <div className="auto-poster-done" role="status">
                  <strong>Batch {batchIndex + 1} downloaded.</strong>{' '}
                  {lastBatchDone ? 'That was the last batch.' : `${batches.length - batchIndex - 1} more batch${batches.length - batchIndex - 1 === 1 ? '' : 'es'} to go.`}
                  <div className="admin-form-actions">
                    {!lastBatchDone && <button type="button" className="admin-primary-button" onClick={nextBatch}>Next batch</button>}
                    <button type="button" className="admin-outline-button" onClick={lastBatchDone ? onClose : () => loadSummary(includePrepared)}>
                      {lastBatchDone ? 'Done' : 'Refresh counts'}
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default AutoPosterModal;
