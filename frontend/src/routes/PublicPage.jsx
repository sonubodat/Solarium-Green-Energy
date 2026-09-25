import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { apiRequest } from '../api/client';
import { SkeletonBlock } from '../components/Skeleton';
import './PublicPage.css';

const ICONS = {
  person: 'M12 12a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9Zm0 2c-4.2 0-7.5 2.1-7.5 4.7V21h15v-2.3c0-2.6-3.3-4.7-7.5-4.7Z',
  phone: 'M6.6 10.8c1.3 2.6 3.4 4.7 6 6l2-2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.5.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1C10.5 21 3 13.5 3 4c0-.6.4-1 1-1h3.8c.6 0 1 .4 1 1 0 1.2.2 2.4.6 3.5.1.4 0 .8-.3 1l-2 2Z',
  mail: 'M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Zm1.5 2 6.2 5 6.3-5H5.5ZM3 7.4V17a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1V7.4l-8.3 6.6a1 1 0 0 1-1.2 0L3 7.4Z',
  pin: 'M12 2a7 7 0 0 0-7 7c0 5.3 7 13 7 13s7-7.7 7-13a7 7 0 0 0-7-7Zm0 9.7a2.7 2.7 0 1 1 0-5.4 2.7 2.7 0 0 1 0 5.4Z',
  lock: 'M7 10V8a5 5 0 0 1 10 0v2h1a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1h1Zm2 0h6V8a3 3 0 0 0-6 0v2Z',
  arrow: 'M5 12h13m0 0-5-5m5 5-5 5',
  shield: 'M12 2 4 5v6c0 5 3.4 8.7 8 11 4.6-2.3 8-6 8-11V5l-8-3Z',
  headset: 'M12 3a8 8 0 0 0-8 8v5a3 3 0 0 0 3 3h1v-7H5v-1a7 7 0 0 1 14 0v1h-3v7h1a3 3 0 0 0 3-3v-5a8 8 0 0 0-8-8Z',
  bolt: 'M13 2 4 14h6l-1 8 9-12h-6l1-8Z',
  check: 'M5 13l4 4L19 7',
  warning: 'M12 9v4m0 4h.01M10.3 3.9 2.5 17a1.5 1.5 0 0 0 1.3 2.3h16.4a1.5 1.5 0 0 0 1.3-2.3L13.7 3.9a1.5 1.5 0 0 0-2.6 0Z',
  target: 'M12 2v3m0 14v3M2 12h3m14 0h3M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z',
};

function Icon({ path, className }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={path} />
    </svg>
  );
}

const WHY_ITEMS = [
  { icon: 'shield', title: 'Genuine enquiry', copy: 'We only use your details to respond to your solar enquiry.' },
  { icon: 'headset', title: 'Expert guidance', copy: 'Our team will guide you with the best solar solutions.' },
  { icon: 'bolt', title: 'Clean energy future', copy: "Together, let's build a sustainable tomorrow." },
];

const EMPTY_LEAD = { customer_name: '', phone: '', email: '', location: '', pincode: '', average_electricity_bill: '', solar_size: '' };
const BILL_BANDS = ['1-2k', '2-3k', '3-4k', '4-5k', '5-6k', '6-7k', '7-8k', '8-9k', '9-10k', '10k+'];
const SOLAR_SIZE_BANDS = ['1-2 kW', '2-3 kW', '3-4 kW', '4-5 kW', '5-6 kW', '6-7 kW', '7-8 kW', '8-9 kW', '9-10 kW', '10+ kW'];
// TODO: placeholder — replace with Solarium's real support inbox before launch.
const SUPPORT_EMAIL = 'support@solariumenergy.in';
const SLOW_REQUEST_MS = 6000;

