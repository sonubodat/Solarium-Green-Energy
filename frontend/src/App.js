import { useState } from 'react';
import { apiRequest, API_BASE_URL } from './api/client';
import './App.css';

const views = {
  Public: {
    eyebrow: 'Customer referral',
    title: 'A simpler path to solar',
    description: 'Connect with Solarium Energy through your local referral partner.',
    action: 'Start an enquiry',
    items: [
      ['Referral source', 'Local partner'],
      ['Referral QR', 'Active'],
      ['Enquiry', 'Not started'],
    ],
  },
  Vendor: {
    eyebrow: 'Vendor portal',
    title: 'Your referral workspace',
    description: 'Keep track of referrals and payout status in one quiet, focused view.',
    action: 'View referrals',
    items: [
      ['Business', 'Ram Store'],
      ['Referral access', 'Active'],
      ['Payout status', 'Unpaid'],
    ],
  },
  Sales: {
    eyebrow: 'Sales portal',
    title: 'Onboarding, without the noise',
    description: 'Work through assigned registrations and activate the next unassigned QR.',
    action: 'Activate a QR',
    items: [
      ['Assigned work', 'Ready for review'],
      ['Vendor onboarding', 'In progress'],
      ['QR inventory', 'Unassigned'],
    ],
  },
  Admin: {
    eyebrow: 'Admin portal',
    title: 'System control, clearly arranged',
    description: 'Manage vendors, QR assignments, leads, payouts, and audit history.',
    action: 'Open vendor management',
    items: [
      ['Vendor records', 'Review required'],
      ['QR assignments', 'Active'],
      ['Payout records', 'Unpaid'],
    ],
  },
};

const LEAD_STATUSES = ['NEW', 'CONTACTED', 'QUALIFIED', 'CONVERTED', 'REJECTED', 'DUPLICATE'];
const QR_STATUSES = ['UNASSIGNED', 'ACTIVE', 'INACTIVE', 'RETIRED'];

