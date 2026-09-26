import { useEffect, useRef, useState } from 'react';
import { apiRequest } from '../api/client';
import { SkeletonBlock } from '../components/Skeleton';
import SessionExpiryGuard from '../components/SessionExpiryGuard';
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
  // Was missing entirely — the "Dedicated support" bullet on the login page referenced
  // ICONS.headset with a `|| ICONS.person` fallback, so it silently rendered the wrong icon.
  headset: 'M4 18v-6a8 8 0 0 1 16 0v6M4 18a2 2 0 0 0 2 2h1v-6H5a1 1 0 0 0-1 1v3Zm16 0a2 2 0 0 1-2 2h-1v-6h2a1 1 0 0 1 1 1v3Z',
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
  const [passwordBannerDismissed, setPasswordBannerDismissed] = useState(false);
  // Distinguishes "still checking whether a session cookie is valid" from "confirmed logged
  // out" — without this, the login form flashes on every page load/reload for an already
  // signed-in Vendor while restoreSession()'s request is in flight (worse the slower the
  // backend is, e.g. a cold Render instance waking up), before silently swapping to the
  // dashboard. Shows a skeleton instead of that flash.
  const [sessionChecked, setSessionChecked] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [currentPasswordInput, setCurrentPasswordInput] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [activeSection, setActiveSection] = useState('overview');
  const [bankDetails, setBankDetails] = useState({
    upi_number: '', upi_id: '', account_holder_name: '', account_number: '', ifsc_code: '',
  });
  const [bankMessage, setBankMessage] = useState('');

  const mountedRef = useRef(true);
  const hasScrolledToDashboardRef = useRef(false);

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
    // The login form and the dashboard are the same route/scroll container (no full page
    // navigation between them) — if the customer scrolled while filling the login form
    // (very plausible on mobile with the on-screen keyboard open), that scroll position
    // otherwise carries straight into the dashboard, landing them mid-page with the sticky
    // header overlapping the tab navigation. Only fires once, on the login->dashboard
    // transition itself, not on every later data refresh.
    if (portalData && !hasScrolledToDashboardRef.current) {
      window.scrollTo(0, 0);
      hasScrolledToDashboardRef.current = true;
    }
  }, [portalData]);

  useEffect(() => {
    restoreSession();

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadVendorData(account = null) {
    // Parallelized (below) — these are independent GET requests, not steps of one transaction,
    // so there is no held connection for them to contend over. (This used to be sequential
    // specifically to avoid grabbing 3 pooled connections at once under the old transaction-mode
    // pooler; that root cause was fixed separately — see prisma.js/env.js — and this codebase's
    // Admin dashboard was parallelized the same way once that fix landed.)
    const profile = await apiRequest('/vendor/profile');

    const [leads, payouts, bank] = await Promise.all([
      apiRequest('/vendor/leads'),
      apiRequest('/vendor/payouts'),
      apiRequest('/vendor/bank-details'),
    ]);

    if (bank.bank_details) {
      setBankDetails({
        upi_number: bank.bank_details.upiNumber || '',
        upi_id: bank.bank_details.upiId || '',
        account_holder_name: bank.bank_details.accountHolderName || '',
        account_number: bank.bank_details.accountNumber || '',
        ifsc_code: bank.bank_details.ifscCode || '',
      });
    }

    return {
      account,
      data: [profile, leads, payouts, bank],
    };
  }

  async function loadLeadsPage(page) {
    const leadsResult = await apiRequest(`/vendor/leads?page=${page}&limit=25`);
    setPortalData((current) => {
      const data = [...current.data];
      data[1] = leadsResult;
      return { ...current, data };
    });
  }

  async function loadPayoutsPage(page) {
    const payoutsResult = await apiRequest(`/vendor/payouts?page=${page}&limit=25`);
    setPortalData((current) => {
      const data = [...current.data];
      data[2] = payoutsResult;
      return { ...current, data };
    });
  }

  async function restoreSession() {
    try {
      const session = await apiRequest('/auth/session?portal=vendor');

      if (!mountedRef.current || session.role !== 'VENDOR') return;

      const data = await loadVendorData(session.account);

      if (!mountedRef.current) return;

      setPortalData(data);
    } catch (error) {
      // No active session.
    } finally {
      if (mountedRef.current) setSessionChecked(true);
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
      await apiRequest('/auth/logout?portal=vendor', {
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
          current_password: login.password || currentPasswordInput,
          new_password: newPassword,
        }),
      });

      // The temporary password gated the dashboard data, so load it now that the change is
      // done. loadVendorData re-fetches the profile too, which carries mustChangePassword: false.
      const data = await loadVendorData(result.vendor);
      if (!mountedRef.current) return;
      setPortalData(data);

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

  async function saveBankDetails(event) {
    event.preventDefault();
    setLoading(true);
    setBankMessage('');
    try {
      await apiRequest('/vendor/bank-details', { method: 'PATCH', body: JSON.stringify(bankDetails) });
      setBankMessage('Bank details saved.');
    } catch (error) {
      setBankMessage(error.message || 'Unable to save bank details.');
    } finally {
      setLoading(false);
    }
  }

  async function uploadBankDocument(type, event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > 200 * 1024) {
      setBankMessage('Documents must be 200 KB or smaller.');
      return;
    }
    if (!['application/pdf', 'image/jpeg', 'image/png'].includes(file.type)) {
      setBankMessage('Upload a PDF, JPG, or PNG document.');
      return;
    }
    const body = new FormData();
    body.append('file', file);
    setLoading(true);
    setBankMessage('');
    try {
      await apiRequest(`/vendor/bank-details/${type}`, { method: 'POST', body });
      setBankMessage(`${type === 'passbook' ? 'Passbook' : 'Cancelled cheque'} uploaded.`);
      const bank = await apiRequest('/vendor/bank-details', { forceRefresh: true });
      setPortalData((current) => {
        const data = [...current.data];
        data[3] = bank;
        return { ...current, data };
      });
    } catch (error) {
      setBankMessage(error.message || 'Unable to upload document.');
    } finally {
      setLoading(false);
    }
  }

  function renderLogin() {
    return (
      <div className="vendor-auth-page">
        <div className="vendor-auth-brand">
          <img className="vendor-logo" src="/Sol_logo.jpg" alt="Solarium" />
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
                  <Icon path={ICONS.headset} />
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
                <h2>Solar Mitra login</h2>
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
    if (!vendor?.mustChangePassword || passwordBannerDismissed) return null;

    return (
      <div className="vendor-password-banner">
        <div className="vendor-password-banner-icon">
          <Icon path={ICONS.lock} />
        </div>

        <div className="vendor-password-banner-copy">
          <strong>Your password is your phone number</strong>
          <span>
            You can keep it or set a new one below. This is optional.
          </span>
        </div>

        <form
          onSubmit={changeVendorPassword}
          className="vendor-password-form"
        >
          {/* After a page reload the sign-in form's password is gone, so ask for it again. */}
          {!login.password && (
            <input
              required
              type="password"
              autoComplete="current-password"
              placeholder="Current password (your phone number)"
              value={currentPasswordInput}
              onChange={(event) => setCurrentPasswordInput(event.target.value)}
            />
          )}
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

          <button
            type="button"
            className="vendor-text-button"
            onClick={() => setPasswordBannerDismissed(true)}
          >
            Keep phone number
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
            <span className="vendor-section-kicker">SOLAR MITRA DASHBOARD</span>

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
              <strong>{vendor.businessName || 'Solar Mitra Partner'}</strong>
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
                <strong>Solar Mitra Partner</strong>
              </div>

              <div>
                <small>QR code</small>
                <strong>
                  {vendor.qrAssigned
                    ? `Assigned (${vendor.currentQr})`
                    : 'Unassigned'}
                </strong>
              </div>
            </div>
          </section>
        </div>
      </>
    );
  }

  function renderVendorPagination(pagination, onPageChange) {
    if (!pagination || pagination.total <= pagination.limit) return null;

    const { page, limit, total } = pagination;
    const start = total === 0 ? 0 : (page - 1) * limit + 1;
    const end = Math.min(page * limit, total);

    return (
      <div className="vendor-pagination">
        <span>{`Showing ${start}–${end} of ${total}`}</span>
        <div>
          <button
            type="button"
            className="vendor-pagination-button"
            disabled={loading || page <= 1}
            onClick={() => onPageChange(page - 1)}
          >
            Previous
          </button>
          <button
            type="button"
            className="vendor-pagination-button"
            disabled={loading || end >= total}
            onClick={() => onPageChange(page + 1)}
          >
            Next
          </button>
        </div>
      </div>
    );
  }

  function renderReferrals(leads, leadsPagination) {
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

        {renderVendorPagination(leadsPagination, loadLeadsPage)}
      </section>
    );
  }

  function renderPayouts(payouts, payoutsPagination) {
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

        {renderVendorPagination(payoutsPagination, loadPayoutsPage)}
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
            <p>Review your Solar Mitra account information.</p>
          </div>
        </div>

        <div className="vendor-profile-card">
          <div className="vendor-profile-avatar">
            {getInitials(vendor.businessName)}
          </div>

          <div>
            <strong>{vendor.businessName || 'Solar Mitra Partner'}</strong>
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
            <strong>Solar Mitra Partner</strong>
          </div>

          <div>
            <small>QR code</small>
            <strong>
              {vendor.qrAssigned
                ? `Assigned (${vendor.currentQr})`
                : 'Unassigned'}
            </strong>
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

  function renderSettings() {
    const details = portalData.data[3]?.bank_details;
    return (
      <section className="vendor-panel vendor-full-panel">
        <div className="vendor-panel-heading">
          <div>
            <span className="vendor-panel-kicker">PAYOUT SETTINGS</span>
            <h2>Bank details</h2>
            <p>Add the account information used for commission payouts.</p>
          </div>
        </div>
        <form className="vendor-bank-form" onSubmit={saveBankDetails}>
          <label><span>UPI number</span><input value={bankDetails.upi_number} onChange={(event) => setBankDetails({ ...bankDetails, upi_number: event.target.value })} /></label>
          <label><span>UPI ID</span><input value={bankDetails.upi_id} onChange={(event) => setBankDetails({ ...bankDetails, upi_id: event.target.value })} placeholder="name@bank" /></label>
          <label><span>Account holder name</span><input value={bankDetails.account_holder_name} onChange={(event) => setBankDetails({ ...bankDetails, account_holder_name: event.target.value })} /></label>
          <label><span>Account number</span><input value={bankDetails.account_number} onChange={(event) => setBankDetails({ ...bankDetails, account_number: event.target.value })} /></label>
          <label><span>IFSC code</span><input value={bankDetails.ifsc_code} onChange={(event) => setBankDetails({ ...bankDetails, ifsc_code: event.target.value.toUpperCase() })} /></label>
          <button type="submit" className="vendor-primary-button" disabled={loading}>Save bank details</button>
        </form>
        <div className="vendor-document-grid">
          {['passbook', 'cheque'].map((type) => {
            const uploaded = type === 'passbook' ? details?.passbookFileName : details?.chequeFileName;
            return (
              <label className="vendor-document-upload" key={type}>
                <strong>{type === 'passbook' ? 'Passbook' : 'Cancelled cheque'}</strong>
                <span>{uploaded || 'PDF, JPG, or PNG up to 200 KB'}</span>
                <input type="file" accept="application/pdf,image/jpeg,image/png" onChange={(event) => uploadBankDocument(type, event)} disabled={loading} />
                <em>{uploaded ? 'Replace document' : 'Choose document'}</em>
              </label>
            );
          })}
        </div>
        {bankMessage && <p className="vendor-form-message">{bankMessage}</p>}
      </section>
    );
  }

  function renderWorkspace() {
    const [profileResult, leadsResult, payoutsResult] = portalData.data;

    const vendor = {
      ...(profileResult.vendor || portalData.account || {}),
      currentQr: profileResult.currentQr || null,
      qrAssigned: Boolean(profileResult.qrAssigned),
    };

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
              <img className="vendor-logo" src="/Sol_logo.jpg" alt="Solarium" />
            </div>

            <div className="vendor-header-right">
              <div className="vendor-header-business">
                <span className="vendor-header-avatar">
                  {getInitials(vendor.businessName)}
                </span>

                <div>
                  <strong>{vendor.businessName || 'Solar Mitra'}</strong>
                  <small>Solar Mitra Partner</small>
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

          {(
            <>
          <nav className="vendor-tabs" aria-label="Solar Mitra navigation">
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
              className={activeSection === 'settings' ? 'active' : ''}
              onClick={() => setActiveSection('settings')}
            >
              <Icon path={ICONS.lock} />
              Settings
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
            renderReferrals(leads, leadsResult.pagination)}

          {activeSection === 'payouts' &&
            renderPayouts(payouts, payoutsResult.pagination)}

          {activeSection === 'account' &&
            renderAccount(vendor)}

          {activeSection === 'settings' && renderSettings()}
            </>
          )}

          {message && (
            <div className="vendor-success-message" role="status">
              <Icon path={ICONS.check} />
              {message}
            </div>
          )}
        </main>

        <footer className="vendor-footer">
          <div>
            <img className="vendor-logo" src="/Sol_logo.jpg" alt="Solarium" />
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

  if (!sessionChecked) {
    return (
      <div className="vendor-app">
        <header className="vendor-header">
          <div className="vendor-header-inner">
            <div className="vendor-brand">
              <img className="vendor-logo" src="/Sol_logo.jpg" alt="Solarium" />
            </div>
            <SkeletonBlock width="140px" height="36px" radius="10px" />
          </div>
        </header>

        <main className="vendor-main">
          <nav className="vendor-tabs" aria-hidden="true">
            {Array.from({ length: 4 }).map((_, index) => (
              // eslint-disable-next-line react/no-array-index-key
              <SkeletonBlock key={index} width="90px" height="20px" />
            ))}
          </nav>

          <div className="vendor-welcome">
            <div style={{ display: 'grid', gap: '10px' }}>
              <SkeletonBlock width="130px" height="14px" />
              <SkeletonBlock width="260px" height="30px" />
              <SkeletonBlock width="320px" height="16px" />
            </div>
          </div>

          <div className="vendor-stat-grid">
            {Array.from({ length: 3 }).map((_, index) => (
              <div className="vendor-stat-card" key={index}>
                <SkeletonBlock width="38px" height="38px" radius="10px" />
                <div style={{ display: 'grid', gap: '8px', marginTop: '10px' }}>
                  <SkeletonBlock width="70%" height="12px" />
                  <SkeletonBlock width="45%" height="22px" />
                </div>
              </div>
            ))}
          </div>
        </main>
      </div>
    );
  }

  if (!portalData) {
    return renderLogin();
  }

  return (
    <>
      {renderWorkspace()}
      <SessionExpiryGuard portal="vendor" onSignOut={signOutCurrent} />
    </>
  );
}

export default VendorPage;