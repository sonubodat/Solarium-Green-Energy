// SalesPage.js

import { useEffect, useRef, useState } from 'react';
import { apiRequest } from '../api/client';
import { INDIAN_STATES } from '../constants/indian-states';
import QrScanner from '../components/QrScanner';
import VendorPicker from '../components/VendorPicker';
import { SkeletonBlock } from '../components/Skeleton';
import './SalesPage.css';

// Server-side, paginated Solar Mitra lookup for the Sales pickers. Uncached (forceRefresh) so a
// Solar Mitra onboarded or assigned a moment ago is current. includeAssigned is asked for only
// by "Complete onboarding": photos and the geo-tag are added after the QR is assigned, while the
// QR-assign picker keeps excluding anyone who already holds one. This only narrows what is
// OFFERED — the ownership checks on the assign/location/photo endpoints stay authoritative.
function salesVendorFetcher(includeAssigned) {
  return (search, page, limit) => {
    const params = new URLSearchParams({ page: String(page), limit: String(limit) });
    if (search) params.set('search', search);
    if (includeAssigned) params.set('include_assigned', 'true');
    return apiRequest(`/sales/vendors?${params.toString()}`, { forceRefresh: true });
  };
}
const fetchAssignableVendors = salesVendorFetcher(false);
const fetchOnboardingVendors = salesVendorFetcher(true);
// GET /sales/vendors is newest-first: the pickers show only this many (a just-created Solar Mitra
// is row 1) and everything else is found through the search box.
const SALES_PICKER_RECENT = 3;

const ICONS = {
  user: 'M12 12a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9Zm0 2c-4.2 0-7.5 2.1-7.5 4.7V21h15v-2.3c0-2.6-3.3-4.7-7.5-4.7Z',
  lock: 'M7 10V8a5 5 0 0 1 10 0v2h1a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1h1Zm2 0h6V8a3 3 0 0 0-6 0v2Z',
  store: 'M4 10h16v10H4V10Zm2 0V6h12v4M3 10h18M8 14h3v3H8v-3Zm6 0h2v3h-2v-3Z',
  qr: 'M4 4h6v6H4V4Zm10 0h6v6h-6V4ZM4 14h6v6H4v-6Zm10 1h2v2h-2v-2Zm3-1h3v3h-3v-3Zm-3 4h2v2h-2v-2Zm5-1h1v2h-1v-2Z',
  logout: 'M10 17l5-5-5-5m5 5H3m10-8h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4',
  arrow: 'M5 12h13m0 0-5-5m5 5-5 5',
  check: 'm5 12 4 4L19 6',
  alert: 'M12 9v4m0 4h.01M10.3 3.7 2.5 18a2 2 0 0 0 1.7 3h15.6a2 2 0 0 0 1.7-3L13.7 3.7a2 2 0 0 0-3.4 0Z',
  camera: 'M4 8a2 2 0 0 1 2-2h1l1.2-2h7.6L17 6h1a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8Zm8 3a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z',
  plus: 'M12 5v14M5 12h14',
  target: 'M12 2v3m0 14v3M2 12h3m14 0h3M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z',
};

// "18.5204, 73.8567" (also space-separated, e.g. pasted from Google Maps) -> { latitude, longitude }.
function parseCoordsText(text) {
  const parts = String(text).trim().split(/[,\s]+/).filter(Boolean);
  const [latitude, longitude] = parts.map(Number);
  if (parts.length !== 2 || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    throw new Error('Enter coordinates as "latitude, longitude", e.g. 18.5204, 73.8567.');
  }
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    throw new Error('Latitude must be between -90 and 90, longitude between -180 and 180.');
  }
  return { latitude, longitude };
}

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

// Bank details Sales fills in on the Solar Mitra's behalf (same fields/limits as the vendor's own form).
const EMPTY_BANK = { upi_number: '', upi_id: '', account_holder_name: '', account_number: '', ifsc_code: '' };

// Mirrors the backend's isBankDetailsSet() (backend/src/lib/vendor-bank-details.js): once
// anything has been saved, Sales can no longer change it — only Admin can, from then on.
function bankDetailsAreSet(d) {
  return Boolean(d && (d.upiNumber || d.upiId || d.accountHolderName || d.accountNumber || d.ifscCode || d.passbookFileName || d.chequeFileName));
}

