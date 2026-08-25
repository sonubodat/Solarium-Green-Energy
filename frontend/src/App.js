import { useState } from 'react';
import { apiRequest } from './api/client';
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
      await apiRequest('/public/leads', { method: 'POST', body: JSON.stringify({ ...lead, scan_id: referral.scan_id }) });
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
            {activeView !== 'Vendor' && <pre>{JSON.stringify(portalData.data, null, 2)}</pre>}
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