function PublicPage() {
  const { code: pathQrCode } = useParams();
  // 'idle' = no QR in the URL (general enquiry); 'loading' | 'active' | 'inactive' | 'invalid' apply to a /v/:code visit.
  const [referralStatus, setReferralStatus] = useState(pathQrCode ? 'loading' : 'idle');
  const [referral, setReferral] = useState(null);
  const [referralMessage, setReferralMessage] = useState('');
  const [lead, setLead] = useState(EMPTY_LEAD);
  // Starts unticked: DPDP Act s.6 needs a clear affirmative action, a pre-ticked box is not consent.
  const [consent, setConsent] = useState(false);
  const noticeRef = useRef(null);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(null);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState('');
  // Raw GPS coordinates for the optional LeadLocation record (pilot scope) — separate from
  // `lead.location`, the free-text city name. Only set once real coordinates are received, not
  // just because the button was clicked; submitted alongside the lead if present.
  const [capturedCoords, setCapturedCoords] = useState(null);
  // 'idle' | 'checking' | 'available' | 'taken'. UX convenience only — the backend re-checks
  // (and the database enforces) uniqueness again on final submit regardless of this state.
  const [phoneCheck, setPhoneCheck] = useState('idle');
  const [slowRequest, setSlowRequest] = useState(false);
  const phoneCheckSeq = useRef(0);
  const slowRequestTimer = useRef(null);

  function startSlowRequestWatch() {
    setSlowRequest(false);
    clearTimeout(slowRequestTimer.current);
    slowRequestTimer.current = setTimeout(() => setSlowRequest(true), SLOW_REQUEST_MS);
  }

  function stopSlowRequestWatch() {
    clearTimeout(slowRequestTimer.current);
    setSlowRequest(false);
  }

  useEffect(() => () => clearTimeout(slowRequestTimer.current), []);

  async function checkPhoneAvailability(rawPhone) {
    if (!rawPhone.trim()) {
      setPhoneCheck('idle');
      return;
    }
    const seq = ++phoneCheckSeq.current;
    setPhoneCheck('checking');
    startSlowRequestWatch();
    try {
      await apiRequest('/public/leads/check-phone', { method: 'POST', body: JSON.stringify({ phone: rawPhone }) });
      if (seq === phoneCheckSeq.current) setPhoneCheck('available');
    } catch (error) {
      if (seq !== phoneCheckSeq.current) return;
      setPhoneCheck(error.code === 'CUSTOMER_ALREADY_EXISTS' ? 'taken' : 'idle');
    } finally {
      if (seq === phoneCheckSeq.current) stopSlowRequestWatch();
    }
  }

  useEffect(() => {
    if (!pathQrCode) return;
    let cancelled = false;
    (async () => {
      setReferralStatus('loading');
      try {
        const result = await apiRequest(`/public/qr/${encodeURIComponent(decodeURIComponent(pathQrCode))}`);
        if (cancelled) return;
        setReferral(result.referral);
        setReferralStatus('active');
      } catch (error) {
        if (cancelled) return;
        // Trust the backend's status, not the browser's guess — an unassigned/inactive/retired QR
        // must not silently fall back to a normal standalone enquiry (that would blur attribution).
        setReferralMessage(error.message);
        setReferralStatus(error.code === 'QR_NOT_FOUND' ? 'invalid' : 'inactive');
      }
    })();
    return () => { cancelled = true; };
  }, [pathQrCode]);

  async function submitLead(event) {
    event.preventDefault();
    // Frontend check is UX only — repeat it here rather than trusting the earlier blur check,
    // since the customer could still submit before that check resolves. The backend/database
    // enforce this for real regardless of what the frontend does or doesn't catch.
    if (phoneCheck === 'taken') {
      setMessage('This phone number has already been used to submit an enquiry.');
      return;
    }
    setLoading(true);
    setMessage('');
    startSlowRequestWatch();
    try {
      const body = { ...lead };
      // The backend derives vendor/QR attribution server-side from this scan_id — the browser
      // never sends and is never trusted with a vendor or QR identifier directly.
      if (referral?.scan_id) body.scan_id = referral.scan_id;
      if (!body.email.trim()) delete body.email;
      if (!body.location.trim()) delete body.location;
      if (!body.average_electricity_bill) delete body.average_electricity_bill;
      if (!body.solar_size) delete body.solar_size;
      // Optional — only sent if the customer tapped "Use my location" and coordinates were
      // actually received (not just because the button was clicked).
      if (capturedCoords) {
        body.location_lat = capturedCoords.latitude;
        body.location_lng = capturedCoords.longitude;
        if (capturedCoords.accuracy != null) body.location_accuracy = capturedCoords.accuracy;
        body.location_captured_at = capturedCoords.capturedAt;
      }
      await apiRequest('/public/leads', { method: 'POST', body: JSON.stringify(body) });
      setSubmitted({ name: lead.customer_name });
      setLead(EMPTY_LEAD);
      setConsent(false);
      setPhoneCheck('idle');
      setCapturedCoords(null);
    } catch (error) {
      setMessage(error.message);
      if (error.code === 'CUSTOMER_ALREADY_EXISTS') setPhoneCheck('taken');
    } finally {
      setLoading(false);
      stopSlowRequestWatch();
    }
  }

  function startNewEnquiry() {
    setSubmitted(null);
    setMessage('');
    setCapturedCoords(null);
    setLocationError('');
  }

  function useMyLocation() {
    if (!navigator.geolocation) {
      setLocationError('Location is not available on this device.');
      return;
    }
    setLocating(true);
    setLocationError('');
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        try {
          const { latitude, longitude, accuracy } = position.coords;
          // Capture the raw coordinates for the optional LeadLocation record regardless of
          // whether the reverse-geocode below succeeds — that's a separate, best-effort
          // convenience (filling the city text field), not a prerequisite for this.
          setCapturedCoords({ latitude, longitude, accuracy, capturedAt: new Date(position.timestamp).toISOString() });

          // OpenStreetMap's free Nominatim endpoint — no API key needed, called directly from the
          // browser since this is light, occasional use. If this page's traffic grows meaningfully,
          // proxy this through the backend with caching to stay within Nominatim's usage policy.
          const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${latitude}&lon=${longitude}`, { headers: { Accept: 'application/json' } });
          const data = await response.json();
          const city = data?.address?.city || data?.address?.town || data?.address?.village || data?.address?.county;
          if (city) {
            setLead((current) => ({ ...current, location: city }));
          } else {
            setLocationError('Could not determine your city — enter it manually.');
          }
        } catch (error) {
          setLocationError('Could not detect your location — enter it manually.');
        } finally {
          setLocating(false);
        }
      },
      () => {
        setLocationError('Location permission was denied — enter it manually.');
        setLocating(false);
      },
      { timeout: 8000 },
    );
  }

  function renderFormCard() {
    if (referralStatus === 'loading') {
      // A blank/spinner-only state reads as broken while the backend wakes up (Render's free
      // tier can take several seconds to respond to the first request) — a skeleton shaped
      // like the real form makes it clear the page is working, not stuck.
      return (
        <div aria-hidden="true" aria-label="Loading">
          <SkeletonBlock width="60%" height="24px" />
          <SkeletonBlock width="40%" height="14px" style={{ marginTop: '10px' }} />
          <div className="enquiry-row" style={{ marginTop: '20px' }}>
            <SkeletonBlock height="46px" radius="10px" />
            <SkeletonBlock height="46px" radius="10px" />
          </div>
          <SkeletonBlock height="46px" radius="10px" style={{ marginTop: '14px' }} />
          <SkeletonBlock height="46px" radius="10px" style={{ marginTop: '14px' }} />
          <SkeletonBlock height="48px" radius="10px" style={{ marginTop: '20px' }} />
        </div>
      );
    }

    if (referralStatus === 'invalid' || referralStatus === 'inactive') {
      return (
        <div className="enquiry-referral-blocked">
          <Icon path={ICONS.warning} className="enquiry-referral-blocked-icon" />
          <p>{referralMessage}</p>
        </div>
      );
    }

    if (submitted) {
      return (
        <div className="enquiry-success">
          <span className="enquiry-success-icon"><Icon path={ICONS.check} /></span>
          <h2>Enquiry received</h2>
          <p>{submitted.name ? <>Thank you, <strong>{submitted.name}</strong>.</> : 'Thank you.'} Our solar team will contact you shortly.</p>
          <button type="button" className="enquiry-submit" onClick={startNewEnquiry}>Done</button>
        </div>
      );
    }

    return (
      <>
        <h2>Share your details</h2>
        <p className="enquiry-card-sub">Please fill in the form below</p>

        <form onSubmit={submitLead} className="enquiry-form" autoComplete="on">
          <div className="enquiry-row">
            <div className="enquiry-field">
              <Icon path={ICONS.person} className="enquiry-field-icon" />
              <input
                id="customer-name"
                name="name"
                type="text"
                autoComplete="name"
                autoCapitalize="words"
                enterKeyHint="next"
                required
                placeholder="Full Name *"
                value={lead.customer_name}
                onChange={(event) => setLead({ ...lead, customer_name: event.target.value })}
              />
            </div>
            <div className="enquiry-field">
              <Icon path={ICONS.phone} className="enquiry-field-icon" />
              <input
                id="customer-phone"
                name="tel"
                type="tel"
                autoComplete="tel"
                inputMode="tel"
                enterKeyHint="next"
                required
                placeholder="Mobile Number *"
                value={lead.phone}
                onChange={(event) => {
                  setLead({ ...lead, phone: event.target.value });
                  setPhoneCheck('idle');
                }}
                onBlur={(event) => checkPhoneAvailability(event.target.value)}
              />
            </div>
          </div>
          {phoneCheck === 'checking' && <p className="enquiry-phone-status checking">Checking...</p>}
          {phoneCheck === 'taken' && (
            <p className="enquiry-phone-status taken">This phone number has already been used to submit an enquiry.</p>
          )}
          <div className="enquiry-field">
            <Icon path={ICONS.mail} className="enquiry-field-icon" />
            <input
              id="customer-email"
              name="email"
              type="email"
              autoComplete="email"
              inputMode="email"
              enterKeyHint="next"
              placeholder="Email Address"
              value={lead.email}
              onChange={(event) => setLead({ ...lead, email: event.target.value })}
            />
          </div>
          <div className="enquiry-field">
            <Icon path={ICONS.pin} className="enquiry-field-icon" />
            <input
              id="customer-location"
              name="address-level2"
              type="text"
              autoComplete="address-level2"
              autoCapitalize="words"
              enterKeyHint="done"
              placeholder="City / Location"
              value={lead.location}
              onChange={(event) => setLead({ ...lead, location: event.target.value })}
            />
          </div>
          <div className="enquiry-row">
            <div className="enquiry-field">
              <Icon path={ICONS.pin} className="enquiry-field-icon" />
              <input
                id="customer-pincode"
                name="postal-code"
                type="text"
                inputMode="numeric"
                autoComplete="postal-code"
                pattern="[1-9][0-9]{5}"
                maxLength="6"
                required
                placeholder="Pincode *"
                value={lead.pincode}
                onChange={(event) => setLead({ ...lead, pincode: event.target.value.replace(/\D/g, '').slice(0, 6) })}
              />
            </div>
            <label className="enquiry-select">
              <span>Average electricity bill</span>
              <select
                id="average-electricity-bill"
                name="average_electricity_bill"
                value={lead.average_electricity_bill}
                onChange={(event) => setLead({ ...lead, average_electricity_bill: event.target.value })}
              >
                <option value="">Select monthly bill</option>
                {BILL_BANDS.map((band) => <option key={band} value={band}>{band}</option>)}
              </select>
            </label>
          </div>
          <label className="enquiry-select">
            <span>Solar system size</span>
            <select
              id="solar-size"
              name="solar_size"
              value={lead.solar_size}
              onChange={(event) => setLead({ ...lead, solar_size: event.target.value })}
            >
              <option value="">Select system size</option>
              {SOLAR_SIZE_BANDS.map((band) => <option key={band} value={band}>{band}</option>)}
            </select>
          </label>
          <div className="enquiry-location-row">
            <button type="button" className={`enquiry-location-button${capturedCoords ? ' captured' : ''}`} onClick={useMyLocation} disabled={locating}>
              <Icon path={ICONS.target} className="enquiry-location-icon" />
              {locating ? 'Detecting...' : capturedCoords ? 'Location captured' : 'Use my location'}
              {capturedCoords && !locating && <Icon path={ICONS.check} className="enquiry-location-icon" />}
            </button>
            {locationError && <span className="enquiry-location-error">{locationError}</span>}
          </div>

          <label className="enquiry-consent">
            <input type="checkbox" required checked={consent} onChange={(event) => setConsent(event.target.checked)} />
            <span>
              I consent to Solarium Energy processing the personal data I have entered, and sharing it with the Solar Mitra who referred me, to contact me about my solar enquiry, as described in the{' '}
              <button type="button" className="enquiry-consent-link" onClick={() => noticeRef.current?.showModal()}>Privacy Notice</button>
              {' '}(Digital Personal Data Protection Act, 2023).
            </span>
          </label>

          <button className="enquiry-submit" disabled={loading || phoneCheck === 'taken' || phoneCheck === 'checking'}>
            {loading ? 'Sending...' : 'Submit Enquiry'}
            {!loading && <Icon path={ICONS.arrow} className="enquiry-submit-icon" />}
          </button>

          <p className="enquiry-security"><Icon path={ICONS.lock} className="enquiry-security-icon" /> Your information is safe with us.</p>
        </form>

        <dialog ref={noticeRef} className="enquiry-notice" aria-labelledby="enquiry-notice-title">
          <h2 id="enquiry-notice-title">Privacy Notice</h2>
          <p className="enquiry-notice-sub">Under the Digital Personal Data Protection Act, 2023 (India)</p>
          <dl>
            <dt>What we collect</dt>
            <dd>Your name, phone number, and the optional details you fill in: email, city, pincode, average electricity bill, preferred system size and, only if you tap "Use my location", your GPS location.</dd>
            <dt>Why</dt>
            <dd>To contact you about your solar enquiry and give you a quote. Nothing else, and we do not sell your data.</dd>
            <dt>Who sees it</dt>
            <dd>Solarium Energy, and the Solar Mitra (partner) whose QR code or link brought you here.</dd>
            <dt>Cookies and browser storage</dt>
            <dd>This page uses only essential browser storage needed for the form to work. No advertising or tracking cookies.</dd>
            <dt>How long</dt>
            <dd>Only as long as needed for your enquiry, or as the law requires.</dd>
            <dt>Your rights</dt>
            <dd>You can withdraw consent, and ask to access, correct or erase your data, by emailing <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>. You may also complain to the Data Protection Board of India.</dd>
          </dl>
          <button type="button" className="enquiry-notice-close" onClick={() => noticeRef.current?.close()}>Close</button>
        </dialog>

        {message && <p className="enquiry-message" role="status">{message}</p>}

        {slowRequest && (
          <p className="enquiry-slow-notice" role="status">
            This is taking longer than expected. If it doesn't go through, email your details to{' '}
            <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> and our team will follow up.
          </p>
        )}
      </>
    );
  }

  return (
    <div className="enquiry-page">
      <header className="enquiry-header">
        <span className="enquiry-brand"><img className="enquiry-logo" src="/Sol_logo.jpg" alt="Solarium" /></span>
        <span className="enquiry-tagline">India's Leading Solar Solutions Provider</span>
      </header>

      <section className="enquiry-hero">
        <h1>Powering a sustainable tomorrow</h1>
        <p>{referral ? <>Referred by <strong>{referral.vendor_name}</strong> — share your details and our team will get in touch.</> : 'Share your details and our team will get in touch with you shortly.'}</p>
      </section>

      <section className="enquiry-card">
        {renderFormCard()}
      </section>

      {referralStatus !== 'invalid' && referralStatus !== 'inactive' && (
        <section className="enquiry-why">
          <h3>Why share your details?</h3>
          {WHY_ITEMS.map((item) => (
            <div className="enquiry-why-item" key={item.title}>
              <span className="enquiry-why-icon"><Icon path={ICONS[item.icon]} /></span>
              <div>
                <strong>{item.title}</strong>
                <p>{item.copy}</p>
              </div>
            </div>
          ))}
        </section>
      )}

      <footer className="enquiry-footer">
        <span className="enquiry-brand"><img className="enquiry-logo" src="/Sol_logo.jpg" alt="Solarium" /></span>
        <p>India's Leading Solar Solutions Provider</p>
        <p className="enquiry-copyright">© {new Date().getFullYear()} Solarium Energy. All rights reserved.</p>
      </footer>
    </div>
  );
}

export default PublicPage;