function SalesBankForm({ vendorId }) {
  const [bank, setBank] = useState(EMPTY_BANK);
  const [docs, setDocs] = useState({ passbook: '', cheque: '' });
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState({ text: '', error: false });
  // Proactively disables the form once the loaded details are non-empty; the backend's own
  // 403 BANK_DETAILS_LOCKED (checked at write time, so a stale/cached GET can't be used to get
  // around it) also flips this on if save/upload gets there first.
  const [locked, setLocked] = useState(false);

  useEffect(() => {
    setBank(EMPTY_BANK);
    setDocs({ passbook: '', cheque: '' });
    setNote({ text: '', error: false });
    setLocked(false);
    if (!vendorId) return undefined;
    let active = true;
    apiRequest(`/sales/vendors/${vendorId}/bank-details`, { forceRefresh: true })
      .then((result) => {
        const d = result.bank_details;
        if (!active || !d) return;
        setBank({
          upi_number: d.upiNumber || '',
          upi_id: d.upiId || '',
          account_holder_name: d.accountHolderName || '',
          account_number: d.accountNumber || '',
          ifsc_code: d.ifscCode || '',
        });
        setDocs({ passbook: d.passbookFileName || '', cheque: d.chequeFileName || '' });
        setLocked(bankDetailsAreSet(d));
      })
      .catch(() => {});
    return () => { active = false; };
  }, [vendorId]);

  function lockedByServer(error) {
    if (error.code === 'BANK_DETAILS_LOCKED') setLocked(true);
  }

  async function save() {
    setBusy(true);
    try {
      await apiRequest(`/sales/vendors/${vendorId}/bank-details`, { method: 'PATCH', body: JSON.stringify(bank) });
      setNote({ text: 'Bank details saved.', error: false });
      setLocked(true);
    } catch (error) {
      lockedByServer(error);
      setNote({ text: error.message || 'Unable to save bank details.', error: true });
    } finally {
      setBusy(false);
    }
  }

  async function upload(type, file) {
    if (!file) return;
    if (file.size > 200 * 1024) return setNote({ text: 'Documents must be 200 KB or smaller.', error: true });
    if (!['application/pdf', 'image/jpeg', 'image/png'].includes(file.type)) return setNote({ text: 'Upload a PDF, JPG, or PNG document.', error: true });
    const body = new FormData();
    body.append('file', file);
    setBusy(true);
    try {
      await apiRequest(`/sales/vendors/${vendorId}/bank-details/${type}`, { method: 'POST', body });
      setDocs((current) => ({ ...current, [type]: file.name }));
      setNote({ text: `${type === 'passbook' ? 'Passbook' : 'Cancelled cheque'} uploaded.`, error: false });
      setLocked(true);
    } catch (error) {
      lockedByServer(error);
      setNote({ text: error.message || 'Unable to upload document.', error: true });
    } finally {
      setBusy(false);
    }
  }

  const fields = [
    ['upi_number', 'UPI number', ''],
    ['upi_id', 'UPI ID', 'name@bank'],
    ['account_holder_name', 'Account holder name', ''],
    ['account_number', 'Account number', ''],
    ['ifsc_code', 'IFSC code', ''],
  ];
  const disabled = !vendorId || busy || locked;

  return (
    <div className="sales-field-labeled">
      <span>Bank details (optional)</span>
      {locked && (
        <small className="sales-field-error" role="status">
          Bank details are already set for this Solar Mitra. Ask an Admin to change them.
        </small>
      )}
      {fields.map(([key, label, placeholder]) => (
        <div className="sales-field-input" key={key}>
          <input
            aria-label={label}
            placeholder={placeholder || label}
            disabled={disabled}
            value={bank[key]}
            onChange={(event) => setBank({ ...bank, [key]: key === 'ifsc_code' ? event.target.value.toUpperCase() : event.target.value })}
          />
        </div>
      ))}
      <button type="button" className="sales-primary-button" disabled={disabled} onClick={save}>
        Save bank details
      </button>
      {[['passbook', 'Passbook'], ['cheque', 'Cancelled cheque']].map(([type, label]) => (
        <label className="sales-field-labeled" key={type}>
          <span>{label} (PDF/JPG/PNG, max 200 KB){docs[type] ? ` - uploaded: ${docs[type]}` : ''}</span>
          <div className="sales-field-input">
            <input type="file" accept="application/pdf,image/jpeg,image/png" disabled={disabled} onChange={(event) => { upload(type, event.target.files?.[0]); event.target.value = ''; }} />
          </div>
        </label>
      ))}
      {note.text && <small className={note.error ? 'sales-field-error' : ''} role={note.error ? 'alert' : 'status'}>{note.text}</small>}
    </div>
  );
}

