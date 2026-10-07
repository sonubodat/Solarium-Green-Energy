import { useEffect, useState } from 'react';
import { apiRequest } from '../api/client';

// "My leads" for a BDE / Sales user: only leads assigned to them. A BDE can move a lead between New,
// Contacted, Qualified and Lost and add notes; Converted, Rejected and Duplicate are set by the office.
// No commission data is ever shown here. The server decides what is allowed; this only mirrors it.

const STATUS_LABEL = { NEW: 'New', CONTACTED: 'Contacted', QUALIFIED: 'Qualified', LOST: 'Lost', CONVERTED: 'Converted', REJECTED: 'Rejected', DUPLICATE: 'Duplicate' };
const EDITABLE = ['NEW', 'CONTACTED', 'QUALIFIED', 'LOST'];
const FILTERS = ['', ...EDITABLE, 'CONVERTED'];

const telHref = (phone) => `tel:${String(phone || '').replace(/[^\d+]/g, '')}`;
const whatsappHref = (phone) => {
  const digits = String(phone || '').replace(/\D/g, '');
  return `https://wa.me/${digits.length === 10 ? `91${digits}` : digits}`;
};

export default function SalesLeads() {
  const [status, setStatus] = useState('');
  const [list, setList] = useState(null);
  const [error, setError] = useState('');
  const [openId, setOpenId] = useState('');
  const [detail, setDetail] = useState(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);

  async function loadList() {
    try {
      const data = await apiRequest(`/sales/leads?limit=50${status ? `&status=${status}` : ''}`, { forceRefresh: true });
      setList(data.leads);
    } catch (err) {
      setError(err.message);
    }
  }
  async function loadDetail(id) {
    try {
      setDetail((await apiRequest(`/sales/leads/${id}`, { forceRefresh: true })).lead);
    } catch (err) {
      // 404: the lead was reassigned to someone else. Go back to the list instead of showing stale data.
      setOpenId('');
      setDetail(null);
      setError(err.status === 404 ? 'This lead is no longer assigned to you.' : err.message);
      loadList();
    }
  }
  useEffect(() => {
    loadList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);
  useEffect(() => {
    if (openId) loadDetail(openId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openId]);

  async function act(run) {
    setBusy(true);
    setError('');
    try {
      await run();
    } catch (err) {
      setError(err.message);
      if (err.status === 404) { setOpenId(''); setDetail(null); }
      await loadList();
      if (err.status === 409) await loadDetail(openId);
    } finally {
      setBusy(false);
    }
  }

  const setLeadStatus = (next) => act(async () => {
    await apiRequest(`/sales/leads/${openId}`, { method: 'PATCH', body: JSON.stringify({ status: next }) });
    await loadDetail(openId);
    await loadList();
  });
  const addNote = (event) => {
    event.preventDefault();
    return act(async () => {
      await apiRequest(`/sales/leads/${openId}/notes`, { method: 'POST', body: JSON.stringify({ body: draft }) });
      setDraft('');
      await loadDetail(openId);
    });
  };

  if (openId) {
    const lead = detail;
    const locked = lead && !EDITABLE.includes(lead.status);
    return (
      <section className="sales-leads" aria-label="Lead details">
        <button type="button" className="sales-cancel-button" onClick={() => { setOpenId(''); setDetail(null); loadList(); }}>Back to my leads</button>
        {error && <div className="sales-message error" role="alert">{error}</div>}
        {!lead ? <p>Loading...</p> : (
          <article className="sales-card sales-lead-detail">
            <h2>{lead.customerName}</h2>
            <p><span className={`sales-lead-status ${lead.status}`}>{STATUS_LABEL[lead.status] || lead.status}</span></p>
            <div className="sales-lead-contact">
              <a className="sales-primary-button" href={telHref(lead.phone)}>Call {lead.phone}</a>
              <a className="sales-cancel-button" href={whatsappHref(lead.phone)} target="_blank" rel="noreferrer">WhatsApp</a>
            </div>
            <dl className="sales-lead-fields">
              {lead.email && (<><dt>Email</dt><dd>{lead.email}</dd></>)}
              <dt>Location</dt><dd>{lead.location || '—'}</dd>
              <dt>Pincode</dt><dd>{lead.pincode || '—'}</dd>
              <dt>Average electricity bill</dt><dd>{lead.averageElectricityBill || '—'}</dd>
              <dt>Solar system size</dt><dd>{lead.solarSize || '—'}</dd>
              <dt>Referred by</dt><dd>{lead.referredBy || '—'}</dd>
              <dt>Lead date</dt><dd>{new Date(lead.createdAt).toLocaleDateString()}</dd>
              {lead.geoLocation && (<><dt>Map</dt><dd><a href={`https://www.google.com/maps?q=${lead.geoLocation.latitude},${lead.geoLocation.longitude}`} target="_blank" rel="noreferrer">Open location</a></dd></>)}
            </dl>

            <h3>Status</h3>
            {locked ? (
              <p>This lead was closed by the office ({STATUS_LABEL[lead.status] || lead.status}). It can no longer be changed here.</p>
            ) : (
              <div className="sales-lead-status-buttons">
                {EDITABLE.map((option) => (
                  <button key={option} type="button" className={`sales-status-button${lead.status === option ? ' selected' : ''}`} disabled={busy || lead.status === option} onClick={() => setLeadStatus(option)}>{STATUS_LABEL[option]}</button>
                ))}
              </div>
            )}

            <h3>Notes</h3>
            <form onSubmit={addNote} className="sales-lead-note-form">
              <textarea required maxLength="2000" rows="3" placeholder="Add a note (call outcome, visit time...)" value={draft} onChange={(event) => setDraft(event.target.value)} />
              <button className="sales-primary-button" disabled={busy || !draft.trim()}>Add note</button>
            </form>
            {lead.notes.length ? (
              <ul className="sales-lead-notes">
                {lead.notes.map((note) => (
                  <li key={note.id}><strong>{note.author.name}</strong> <small>{new Date(note.createdAt).toLocaleString()}</small><p>{note.body}</p></li>
                ))}
              </ul>
            ) : <p>No notes yet.</p>}
          </article>
        )}
      </section>
    );
  }

  return (
    <section className="sales-leads" aria-label="My leads">
      <div className="sales-lead-filters" role="group" aria-label="Filter by status">
        {FILTERS.map((option) => (
          <button key={option || 'all'} type="button" className={`sales-chip${status === option ? ' selected' : ''}`} aria-pressed={status === option} onClick={() => setStatus(option)}>{option ? STATUS_LABEL[option] : 'All'}</button>
        ))}
      </div>
      {error && <div className="sales-message error" role="alert">{error}</div>}
      {list === null ? <p>Loading...</p> : list.length === 0 ? (
        <p className="sales-lead-empty">No leads here yet. Leads assigned to you by the office will appear in this list.</p>
      ) : (
        <ul className="sales-lead-list">
          {list.map((lead) => (
            <li key={lead.id}>
              <button type="button" className="sales-lead-card" onClick={() => setOpenId(lead.id)}>
                <span className="sales-lead-name">{lead.customerName}</span>
                <span className={`sales-lead-status ${lead.status}`}>{STATUS_LABEL[lead.status] || lead.status}</span>
                <span className="sales-lead-sub">{lead.phone}{lead.location ? ` · ${lead.location}` : ''}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
