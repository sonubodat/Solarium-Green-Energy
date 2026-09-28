import { useState } from 'react';
import { Link } from 'react-router-dom';
import { apiRequest } from '../api/client';
import LanguageSwitcher from '../components/LanguageSwitcher';
import { INDIAN_STATES } from '../constants/indian-states';
import { useVendorLanguage } from '../lib/use-vendor-language';
import './VendorPage.css';

const EMPTY_FORM = { business_name: '', owner_name: '', mobile_number: '', state: '', website: '' };

const ICONS = {
  store: 'M3 9 5 4h14l2 5M4 9v10a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V9M3 9h18M8 9v3m8-3v3M9 20v-5h6v5',
  person: 'M12 12a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9Zm0 2c-4.2 0-7.5 2.1-7.5 4.7V21h15v-2.3c0-2.6-3.3-4.7-7.5-4.7Z',
  phone: 'M6.6 10.8c1.3 2.6 3.4 4.7 6 6l2-2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.5.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1C10.5 21 3 13.5 3 4c0-.6.4-1 1-1h3.8c.6 0 1 .4 1 1 0 1.2.2 2.4.6 3.5.1.4 0 .8-.3 1l-2 2Z',
  pin: 'M12 2a7 7 0 0 0-7 7c0 5.3 7 13 7 13s7-7.7 7-13a7 7 0 0 0-7-7Zm0 9.7a2.7 2.7 0 1 1 0-5.4 2.7 2.7 0 0 1 0 5.4Z',
  check: 'M20 6 9 17l-5-5',
};

function Icon({ path }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={path} />
    </svg>
  );
}

// Same 10-digit rule the server enforces (+91 / 0091 prefixes and spaces allowed).
function looksLikeIndianMobile(value) {
  let digits = String(value).replace(/\D/g, '');
  if (digits.startsWith('0091') && digits.length === 14) digits = digits.slice(4);
  else if (digits.startsWith('91') && digits.length === 12) digits = digits.slice(2);
  return /^[6-9]\d{9}$/.test(digits);
}

// Public "Apply for Solar Mitra": a new partner leaves their details, the team reviews the application
// in Admin and approves it. Nothing is created or activated from here.
function ApplyPage() {
  const { language, setLanguage, t } = useVendorLanguage();
  const [form, setForm] = useState(EMPTY_FORM);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [alreadyMitra, setAlreadyMitra] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const change = (field) => (event) => setForm((current) => ({ ...current, [field]: event.target.value }));

  async function submit(event) {
    event.preventDefault();
    setError('');
    setAlreadyMitra(false);
    if (!looksLikeIndianMobile(form.mobile_number)) {
      setError(t('apply.invalidMobile'));
      return;
    }
    setLoading(true);
    try {
      await apiRequest('/vendors/register', { method: 'POST', body: JSON.stringify(form) });
      setSubmitted(true);
    } catch (failure) {
      if (failure.code === 'ALREADY_A_SOLAR_MITRA') {
        setAlreadyMitra(true);
        setError(t('apply.alreadyMitra'));
      } else if (failure.code === 'INVALID_MOBILE_NUMBER') {
        setError(t('apply.invalidMobile'));
      } else if (failure.status === 429) {
        setError(t('apply.tooMany'));
      } else {
        setError(t('apply.failed'));
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="vendor-auth-page" lang={language}>
      <div className="vendor-auth-brand">
        <Link to="/" aria-label="Solarium">
          <img className="vendor-logo" src="/Sol_logo.jpg" alt="Solarium" />
        </Link>
        <LanguageSwitcher language={language} onChange={setLanguage} label={t('lang.label')} />
      </div>

      <div className="vendor-apply-wrap">
        <section className="vendor-login-card">
          {submitted ? (
            <div className="vendor-apply-done" role="status">
              <span className="vendor-apply-done-icon"><Icon path={ICONS.check} /></span>
              <h2>{t('apply.doneTitle')}</h2>
              <p>{t('apply.doneBody')}</p>
            </div>
          ) : (
            <>
              <div className="vendor-login-heading">
                <div className="vendor-login-icon">
                  <Icon path={ICONS.store} />
                </div>
                <div>
                  <h2>{t('apply.title')}</h2>
                  <p>{t('apply.sub')}</p>
                </div>
              </div>

              <form onSubmit={submit} className="vendor-form" noValidate>
                <label>
                  {t('apply.business')}
                  <div className="vendor-input-wrap">
                    <Icon path={ICONS.store} />
                    <input required minLength={2} maxLength={160} autoComplete="organization" value={form.business_name} onChange={change('business_name')} />
                  </div>
                </label>

                <label>
                  {t('apply.owner')}
                  <div className="vendor-input-wrap">
                    <Icon path={ICONS.person} />
                    <input required minLength={2} maxLength={120} autoComplete="name" value={form.owner_name} onChange={change('owner_name')} />
                  </div>
                </label>

                <label>
                  {t('apply.mobile')}
                  <div className="vendor-input-wrap">
                    <Icon path={ICONS.phone} />
                    <input required type="tel" inputMode="tel" autoComplete="tel" maxLength={20} value={form.mobile_number} onChange={change('mobile_number')} />
                  </div>
                </label>

                <label>
                  {t('apply.state')}
                  <div className="vendor-input-wrap">
                    <Icon path={ICONS.pin} />
                    <select required value={form.state} onChange={change('state')}>
                      <option value="">{t('apply.statePlaceholder')}</option>
                      {INDIAN_STATES.map((state) => <option key={state} value={state}>{state}</option>)}
                    </select>
                  </div>
                </label>

                {/* Hidden from people; a form-filling bot fills it and the server then stores nothing. */}
                <div className="vendor-apply-trap" aria-hidden="true">
                  <label>
                    Website
                    <input tabIndex={-1} autoComplete="off" value={form.website} onChange={change('website')} />
                  </label>
                </div>

                <button type="submit" className="vendor-primary-button" disabled={loading || !form.state}>
                  {loading ? t('apply.submitting') : t('apply.submit')}
                </button>
              </form>

              {error && (
                <p className="vendor-form-message vendor-form-message-error" role="alert">
                  {error}
                  {alreadyMitra && <> <Link to="/vendor">{t('apply.signIn')}</Link></>}
                </p>
              )}

              <p className="vendor-apply-prompt">
                {t('apply.haveAccount')} <Link to="/vendor">{t('apply.signIn')}</Link>
              </p>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

export default ApplyPage;
