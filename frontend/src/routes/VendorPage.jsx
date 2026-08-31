import { useEffect, useRef, useState } from 'react';
import { apiRequest } from '../api/client';
import './VendorPage.css';

const ICONS = {
  store: 'M3 9 5 4h14l2 5M4 9v10a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V9M3 9h18M8 9v3m8-3v3M9 20v-5h6v5',
  person: 'M12 12a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9Zm0 2c-4.2 0-7.5 2.1-7.5 4.7V21h15v-2.3c0-2.6-3.3-4.7-7.5-4.7Z',
  users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm7-7a4 4 0 0 1 0 7.8M22 21v-2a4 4 0 0 0-3-3.9',
  wallet: 'M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Zm0 2h18m-5 5h3',
  chart: 'M4 19V5m0 14h17M8 16l3-4 3 2 5-7',
  arrow: 'M5 12h13m0 0-5-5m5 5-5 5',
  logout: 'M10 17l5-5-5-5m5 5H3m10-9h5a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-5',
  lock: 'M7 10V8a5 5 0 0 1 10 0v2h1a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1h1Zm2 0h6V8a3 3 0 0 0-6 0v2Z',
  phone: 'M6.6 10.8c1.3 2.6 3.4 4.7 6 6l2-2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.5.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1C10.5 21 3 13.5 3 4c0-.6.4-1 1-1h3.8c.6 0 1 .4 1 1 0 1.2.2 2.4.6 3.5.1.4 0 .8-.3 1l-2 2Z',
  check: 'M20 6 9 17l-5-5',
  clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Zm0-6V12l4-2',
};

function Icon({ path, className = '' }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={path} />
    </svg>
  );
}

function getInitials(name = '') {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase() || 'VE';
}

function statusClass(status = '') {
  const value = status.toLowerCase();

  if (
    value.includes('paid') ||
    value.includes('completed') ||
    value.includes('approved') ||
    value.includes('success')
  ) {
    return 'vendor-status vendor-status-success';
  }

  if (
    value.includes('pending') ||
    value.includes('progress') ||
    value.includes('review')
  ) {
    return 'vendor-status vendor-status-pending';
  }

  if (
    value.includes('reject') ||
    value.includes('cancel') ||
    value.includes('failed')
  ) {
    return 'vendor-status vendor-status-danger';
  }

  return 'vendor-status vendor-status-neutral';
}