function App() {
  const [activeView, setActiveView] = useState('Public');
  const view = views[activeView];
  const [qrCode, setQrCode] = useState('V-0001');
  const [referral, setReferral] = useState(null);
  const [lead, setLead] = useState({ customer_name: '', phone: '', email: '', location: '' });
  const [login, setLogin] = useState({ identifier: '', password: '' });
  const [portalData, setPortalData] = useState(null);
  const [selectedRegistration, setSelectedRegistration] = useState('');
  const [selectedVendorId, setSelectedVendorId] = useState('');
  const [temporaryPassword, setTemporaryPassword] = useState('');
  const [assignmentCode, setAssignmentCode] = useState('');
  const [qrStatus, setQrStatus] = useState(null);
  const [adminResource, setAdminResource] = useState('vendors');
  const [newPassword, setNewPassword] = useState('');
  const [newVendor, setNewVendor] = useState({ business_name: '', owner_name: '', login_identifier: '', mobile_number: '', password: '' });
  const [qrGenerateQuantity, setQrGenerateQuantity] = useState('100');
  const [reassignVendorInputs, setReassignVendorInputs] = useState({});
  const [leadStatusInputs, setLeadStatusInputs] = useState({});
  const [paidReferenceInputs, setPaidReferenceInputs] = useState({});
  const [newStaffUser, setNewStaffUser] = useState({ name: '', username_or_mobile: '', password: '', role: 'SALES' });
  const [staffRoleInputs, setStaffRoleInputs] = useState({});
  const [editingVendorId, setEditingVendorId] = useState(null);
  const [editVendorDraft, setEditVendorDraft] = useState({ business_name: '', owner_name: '', login_identifier: '', mobile_number: '' });
  const [qrPrintFilters, setQrPrintFilters] = useState({ status: '', vendor_id: '' });
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  function changeView(name) {
    setActiveView(name);
    setMessage('');
    setReferral(null);
    setPortalData(null);
    setSelectedRegistration('');
    setSelectedVendorId('');
    setTemporaryPassword('');
    setAssignmentCode('');
    setQrStatus(null);
    setAdminResource('vendors');
    setNewPassword('');
    setNewVendor({ business_name: '', owner_name: '', login_identifier: '', mobile_number: '', password: '' });
    setQrGenerateQuantity('100');
    setReassignVendorInputs({});
    setLeadStatusInputs({});
    setPaidReferenceInputs({});
    setNewStaffUser({ name: '', username_or_mobile: '', password: '', role: 'SALES' });
    setStaffRoleInputs({});
    setEditingVendorId(null);
    setQrPrintFilters({ status: '', vendor_id: '' });
  }

  async function resolveQr(event) {
    event.preventDefault();
    setLoading(true);
    setMessage('');
    try {
      const result = await apiRequest(`/public/qr/${encodeURIComponent(qrCode.trim())}`);
      setReferral(result.referral);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  }

  async function submitLead(event) {
    event.preventDefault();
    setLoading(true);
    setMessage('');
    try {
      const body = { ...lead, scan_id: referral.scan_id };
      if (!body.email.trim()) delete body.email;
      if (!body.location.trim()) delete body.location;
      await apiRequest('/public/leads', { method: 'POST', body: JSON.stringify(body) });
      setMessage('Your enquiry has been received.');
      setLead({ customer_name: '', phone: '', email: '', location: '' });
    } catch (error) {
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  }

  async function signIn(event) {
    event.preventDefault();
    setLoading(true);
    setMessage('');
    try {
      const path = activeView === 'Vendor' ? '/vendor/login' : '/auth/login';
      const body = activeView === 'Vendor'
        ? { login_identifier: login.identifier, password: login.password }
        : { username_or_mobile: login.identifier, password: login.password };
      const result = await apiRequest(path, { method: 'POST', body: JSON.stringify(body) });
      const data = activeView === 'Vendor'
        ? await Promise.all(['/vendor/profile', '/vendor/leads', '/vendor/payouts'].map((path) => apiRequest(path)))
        : await apiRequest(activeView === 'Admin' ? '/admin/vendors' : '/sales/registrations');
      setPortalData({ account: result.vendor || result.user, data });
      setMessage('Signed in successfully.');
    } catch (error) {
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  }

  async function loadAdminResource(resource = adminResource) {
    setLoading(true);
    setMessage('');
    try {
      const data = await apiRequest(`/admin/${resource}`);
      setPortalData({ ...portalData, data });
    } catch (error) {
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  }

  async function createVendor(event) {
    event.preventDefault();
    setLoading(true);
    setMessage('');
    try {
      const body = { ...newVendor };
      if (!body.password) delete body.password;
      await apiRequest('/admin/vendors', { method: 'POST', body: JSON.stringify(body) });
      setNewVendor({ business_name: '', owner_name: '', login_identifier: '', mobile_number: '', password: '' });
      await loadAdminResource('vendors');
      setMessage('Vendor created.');
    } catch (error) {
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  }

  async function deactivateVendor(vendorId, businessName) {
    if (!window.confirm(`Deactivate ${businessName}? Historical records are preserved.`)) return;
    setLoading(true);
    setMessage('');
    try {
      await apiRequest(`/admin/vendors/${vendorId}/deactivate`, { method: 'POST' });
      await loadAdminResource('vendors');
      setMessage('Vendor deactivated.');
    } catch (error) {
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  }

  function startEditVendor(vendor) {
    setEditingVendorId(vendor.id);
    setEditVendorDraft({
      business_name: vendor.businessName,
      owner_name: vendor.ownerName,
      login_identifier: vendor.loginIdentifier,
      mobile_number: vendor.mobileNumber,
    });
    setMessage('');
  }

  async function saveVendorEdit(event, vendorId) {
    event.preventDefault();
    if (!window.confirm('Save these changes to the Vendor record?')) return;
    setLoading(true);
    setMessage('');
    try {
      await apiRequest(`/admin/vendors/${vendorId}`, { method: 'PATCH', body: JSON.stringify(editVendorDraft) });
      setEditingVendorId(null);
      await loadAdminResource('vendors');
      setMessage('Vendor updated.');
    } catch (error) {
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  }

  async function resetVendorPassword(vendorId, businessName) {
    if (!window.confirm(`Issue a temporary password reset for ${businessName}?`)) return;
    setLoading(true);
    setMessage('');
    try {
      const result = await apiRequest(`/admin/vendors/${vendorId}/reset-password`, { method: 'POST' });
      setMessage(result.reset_token ? `${result.message} (dev reset token: ${result.reset_token})` : result.message);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  }

  async function generateQrBatch(event) {
    event.preventDefault();
    const quantity = Number.parseInt(qrGenerateQuantity, 10);
    if (!Number.isInteger(quantity) || quantity < 1) {
      setMessage('Enter a valid quantity.');
      return;
    }
    setLoading(true);
    setMessage('');
    try {
      const result = await apiRequest('/admin/qr/generate', { method: 'POST', body: JSON.stringify({ quantity }) });
      await loadAdminResource('qr');
      setMessage(`Generated ${result.count} QR codes.`);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  }

  async function reassignQrCode(qr) {
    const vendorId = (reassignVendorInputs[qr.id] || '').trim();
    if (!vendorId) {
      setMessage('Enter the target Vendor ID before reassigning.');
      return;
    }
    const currentVendor = qr.assignments?.[0]?.vendor?.businessName || 'the current Vendor';
    if (!window.confirm(`Reassign ${qr.code} from ${currentVendor} to Vendor ${vendorId}? Historical attribution is preserved.`)) return;
    setLoading(true);
    setMessage('');
    try {
      await apiRequest(`/admin/qr/${qr.id}/reassign`, { method: 'POST', body: JSON.stringify({ vendor_id: vendorId }) });
      setReassignVendorInputs({ ...reassignVendorInputs, [qr.id]: '' });
      await loadAdminResource('qr');
      setMessage('QR reassigned successfully.');
    } catch (error) {
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  }

  async function updateLeadStatus(lead) {
    const nextStatus = leadStatusInputs[lead.id] || lead.status;
    if (nextStatus === lead.status) {
      setMessage('Select a different status before updating.');
      return;
    }
    if (!window.confirm(`Change the lead for ${lead.customerName} from ${lead.status} to ${nextStatus}?`)) return;
    setLoading(true);
    setMessage('');
    try {
      await apiRequest(`/admin/leads/${lead.id}`, { method: 'PATCH', body: JSON.stringify({ status: nextStatus }) });
      await loadAdminResource('leads');
      setMessage('Lead status updated.');
    } catch (error) {
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  }

  async function markPayoutPaid(payout) {
    const reference = (paidReferenceInputs[payout.id] || '').trim();
    if (!reference) {
      setMessage('Enter a payment reference before marking paid.');
      return;
    }
    if (!window.confirm(`Mark the payout for ${payout.vendor?.businessName || 'this Vendor'} as PAID with reference "${reference}"?`)) return;
    setLoading(true);
    setMessage('');
    try {
      await apiRequest(`/admin/payouts/${payout.id}/mark-paid`, { method: 'POST', body: JSON.stringify({ paid_reference: reference }) });
      setPaidReferenceInputs({ ...paidReferenceInputs, [payout.id]: '' });
      await loadAdminResource('payouts');
      setMessage('Payout marked as paid.');
    } catch (error) {
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  }

  async function createStaffUser(event) {
    event.preventDefault();
    setLoading(true);
    setMessage('');
    try {
      await apiRequest('/admin/users', { method: 'POST', body: JSON.stringify(newStaffUser) });
      setNewStaffUser({ name: '', username_or_mobile: '', password: '', role: 'SALES' });
      await loadAdminResource('users');
      setMessage('Staff user created.');
    } catch (error) {
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  }

  async function updateStaffUserRole(user) {
    const nextRole = staffRoleInputs[user.id] || user.role;
    if (nextRole === user.role) {
      setMessage('Select a different role before updating.');
      return;
    }
    if (!window.confirm(`Change ${user.name}'s role from ${user.role} to ${nextRole}?`)) return;
    setLoading(true);
    setMessage('');
    try {
      await apiRequest(`/admin/users/${user.id}`, { method: 'PATCH', body: JSON.stringify({ role: nextRole }) });
      await loadAdminResource('users');
      setMessage('Staff user role updated.');
    } catch (error) {
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  }

  async function deactivateStaffUser(user) {
    if (!window.confirm(`Deactivate staff user ${user.name}?`)) return;
    setLoading(true);
    setMessage('');
    try {
      await apiRequest(`/admin/users/${user.id}/deactivate`, { method: 'POST' });
      await loadAdminResource('users');
      setMessage('Staff user deactivated.');
    } catch (error) {
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  }

  function openQrPrintSheet() {
    const params = new URLSearchParams();
    if (qrPrintFilters.status) params.set('status', qrPrintFilters.status);
    if (qrPrintFilters.vendor_id.trim()) params.set('vendor_id', qrPrintFilters.vendor_id.trim());
    const query = params.toString();
    window.open(`${API_BASE_URL}/admin/qr/print${query ? `?${query}` : ''}`, '_blank', 'noopener,noreferrer');
  }

  async function onboardVendor(event) {
    event.preventDefault();
    setLoading(true);
    setMessage('');
    try {
      const result = await apiRequest(`/sales/vendors/${selectedRegistration}/onboard`, { method: 'POST', body: JSON.stringify({ password: temporaryPassword }) });
      const registrations = await apiRequest('/sales/registrations');
      setPortalData({ ...portalData, data: registrations });
      setSelectedVendorId(result.vendor.id);
      setSelectedRegistration('');
      setTemporaryPassword('');
      setMessage('Vendor onboarded. Assign an unassigned QR next.');
    } catch (error) {
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  }

  async function checkQr(event) {
    event.preventDefault();
    setLoading(true);
    setMessage('');
    try {
      const result = await apiRequest(`/sales/qr/${encodeURIComponent(assignmentCode.trim())}`);
      setQrStatus(result.qr);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  }

  async function assignQr(event) {
    event.preventDefault();
    setLoading(true);
    setMessage('');
    try {
      await apiRequest('/sales/qr/assign', { method: 'POST', body: JSON.stringify({ code: assignmentCode.trim(), vendor_id: selectedVendorId }) });
      setMessage('QR assigned successfully.');
      setQrStatus(null);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  }

  async function changeVendorPassword(event) {
    event.preventDefault();
    setLoading(true);
    setMessage('');
    try {
      const result = await apiRequest('/vendor/change-password', {
        method: 'POST',
        body: JSON.stringify({ current_password: login.password, new_password: newPassword }),
      });
      setPortalData({ ...portalData, account: result.vendor });
      setLogin({ ...login, password: newPassword });
      setNewPassword('');
      setMessage('Password changed successfully.');
    } catch (error) {
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  }

  function renderVendorWorkspace() {
    const [profileResult, leadsResult, payoutsResult] = portalData.data;
    const vendor = profileResult.vendor || portalData.account;
    return (
      <div className="vendor-workspace">
        {vendor.mustChangePassword && (
          <form onSubmit={changeVendorPassword} className="lead-form">
            <p className="referral-note">Set a permanent password before continuing.</p>
            <input required minLength="8" type="password" placeholder="New password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} />
            <button className="primary-action" disabled={loading}>{loading ? 'Updating...' : 'Change password'}</button>
          </form>
        )}
        <div className="data-section">
          <h2>{vendor.businessName}</h2>
          <p className="referral-note">Owner: {vendor.ownerName} · Access: Active</p>
          <h3>Referrals</h3>
          {leadsResult.leads?.length ? leadsResult.leads.map((item) => <div className="data-row" key={item.id}><span>{item.customerName}</span><strong>{item.status}</strong></div>) : <p className="empty-state">No referrals yet.</p>}
          <h3>Payout status</h3>
          {payoutsResult.payouts?.length ? payoutsResult.payouts.map((item) => <div className="data-row" key={item.id}><span>{item.leadId}</span><strong>{item.status}</strong></div>) : <p className="empty-state">No payout records yet.</p>}
        </div>
      </div>
    );
  }

  function renderAdminVendors() {
    const vendors = portalData?.data?.vendors || [];
    return (
      <div className="data-section">
        <h3>Create vendor</h3>
        <form onSubmit={createVendor} className="lead-form">
          <input required placeholder="Business name" value={newVendor.business_name} onChange={(event) => setNewVendor({ ...newVendor, business_name: event.target.value })} />
          <input required placeholder="Owner name" value={newVendor.owner_name} onChange={(event) => setNewVendor({ ...newVendor, owner_name: event.target.value })} />
          <input required placeholder="Login identifier" value={newVendor.login_identifier} onChange={(event) => setNewVendor({ ...newVendor, login_identifier: event.target.value })} />
          <input required placeholder="Mobile number" value={newVendor.mobile_number} onChange={(event) => setNewVendor({ ...newVendor, mobile_number: event.target.value })} />
          <input type="password" minLength="8" placeholder="Initial password (optional)" value={newVendor.password} onChange={(event) => setNewVendor({ ...newVendor, password: event.target.value })} />
          <button className="primary-action" disabled={loading}>{loading ? 'Creating...' : 'Create vendor'}</button>
        </form>
        <h3>Vendors</h3>
        {vendors.length ? vendors.map((vendor) => (
          editingVendorId === vendor.id ? (
            <form onSubmit={(event) => saveVendorEdit(event, vendor.id)} className="lead-form admin-edit-form" key={vendor.id}>
              <input required placeholder="Business name" value={editVendorDraft.business_name} onChange={(event) => setEditVendorDraft({ ...editVendorDraft, business_name: event.target.value })} />
              <input required placeholder="Owner name" value={editVendorDraft.owner_name} onChange={(event) => setEditVendorDraft({ ...editVendorDraft, owner_name: event.target.value })} />
              <input required placeholder="Login identifier" value={editVendorDraft.login_identifier} onChange={(event) => setEditVendorDraft({ ...editVendorDraft, login_identifier: event.target.value })} />
              <input required placeholder="Mobile number" value={editVendorDraft.mobile_number} onChange={(event) => setEditVendorDraft({ ...editVendorDraft, mobile_number: event.target.value })} />
              <span className="row-actions">
                <button className="primary-action" disabled={loading}>{loading ? 'Saving...' : 'Save changes'}</button>
                <button type="button" className="secondary-action" onClick={() => setEditingVendorId(null)} disabled={loading}>Cancel</button>
              </span>
            </form>
          ) : (
            <div className="data-row admin-row" key={vendor.id}>
              <span>{vendor.businessName} <em>({vendor.loginIdentifier}, {vendor.status})</em></span>
              <span className="row-actions">
                <button className="secondary-action" onClick={() => startEditVendor(vendor)} disabled={loading}>Edit</button>
                <button className="secondary-action" onClick={() => resetVendorPassword(vendor.id, vendor.businessName)} disabled={loading}>Reset password</button>
                <button className="secondary-action" onClick={() => deactivateVendor(vendor.id, vendor.businessName)} disabled={loading || vendor.status === 'INACTIVE'}>Deactivate</button>
              </span>
            </div>
          )
        )) : <p className="empty-state">No vendors yet.</p>}
      </div>
    );
  }

  function renderAdminQr() {
    const qrCodes = portalData?.data?.data || [];
    return (
      <div className="data-section">
        <h3>Generate QR batch</h3>
        <form onSubmit={generateQrBatch} className="inline-form">
          <label htmlFor="qr-quantity">Quantity</label>
          <input id="qr-quantity" type="number" min="1" max="5000" value={qrGenerateQuantity} onChange={(event) => setQrGenerateQuantity(event.target.value)} />
          <button className="primary-action" disabled={loading}>{loading ? 'Generating...' : 'Generate'}</button>
        </form>
        <h3>Print / export</h3>
        <div className="print-controls">
          <label htmlFor="qr-print-status">Status filter</label>
          <select id="qr-print-status" value={qrPrintFilters.status} onChange={(event) => setQrPrintFilters({ ...qrPrintFilters, status: event.target.value })}>
            <option value="">All statuses</option>
            {QR_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
          </select>
          <input
            placeholder="Vendor ID (optional)"
            value={qrPrintFilters.vendor_id}
            onChange={(event) => setQrPrintFilters({ ...qrPrintFilters, vendor_id: event.target.value })}
          />
          <button type="button" className="primary-action" onClick={openQrPrintSheet}>Open printable sheet</button>
        </div>
        <h3>QR inventory</h3>
        {qrCodes.length ? qrCodes.map((qr) => {
          const currentVendor = qr.assignments?.[0]?.vendor?.businessName;
          return (
            <div className="data-row admin-row" key={qr.id}>
              <span>{qr.code} <em>({qr.status}{currentVendor ? ` — ${currentVendor}` : ''})</em></span>
              <span className="row-actions">
                <a className="secondary-action" href={`${API_BASE_URL}/admin/qr/${qr.id}/image`} target="_blank" rel="noreferrer">SVG</a>
                <a className="secondary-action" href={`${API_BASE_URL}/admin/qr/${qr.id}/image?format=png`} target="_blank" rel="noreferrer">PNG</a>
                {qr.status === 'ACTIVE' && (
                  <>
                    <input
                      className="reassign-input"
                      placeholder="Target Vendor ID"
                      value={reassignVendorInputs[qr.id] || ''}
                      onChange={(event) => setReassignVendorInputs({ ...reassignVendorInputs, [qr.id]: event.target.value })}
                    />
                    <button className="secondary-action" onClick={() => reassignQrCode(qr)} disabled={loading}>Reassign</button>
                  </>
                )}
              </span>
            </div>
          );
        }) : <p className="empty-state">No QR codes yet.</p>}
      </div>
    );
  }

  function renderAdminLeads() {
    const leads = portalData?.data?.leads || [];
    return (
      <div className="data-section">
        <h3>Leads</h3>
        {leads.length ? leads.map((lead) => (
          <div className="data-row admin-row" key={lead.id}>
            <span>{lead.customerName} <em>({lead.vendor?.businessName || 'no vendor'} · {lead.qr?.code || 'no QR'} · {lead.status})</em></span>
            <span className="row-actions">
              <select value={leadStatusInputs[lead.id] || lead.status} onChange={(event) => setLeadStatusInputs({ ...leadStatusInputs, [lead.id]: event.target.value })}>
                {LEAD_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
              </select>
              <button className="secondary-action" onClick={() => updateLeadStatus(lead)} disabled={loading}>Update</button>
            </span>
          </div>
        )) : <p className="empty-state">No leads yet.</p>}
      </div>
    );
  }

  function renderAdminPayouts() {
    const payouts = portalData?.data?.payouts || [];
    return (
      <div className="data-section">
        <h3>Payouts</h3>
        {payouts.length ? payouts.map((payout) => (
          <div className="data-row admin-row" key={payout.id}>
            <span>{payout.vendor?.businessName || 'Unknown vendor'} <em>({payout.status}{payout.paidReference ? ` — ${payout.paidReference}` : ''})</em></span>
            {payout.status === 'UNPAID' && (
              <span className="row-actions">
                <input
                  className="reassign-input"
                  placeholder="Payment reference"
                  value={paidReferenceInputs[payout.id] || ''}
                  onChange={(event) => setPaidReferenceInputs({ ...paidReferenceInputs, [payout.id]: event.target.value })}
                />
                <button className="secondary-action" onClick={() => markPayoutPaid(payout)} disabled={loading}>Mark paid</button>
              </span>
            )}
          </div>
        )) : <p className="empty-state">No payout records yet.</p>}
      </div>
    );
  }

  function renderAdminUsers() {
    const staffUsers = portalData?.data?.users || [];
    return (
      <div className="data-section">
        <h3>Create staff user</h3>
        <form onSubmit={createStaffUser} className="lead-form">
          <input required placeholder="Name" value={newStaffUser.name} onChange={(event) => setNewStaffUser({ ...newStaffUser, name: event.target.value })} />
          <input required placeholder="Username or mobile" value={newStaffUser.username_or_mobile} onChange={(event) => setNewStaffUser({ ...newStaffUser, username_or_mobile: event.target.value })} />
          <input required minLength="8" type="password" placeholder="Password" value={newStaffUser.password} onChange={(event) => setNewStaffUser({ ...newStaffUser, password: event.target.value })} />
          <select value={newStaffUser.role} onChange={(event) => setNewStaffUser({ ...newStaffUser, role: event.target.value })}>
            <option value="SALES">SALES</option>
            <option value="ADMIN">ADMIN</option>
          </select>
          <button className="primary-action" disabled={loading}>{loading ? 'Creating...' : 'Create staff user'}</button>
        </form>
        <h3>Staff users</h3>
        {staffUsers.length ? staffUsers.map((user) => (
          <div className="data-row admin-row" key={user.id}>
            <span>{user.name} <em>({user.usernameMobile}, {user.status})</em></span>
            <span className="row-actions">
              <select value={staffRoleInputs[user.id] || user.role} onChange={(event) => setStaffRoleInputs({ ...staffRoleInputs, [user.id]: event.target.value })}>
                <option value="SALES">SALES</option>
                <option value="ADMIN">ADMIN</option>
              </select>
              <button className="secondary-action" onClick={() => updateStaffUserRole(user)} disabled={loading}>Update role</button>
              <button className="secondary-action" onClick={() => deactivateStaffUser(user)} disabled={loading || user.status === 'INACTIVE'}>Deactivate</button>
            </span>
          </div>
        )) : <p className="empty-state">No staff users yet.</p>}
      </div>
    );
  }

  function renderPublic() {
    return (
      <div className="live-panel">
        <form onSubmit={resolveQr} className="inline-form">
          <label htmlFor="qr-code">Referral QR</label>
          <input id="qr-code" value={qrCode} onChange={(event) => setQrCode(event.target.value)} placeholder="V-0001" />
          <button className="primary-action" disabled={loading}>{loading ? 'Checking...' : 'Open referral'}</button>
        </form>
        {referral && (
          <form onSubmit={submitLead} className="lead-form">
            <p className="referral-note">Referred by <strong>{referral.vendor_name}</strong></p>
            <input required placeholder="Customer name" value={lead.customer_name} onChange={(event) => setLead({ ...lead, customer_name: event.target.value })} />
            <input required placeholder="Mobile number" value={lead.phone} onChange={(event) => setLead({ ...lead, phone: event.target.value })} />
            <input type="email" placeholder="Email" value={lead.email} onChange={(event) => setLead({ ...lead, email: event.target.value })} />
            <input placeholder="Location" value={lead.location} onChange={(event) => setLead({ ...lead, location: event.target.value })} />
            <button className="primary-action" disabled={loading}>{loading ? 'Sending...' : 'Submit enquiry'}</button>
          </form>
        )}
      </div>
    );
  }

  function renderPortal() {
    const registrations = activeView === 'Sales' && portalData?.data?.registrations ? portalData.data.registrations : [];
    return (
      <div className="live-panel">
        {!portalData ? (
          <form onSubmit={signIn} className="lead-form">
            <input required placeholder={activeView === 'Vendor' ? 'Login identifier' : 'Username or mobile'} value={login.identifier} onChange={(event) => setLogin({ ...login, identifier: event.target.value })} />
            <input required type="password" placeholder="Password" value={login.password} onChange={(event) => setLogin({ ...login, password: event.target.value })} />
            <button className="primary-action" disabled={loading}>{loading ? 'Signing in...' : 'Sign in'}</button>
          </form>
        ) : (
          <div className="portal-result">
            <p className="referral-note">Signed in as <strong>{portalData.account.name || portalData.account.businessName || portalData.account.loginIdentifier}</strong></p>
            {activeView === 'Admin' && (
              <div className="inline-form">
                <label htmlFor="admin-resource">Operational view</label>
                <select id="admin-resource" value={adminResource} onChange={(event) => { setAdminResource(event.target.value); loadAdminResource(event.target.value); }}>
                  <option value="vendors">Vendors</option>
                  <option value="qr">QR inventory</option>
                  <option value="leads">Leads</option>
                  <option value="scans">Scans</option>
                  <option value="payouts">Payouts</option>
                  <option value="users">Staff users</option>
                  <option value="audit-logs">Audit logs</option>
                </select>
                <button className="primary-action" onClick={() => loadAdminResource()} disabled={loading}>{loading ? 'Loading...' : 'Refresh view'}</button>
              </div>
            )}
            {activeView === 'Vendor' ? renderVendorWorkspace() : null}
            {activeView === 'Admin' && adminResource === 'vendors' ? renderAdminVendors() : null}
            {activeView === 'Admin' && adminResource === 'qr' ? renderAdminQr() : null}
            {activeView === 'Admin' && adminResource === 'leads' ? renderAdminLeads() : null}
            {activeView === 'Admin' && adminResource === 'payouts' ? renderAdminPayouts() : null}
            {activeView === 'Admin' && adminResource === 'users' ? renderAdminUsers() : null}
            {activeView === 'Sales' && (
              <>
                <form onSubmit={onboardVendor} className="lead-form">
                  <select required value={selectedRegistration} onChange={(event) => setSelectedRegistration(event.target.value)}>
                    <option value="">Select pending registration</option>
                    {registrations.map((registration) => <option key={registration.id} value={registration.id}>{registration.businessName} - {registration.ownerName}</option>)}
                  </select>
                  <input required minLength="8" placeholder="Temporary password" value={temporaryPassword} onChange={(event) => setTemporaryPassword(event.target.value)} />
                  <button className="primary-action" disabled={loading}>{loading ? 'Onboarding...' : 'Complete onboarding'}</button>
                </form>
                <form onSubmit={checkQr} className="inline-form">
                  <label htmlFor="assignment-code">Assign physical QR</label>
                  <input id="assignment-code" required placeholder="V-0001" value={assignmentCode} onChange={(event) => setAssignmentCode(event.target.value)} />
                  <button className="primary-action" disabled={loading}>{loading ? 'Checking...' : 'Check QR'}</button>
                </form>
                {qrStatus && <p className="referral-note">QR status: <strong>{qrStatus.status}</strong></p>}
                {qrStatus?.status === 'UNASSIGNED' && selectedVendorId && <button className="primary-action" onClick={assignQr} disabled={loading}>Assign QR to selected Vendor</button>}
              </>
            )}
            {activeView !== 'Vendor' && !(activeView === 'Admin' && ['vendors', 'qr', 'leads', 'payouts', 'users'].includes(adminResource)) && <pre>{JSON.stringify(portalData.data, null, 2)}</pre>}
          </div>
        )}
      </div>
    );
  }

  return (
    <main className="App">
      <nav className="topbar" aria-label="Solarium navigation">
        <div className="brand"><span className="brand-mark">S</span><span>solarium<span className="brand-accent">/</span>energy</span></div>
        <span className="environment">Frontend preview</span>
      </nav>

      <section className="workspace">
        <aside className="sidebar">
          <p className="sidebar-label">View as</p>
          <div className="view-switcher" role="tablist" aria-label="Portal views">
            {Object.keys(views).map((name) => (
              <button
                className={activeView === name ? 'view-tab active' : 'view-tab'}
                key={name}
                onClick={() => changeView(name)}
                role="tab"
                aria-selected={activeView === name}
              >
                <span className="tab-dot" />{name}
              </button>
            ))}
          </div>
          <p className="sidebar-note">Connected to the Solarium API on port 4000.</p>
        </aside>

        <section className="content" role="tabpanel">
          <div className="content-header">
            <span className="status-pill"><span className="live-dot" /> {activeView} space</span>
            <span className="route-label">/{activeView.toLowerCase()}</span>
          </div>
          <div className="hero-copy">
            <p className="eyebrow">{view.eyebrow}</p>
            <h1>{view.title}</h1>
            <p className="description">{view.description}</p>
            {activeView === 'Public' ? renderPublic() : renderPortal()}
          </div>
          <div className="status-list">
            {view.items.map(([label, status]) => (
              <div className="status-row" key={label}>
                <span>{label}</span><strong>{status}</strong>
              </div>
            ))}
          </div>
          {message && <p className="form-message" role="status">{message}</p>}
          <p className="preview-note">Live API connection enabled for this workflow. Additional portal screens will be added module by module.</p>
        </section>
      </section>
    </main>
  );
}

export default App;
