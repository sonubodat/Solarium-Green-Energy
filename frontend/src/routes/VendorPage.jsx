import { useEffect, useRef, useState } from 'react';
import { apiRequest, downloadFile } from '../api/client';
import { SkeletonBlock } from '../components/Skeleton';
import SessionExpiryGuard from '../components/SessionExpiryGuard';
import LanguageSwitcher from '../components/LanguageSwitcher';
import { mailtoHref, shareBody, smsHref, whatsappHref } from '../lib/qr-link';
import { translateStatus } from '../lib/vendor-i18n';
import { useVendorLanguage } from '../lib/use-vendor-language';
import { Link } from 'react-router-dom';
import './VendorPage.css';

// The password prompt (Solar Mitra still on the phone-number password) closes by itself after this many
// seconds, the same as choosing "Keep phone number". It shows the countdown; nothing is locked meanwhile.
const PASSWORD_PROMPT_SECONDS = 60;

const ICONS = {
  home: 'M3 11.5 12 4l9 7.5M5 10v10h5v-6h4v6h5V10',
  external: 'M14 4h6v6M20 4l-9 9M10 6H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4',
  qr: 'M4 4h6v6H4V4Zm10 0h6v6h-6V4ZM4 14h6v6H4v-6Zm10 1h2v2h-2v-2Zm3-1h3v3h-3v-3Zm-3 4h2v2h-2v-2Z',
  share: 'M8.6 13.5l6.8 4M15.4 6.5l-6.8 4M18 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM6 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm12 7a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
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
  const { language, setLanguage, t } = useVendorLanguage();
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
  const [showQrModal, setShowQrModal] = useState(false);
  // Direct share options (WhatsApp, SMS, email, copy) for browsers without a system share sheet.
  const [showShareOptions, setShowShareOptions] = useState(false);
  const [promptSeconds, setPromptSeconds] = useState(PASSWORD_PROMPT_SECONDS);
  // Phones show the password notice collapsed; this opens its form. Larger screens always show the form.
  const [passwordFormOpen, setPasswordFormOpen] = useState(false);
  // Result of the last "Share link" / QR download / "Try again" action, shown next to the QR card.
  const [linkNotice, setLinkNotice] = useState('');

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
    const profile = await apiRequest('/vendor/profile', { forceRefresh: true });

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
      setLinkNotice('');
    } catch (error) {
      setMessage(error.message || t('login.failed'));
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
      // Nothing from one Solar Mitra's QR card may carry over to the next person who signs in.
      setShowQrModal(false);
      setShowShareOptions(false);
      setLinkNotice('');
      setPasswordBannerDismissed(false);
      setPasswordFormOpen(false);
      setPromptSeconds(PASSWORD_PROMPT_SECONDS);
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
      setMessage(t('pw.changed'));
    } catch (error) {
      setMessage(error.message || t('pw.failed'));
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
      setBankMessage(t('set.saved'));
    } catch (error) {
      setBankMessage(error.message || t('set.saveFailed'));
    } finally {
      setLoading(false);
    }
  }

  async function uploadBankDocument(type, event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > 200 * 1024) {
      setBankMessage(t('set.tooBig'));
      return;
    }
    if (!['application/pdf', 'image/jpeg', 'image/png'].includes(file.type)) {
      setBankMessage(t('set.badType'));
      return;
    }
    const body = new FormData();
    body.append('file', file);
    setLoading(true);
    setBankMessage('');
    try {
      await apiRequest(`/vendor/bank-details/${type}`, { method: 'POST', body });
      setBankMessage(t('set.uploaded', { doc: t(type === 'passbook' ? 'set.passbook' : 'set.cheque') }));
      const bank = await apiRequest('/vendor/bank-details', { forceRefresh: true });
      setPortalData((current) => {
        const data = [...current.data];
        data[3] = bank;
        return { ...current, data };
      });
    } catch (error) {
      setBankMessage(error.message || t('set.uploadFailed'));
    } finally {
      setLoading(false);
    }
  }

  function renderLogin() {
    return (
      <div className="vendor-auth-page" lang={language}>
        <div className="vendor-auth-brand">
          <img className="vendor-logo" src="/Sol_logo.jpg" alt="Solarium" />
          <LanguageSwitcher language={language} onChange={setLanguage} label={t('lang.label')} />
        </div>

        <div className="vendor-auth-layout">
          <section className="vendor-auth-intro">
            <span className="vendor-eyebrow">{t('login.eyebrow')}</span>

            <h1>
              {t('login.headTop')}
              <br />
              <span>{t('login.headAccent')}</span>
            </h1>

            <p>{t('login.intro')}</p>

            <div className="vendor-auth-points">
              <div>
                <span className="vendor-point-icon">
                  <Icon path={ICONS.users} />
                </span>
                <div>
                  <strong>{t('login.point1')}</strong>
                  <small>{t('login.point1Body')}</small>
                </div>
              </div>

              <div>
                <span className="vendor-point-icon">
                  <Icon path={ICONS.wallet} />
                </span>
                <div>
                  <strong>{t('login.point2')}</strong>
                  <small>{t('login.point2Body')}</small>
                </div>
              </div>

              <div>
                <span className="vendor-point-icon">
                  <Icon path={ICONS.headset} />
                </span>
                <div>
                  <strong>{t('login.point3')}</strong>
                  <small>{t('login.point3Body')}</small>
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
                <h2>{t('login.title')}</h2>
                <p>{t('login.subtitle')}</p>
              </div>
            </div>

            <form onSubmit={signIn} className="vendor-form">
              <label>
                {t('login.id')}
                <div className="vendor-input-wrap">
                  <Icon path={ICONS.person} />
                  <input
                    required
                    autoComplete="username"
                    placeholder={t('login.idPlaceholder')}
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
                {t('login.password')}
                <div className="vendor-input-wrap">
                  <Icon path={ICONS.lock} />
                  <input
                    required
                    type="password"
                    autoComplete="current-password"
                    placeholder={t('login.passwordPlaceholder')}
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
                {loading ? t('login.submitting') : t('login.submit')}
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
              <span>{t('login.secure')}</span>
            </div>

            <p className="vendor-apply-prompt">
              <Link to="/apply">{t('apply.loginLink')}</Link>
            </p>
          </section>
        </div>
      </div>
    );
  }

  function renderPasswordSetup(vendor) {
    if (!vendor?.mustChangePassword || passwordBannerDismissed) return null;

    return (
      <div className={`vendor-password-banner${passwordFormOpen ? ' is-open' : ''}`}>
        <div className="vendor-password-banner-icon">
          <Icon path={ICONS.lock} />
        </div>

        <div className="vendor-password-banner-copy">
          <strong>{t('pw.title')}</strong>
          <span>{t('pw.body')}</span>
          {promptSeconds > 0 && <small className="vendor-password-timer">{t('pw.closesIn', { seconds: promptSeconds })}</small>}
        </div>

        {/* Phones only: the form below stays collapsed until this is tapped. */}
        <button
          type="button"
          className="vendor-password-toggle"
          aria-expanded={passwordFormOpen}
          onClick={() => setPasswordFormOpen(true)}
        >
          {t('pw.set')}
        </button>

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
              placeholder={t('pw.current')}
              value={currentPasswordInput}
              onChange={(event) => setCurrentPasswordInput(event.target.value)}
            />
          )}
          <input
            required
            minLength={8}
            type="password"
            placeholder={t('pw.new')}
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
          />

          <button
            type="submit"
            className="vendor-primary-button vendor-small-button"
            disabled={loading}
          >
            {loading ? t('pw.updating') : t('pw.set')}
          </button>

          <button
            type="button"
            className="vendor-text-button vendor-keep-button"
            onClick={() => setPasswordBannerDismissed(true)}
          >
            {t('pw.keep')}
          </button>
        </form>
      </div>
    );
  }

  // Phones with a system share sheet get it (it lists WhatsApp, Messages, Telegram and whatever else is
  // installed). Only the URL is handed over: with a title or text as well, some apps glue that text onto
  // the link and the recipient gets an address like /v/V-1148%20Interested%20in%20solar. Anywhere else
  // (a desktop, or a page without https) the direct options open under the buttons. Closing the share
  // sheet is not an error.
  async function shareReferralLink(vendor) {
    setLinkNotice('');
    if (navigator.share) {
      try {
        await navigator.share({ url: vendor.referralUrl });
        setShowShareOptions(false);
        return;
      } catch (error) {
        if (error?.name === 'AbortError') return;
      }
    }
    setShowShareOptions((open) => !open);
  }

  async function copyReferralLink(url) {
    try {
      await navigator.clipboard.writeText(url);
      setLinkNotice(t('qr.copied'));
    } catch (error) {
      setLinkNotice(t('qr.copyFailed'));
    }
  }

  // The vendor's QR on the poster template Admin published (PDF). The plain QR image is not offered for download.
  async function downloadPoster(code) {
    setLinkNotice('');
    try {
      await downloadFile('/vendor/qr/poster', `Solarium-Poster-${code}.pdf`, t('qr.preparingPoster'));
    } catch (error) {
      setLinkNotice(error.message);
    }
  }

  // Reloads the profile, which is what asks the server to create the QR again after a failure.
  async function retryQrSetup() {
    setLoading(true);
    setLinkNotice('');
    try {
      const data = await loadVendorData(portalData.account);
      if (mountedRef.current) setPortalData(data);
    } catch (error) {
      if (mountedRef.current) setLinkNotice(error.message || t('qr.reloadFailed'));
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }

  // The password prompt is showing while the account still uses its phone number as password.
  const passwordPromptShown = Boolean(portalData?.data?.[0]?.vendor?.mustChangePassword ?? portalData?.account?.mustChangePassword) && !passwordBannerDismissed;
  useEffect(() => {
    if (!passwordPromptShown) return undefined;
    setPromptSeconds(PASSWORD_PROMPT_SECONDS);
    const timer = setInterval(() => setPromptSeconds((seconds) => Math.max(0, seconds - 1)), 1000);
    return () => clearInterval(timer);
  }, [passwordPromptShown]);

  // Time is up: close the prompt, unless a password is half typed (then it stays until sent or dismissed).
  useEffect(() => {
    if (passwordPromptShown && promptSeconds === 0 && !newPassword && !currentPasswordInput) {
      setPasswordBannerDismissed(true);
    }
  }, [passwordPromptShown, promptSeconds, newPassword, currentPasswordInput]);

  useEffect(() => {
    if (!showQrModal) return undefined;
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setShowQrModal(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [showQrModal]);

  function renderQrCard(vendor) {
    if (vendor.qrProvisioning === 'failed' && !vendor.currentQr) {
      return (
        <section className="vendor-qr-card">
          <div className="vendor-qr-info">
            <span className="vendor-section-kicker">{t('qr.kicker')}</span>
            <h2>{t('qr.settingUp')}</h2>
            <p>{t('qr.setupFailed')}</p>
            {linkNotice && <small role="status" className="vendor-qr-notice">{linkNotice}</small>}
          </div>
          <div className="vendor-qr-actions">
            <button type="button" className="vendor-qr-button primary" onClick={retryQrSetup} disabled={loading}>
              {t('qr.tryAgain')}
            </button>
          </div>
        </section>
      );
    }
    if (!vendor.currentQr || !vendor.referralUrl) return null;
    return (
      <section className="vendor-qr-card">
        <div className="vendor-qr-info">
          <span className="vendor-section-kicker">{t('qr.kicker')}</span>
          <h2>{vendor.currentQr}</h2>
          <p>{t('qr.counted')}</p>
          <div className="vendor-qr-linkrow">
            <a
              className="vendor-qr-open"
              href={vendor.referralUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={t('qr.openAria')}
            >
              <Icon path={ICONS.external} />
              {t('qr.open')}
            </a>
          </div>
          {linkNotice && !showQrModal && <small role="status" className="vendor-qr-notice">{linkNotice}</small>}
        </div>
        <div className="vendor-qr-actions">
          <button
            type="button"
            className="vendor-qr-button primary"
            onClick={() => { setLinkNotice(''); setShowQrModal(true); }}
          >
            <Icon path={ICONS.qr} />
            {t('qr.show')}
          </button>
          <button type="button" className="vendor-qr-button" onClick={() => shareReferralLink(vendor)} aria-expanded={showShareOptions}>
            <Icon path={ICONS.share} />
            {t('qr.share')}
          </button>
        </div>
        {showShareOptions && (
          <div className="vendor-share-options" role="group" aria-label={t('qr.shareAria')}>
            <a
              href={whatsappHref(shareBody(vendor.businessName, vendor.referralUrl))}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setShowShareOptions(false)}
            >
              WhatsApp
            </a>
            <a href={smsHref(shareBody(vendor.businessName, vendor.referralUrl))} onClick={() => setShowShareOptions(false)}>
              SMS
            </a>
            <a
              href={mailtoHref(shareBody(vendor.businessName, vendor.referralUrl))}
              onClick={() => setShowShareOptions(false)}
            >
              {t('qr.email')}
            </a>
            <button type="button" onClick={() => copyReferralLink(vendor.referralUrl)}>{t('qr.copyLink')}</button>
          </div>
        )}
      </section>
    );
  }

  function renderQrModal(vendor) {
    // Shown as an <img> data URL, never injected as HTML.
    const source = `data:image/svg+xml;utf8,${encodeURIComponent(vendor.qrSvg)}`;
    return (
      <div className="vendor-qr-overlay" onClick={() => setShowQrModal(false)}>
        <div
          className="vendor-qr-modal"
          role="dialog"
          aria-modal="true"
          aria-label={t('qr.modalAria')}
          onClick={(event) => event.stopPropagation()}
        >
          <button type="button" className="vendor-qr-close" aria-label={t('qr.close')} onClick={() => setShowQrModal(false)}>
            ×
          </button>
          <img className="vendor-qr-image" src={source} alt={t('qr.alt', { code: vendor.currentQr })} />
          <strong>{vendor.currentQr}</strong>
          <p>{t('qr.modalBody')}</p>
          <div className="vendor-qr-actions">
            <button type="button" className="vendor-qr-button primary" onClick={() => downloadPoster(vendor.currentQr)}>
              {t('qr.downloadPoster')}
            </button>
          </div>
          {linkNotice && <small role="status" className="vendor-qr-notice">{linkNotice}</small>}
        </div>
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
            <span className="vendor-section-kicker">{t('welcome.kicker')}</span>

            <h1>
              <span className="vendor-welcome-label vendor-desktop-only">{t('welcome.back')}</span>
              <span className="vendor-welcome-label vendor-mobile-only">{t('welcome.short')}</span>{' '}
              <span className="vendor-welcome-name">{vendor.ownerName || vendor.businessName || t('welcome.partner')}</span>
            </h1>

            <p className="vendor-welcome-sub">{t('welcome.sub')}</p>

            {/* Phones: one line of status in place of the business card on the right. */}
            <div className="vendor-welcome-status">
              <Icon path={ICONS.check} />
              {t('welcome.active')}
            </div>
          </div>

          <div className="vendor-business-badge">
            <span className="vendor-avatar">
              {getInitials(vendor.businessName)}
            </span>

            <div>
              <strong>{vendor.businessName || t('role')}</strong>
              <small>{t('welcome.active')}</small>
            </div>
          </div>
        </div>

        {renderQrCard(vendor)}

        <h2 className="vendor-stats-title">{t('stats.title')}</h2>
        <div className="vendor-stat-grid">
          <div className="vendor-stat-card">
            <span className="vendor-stat-icon">
              <Icon path={ICONS.users} />
            </span>

            <div>
              <small>{t('stats.total')}</small>
              <strong>{totalLeads}</strong>
              <span>{t('stats.totalSub')}</span>
            </div>
          </div>

          <div className="vendor-stat-card">
            <span className="vendor-stat-icon">
              <Icon path={ICONS.clock} />
            </span>

            <div>
              <small>{t('stats.progress')}</small>
              <strong>{pendingLeads}</strong>
              <span>{t('stats.progressSub')}</span>
            </div>
          </div>

          <div className="vendor-stat-card">
            <span className="vendor-stat-icon">
              <Icon path={ICONS.wallet} />
            </span>

            <div>
              <small>{t('stats.paid')}</small>
              <strong>{paidPayouts}</strong>
              <span>{t('stats.paidSub')}</span>
            </div>
          </div>
        </div>

        <div className="vendor-content-grid">
          <section className="vendor-panel">
            <div className="vendor-panel-heading">
              <div>
                <span className="vendor-panel-kicker">{t('ref.kicker')}</span>
                <h2>{t('ref.title')}</h2>
              </div>

              {leads.length > 0 && (
                <button
                  type="button"
                  className="vendor-text-button"
                  onClick={() => setActiveSection('referrals')}
                >
                  {t('ref.viewAll')}
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
                      <strong>{item.customerName || t('common.customer')}</strong>

                      <small>
                        {item.phone || item.email || t('ref.contact')}
                      </small>
                    </div>

                    <span className={statusClass(item.status)}>
                      {translateStatus(language, item.status || 'New')}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="vendor-empty">
                <span className="vendor-empty-icon">
                  <Icon path={ICONS.users} />
                </span>

                <strong>{t('ref.emptyTitle')}</strong>
                <p>{t('ref.emptyBody')}</p>
              </div>
            )}
          </section>

          <section className="vendor-panel vendor-quick-panel">
            <div className="vendor-panel-heading">
              <div>
                <span className="vendor-panel-kicker">{t('acct.kicker')}</span>
                <h2>{t('acct.title')}</h2>
              </div>
            </div>

            <div className="vendor-account-status">
              <span className="vendor-account-check">
                <Icon path={ICONS.check} />
              </span>

              <div>
                <strong>{t('acct.active')}</strong>
                <p>{t('acct.activeBody')}</p>
              </div>
            </div>

            <div className="vendor-account-details">
              <div>
                <small>{t('acct.business')}</small>
                <strong>{vendor.businessName || '—'}</strong>
              </div>

              <div>
                <small>{t('acct.owner')}</small>
                <strong>{vendor.ownerName || '—'}</strong>
              </div>

              <div>
                <small>{t('acct.access')}</small>
                <strong>{t('role')}</strong>
              </div>

              <div>
                <small>{t('acct.qr')}</small>
                <strong>
                  {vendor.qrAssigned
                    ? t('acct.assigned', { code: vendor.currentQr })
                    : t('acct.unassigned')}
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
        <span>{t('common.showing', { start, end, total })}</span>
        <div>
          <button
            type="button"
            className="vendor-pagination-button"
            disabled={loading || page <= 1}
            onClick={() => onPageChange(page - 1)}
          >
            {t('common.previous')}
          </button>
          <button
            type="button"
            className="vendor-pagination-button"
            disabled={loading || end >= total}
            onClick={() => onPageChange(page + 1)}
          >
            {t('common.next')}
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
            <span className="vendor-panel-kicker">{t('refs.kicker')}</span>
            <h2>{t('refs.title')}</h2>
            <p>{t('refs.sub')}</p>
          </div>
        </div>

        {leads.length ? (
          <div className="vendor-table-wrap">
            <table className="vendor-table">
              <thead>
                <tr>
                  <th>{t('refs.customer')}</th>
                  <th>{t('refs.contact')}</th>
                  <th>{t('refs.status')}</th>
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

                        <strong>{item.customerName || t('common.customer')}</strong>
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
                        {translateStatus(language, item.status || 'New')}
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

            <strong>{t('refs.emptyTitle')}</strong>
            <p>{t('refs.emptyBody')}</p>
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
            <span className="vendor-panel-kicker">{t('pay.kicker')}</span>
            <h2>{t('pay.title')}</h2>
            <p>{t('pay.sub')}</p>
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
                    {t('pay.referral', { id: item.leadId || item.id })}
                  </strong>

                  <small>{t('pay.commission')}</small>
                </div>

                <span className={statusClass(item.status)}>
                  {translateStatus(language, item.status || 'Pending')}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="vendor-empty vendor-empty-large">
            <span className="vendor-empty-icon">
              <Icon path={ICONS.wallet} />
            </span>

            <strong>{t('pay.emptyTitle')}</strong>
            <p>{t('pay.emptyBody')}</p>
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
            <span className="vendor-panel-kicker">{t('account.kicker')}</span>
            <h2>{t('account.title')}</h2>
            <p>{t('account.sub')}</p>
          </div>
        </div>

        <div className="vendor-profile-card">
          <div className="vendor-profile-avatar">
            {getInitials(vendor.businessName)}
          </div>

          <div>
            <strong>{vendor.businessName || t('role')}</strong>
            <span>{vendor.ownerName || t('account.ownerFallback')}</span>
          </div>

          <span className="vendor-active-pill">
            <i />
            {t('account.active')}
          </span>
        </div>

        <div className="vendor-detail-grid">
          <div>
            <small>{t('account.businessName')}</small>
            <strong>{vendor.businessName || '—'}</strong>
          </div>

          <div>
            <small>{t('account.ownerName')}</small>
            <strong>{vendor.ownerName || '—'}</strong>
          </div>

          <div>
            <small>{t('account.loginId')}</small>
            <strong>
              {vendor.loginIdentifier || vendor.login_identifier || '—'}
            </strong>
          </div>

          <div>
            <small>{t('account.access')}</small>
            <strong>{t('role')}</strong>
          </div>

          <div>
            <small>{t('acct.qr')}</small>
            <strong>
              {vendor.qrAssigned
                ? t('acct.assigned', { code: vendor.currentQr })
                : t('acct.unassigned')}
            </strong>
          </div>
        </div>

        <div className="vendor-security-box">
          <div className="vendor-security-icon">
            <Icon path={ICONS.lock} />
          </div>

          <div>
            <strong>{t('account.securityTitle')}</strong>
            <p>{t('account.securityBody')}</p>
          </div>
        </div>

        {/* Phones: Settings is not in the bottom bar, and the header has no Sign out. */}
        <div className="vendor-account-actions">
          <button type="button" onClick={() => setActiveSection('settings')}>
            <Icon path={ICONS.wallet} />
            <span>{t('account.bankLink')}</span>
            <Icon path={ICONS.arrow} />
          </button>
          <button type="button" className="danger" onClick={signOutCurrent} disabled={loading}>
            <Icon path={ICONS.logout} />
            <span>{t('header.signOut')}</span>
          </button>
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
            {/* Phones: Settings sits under Account, so give the way back. */}
            <button type="button" className="vendor-back-button" onClick={() => setActiveSection('account')}>
              <Icon path={ICONS.arrow} />
              {t('nav.account')}
            </button>
            <span className="vendor-panel-kicker">{t('set.kicker')}</span>
            <h2>{t('set.title')}</h2>
            <p>{t('set.sub')}</p>
          </div>
        </div>
        <form className="vendor-bank-form" onSubmit={saveBankDetails}>
          <label><span>{t('set.upiNumber')}</span><input value={bankDetails.upi_number} onChange={(event) => setBankDetails({ ...bankDetails, upi_number: event.target.value })} /></label>
          <label><span>{t('set.upiId')}</span><input value={bankDetails.upi_id} onChange={(event) => setBankDetails({ ...bankDetails, upi_id: event.target.value })} placeholder="name@bank" /></label>
          <label><span>{t('set.holder')}</span><input value={bankDetails.account_holder_name} onChange={(event) => setBankDetails({ ...bankDetails, account_holder_name: event.target.value })} /></label>
          <label><span>{t('set.accountNumber')}</span><input value={bankDetails.account_number} onChange={(event) => setBankDetails({ ...bankDetails, account_number: event.target.value })} /></label>
          <label><span>{t('set.ifsc')}</span><input value={bankDetails.ifsc_code} onChange={(event) => setBankDetails({ ...bankDetails, ifsc_code: event.target.value.toUpperCase() })} /></label>
          <button type="submit" className="vendor-primary-button" disabled={loading}>{t('set.save')}</button>
        </form>
        <div className="vendor-document-grid">
          {['passbook', 'cheque'].map((type) => {
            const uploaded = type === 'passbook' ? details?.passbookFileName : details?.chequeFileName;
            return (
              <label className="vendor-document-upload" key={type}>
                <strong>{t(type === 'passbook' ? 'set.passbook' : 'set.cheque')}</strong>
                <span>{uploaded || t('set.fileHint')}</span>
                <input type="file" accept="application/pdf,image/jpeg,image/png" onChange={(event) => uploadBankDocument(type, event)} disabled={loading} />
                <em>{uploaded ? t('set.replace') : t('set.choose')}</em>
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
      // 'failed' only when the server tried to create this Solar Mitra's QR and could not.
      qrProvisioning: profileResult.qrProvisioning || 'ok',
      referralUrl: profileResult.referralUrl || '',
      qrSvg: profileResult.qrSvg || '',
    };

    const leads = leadsResult.leads || [];
    const payouts = payoutsResult.payouts || [];
    // The leads array is capped at one page (25) — pagination.total is the vendor's true
    // customer/referral count across every page, which is what the "Total referrals" stat
    // and the Referrals tab badge should show, not just how many happen to be on page 1.
    const totalLeads = leadsResult.pagination?.total ?? leads.length;

    return (
      <div className="vendor-app" lang={language}>
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
                  <small>{t('role')}</small>
                </div>
              </div>

              <LanguageSwitcher language={language} onChange={setLanguage} label={t('lang.label')} />

              <button
                type="button"
                className="vendor-logout-button"
                onClick={signOutCurrent}
                disabled={loading}
                aria-label={t('header.signOut')}
              >
                <Icon path={ICONS.logout} />
                <span>{t('header.signOut')}</span>
              </button>
            </div>
          </div>
        </header>

        <main className="vendor-main">
          {renderPasswordSetup(vendor)}

          {(
            <>
          <nav className="vendor-tabs" aria-label={t('nav.aria')}>
            <button
              type="button"
              className={activeSection === 'overview' ? 'active' : ''}
              onClick={() => setActiveSection('overview')}
            >
              <Icon path={ICONS.chart} />
              {t('nav.overview')}
            </button>

            <button
              type="button"
              className={activeSection === 'settings' ? 'active' : ''}
              onClick={() => setActiveSection('settings')}
            >
              <Icon path={ICONS.lock} />
              {t('nav.settings')}
            </button>

            <button
              type="button"
              className={activeSection === 'referrals' ? 'active' : ''}
              onClick={() => setActiveSection('referrals')}
            >
              <Icon path={ICONS.users} />
              {t('nav.referrals')}
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
              {t('nav.payouts')}
            </button>

            <button
              type="button"
              className={activeSection === 'account' ? 'active' : ''}
              onClick={() => setActiveSection('account')}
            >
              <Icon path={ICONS.person} />
              {t('nav.account')}
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

        {showQrModal && vendor.qrSvg && renderQrModal(vendor)}

        <footer className="vendor-footer">
          <div>
            <img className="vendor-logo" src="/Sol_logo.jpg" alt="Solarium" />
          </div>

          <span>{t('footer.tagline')}</span>

          <span>
            © {new Date().getFullYear()} Solarium Energy
          </span>
        </footer>

        {/* Phones only (hidden by CSS on larger screens). Settings is reached from Account. */}
        <nav className="vendor-bottom-nav" aria-label={t('nav.bottomAria')}>
          {[
            { section: 'overview', icon: ICONS.home, label: t('nav.home') },
            { section: 'referrals', icon: ICONS.users, label: t('nav.referrals'), count: totalLeads },
            { section: 'payouts', icon: ICONS.wallet, label: t('nav.payouts') },
            { section: 'account', icon: ICONS.person, label: t('nav.account') },
          ].map((item) => {
            const active = item.section === activeSection || (item.section === 'account' && activeSection === 'settings');
            return (
              <button
                key={item.section}
                type="button"
                className={active ? 'active' : ''}
                aria-current={active ? 'page' : undefined}
                onClick={() => setActiveSection(item.section)}
              >
                <span className="vendor-bottom-nav-icon">
                  <Icon path={item.icon} />
                  {item.count > 0 && <span className="vendor-tab-count">{item.count}</span>}
                </span>
                <span className="vendor-bottom-nav-label">{item.label}</span>
              </button>
            );
          })}
        </nav>
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