function VendorPage() {
  const [login, setLogin] = useState({
    identifier: '',
    password: '',
  });

  const [portalData, setPortalData] = useState(null);
  const [newPassword, setNewPassword] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [activeSection, setActiveSection] = useState('overview');

  const mountedRef = useRef(true);

  useEffect(() => {
    // Explicitly set true here too, not just in the useRef initializer — React StrictMode's
    // dev-only double-invoke of effects (mount -> cleanup -> mount again) would otherwise run
    // this cleanup once and leave mountedRef permanently false, silently blocking every
    // subsequent state update gated on it (setPortalData, setLoading(false), etc.).
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    restoreSession();

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadVendorData(account = null) {
    // Sequential, not Promise.all — avoids grabbing 3 pooled DB connections at once on every
    // sign-in/session-restore against a pooler with a small shared connection ceiling.
    const profile = await apiRequest('/vendor/profile');
    const leads = await apiRequest('/vendor/leads');
    const payouts = await apiRequest('/vendor/payouts');
    const data = [profile, leads, payouts];

    return {
      account,
      data,
    };
  }

  async function restoreSession() {
    try {
      const session = await apiRequest('/auth/session');

      if (!mountedRef.current || session.role !== 'VENDOR') return;

      const data = await loadVendorData(session.account);

      if (!mountedRef.current) return;

      setPortalData(data);
    } catch (error) {
      // No active session.
    }
  }

  async function signIn(event) {
    event.preventDefault();

    setLoading(true);
    setMessage('');

    try {
      const result = await apiRequest('/vendor/login', {
        method: 'POST',
        body: JSON.stringify({
          login_identifier: login.identifier,
          password: login.password,
        }),
      });

      const data = await loadVendorData(result.vendor);

      if (!mountedRef.current) return;

      setPortalData(data);
      setMessage('');
    } catch (error) {
      setMessage(error.message || 'Unable to sign in.');
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }

  async function signOutCurrent() {
    setLoading(true);
    setMessage('');

    try {
      await apiRequest('/auth/logout', {
        method: 'POST',
      });
    } catch (error) {
      // Clear UI even when logout request fails.
    } finally {
      setPortalData(null);
      setLoading(false);
      setLogin({
        identifier: '',
        password: '',
      });
      setActiveSection('overview');
    }
  }

  async function changeVendorPassword(event) {
    event.preventDefault();

    setLoading(true);
    setMessage('');

    try {
      const result = await apiRequest('/vendor/change-password', {
        method: 'POST',
        body: JSON.stringify({
          current_password: login.password,
          new_password: newPassword,
        }),
      });

      setPortalData((current) => ({
        ...current,
        account: result.vendor,
      }));

      setLogin((current) => ({
        ...current,
        password: newPassword,
      }));

      setNewPassword('');
      setMessage('Password changed successfully.');
    } catch (error) {
      setMessage(error.message || 'Unable to change password.');
    } finally {
      setLoading(false);
    }
  }

  function renderLogin() {
    return (
      <div className="vendor-auth-page">
        <div className="vendor-auth-brand">
          <span className="vendor-brand-main">solarium</span>
          <span className="vendor-brand-accent">energy</span>
        </div>

        <div className="vendor-auth-layout">
          <section className="vendor-auth-intro">
            <span className="vendor-eyebrow">PARTNER PORTAL</span>

            <h1>
              Grow your business
              <br />
              with <span>solar.</span>
            </h1>

            <p>
              Share genuine solar opportunities with Solarium Energy
              and track your referrals and payouts from one simple place.
            </p>

            <div className="vendor-auth-points">
              <div>
                <span className="vendor-point-icon">
                  <Icon path={ICONS.users} />
                </span>
                <div>
                  <strong>Customer referrals</strong>
                  <small>Track every enquiry you send.</small>
                </div>
              </div>

              <div>
                <span className="vendor-point-icon">
                  <Icon path={ICONS.wallet} />
                </span>
                <div>
                  <strong>Transparent payouts</strong>
                  <small>Know exactly where your earnings stand.</small>
                </div>
              </div>

              <div>
                <span className="vendor-point-icon">
                  <Icon path={ICONS.headset || ICONS.person} />
                </span>
                <div>
                  <strong>Dedicated support</strong>
                  <small>Our team helps move opportunities forward.</small>
                </div>
              </div>
            </div>
          </section>

          <section className="vendor-login-card">
            <div className="vendor-login-heading">
              <div className="vendor-login-icon">
                <Icon path={ICONS.store} />
              </div>

              <div>
                <h2>Vendor login</h2>
                <p>Access your partner workspace</p>
              </div>
            </div>

            <form onSubmit={signIn} className="vendor-form">
              <label>
                Login ID
                <div className="vendor-input-wrap">
                  <Icon path={ICONS.person} />
                  <input
                    required
                    autoComplete="username"
                    placeholder="Enter your login ID"
                    value={login.identifier}
                    onChange={(event) =>
                      setLogin({
                        ...login,
                        identifier: event.target.value,
                      })
                    }
                  />
                </div>
              </label>

              <label>
                Password
                <div className="vendor-input-wrap">
                  <Icon path={ICONS.lock} />
                  <input
                    required
                    type="password"
                    autoComplete="current-password"
                    placeholder="Enter your password"
                    value={login.password}
                    onChange={(event) =>
                      setLogin({
                        ...login,
                        password: event.target.value,
                      })
                    }
                  />
                </div>
              </label>

              <button
                type="submit"
                className="vendor-primary-button"
                disabled={loading}
              >
                {loading ? 'Signing in...' : 'Sign in'}
                {!loading && <Icon path={ICONS.arrow} />}
              </button>
            </form>

            {message && (
              <p className="vendor-form-message vendor-form-message-error">
                {message}
              </p>
            )}

            <div className="vendor-login-security">
              <Icon path={ICONS.lock} />
              <span>Your account information is securely protected.</span>
            </div>
          </section>
        </div>
      </div>
    );
  }

  function renderPasswordSetup(vendor) {
    if (!vendor?.mustChangePassword) return null;

    return (
      <div className="vendor-password-banner">
        <div className="vendor-password-banner-icon">
          <Icon path={ICONS.lock} />
        </div>

        <div className="vendor-password-banner-copy">
          <strong>Set your permanent password</strong>
          <span>
            For security, please change the temporary password before
            continuing.
          </span>
        </div>

        <form
          onSubmit={changeVendorPassword}
          className="vendor-password-form"
        >
          <input
            required
            minLength={8}
            type="password"
            placeholder="New password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
          />

          <button
            type="submit"
            className="vendor-primary-button vendor-small-button"
            disabled={loading}
          >
            {loading ? 'Updating...' : 'Set password'}
          </button>
        </form>
      </div>
    );
  }

  function renderOverview(vendor, leads, payouts, totalLeads) {

    const pendingLeads = leads.filter((item) => {
      const status = String(item.status || '').toLowerCase();
      return (
        status.includes('pending') ||
        status.includes('new') ||
        status.includes('progress')
      );
    }).length;

    const paidPayouts = payouts.filter((item) => {
      const status = String(item.status || '').toLowerCase();
      return status.includes('paid') || status.includes('completed');
    }).length;

    return (
      <>
        <div className="vendor-welcome">
          <div>
            <span className="vendor-section-kicker">VENDOR DASHBOARD</span>

            <h1>
              Welcome back,{' '}
              <span>{vendor.ownerName || vendor.businessName || 'Partner'}</span>
            </h1>

            <p>
              Here is a quick look at your referrals and payout activity.
            </p>
          </div>

          <div className="vendor-business-badge">
            <span className="vendor-avatar">
              {getInitials(vendor.businessName)}
            </span>

            <div>
              <strong>{vendor.businessName || 'Vendor Partner'}</strong>
              <small>Active partner</small>
            </div>
          </div>
        </div>

        <div className="vendor-stat-grid">
          <div className="vendor-stat-card">
            <span className="vendor-stat-icon">
              <Icon path={ICONS.users} />
            </span>

            <div>
              <small>Total referrals</small>
              <strong>{totalLeads}</strong>
              <span>Customer enquiries</span>
            </div>
          </div>

          <div className="vendor-stat-card">
            <span className="vendor-stat-icon">
              <Icon path={ICONS.clock} />
            </span>

            <div>
              <small>In progress</small>
              <strong>{pendingLeads}</strong>
              <span>Need attention</span>
            </div>
          </div>

          <div className="vendor-stat-card">
            <span className="vendor-stat-icon">
              <Icon path={ICONS.wallet} />
            </span>

            <div>
              <small>Paid referrals</small>
              <strong>{paidPayouts}</strong>
              <span>Completed payouts</span>
            </div>
          </div>
        </div>

        <div className="vendor-content-grid">
          <section className="vendor-panel">
            <div className="vendor-panel-heading">
              <div>
                <span className="vendor-panel-kicker">RECENT ACTIVITY</span>
                <h2>Customer referrals</h2>
              </div>

              {leads.length > 0 && (
                <button
                  type="button"
                  className="vendor-text-button"
                  onClick={() => setActiveSection('referrals')}
                >
                  View all
                  <Icon path={ICONS.arrow} />
                </button>
              )}
            </div>

            {leads.length ? (
              <div className="vendor-referral-list">
                {leads.slice(0, 5).map((item) => (
                  <div className="vendor-referral-row" key={item.id}>
                    <span className="vendor-referral-avatar">
                      {getInitials(item.customerName)}
                    </span>

                    <div className="vendor-referral-main">
                      <strong>{item.customerName || 'Customer'}</strong>

                      <small>
                        {item.phone || item.email || 'Contact details available'}
                      </small>
                    </div>

                    <span className={statusClass(item.status)}>
                      {item.status || 'New'}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="vendor-empty">
                <span className="vendor-empty-icon">
                  <Icon path={ICONS.users} />
                </span>

                <strong>No referrals yet</strong>
                <p>
                  Your customer enquiries will appear here once they are
                  submitted.
                </p>
              </div>
            )}
          </section>

          <section className="vendor-panel vendor-quick-panel">
            <div className="vendor-panel-heading">
              <div>
                <span className="vendor-panel-kicker">PARTNER STATUS</span>
                <h2>Your account</h2>
              </div>
            </div>

            <div className="vendor-account-status">
              <span className="vendor-account-check">
                <Icon path={ICONS.check} />
              </span>

              <div>
                <strong>Account active</strong>
                <p>You can continue sending customer referrals.</p>
              </div>
            </div>

            <div className="vendor-account-details">
              <div>
                <small>Business</small>
                <strong>{vendor.businessName || '—'}</strong>
              </div>

              <div>
                <small>Owner</small>
                <strong>{vendor.ownerName || '—'}</strong>
              </div>

              <div>
                <small>Access</small>
                <strong>Vendor Partner</strong>
              </div>
            </div>
          </section>
        </div>
      </>
    );
  }

  function renderReferrals(leads) {
    return (
      <section className="vendor-panel vendor-full-panel">
        <div className="vendor-panel-heading">
          <div>
            <span className="vendor-panel-kicker">CUSTOMERS</span>
            <h2>All referrals</h2>
            <p>Track the customers you have referred to Solarium Energy.</p>
          </div>
        </div>

        {leads.length ? (
          <div className="vendor-table-wrap">
            <table className="vendor-table">
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Contact</th>
                  <th>Status</th>
                </tr>
              </thead>

              <tbody>
                {leads.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <div className="vendor-table-person">
                        <span className="vendor-referral-avatar">
                          {getInitials(item.customerName)}
                        </span>

                        <strong>{item.customerName || 'Customer'}</strong>
                      </div>
                    </td>

                    <td>
                      <div className="vendor-contact-cell">
                        {item.phone && (
                          <span>
                            <Icon path={ICONS.phone} />
                            {item.phone}
                          </span>
                        )}

                        {item.email && (
                          <span>{item.email}</span>
                        )}
                      </div>
                    </td>

                    <td>
                      <span className={statusClass(item.status)}>
                        {item.status || 'New'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="vendor-empty vendor-empty-large">
            <span className="vendor-empty-icon">
              <Icon path={ICONS.users} />
            </span>

            <strong>No customer referrals yet</strong>
            <p>
              Once you start referring customers, their enquiries will
              appear here.
            </p>
          </div>
        )}
      </section>
    );
  }

  function renderPayouts(payouts) {
    return (
      <section className="vendor-panel vendor-full-panel">
        <div className="vendor-panel-heading">
          <div>
            <span className="vendor-panel-kicker">EARNINGS</span>
            <h2>Payouts</h2>
            <p>Track the status of your referral commissions.</p>
          </div>
        </div>

        {payouts.length ? (
          <div className="vendor-payout-list">
            {payouts.map((item) => (
              <div className="vendor-payout-row" key={item.id}>
                <div className="vendor-payout-icon">
                  <Icon path={ICONS.wallet} />
                </div>

                <div className="vendor-payout-info">
                  <strong>
                    Referral #{item.leadId || item.id}
                  </strong>

                  <small>Commission payout</small>
                </div>

                <span className={statusClass(item.status)}>
                  {item.status || 'Pending'}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="vendor-empty vendor-empty-large">
            <span className="vendor-empty-icon">
              <Icon path={ICONS.wallet} />
            </span>

            <strong>No payout records yet</strong>
            <p>
              Your commission records will appear here as referrals
              progress.
            </p>
          </div>
        )}
      </section>
    );
  }

  function renderAccount(vendor) {
    return (
      <section className="vendor-panel vendor-full-panel">
        <div className="vendor-panel-heading">
          <div>
            <span className="vendor-panel-kicker">ACCOUNT</span>
            <h2>Business account</h2>
            <p>Review your vendor account information.</p>
          </div>
        </div>

        <div className="vendor-profile-card">
          <div className="vendor-profile-avatar">
            {getInitials(vendor.businessName)}
          </div>

          <div>
            <strong>{vendor.businessName || 'Vendor Partner'}</strong>
            <span>{vendor.ownerName || 'Business Owner'}</span>
          </div>

          <span className="vendor-active-pill">
            <i />
            Active
          </span>
        </div>

        <div className="vendor-detail-grid">
          <div>
            <small>Business name</small>
            <strong>{vendor.businessName || '—'}</strong>
          </div>

          <div>
            <small>Owner name</small>
            <strong>{vendor.ownerName || '—'}</strong>
          </div>

          <div>
            <small>Login identifier</small>
            <strong>
              {vendor.loginIdentifier || vendor.login_identifier || '—'}
            </strong>
          </div>

          <div>
            <small>Account access</small>
            <strong>Vendor Partner</strong>
          </div>
        </div>

        <div className="vendor-security-box">
          <div className="vendor-security-icon">
            <Icon path={ICONS.lock} />
          </div>

          <div>
            <strong>Account security</strong>
            <p>
              Keep your password private. Solarium Energy will never ask
              you to share your password.
            </p>
          </div>
        </div>
      </section>
    );
  }

  function renderWorkspace() {
    const [profileResult, leadsResult, payoutsResult] = portalData.data;

    const vendor =
      profileResult.vendor ||
      portalData.account ||
      {};

    const leads = leadsResult.leads || [];
    const payouts = payoutsResult.payouts || [];
    // The leads array is capped at one page (25) — pagination.total is the vendor's true
    // customer/referral count across every page, which is what the "Total referrals" stat
    // and the Referrals tab badge should show, not just how many happen to be on page 1.
    const totalLeads = leadsResult.pagination?.total ?? leads.length;

    return (
      <div className="vendor-app">
        <header className="vendor-header">
          <div className="vendor-header-inner">
            <div className="vendor-brand">
              <span className="vendor-brand-main">solarium</span>
              <span className="vendor-brand-accent">energy</span>
            </div>

            <div className="vendor-header-right">
              <div className="vendor-header-business">
                <span className="vendor-header-avatar">
                  {getInitials(vendor.businessName)}
                </span>

                <div>
                  <strong>{vendor.businessName || 'Vendor'}</strong>
                  <small>Vendor Partner</small>
                </div>
              </div>

              <button
                type="button"
                className="vendor-logout-button"
                onClick={signOutCurrent}
                disabled={loading}
                aria-label="Sign out"
              >
                <Icon path={ICONS.logout} />
                <span>Sign out</span>
              </button>
            </div>
          </div>
        </header>

        <main className="vendor-main">
          {renderPasswordSetup(vendor)}

          <nav className="vendor-tabs" aria-label="Vendor navigation">
            <button
              type="button"
              className={activeSection === 'overview' ? 'active' : ''}
              onClick={() => setActiveSection('overview')}
            >
              <Icon path={ICONS.chart} />
              Overview
            </button>

            <button
              type="button"
              className={activeSection === 'referrals' ? 'active' : ''}
              onClick={() => setActiveSection('referrals')}
            >
              <Icon path={ICONS.users} />
              Referrals
              {totalLeads > 0 && (
                <span className="vendor-tab-count">{totalLeads}</span>
              )}
            </button>

            <button
              type="button"
              className={activeSection === 'payouts' ? 'active' : ''}
              onClick={() => setActiveSection('payouts')}
            >
              <Icon path={ICONS.wallet} />
              Payouts
            </button>

            <button
              type="button"
              className={activeSection === 'account' ? 'active' : ''}
              onClick={() => setActiveSection('account')}
            >
              <Icon path={ICONS.person} />
              Account
            </button>
          </nav>

          {activeSection === 'overview' &&
            renderOverview(vendor, leads, payouts, totalLeads)}

          {activeSection === 'referrals' &&
            renderReferrals(leads)}

          {activeSection === 'payouts' &&
            renderPayouts(payouts)}

          {activeSection === 'account' &&
            renderAccount(vendor)}

          {message && (
            <div className="vendor-success-message" role="status">
              <Icon path={ICONS.check} />
              {message}
            </div>
          )}
        </main>

        <footer className="vendor-footer">
          <div>
            <span className="vendor-brand-main">solarium</span>
            <span className="vendor-brand-accent">energy</span>
          </div>

          <span>
            Partner portal · India's Leading Solar Solutions Provider
          </span>

          <span>
            © {new Date().getFullYear()} Solarium Energy
          </span>
        </footer>
      </div>
    );
  }

  if (!portalData) {
    return renderLogin();
  }

  return renderWorkspace();
}

export default VendorPage;