function SalesPage() {
  const [login, setLogin] = useState({
    identifier: '',
    password: '',
  });

  const [portalData, setPortalData] = useState(null);
  // Distinguishes "still checking whether a session cookie is valid" from "confirmed logged
  // out" — without this, the login form flashes on every page load/reload for an already
  // signed-in Sales user while restoreSession()'s request is in flight (worse the slower the
  // backend is, e.g. a cold Render instance waking up), before silently swapping to the
  // dashboard. Shows a skeleton instead of that flash.
  const [sessionChecked, setSessionChecked] = useState(false);
  const [selectedVendorId, setSelectedVendorId] = useState('');
  const [selectedVendorLabel, setSelectedVendorLabel] = useState('');
  const [assignmentCode, setAssignmentCode] = useState('');
  const [qrStatus, setQrStatus] = useState(null);
  const [showScanner, setShowScanner] = useState(false);
  const [showCreateVendor, setShowCreateVendor] = useState(false);
  const [newVendor, setNewVendor] = useState({ business_name: '', owner_name: '', login_identifier: '', mobile_number: '', password: '', state: '' });
  const [newVendorLocation, setNewVendorLocation] = useState(null);
  const [locatingVendor, setLocatingVendor] = useState(false);
  const [vendorLocationError, setVendorLocationError] = useState('');
  // Typed/pasted alternative to the GPS button (same idea as Admin's coordinates field).
  const [coordsText, setCoordsText] = useState('');
  const [shopPhotoFile, setShopPhotoFile] = useState(null);
  const [qrPlacementPhotoFile, setQrPlacementPhotoFile] = useState(null);
  const [shopPhotoPreview, setShopPhotoPreview] = useState('');
  const [qrPlacementPhotoPreview, setQrPlacementPhotoPreview] = useState('');
  const [showCompleteOnboarding, setShowCompleteOnboarding] = useState(false);
  const [completeVendorId, setCompleteVendorId] = useState('');
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState('');
  // Full-screen animated checkmark instead of the bottom banner for success only — errors
  // still use the bottom .sales-message banner unchanged.
  const [showSuccessOverlay, setShowSuccessOverlay] = useState(false);
  const [loading, setLoading] = useState(false);

  const mountedRef = useRef(true);
  const hasScrolledToDashboardRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    // The login form and the dashboard are the same route/scroll container (no full page
    // navigation between them) — if the user scrolled while filling the login form, that
    // scroll position otherwise carries straight into the dashboard, landing them mid-page
    // with the sticky header overlapping content. Only fires once, on the login->dashboard
    // transition itself, not on every later data refresh.
    if (portalData && !hasScrolledToDashboardRef.current) {
      window.scrollTo(0, 0);
      hasScrolledToDashboardRef.current = true;
    }
  }, [portalData]);

  useEffect(() => {
    if (messageType !== 'success' || !message) return undefined;

    // Replaces the bottom banner for success only — shows the animated checkmark instead,
    // then clears both the overlay and the message together after 2s so no stale success
    // text is left behind for the (now-unused-for-success) bottom banner to pick up.
    setShowSuccessOverlay(true);
    const timer = setTimeout(() => {
      setShowSuccessOverlay(false);
      setMessage('');
      setMessageType('');
    }, 2000);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message, messageType]);

  useEffect(() => {
    restoreSession();

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function restoreSession() {
    try {
      const session = await apiRequest('/auth/session?portal=sales');

      if (!mountedRef.current || session.role !== 'SALES') return;

      if (!mountedRef.current) return;

      setPortalData({
        account: session.account,
        data: null,
      });
    } catch (error) {
      // No active Sales session.
    } finally {
      if (mountedRef.current) setSessionChecked(true);
    }
  }

  async function signOutCurrent() {
    setLoading(true);
    setMessage('');
    setMessageType('');

    try {
      await apiRequest('/auth/logout?portal=sales', {
        method: 'POST',
      });
    } catch (error) {
      // Clear UI even if logout request fails.
    } finally {
      setPortalData(null);
      setLoading(false);
      setMessage('Signed out.');
      setMessageType('success');
    }
  }

  async function signIn(event) {
    event.preventDefault();

    setLoading(true);
    setMessage('');
    setMessageType('');

    try {
      const result = await apiRequest('/auth/login?portal=sales', {
        method: 'POST',
        body: JSON.stringify({
          username_or_mobile: login.identifier.trim(),
          password: login.password,
        }),
      });

      if (!mountedRef.current) return;

      setPortalData({
        account: result.user,
        data: null,
      });

      setMessage('Signed in successfully.');
      setMessageType('success');
    } catch (error) {
      setMessage(error.message);
      setMessageType('error');
    } finally {
      setLoading(false);
    }
  }

  // Being physically at the shop is the whole point of a Solar Mitra geo-tag, so
  // enableHighAccuracy is on here (unlike the public enquiry page's rougher "which city"
  // need) — Sales is standing there and precision is worth the extra GPS settle time.
  // Uses typed/pasted coordinates instead of GPS; no accuracy value exists for these, so none is sent.
  function applyCoordsText() {
    try {
      const { latitude, longitude } = parseCoordsText(coordsText);
      setNewVendorLocation({ latitude, longitude, capturedAt: new Date().toISOString() });
      setVendorLocationError('');
    } catch (error) {
      setNewVendorLocation(null);
      setVendorLocationError(error.message);
    }
  }

  function captureVendorLocation() {
    if (!navigator.geolocation) {
      setVendorLocationError('Location is not available on this device.');
      return;
    }
    setLocatingVendor(true);
    setVendorLocationError('');
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude, accuracy } = position.coords;
        setNewVendorLocation({ latitude, longitude, accuracy, capturedAt: new Date(position.timestamp).toISOString() });
        setCoordsText(`${latitude.toFixed(6)}, ${longitude.toFixed(6)}`);
        setLocatingVendor(false);
      },
      () => {
        setVendorLocationError('Could not detect the shop’s location — check location permission and try again.');
        setLocatingVendor(false);
      },
      { timeout: 8000, enableHighAccuracy: true },
    );
  }

  // Client-side check is just an early sanity/UX check — the server compresses whatever
  // comes in down to ~100KB before storing it, so this isn't the real cap.
  function handlePhotoSelect(kind, event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > 15 * 1024 * 1024) {
      setMessage('Photos must be 15 MB or smaller.');
      setMessageType('error');
      return;
    }
    if (!['image/jpeg', 'image/png'].includes(file.type)) {
      setMessage('Upload a JPG or PNG photo.');
      setMessageType('error');
      return;
    }
    const previewUrl = URL.createObjectURL(file);
    if (kind === 'shop') {
      setShopPhotoFile(file);
      setShopPhotoPreview(previewUrl);
    } else {
      setQrPlacementPhotoFile(file);
      setQrPlacementPhotoPreview(previewUrl);
    }
  }

  function resetOnboardingCapture() {
    setCoordsText('');
    setNewVendorLocation(null);
    setVendorLocationError('');
    setShopPhotoFile(null);
    setQrPlacementPhotoFile(null);
    setShopPhotoPreview('');
    setQrPlacementPhotoPreview('');
  }

  async function uploadOnboardingPhoto(vendorId, kind, file) {
    const body = new FormData();
    body.append('photo', file);
    await apiRequest(`/sales/vendors/${vendorId}/photos/${kind}`, { method: 'POST', body });
  }

  async function createVendorDirect(event) {
    event.preventDefault();

    setLoading(true);
    setMessage('');
    setMessageType('');

    try {
      const body = {
        ...newVendor,
        ...(newVendorLocation
          ? {
              latitude: newVendorLocation.latitude,
              longitude: newVendorLocation.longitude,
              accuracy: newVendorLocation.accuracy,
              captured_at: newVendorLocation.capturedAt,
            }
          : {}),
      };
      const result = await apiRequest('/sales/vendors', {
        method: 'POST',
        body: JSON.stringify(body),
      });

      if (!mountedRef.current) return;
      const vendorId = result.vendor.id;

      const photoFailures = [];
      for (const [kind, file] of [['shop', shopPhotoFile], ['qr-placement', qrPlacementPhotoFile]]) {
        if (!file) continue;
        try {
          await uploadOnboardingPhoto(vendorId, kind, file);
        } catch (photoError) {
          photoFailures.push(kind);
        }
      }

      setNewVendor({ business_name: '', owner_name: '', login_identifier: '', mobile_number: '', password: '', state: '' });
      resetOnboardingCapture();
      setShowCreateVendor(false);
      setSelectedVendorId(vendorId);
      setSelectedVendorLabel(newVendor.business_name);

      if (photoFailures.length) {
        const labels = { shop: 'shop', 'qr-placement': 'QR placement' };
        setMessage(`Solar Mitra created, but the ${photoFailures.map((kind) => labels[kind]).join(' and ')} photo failed to upload — finish it from "Complete Solar Mitra onboarding" below.`);
        setMessageType('error');
      } else {
        setMessage('Solar Mitra created. Assign an unassigned QR next.');
        setMessageType('success');
      }
    } catch (error) {
      setMessage(error.message);
      setMessageType('error');
    } finally {
      setLoading(false);
    }
  }

  async function completeOnboardingLocation() {
    if (!completeVendorId || !newVendorLocation) return;
    setLoading(true);
    setMessage('');
    setMessageType('');
    try {
      await apiRequest(`/sales/vendors/${completeVendorId}/location`, {
        method: 'PATCH',
        body: JSON.stringify({
          latitude: newVendorLocation.latitude,
          longitude: newVendorLocation.longitude,
          accuracy: newVendorLocation.accuracy,
          captured_at: newVendorLocation.capturedAt,
        }),
      });
      setNewVendorLocation(null);
      setMessage('Location saved.');
      setMessageType('success');
    } catch (error) {
      setMessage(error.message);
      setMessageType('error');
    } finally {
      setLoading(false);
    }
  }

  async function completeOnboardingPhoto(kind) {
    const file = kind === 'shop' ? shopPhotoFile : qrPlacementPhotoFile;
    if (!completeVendorId || !file) return;
    setLoading(true);
    setMessage('');
    setMessageType('');
    try {
      await uploadOnboardingPhoto(completeVendorId, kind, file);
      if (kind === 'shop') {
        setShopPhotoFile(null);
        setShopPhotoPreview('');
      } else {
        setQrPlacementPhotoFile(null);
        setQrPlacementPhotoPreview('');
      }
      setMessage(`${kind === 'shop' ? 'Shop' : 'QR placement'} photo saved.`);
      setMessageType('success');
    } catch (error) {
      setMessage(error.message);
      setMessageType('error');
    } finally {
      setLoading(false);
    }
  }

  async function checkQrCode(code) {
    setLoading(true);
    setMessage('');
    setMessageType('');
    setQrStatus(null);

    try {
      const result = await apiRequest(`/sales/qr/${encodeURIComponent(code.trim())}`);
      setQrStatus(result.qr);
    } catch (error) {
      setMessage(error.message);
      setMessageType('error');
    } finally {
      setLoading(false);
    }
  }

  async function checkQr(event) {
    event.preventDefault();
    await checkQrCode(assignmentCode);
  }

  function handleScanDetected(code) {
    setShowScanner(false);
    setAssignmentCode(code);
    checkQrCode(code);
  }

  async function assignQr(event) {
    event.preventDefault();

    if (!selectedVendorId) return;

    setLoading(true);
    setMessage('');
    setMessageType('');

    try {
      await apiRequest('/sales/qr/assign', {
        method: 'POST',
        body: JSON.stringify({
          code: assignmentCode.trim(),
          vendor_id: selectedVendorId,
        }),
      });

      setMessage('QR assigned successfully.');
      setMessageType('success');
      setQrStatus(null);
      setAssignmentCode('');
      setSelectedVendorId('');
      setSelectedVendorLabel('');
    } catch (error) {
      setMessage(error.message);
      setMessageType('error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="sales-page">
      <div className="sales-background" />

      <main className="sales-container">
        {!sessionChecked ? (
          <>
            <section className="sales-welcome" aria-hidden="true">
              <div style={{ display: 'grid', gap: '10px' }}>
                <SkeletonBlock width="150px" height="14px" />
                <SkeletonBlock width="280px" height="34px" />
                <SkeletonBlock width="340px" height="16px" />
              </div>
            </section>

            <section className="sales-grid" aria-hidden="true">
              {Array.from({ length: 2 }).map((_, index) => (
                <article className="sales-card" key={index}>
                  <div className="sales-card-header">
                    <SkeletonBlock width="42px" height="42px" radius="10px" />
                    <div style={{ display: 'grid', gap: '8px' }}>
                      <SkeletonBlock width="70px" height="11px" />
                      <SkeletonBlock width="150px" height="20px" />
                    </div>
                  </div>
                  <SkeletonBlock width="90%" height="14px" style={{ marginTop: '14px' }} />
                  <SkeletonBlock width="60%" height="14px" style={{ marginTop: '8px' }} />
                </article>
              ))}
            </section>
          </>
        ) : !portalData ? (
          <section className="sales-login-card">
            <div className="sales-brand"><img className="sales-logo" src="/Sol_logo.jpg" alt="Solarium" /></div>

            <div className="sales-login-heading">
              <div className="sales-eyebrow">SALES PORTAL</div>

              <h1>Get Solar Mitras<br />up and running.</h1>

              <p>
                Onboard Solar Mitras, activate their QR codes and keep every
                setup moving smoothly.
              </p>
            </div>

            <form onSubmit={signIn} className="sales-form">
              <div className="sales-field">
                <Icon
                  path={ICONS.user}
                  className="sales-field-icon"
                />

                <input
                  required
                  id="sales-login-identifier"
                  name="username_or_mobile"
                  autoComplete="username"
                  placeholder="Username or mobile"
                  value={login.identifier}
                  onChange={(event) =>
                    setLogin({
                      ...login,
                      identifier: event.target.value,
                    })
                  }
                />
              </div>

              <div className="sales-field">
                <Icon
                  path={ICONS.lock}
                  className="sales-field-icon"
                />

                <input
                  required
                  id="sales-login-password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  placeholder="Password"
                  value={login.password}
                  onChange={(event) =>
                    setLogin({
                      ...login,
                      password: event.target.value,
                    })
                  }
                />
              </div>

              <button
                type="submit"
                className="sales-primary-button"
                disabled={loading}
              >
                {loading ? 'Signing in...' : 'Sign in'}

                {!loading && (
                  <Icon
                    path={ICONS.arrow}
                    className="sales-button-icon"
                  />
                )}
              </button>
            </form>

            <div className="sales-login-footer">
              <Icon
                path={ICONS.lock}
                className="sales-small-icon"
              />
              Secure access for authorised sales staff
            </div>
          </section>
        ) : (
          <>
            <header className="sales-topbar">
              <div className="sales-brand"><img className="sales-logo" src="/Sol_logo.jpg" alt="Solarium" /></div>

              <div className="sales-user-area">
                <div className="sales-user-info">
                  <span>Sales Executive</span>
                  <strong>{portalData.account.name}</strong>
                </div>

                <button
                  type="button"
                  className="sales-logout-button"
                  onClick={signOutCurrent}
                  disabled={loading}
                  aria-label="Sign out"
                >
                  <Icon path={ICONS.logout} />
                  <span>Sign out</span>
                </button>
              </div>
            </header>

            <section className="sales-welcome">
              <div>
                <div className="sales-eyebrow">SALES WORKSPACE</div>

                <h1>Let&apos;s get Solar Mitras<br />live.</h1>

                <p>
                  Complete onboarding first, then connect the Solar Mitra
                  to their physical QR.
                </p>
              </div>

              <div className="sales-progress">
                <div className="sales-progress-step active">
                  <span>1</span>
                  <div>
                    <strong>Onboard</strong>
                    <small>Solar Mitra setup</small>
                  </div>
                </div>

                <div className="sales-progress-line" />

                <div
                  className={`sales-progress-step ${
                    qrStatus?.status === 'UNASSIGNED'
                      ? 'active'
                      : ''
                  }`}
                >
                  <span>2</span>
                  <div>
                    <strong>Activate</strong>
                    <small>Assign QR</small>
                  </div>
                </div>
              </div>
            </section>

            <section className="sales-grid">
              {/* Self-registration is currently unavailable; Sales creates every Vendor directly.
              <article className="sales-card">
                <div className="sales-card-header">
                  <div className="sales-card-icon">
                    <Icon path={ICONS.store} />
                  </div>

                  <div>
                    <span className="sales-card-label">STEP 01</span>
                    <h2>Onboard Solar Mitra</h2>
                  </div>
                </div>

                <p className="sales-card-description">
                  Solar Mitras who self-registered are listed here. Onboard one to
                  create their login access.
                </p>

                {registrations.length ? (
                  <div className="sales-registration-list">
                    {registrations.map((registration) => (
                      <div key={registration.id} className="sales-registration-row">
                        <div className="sales-registration-info">
                          <strong>{registration.businessName}</strong>
                          <span>{registration.ownerName} · {registration.mobileNumber}</span>
                        </div>

                        {onboardingId === registration.id ? (
                          <form onSubmit={onboardVendor} className="sales-inline-onboard-form">
                            <div className="sales-field">
                              <Icon path={ICONS.lock} className="sales-field-icon" />
                              <input
                                minLength="8"
                                type="text"
                                autoComplete="off"
                                placeholder="Password (blank = phone number)"
                                value={temporaryPassword}
                                onChange={(event) => setTemporaryPassword(event.target.value)}
                              />
                            </div>
                            <div className="sales-inline-onboard-actions">
                              <button type="submit" className="sales-check-button" disabled={loading}>
                                {loading ? '...' : 'Confirm'}
                              </button>
                              <button
                                type="button"
                                className="sales-cancel-button"
                                onClick={() => { setOnboardingId(null); setTemporaryPassword(''); }}
                                disabled={loading}
                              >
                                Cancel
                              </button>
                            </div>
                          </form>
                        ) : (
                          <button
                            type="button"
                            className="sales-onboard-button"
                            onClick={() => { setOnboardingId(registration.id); setTemporaryPassword(''); }}
                            disabled={loading}
                          >
                            Onboard
                            <Icon path={ICONS.arrow} className="sales-button-icon" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="sales-empty-note">
                    <Icon path={ICONS.check} />
                    <span>No pending registrations right now.</span>
                  </div>
                )}

                {(() => {
                  const meta = portalData?.data?.pagination;
                  if (!meta || meta.total <= meta.limit) return null;
                  const start = meta.total === 0 ? 0 : (meta.page - 1) * meta.limit + 1;
                  const end = Math.min(meta.page * meta.limit, meta.total);
                  return (
                    <div className="sales-registration-pagination">
                      <span>{`Showing ${start}–${end} of ${meta.total}`}</span>
                      <div>
                        <button
                          type="button"
                          className="sales-cancel-button"
                          disabled={loading || meta.page <= 1}
                          onClick={() => loadRegistrationsPage(meta.page - 1)}
                        >
                          Previous
                        </button>
                        <button
                          type="button"
                          className="sales-cancel-button"
                          disabled={loading || end >= meta.total}
                          onClick={() => loadRegistrationsPage(meta.page + 1)}
                        >
                          Next
                        </button>
                      </div>
                    </div>
                  );
                })()}
              </article> */}

              <article className="sales-card">
                <div className="sales-card-header">
                  <div className="sales-card-icon qr">
                    <Icon path={ICONS.qr} />
                  </div>

                  <div>
                    <span className="sales-card-label">STEP 02</span>
                    <h2>Assign physical QR</h2>
                  </div>
                </div>

                <p className="sales-card-description">
                  Scan or enter the QR code printed on the Solar Mitra&apos;s
                  physical material and connect it to their account.
                </p>

                <form
                  onSubmit={checkQr}
                  className="sales-work-form"
                >
                  <label
                    htmlFor="assignment-code"
                    className="sales-input-label"
                  >
                    QR code
                  </label>

                  <div className="sales-field sales-qr-field">
                    <Icon
                      path={ICONS.qr}
                      className="sales-field-icon"
                    />

                    <input
                      id="assignment-code"
                      required
                      autoCapitalize="characters"
                      placeholder="V-0001"
                      value={assignmentCode}
                      onChange={(event) =>
                        setAssignmentCode(
                          event.target.value.toUpperCase()
                        )
                      }
                    />

                    <button
                      type="submit"
                      className="sales-check-button"
                      disabled={loading}
                    >
                      {loading ? '...' : 'Check'}
                    </button>
                  </div>

                  <button
                    type="button"
                    className="sales-scan-button"
                    onClick={() => setShowScanner(true)}
                    disabled={loading}
                  >
                    <Icon path={ICONS.camera} className="sales-button-icon" />
                    Scan QR with camera
                  </button>
                </form>

                {qrStatus && (
                  <div
                    className={`sales-qr-status ${
                      qrStatus.status === 'UNASSIGNED'
                        ? 'available'
                        : 'assigned'
                    }`}
                  >
                    <div className="sales-qr-status-icon">
                      <Icon
                        path={
                          qrStatus.status === 'UNASSIGNED'
                            ? ICONS.check
                            : ICONS.alert
                        }
                      />
                    </div>

                    <div>
                      <span>QR STATUS</span>
                      <strong>{qrStatus.status}</strong>
                    </div>
                  </div>
                )}

                {qrStatus?.status === 'UNASSIGNED' && (
                  <form
                    onSubmit={assignQr}
                    className="sales-assign-form"
                  >
                    <span className="sales-input-label">Assign to Solar Mitra</span>

                    <VendorPicker
                      fetchPage={fetchAssignableVendors}
                      recentCount={SALES_PICKER_RECENT}
                      value={selectedVendorId}
                      valueLabel={selectedVendorLabel}
                      onChange={(id, vendor) => {
                        setSelectedVendorId(id);
                        setSelectedVendorLabel(vendor?.businessName || '');
                      }}
                      ariaLabel="Solar Mitra to assign this QR to"
                    />

                    <button
                      type="submit"
                      className="sales-primary-button"
                      disabled={loading || !selectedVendorId}
                    >
                      {loading ? 'Assigning...' : 'Assign QR'}

                      {!loading && (
                        <Icon
                          path={ICONS.check}
                          className="sales-button-icon"
                        />
                      )}
                    </button>
                  </form>
                )}
              </article>

              <article className="sales-card sales-card-wide">
                <div className="sales-card-header">
                  <div className="sales-card-icon">
                    <Icon path={ICONS.store} />
                  </div>

                  <div>
                    <span className="sales-card-label">STEP 01</span>
                    <h2>Create Solar Mitra directly</h2>
                  </div>
                </div>

                <p className="sales-card-description">
                  Already spoke with a Solar Mitra who hasn&apos;t self-registered? Create
                  their account directly — no verification needed for now.
                </p>

                {!showCreateVendor ? (
                  <button
                    type="button"
                    className="sales-primary-button"
                    onClick={() => {
                      setShowCompleteOnboarding(false);
                      setCompleteVendorId('');
                      resetOnboardingCapture();
                      setShowCreateVendor(true);
                    }}
                  >
                    Create Solar Mitra
                    <Icon path={ICONS.plus} className="sales-button-icon" />
                  </button>
                ) : (
                  <form onSubmit={createVendorDirect} className="sales-work-form sales-create-vendor-grid">
                    <label className="sales-field-labeled">
                      <span>Business name</span>
                      <div className="sales-field-input">
                        <Icon path={ICONS.store} className="sales-field-icon" />
                        <input
                          id="sales-new-vendor-business-name"
                          name="business_name"
                          required
                          autoComplete="off"
                          placeholder="e.g. Sunrise Solar"
                          value={newVendor.business_name}
                          onChange={(event) => setNewVendor({ ...newVendor, business_name: event.target.value })}
                        />
                      </div>
                    </label>
                    <label className="sales-field-labeled">
                      <span>Owner name</span>
                      <div className="sales-field-input">
                        <Icon path={ICONS.user} className="sales-field-icon" />
                        <input
                          id="sales-new-vendor-owner-name"
                          name="owner_name"
                          required
                          autoComplete="off"
                          placeholder="e.g. Ram Kumar"
                          value={newVendor.owner_name}
                          onChange={(event) => setNewVendor({ ...newVendor, owner_name: event.target.value })}
                        />
                      </div>
                    </label>
                    <label className="sales-field-labeled">
                      <span>Mobile number</span>
                      <div className="sales-field-input">
                        <Icon path={ICONS.user} className="sales-field-icon" />
                        <input
                          id="sales-new-vendor-mobile"
                          name="mobile_number"
                          required
                          type="tel"
                          inputMode="tel"
                          autoComplete="off"
                          placeholder="10-digit mobile number"
                          value={newVendor.mobile_number}
                          onChange={(event) => setNewVendor({ ...newVendor, mobile_number: event.target.value })}
                        />
                      </div>
                    </label>
                    <label className="sales-field-labeled">
                      <span>Username</span>
                      <div className="sales-field-input">
                        <Icon path={ICONS.user} className="sales-field-icon" />
                        <input
                          id="sales-new-vendor-username"
                          name="vendor_username"
                          required
                          autoComplete="off"
                          placeholder="e.g. sunrise-solar"
                          value={newVendor.login_identifier}
                          onChange={(event) => setNewVendor({ ...newVendor, login_identifier: event.target.value })}
                        />
                      </div>
                      <small>This is what the Solar Mitra will type to sign in — not their name or business name.</small>
                    </label>
                    <label className="sales-field-labeled">
                      <span>Password (optional)</span>
                      <div className="sales-field-input">
                        <Icon path={ICONS.lock} className="sales-field-icon" />
                        <input
                          id="sales-new-vendor-password"
                          name="vendor_password"
                          minLength="8"
                          type="password"
                          autoComplete="new-password"
                          placeholder="Leave blank to use phone number"
                          value={newVendor.password}
                          onChange={(event) => setNewVendor({ ...newVendor, password: event.target.value })}
                        />
                      </div>
                    </label>

                    <label className="sales-field-labeled">
                      <span>State</span>
                      <div className="sales-field-input">
                        <select
                          id="sales-new-vendor-state"
                          name="state"
                          required
                          value={newVendor.state}
                          onChange={(event) => setNewVendor({ ...newVendor, state: event.target.value })}
                        >
                          <option value="">Select state</option>
                          {INDIAN_STATES.map((state) => (
                            <option key={state} value={state}>{state}</option>
                          ))}
                        </select>
                      </div>
                    </label>

                    <div className="sales-field-labeled">
                      <span>Shop location (optional)</span>
                      <button
                        type="button"
                        className={`sales-location-button${newVendorLocation ? ' captured' : ''}`}
                        onClick={captureVendorLocation}
                        disabled={locatingVendor}
                      >
                        <Icon path={ICONS.target} className="sales-field-icon" />
                        {locatingVendor ? 'Detecting...' : newVendorLocation ? 'Location captured' : 'Capture shop location'}
                        {newVendorLocation && !locatingVendor && <Icon path={ICONS.check} className="sales-field-icon" />}
                      </button>
                      <div className="sales-field-input">
                        <input
                          aria-label="Shop coordinates"
                          inputMode="decimal"
                          placeholder="Or paste coordinates: 18.5204, 73.8567"
                          value={coordsText}
                          onChange={(event) => { setCoordsText(event.target.value); setNewVendorLocation(null); }}
                          onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); applyCoordsText(); } }}
                        />
                        <button type="button" className="sales-cancel-button" disabled={!coordsText.trim()} onClick={applyCoordsText}>Use</button>
                      </div>
                      {vendorLocationError && <small className="sales-field-error">{vendorLocationError}</small>}
                    </div>

                    <label className="sales-field-labeled">
                      <span>Shop photo (optional)</span>
                      <div className="sales-field-input">
                        <Icon path={ICONS.camera} className="sales-field-icon" />
                        <input type="file" accept="image/jpeg,image/png" onChange={(event) => handlePhotoSelect('shop', event)} />
                      </div>
                      {shopPhotoPreview && <img src={shopPhotoPreview} alt="Shop preview" className="sales-photo-preview" />}
                    </label>

                    <label className="sales-field-labeled">
                      <span>QR placement photo (optional)</span>
                      <div className="sales-field-input">
                        <Icon path={ICONS.camera} className="sales-field-icon" />
                        <input type="file" accept="image/jpeg,image/png" onChange={(event) => handlePhotoSelect('qr-placement', event)} />
                      </div>
                      {qrPlacementPhotoPreview && <img src={qrPlacementPhotoPreview} alt="QR placement preview" className="sales-photo-preview" />}
                    </label>

                    <div className="sales-create-vendor-actions">
                      <button type="submit" className="sales-primary-button" disabled={loading}>
                        {loading ? 'Creating...' : 'Create Solar Mitra'}
                        {!loading && <Icon path={ICONS.check} className="sales-button-icon" />}
                      </button>
                      <button
                        type="button"
                        className="sales-cancel-button"
                        onClick={() => {
                          setShowCreateVendor(false);
                          resetOnboardingCapture();
                        }}
                        disabled={loading}
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                )}
              </article>

              <article className="sales-card sales-card-wide">
                <div className="sales-card-header">
                  <div className="sales-card-icon">
                    <Icon path={ICONS.target} />
                  </div>
                  <div>
                    <span className="sales-card-label">ANY TIME</span>
                    <h2>Complete Solar Mitra onboarding</h2>
                  </div>
                </div>

                <p className="sales-card-description">
                  Missing a Solar Mitra&apos;s shop location or photos from
                  when they were created? Add them here.
                </p>

                {!showCompleteOnboarding ? (
                  <button
                    type="button"
                    className="sales-primary-button"
                    onClick={() => {
                      setShowCreateVendor(false);
                      resetOnboardingCapture();
                      setShowCompleteOnboarding(true);
                    }}
                  >
                    Complete onboarding
                    <Icon path={ICONS.plus} className="sales-button-icon" />
                  </button>
                ) : (
                  <div className="sales-work-form">
                    <div className="sales-field-labeled">
                      <span>Solar Mitra</span>
                      <div className="sales-field-input">
                        <Icon path={ICONS.store} className="sales-field-icon" />
                        <VendorPicker
                          fetchPage={fetchOnboardingVendors}
                          recentCount={SALES_PICKER_RECENT}
                          value={completeVendorId}
                          onChange={(id) => setCompleteVendorId(id)}
                          ariaLabel="Solar Mitra to complete onboarding for"
                        />
                      </div>
                    </div>

                    <div className="sales-field-labeled">
                      <span>Shop location</span>
                      <button
                        type="button"
                        className={`sales-location-button${newVendorLocation ? ' captured' : ''}`}
                        onClick={captureVendorLocation}
                        disabled={locatingVendor || !completeVendorId}
                      >
                        <Icon path={ICONS.target} className="sales-field-icon" />
                        {locatingVendor ? 'Detecting...' : newVendorLocation ? 'Location captured' : 'Capture shop location'}
                      </button>
                      <div className="sales-field-input">
                        <input
                          aria-label="Shop coordinates"
                          inputMode="decimal"
                          placeholder="Or paste coordinates: 18.5204, 73.8567"
                          value={coordsText}
                          onChange={(event) => { setCoordsText(event.target.value); setNewVendorLocation(null); }}
                          onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); applyCoordsText(); } }}
                        />
                        <button type="button" className="sales-cancel-button" disabled={!coordsText.trim() || !completeVendorId} onClick={applyCoordsText}>Use</button>
                      </div>
                      {vendorLocationError && <small className="sales-field-error">{vendorLocationError}</small>}
                      {newVendorLocation && (
                        <button type="button" className="sales-primary-button" disabled={loading} onClick={completeOnboardingLocation}>
                          Save location
                        </button>
                      )}
                    </div>

                    <label className="sales-field-labeled">
                      <span>Shop photo</span>
                      <div className="sales-field-input">
                        <Icon path={ICONS.camera} className="sales-field-icon" />
                        <input type="file" accept="image/jpeg,image/png" disabled={!completeVendorId} onChange={(event) => handlePhotoSelect('shop', event)} />
                      </div>
                      {shopPhotoPreview && <img src={shopPhotoPreview} alt="Shop preview" className="sales-photo-preview" />}
                      {shopPhotoFile && (
                        <button type="button" className="sales-primary-button" disabled={loading} onClick={() => completeOnboardingPhoto('shop')}>
                          Save shop photo
                        </button>
                      )}
                    </label>

                    <label className="sales-field-labeled">
                      <span>QR placement photo</span>
                      <div className="sales-field-input">
                        <Icon path={ICONS.camera} className="sales-field-icon" />
                        <input type="file" accept="image/jpeg,image/png" disabled={!completeVendorId} onChange={(event) => handlePhotoSelect('qr-placement', event)} />
                      </div>
                      {qrPlacementPhotoPreview && <img src={qrPlacementPhotoPreview} alt="QR placement preview" className="sales-photo-preview" />}
                      {qrPlacementPhotoFile && (
                        <button type="button" className="sales-primary-button" disabled={loading} onClick={() => completeOnboardingPhoto('qr-placement')}>
                          Save QR placement photo
                        </button>
                      )}
                    </label>

                    <SalesBankForm vendorId={completeVendorId} />

                    <div className="sales-create-vendor-actions">
                      <button
                        type="button"
                        className="sales-cancel-button"
                        onClick={() => {
                          setShowCompleteOnboarding(false);
                          setCompleteVendorId('');
                          resetOnboardingCapture();
                        }}
                        disabled={loading}
                      >
                        Done
                      </button>
                    </div>
                  </div>
                )}
              </article>
            </section>

            {showScanner && (
              <QrScanner onDetected={handleScanDetected} onClose={() => setShowScanner(false)} />
            )}

            {message && messageType === 'error' && (
              <div className="sales-message error" role="status">
                <Icon path={ICONS.alert} />
                <span>{message}</span>
              </div>
            )}

            {showSuccessOverlay && (
              <div
                className="sales-success-overlay"
                role="status"
                onClick={() => {
                  setShowSuccessOverlay(false);
                  setMessage('');
                  setMessageType('');
                }}
              >
                <div className="sales-success-card">
                  <svg
                    className="sales-success-check"
                    viewBox="0 0 52 52"
                  >
                    <circle
                      className="sales-success-check-circle"
                      cx="26"
                      cy="26"
                      r="24"
                      fill="none"
                    />
                    <path
                      className="sales-success-check-mark"
                      fill="none"
                      d="M14 27l7 7 17-17"
                    />
                  </svg>
                  <p>{message}</p>
                </div>
              </div>
            )}

            <footer className="sales-footer">
              <span className="sales-brand"><img className="sales-logo" src="/Sol_logo.jpg" alt="Solarium" /></span>

              <span>Sales workspace</span>
            </footer>
          </>
        )}
      </main>
    </div>
  );
}

export default SalesPage;