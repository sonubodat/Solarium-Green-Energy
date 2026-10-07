import { useEffect, useState } from 'react';
import { apiRequest } from '../api/client';

// Admin-only pieces for custom roles and lead assignment. The permission catalog is served by
// GET /admin/roles, so the screen never carries its own copy. The backend is the real gate.

// Same rule as the backend: any action on a screen needs that screen's "view"; convert also needs edit.
function withImplied(selected) {
  const next = new Set(selected);
  for (const key of selected) {
    next.add(`${key.split('.')[0]}.view`);
    if (key === 'leads.convert') next.add('leads.edit');
  }
  return next;
}

// A box is locked (ticked, not clearable) while another ticked action needs it.
function isRequired(selected, key) {
  const screen = key.split('.')[0];
  if (key === `${screen}.view`) return [...selected].some((other) => other !== key && other.startsWith(`${screen}.`));
  return key === 'leads.edit' && selected.has('leads.convert');
}

export function RolesPanel({ roles, catalog, onChanged }) {
  const [editing, setEditing] = useState(null); // { id?, name, description, permissions: Set }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  function toggle(key) {
    setEditing((current) => {
      const next = new Set(current.permissions);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return { ...current, permissions: withImplied(next) };
    });
  }

  async function save(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const body = JSON.stringify({ name: editing.name, description: editing.description || null, permissions: [...editing.permissions] });
      await apiRequest(editing.id ? `/admin/roles/${editing.id}` : '/admin/roles', { method: editing.id ? 'PATCH' : 'POST', body });
      const wasEdit = Boolean(editing.id);
      setEditing(null);
      await onChanged(wasEdit ? "Role updated. It applies on each user's next request." : 'Role created.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(role) {
    setBusy(true);
    try {
      await apiRequest(`/admin/roles/${role.id}`, { method: 'DELETE' });
      await onChanged('Role deleted.');
    } catch (err) {
      await onChanged(err.message, true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="admin-roles">
      <div className="admin-resource-heading">
        <div>
          <span className="admin-eyebrow">ACCESS</span>
          <h2>Roles</h2>
          <p>Create roles such as Manager or Operations and choose what each may do. Permanent deletion of Solar Mitras, leads and QR codes, staff, audit logs and printing always stay with the super-admin.</p>
        </div>
        <button type="button" className="admin-primary-button" onClick={() => setEditing({ name: '', description: '', permissions: new Set() })}>New role</button>
      </div>

      {editing && (
        <form className="admin-form-card admin-role-form" onSubmit={save}>
          <div className="admin-form-title">{editing.id ? `Edit role: ${editing.name}` : 'New role'}</div>
          <input required maxLength="60" placeholder="Role name (e.g. Manager)" value={editing.name} onChange={(event) => setEditing({ ...editing, name: event.target.value })} />
          <input maxLength="200" placeholder="Description (optional)" value={editing.description || ''} onChange={(event) => setEditing({ ...editing, description: event.target.value })} />
          <div className="admin-table-wrap">
            <table className="admin-table admin-matrix">
              <thead><tr><th>Screen</th><th>Allowed actions</th></tr></thead>
              <tbody>
                {catalog.map((screen) => (
                  <tr key={screen.key}>
                    <th scope="row">{screen.label}</th>
                    <td>
                      <div className="admin-matrix-options">
                        {screen.permissions.map((permission) => (
                          <label key={permission.key} className="admin-check">
                            <input
                              type="checkbox"
                              checked={editing.permissions.has(permission.key)}
                              disabled={isRequired(editing.permissions, permission.key)}
                              onChange={() => toggle(permission.key)}
                            />
                            {permission.label}
                          </label>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <small>Ticking an action also ticks View for that screen. Nothing ticked means no access.</small>
          {error && <div className="admin-message error" role="alert">{error}</div>}
          <div className="admin-form-actions">
            <button type="button" className="admin-outline-button" onClick={() => setEditing(null)}>Cancel</button>
            <button className="admin-primary-button" disabled={busy}>{busy ? 'Saving...' : 'Save role'}</button>
          </div>
        </form>
      )}

      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead><tr><th>Role</th><th>Can do</th><th>Users</th><th /></tr></thead>
          <tbody>
            {roles.length ? roles.map((role) => (
              <tr key={role.id}>
                <td><div className="admin-primary-cell"><strong>{role.name}</strong><small>{role.description || ''}</small></div></td>
                <td>{role.permissions.length ? `${role.permissions.length} permissions` : 'No access'}</td>
                <td>{role.userCount}</td>
                <td>
                  <div className="admin-row-actions">
                    <button className="admin-mini-button" disabled={busy} onClick={() => setEditing({ id: role.id, name: role.name, description: role.description || '', permissions: new Set(role.permissions) })}>Edit</button>
                    <button className="admin-mini-button danger" disabled={busy || role.userCount > 0} title={role.userCount > 0 ? 'Move its users to another role first' : ''} onClick={() => remove(role)}>Delete</button>
                  </div>
                </td>
              </tr>
            )) : <tr><td colSpan="4" className="admin-empty">No roles yet. Create one, then choose it when adding a staff user.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Assignment, history and notes for one lead, shown in the lead detail modal.
export function LeadWorkPanel({ lead, canAssign, canNote, assignable, onAssigned }) {
  const [notes, setNotes] = useState(null);
  const [history, setHistory] = useState(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function loadNotes() {
    try {
      setNotes((await apiRequest(`/admin/leads/${lead.id}/notes`, { forceRefresh: true })).notes);
    } catch (err) {
      setError(err.message);
    }
  }
  async function loadHistory() {
    try {
      setHistory((await apiRequest(`/admin/leads/${lead.id}/assignments`, { forceRefresh: true })).history);
    } catch (err) {
      setError(err.message);
    }
  }
  useEffect(() => {
    loadNotes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lead.id]);

  async function addNote(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await apiRequest(`/admin/leads/${lead.id}/notes`, { method: 'POST', body: JSON.stringify({ body: draft }) });
      setDraft('');
      await loadNotes();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function assign(value) {
    setBusy(true);
    setError('');
    try {
      await apiRequest(`/admin/leads/${lead.id}/assignment`, { method: 'PATCH', body: JSON.stringify({ assigned_to_id: value || null }) });
      setHistory(null);
      await onAssigned();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="admin-modal-section">
      <h3>Assigned to</h3>
      {canAssign ? (
        <select className="admin-inline-select" value={lead.assignedToId || ''} disabled={busy} onChange={(event) => assign(event.target.value)}>
          <option value="">Unassigned</option>
          {assignable.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}
        </select>
      ) : <p>{lead.assignedTo?.name || 'Unassigned'}</p>}
      <div>
        <button type="button" className="admin-mini-button" onClick={loadHistory}>Show assignment history</button>
        {history && (history.length ? (
          <ul className="admin-note-list">
            {history.map((row) => (
              <li key={row.id}>{new Date(row.changedAt).toLocaleString()}: {row.from?.name || 'Unassigned'} to {row.to?.name || 'Unassigned'} by {row.changedBy.name}</li>
            ))}
          </ul>
        ) : <p>Never assigned.</p>)}
      </div>

      <h3>Notes</h3>
      {notes && (notes.length ? (
        <ul className="admin-note-list">
          {notes.map((note) => (
            <li key={note.id}><strong>{note.author.name}</strong> <small>{new Date(note.createdAt).toLocaleString()}</small><p>{note.body}</p></li>
          ))}
        </ul>
      ) : <p>No notes yet.</p>)}
      {canNote && (
        <form onSubmit={addNote} className="admin-note-form">
          <textarea required maxLength="2000" rows="2" placeholder="Add a note" value={draft} onChange={(event) => setDraft(event.target.value)} />
          <button className="admin-primary-button" disabled={busy || !draft.trim()}>Add note</button>
        </form>
      )}
      {error && <div className="admin-message error" role="alert">{error}</div>}
    </div>
  );
}
