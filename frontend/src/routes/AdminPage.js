// AdminPage.js

import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { parse as parseCsv } from 'csv-parse/browser/esm/sync';
import { apiRequest, API_BASE_URL, downloadFile, clearApiCache } from '../api/client';
import { INDIAN_STATES } from '../constants/indian-states';
import { SkeletonBlock } from '../components/Skeleton';
import VendorPicker from '../components/VendorPicker';
import BatchProgressModal from '../components/BatchProgressModal';
import AutoPosterModal from '../components/AutoPosterModal';
import SessionExpiryGuard from '../components/SessionExpiryGuard';
import { RolesPanel, LeadWorkPanel } from './AdminAccess';
import ExportRangeButton from '../components/ExportRangeButton';
import {
  BATCH_TIMEOUT_MS,
  LEAD_BATCH_SIZE,
  MAX_BULK_ROWS,
  VENDOR_BATCH_SIZE,
  mergeLeadRun,
  mergeVendorRun,
  runBatches,
  toLeadUploadItem,
  verifyLeadBatch,
  verifyVendorBatch,
} from '../lib/batch-upload';
import './AdminPage.css';

// Rows-per-page choices for the big tables. Default is 10. The choice lives only in React state, so
// it survives moving between tables but resets to 10 on refresh or when the tab is closed.
const PAGE_SIZE_OPTIONS = [10, 25, 50, 100, 200];
const DEFAULT_PAGE_SIZE = 10;
// Batches above this many QR codes download as a ZIP of PDFs this size (mirrors the backend's PDF_CHUNK_PAGES).
const PRINT_PDF_CHUNK_PAGES = 50;
const PAGE_SIZE_RESOURCES = ['vendors', 'leads', 'qr', 'scans', 'payouts', 'audit-logs', 'print-history'];

// All-time ratio for the dashboard: one decimal, "—" when there is nothing to divide by.
function formatRatio(part, whole) {
  return whole > 0 ? `${((part / whole) * 100).toFixed(1)}%` : '—';
}

const ICONS = {
  dashboard: 'M4 4h6v6H4V4Zm10 0h6v6h-6V4ZM4 14h6v6H4v-6Zm10 0h6v6h-6v-6Z',
  store: 'M4 10h16v10H4V10Zm2 0V6h12v4M3 10h18',
  qr: 'M4 4h6v6H4V4Zm10 0h6v6h-6V4ZM4 14h6v6H4v-6Zm10 1h2v2h-2v-2Zm3-1h3v3h-3v-3Zm-3 4h2v2h-2v-2Z',
  users: 'M16 20v-1.5c0-2.2-1.8-4-4-4H7c-2.2 0-4 1.8-4 4V20m6-9a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm7-6a3 3 0 0 1 0 6m2 9v-1.5a4 4 0 0 0-3-3.9',
  'vendor-applications': 'M16 20v-1.5c0-2.2-1.8-4-4-4H7c-2.2 0-4 1.8-4 4V20m6-9a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm5 2 2 2 4-4',
  lead: 'M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Zm3 4h8M8 12h8M8 16h5',
  scan: 'M4 7V5a1 1 0 0 1 1-1h2m11 3V5a1 1 0 0 0-1-1h-2M4 17v2a1 1 0 0 0 1 1h2m11-3v2a1 1 0 0 1-1 1h-2M8 8h8v8H8V8Z',
  money: 'M12 2v20m4-16c-.7-1-2.1-2-4-2-2.8 0-4.5 1.4-4.5 3.4 0 5.1 9 2.1 9 6.6 0 2-1.7 3.4-4.5 3.4-2 0-3.6-.9-4.5-2',
  audit: 'M4 4h16v16H4V4Zm4 4h8M8 12h8M8 16h5',
  settings: 'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm8-3.5-1.5-.5a7 7 0 0 0-.6-1.5l.7-1.4-1.8-1.8-1.4.7a7 7 0 0 0-1.5-.6L13.5 5h-3l-.4 1.5a7 7 0 0 0-1.5.6l-1.4-.7-1.8 1.8.7 1.4a7 7 0 0 0-.6 1.5L4 12v3l1.5.4a7 7 0 0 0 .6 1.5l-.7 1.4 1.8 1.8 1.4-.7a7 7 0 0 0 1.5.6l.4 1.5h3l.4-1.5a7 7 0 0 0 1.5-.6l1.4.7 1.8-1.8-.7-1.4a7 7 0 0 0 .6-1.5L20 15v-3Z',
  logout: 'M10 17l5-5-5-5m5 5H3m10-8h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4',
  menu: 'M4 7h16M4 12h16M4 17h16',
  close: 'M6 6l12 12M18 6 6 18',
  search: 'm20 20-4.5-4.5m2-5.5a7.5 7.5 0 1 1-15 0 7.5 7.5 0 0 1 15 0Z',
  plus: 'M12 5v14M5 12h14',
  refresh: 'M20 11a8 8 0 1 0 2 5m-2-5v-5m0 5h-5',
  arrow: 'M5 12h13m0 0-5-5m5 5-5 5',
  check: 'm5 12 4 4L19 6',
  alert: 'M12 9v4m0 4h.01M10.3 3.7 2.5 18a2 2 0 0 0 1.7 3h15.6a2 2 0 0 0 1.7-3L13.7 3.7a2 2 0 0 0-3.4 0Z',
  filter: 'M4 5h16M7 12h10M10 19h4',
  eye: 'M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Zm10 2.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z',
  edit: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4L16.5 3.5Z',
  camera: 'M4 8a2 2 0 0 1 2-2h1l1.2-2h7.6L17 6h1a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8Zm8 3a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z',
  target: 'M12 2v3m0 14v3M2 12h3m14 0h3M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z',
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

// Admin's own bank-details editor, used inside the Solar Mitra Details modal. Unlike Sales'
// equivalent form (SalesBankForm in SalesPage.js), Admin is never locked out once details exist —
// this is the one place that can still fix a mistake or replace a document afterward.
const EMPTY_ADMIN_BANK = { upi_number: '', upi_id: '', account_holder_name: '', account_number: '', ifsc_code: '' };

function AdminBankForm({ vendorId }) {
  const [bank, setBank] = useState(EMPTY_ADMIN_BANK);
  const [docs, setDocs] = useState({ passbook: null, cheque: null });
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState({ text: '', error: false });
  const [confirmDeleteDoc, setConfirmDeleteDoc] = useState(null); // 'passbook' | 'cheque' | null

  const load = useCallback(() => {
    if (!vendorId) return undefined;
    let active = true;
    apiRequest(`/admin/vendors/${vendorId}/bank-details`, { forceRefresh: true })
      .then((result) => {
        if (!active) return;
        const d = result.bank_details;
        setBank(d ? {
          upi_number: d.upiNumber || '',
          upi_id: d.upiId || '',
          account_holder_name: d.accountHolderName || '',
          account_number: d.accountNumber || '',
          ifsc_code: d.ifscCode || '',
        } : EMPTY_ADMIN_BANK);
        setDocs({
          passbook: d?.passbookFileName ? { name: d.passbookFileName, url: d.passbookUrl } : null,
          cheque: d?.chequeFileName ? { name: d.chequeFileName, url: d.chequeUrl } : null,
        });
      })
      .catch(() => {});
    return () => { active = false; };
  }, [vendorId]);

  useEffect(() => {
    setBank(EMPTY_ADMIN_BANK);
    setDocs({ passbook: null, cheque: null });
    setNote({ text: '', error: false });
    setConfirmDeleteDoc(null);
    return load();
  }, [load]);

  async function save() {
    setBusy(true);
    try {
      await apiRequest(`/admin/vendors/${vendorId}/bank-details`, { method: 'PATCH', body: JSON.stringify(bank) });
      setNote({ text: 'Bank details saved.', error: false });
    } catch (error) {
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
      await apiRequest(`/admin/vendors/${vendorId}/bank-details/${type}`, { method: 'POST', body });
      setNote({ text: `${type === 'passbook' ? 'Passbook' : 'Cancelled cheque'} uploaded.`, error: false });
      load(); // refresh the filename and the signed "Open" link for the new document
    } catch (error) {
      setNote({ text: error.message || 'Unable to upload document.', error: true });
    } finally {
      setBusy(false);
    }
  }

  async function deleteDoc(type) {
    setConfirmDeleteDoc(null);
    setBusy(true);
    try {
      const result = await apiRequest(`/admin/vendors/${vendorId}/bank-details/${type}/delete`, { method: 'POST', body: '{}' });
      setNote(result.warning
        ? { text: result.warning, error: true } // DB was cleared; the storage file may be orphaned — see server logs
        : { text: `${type === 'passbook' ? 'Passbook' : 'Cancelled cheque'} deleted.`, error: false });
      load(); // the deleted doc's filename/"Open" link disappear once this resolves
    } catch (error) {
      setNote({ text: error.message || 'Unable to delete document.', error: true });
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

  return (
    <div>
      <div className="admin-form-grid">
        {fields.map(([key, label, placeholder]) => (
          <label className="admin-form-field" key={key}>
            <span>{label}</span>
            <input
              placeholder={placeholder || label}
              disabled={busy}
              value={bank[key]}
              onChange={(event) => setBank({ ...bank, [key]: key === 'ifsc_code' ? event.target.value.toUpperCase() : event.target.value })}
            />
          </label>
        ))}
      </div>
      <div className="admin-form-actions">
        <button type="button" className="admin-primary-button" disabled={busy} onClick={save}>
          {busy ? 'Saving...' : 'Save bank details'}
        </button>
      </div>
      {[['passbook', 'Passbook'], ['cheque', 'Cancelled cheque']].map(([type, label]) => (
        <label className="admin-form-field" key={type} style={{ marginTop: '10px' }}>
          <span>{label} (PDF/JPG/PNG, max 200 KB){docs[type] ? ` - uploaded: ${docs[type].name}` : ''}</span>
          <input type="file" accept="application/pdf,image/jpeg,image/png" disabled={busy} onChange={(event) => { upload(type, event.target.files?.[0]); event.target.value = ''; }} />
        </label>
      ))}
      {(docs.passbook || docs.cheque) && (
        <div className="admin-row-actions" style={{ marginTop: '8px', flexWrap: 'wrap' }}>
          {[['passbook', 'Open passbook'], ['cheque', 'Open cancelled cheque']].map(([type, openLabel]) => (
            docs[type] && (
              <span key={type} className="admin-row-actions" style={{ padding: 0 }}>
                {docs[type].url && <a className="admin-mini-button" href={docs[type].url} target="_blank" rel="noreferrer">{openLabel}</a>}
                {confirmDeleteDoc === type ? (
                  <span className="admin-inline-confirm">
                    <button type="button" className="admin-mini-button danger solid" disabled={busy} onClick={() => deleteDoc(type)}>Confirm</button>
                    <button type="button" className="admin-mini-button admin-inline-confirm-cancel" disabled={busy} onClick={() => setConfirmDeleteDoc(null)} aria-label="Cancel delete">
                      <Icon path={ICONS.close} />
                    </button>
                  </span>
                ) : (
                  <button type="button" className="admin-mini-button danger" disabled={busy} onClick={() => setConfirmDeleteDoc(type)}>
                    Delete {type === 'passbook' ? 'passbook' : 'cancelled cheque'}
                  </button>
                )}
              </span>
            )
          ))}
        </div>
      )}
      {note.text && <small className={note.error ? 'admin-field-error' : ''} role={note.error ? 'alert' : 'status'} style={{ display: 'block', marginTop: '8px' }}>{note.text}</small>}
    </div>
  );
}

function parseBulkVendorNames(text) {
  const seen = new Set();
  const names = [];
  for (const raw of text.split(/\r\n|\r|\n/)) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(trimmed);
  }
  return names;
}

const PROTECTED_DIRECT_VENDOR_LOGINS = new Set(['company-import', 'public-general']);

function isProtectedDirectVendor(vendor) {
  return PROTECTED_DIRECT_VENDOR_LOGINS.has(vendor.loginIdentifier);
}

// Keep in sync with backend/src/lib/qr-artwork-limits.js (the backend stays authoritative).
const QR_ARTWORK_MAX_MB = 8;
const QR_ARTWORK_TYPES = ['image/png', 'image/jpeg', 'application/pdf'];

// Server-side, paginated Solar Mitra lookup for the assign/reassign pickers. forceRefresh
// keeps it uncached, so a Solar Mitra created or assigned a moment ago is always current.
function fetchAssignableVendors(search, page, limit) {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (search) params.set('search', search);
  return apiRequest(`/admin/vendors/lookup?${params.toString()}`, { forceRefresh: true });
}

const BULK_VENDOR_NAME_HEADERS = ['name', 'business_name', 'business name', 'solar mitra', 'solar mitra name'];

// Unlike phone/password (matched by prefix, forgiving of e.g. "phone number"), these financial
// columns are matched by exact alias only — a prefix match risks misreading a near-miss header
// like "account_number_backup" as the real column.
const BULK_VENDOR_BANK_FIELD_ALIASES = {
  upi_number: ['upi_number', 'upi number'],
  upi_id: ['upi_id', 'upi id'],
  account_holder_name: ['account_holder_name', 'account holder name', 'account holder'],
  account_number: ['account_number', 'account number'],
  ifsc_code: ['ifsc_code', 'ifsc', 'ifsc code'],
};

// Parses a pasted or uploaded list into { name, phone, password, upi_number, upi_id,
// account_holder_name, account_number, ifsc_code } rows. Handles CSV and the tab-separated text
// a spreadsheet paste produces, quoted cells (a name may contain a comma), an optional header
// row, and a header like `password=phonenumber` (matched by prefix). A line with a single cell
// is a name with no phone. The 5 bank fields are only ever read from a matching header column —
// there is no positional fallback for them, so a CSV with no header simply leaves them blank.
// Rows are not de-duplicated here — the backend reports duplicates with their row numbers.
function parseBulkVendorRows(text) {
  let records;
  try {
    records = parseCsv(text, {
      delimiter: [',', '\t'],
      relax_column_count: true,
      relax_quotes: true,
      skip_empty_lines: true,
      trim: true,
      bom: true,
    });
  } catch (error) {
    return { rows: [], error: 'Could not read this list — check for an unclosed quote.' };
  }

  let nameIndex = 0;
  let phoneIndex = 1;
  let passwordIndex = 2;
  const bankIndex = { upi_number: -1, upi_id: -1, account_holder_name: -1, account_number: -1, ifsc_code: -1 };
  if (records.length && BULK_VENDOR_NAME_HEADERS.includes(String(records[0][0] || '').toLowerCase())) {
    const header = records.shift().map((cell) => String(cell || '').trim().toLowerCase());
    const phoneColumn = header.findIndex((cell) => cell.startsWith('phone') || cell.startsWith('mobile'));
    const passwordColumn = header.findIndex((cell) => cell.startsWith('password'));
    if (phoneColumn !== -1) phoneIndex = phoneColumn;
    if (passwordColumn !== -1) passwordIndex = passwordColumn;
    for (const field of Object.keys(bankIndex)) {
      bankIndex[field] = header.findIndex((cell) => BULK_VENDOR_BANK_FIELD_ALIASES[field].includes(cell));
    }
  }

  const rows = records
    .map((cells) => {
      const row = {
        name: String(cells[nameIndex] || '').trim(),
        phone: String(cells[phoneIndex] || '').trim(),
        password: String(cells[passwordIndex] || '').trim(),
      };
      for (const [field, index] of Object.entries(bankIndex)) {
        row[field] = index === -1 ? '' : String(cells[index] || '').trim();
      }
      return row;
    })
    .filter((row) => row.name || row.phone)
    // A second uploaded file appended below the first repeats its header row mid-list.
    .filter((row) => !(BULK_VENDOR_NAME_HEADERS.includes(row.name.toLowerCase()) && /^(phone|mobile)/i.test(row.phone)));
  return { rows, error: '' };
}

const BULK_VENDOR_FAILURE_LABELS = {
  MOBILE_REQUIRED: 'Phone number missing',
  INVALID_MOBILE_NUMBER: 'Invalid phone number',
  PHONE_ALREADY_USED: 'Phone number already used',
  PASSWORD_TOO_SHORT: 'Password under 8 characters',
  LOGIN_IDENTIFIER_TAKEN: 'Login ID already taken',
};

// A 2,000-row result can hold thousands of entries; only this many are listed (the counts are always complete).
const RESULT_LIST_LIMIT = 200;

const BULK_VENDOR_BANK_FIELD_LABELS = {
  upi_number: 'UPI number',
  upi_id: 'UPI ID',
  account_holder_name: 'Account holder name',
  account_number: 'Account number',
  ifsc_code: 'IFSC code',
};

const NAV_ITEMS = [
  ['dashboard', 'Dashboard'],
  ['vendors', 'Solar Mitras'],
  ['vendor-applications', 'Solar Mitra Applications'],
  ['qr', 'QR Management'],
  ['print-qr', 'Print QR Codes'],
  ['templates', 'Templates'],
  ['print-history', 'Print History'],
  ['leads', 'Leads'],
  ['scans', 'Scans'],
  ['payouts', 'Commissions'],
  ['users', 'Staff Users'],
  ['audit-logs', 'Audit Logs'],
];

// Permission that opens each screen for a custom-role (STAFF) user. A screen not listed here (printing,
// templates, staff, audit logs) is for the super-admin only. The backend enforces the same rules.
const NAV_PERMISSION = {
  dashboard: 'dashboard.view',
  vendors: 'vendors.view',
  'vendor-applications': 'applications.view',
  qr: 'qr.view',
  leads: 'leads.view',
  scans: 'scans.view',
  payouts: 'payouts.view',
};

const LEAD_STATUS_OPTIONS = ['NEW', 'CONTACTED', 'QUALIFIED', 'CONVERTED', 'LOST', 'REJECTED', 'DUPLICATE'];

const canUse = (account, permission) =>
  account?.role === 'ADMIN' || Boolean(account?.permissions?.includes(permission));

const landingResource = (account) =>
  NAV_ITEMS.map(([key]) => key).find((key) => (account?.role === 'ADMIN' ? true : NAV_PERMISSION[key] && canUse(account, NAV_PERMISSION[key]))) || null;

// Users screen: one selector for the account type. "SALES" and "ADMIN" are the fixed types; every custom
// role is "role:<id>" and creates a STAFF user.
const ACCOUNT_TYPE_SALES = 'SALES';
const accountTypeOf = (user) => (user.role === 'STAFF' ? `role:${user.staffRoleId}` : user.role);
const accountTypePayload = (value) => (value.startsWith('role:') ? { role: 'STAFF', staff_role_id: value.slice(5) } : { role: value });

function AdminPage() {
  const [login, setLogin] = useState({
    identifier: '',
    password: '',
  });

  const [portalData, setPortalData] = useState(null);
  const can = (permission) => canUse(portalData?.account, permission);
  // The signed-in account as of the latest sign-in/restore (state is not updated yet inside the first load).
  const accountRef = useRef(null);
  const [accessRoles, setAccessRoles] = useState([]);
  const [permissionCatalog, setPermissionCatalog] = useState([]);
  const [assignableStaff, setAssignableStaff] = useState([]);
  const [leadAssignFilter, setLeadAssignFilter] = useState('');
  const leadAssignFilterRef = useRef('');
  const [leadStatusFilter, setLeadStatusFilter] = useState('');
  const leadStatusFilterRef = useRef('');
  const [selectedLeadIds, setSelectedLeadIds] = useState([]);
  const [bulkAssignee, setBulkAssignee] = useState('');
  // Distinguishes "still checking whether a session cookie is valid" from "confirmed logged
  // out" — without this, the login form flashes on every page load/reload for an already
  // signed-in Admin while restoreSession()'s request is in flight (worse the slower the
  // backend is, e.g. a cold Render instance waking up), before silently swapping to the
  // dashboard. Shows a skeleton instead of that flash.
  const [sessionChecked, setSessionChecked] = useState(false);
  // Latest `retention` object from whichever admin resource last loaded (dashboard or
  // audit-logs, the only two endpoints that return it) — drives both the blocking
  // "export before it gets deleted" modal and the informational at-capacity note.
  const [retentionStatus, setRetentionStatus] = useState(null);
  const [retentionExportState, setRetentionExportState] = useState({ loading: false, error: '' });
  const [resource, setResource] = useState('dashboard');
  // Scoped to switching resources specifically (sidebar nav clicks), not every filter change,
  // pagination click, or Refresh — those already show their own loading state on the button and
  // switching skeletons under them would be more distracting than helpful. Without this, clicking
  // a sidebar item briefly rendered an empty "No leads yet" (etc.) state while the new resource's
  // data was still in flight, which looked like a bug rather than a load in progress.
  const [resourceLoading, setResourceLoading] = useState(false);
  const [adminPage, setAdminPage] = useState(1);
  // Public "Apply for Solar Mitra" applications: status filter (ref = what the loader reads), the count
  // shown on the sidebar item, and the row being approved/rejected.
  const [applicationStatus, setApplicationStatus] = useState('PENDING');
  const applicationStatusRef = useRef('PENDING');
  const [pendingApplications, setPendingApplications] = useState(0);
  const [applicationBusyId, setApplicationBusyId] = useState('');
  const [rejectingApplicationId, setRejectingApplicationId] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [applicationStates, setApplicationStates] = useState({});
  const [printWizardStep, setPrintWizardStep] = useState(1);
  const [printWizardMode, setPrintWizardMode] = useState('range');
  const [printWizardDraft, setPrintWizardDraft] = useState({ range_start: '', range_end: '', code: '', template_id: '' });
  const [printWizardJob, setPrintWizardJob] = useState(null);
  const [printWizardBusy, setPrintWizardBusy] = useState(false);
  // Batch idempotency: one nonce per NEW batch (openPrintWizard / printGeneratedCodes). A retry of the
  // same batch reuses the key, so double clicks and retries can never create two jobs. busyRef is the
  // same-tick click lock (state updates are async, so a fast second click would slip past `disabled`).
  const printBatchNonceRef = useRef('');
  const printBusyRef = useRef(false);
  const [printDone, setPrintDone] = useState(false);
  // QR Management's own "Generate QR codes" panel — a plain quantity batch (POST /admin/qr/generate,
  // unchanged), so an admin can build up inventory (e.g. 100-200 codes) before ever opening the
  // Print QR Codes wizard, then jump straight into it with that exact range pre-filled.
  const [showGenerateQr, setShowGenerateQr] = useState(false);
  const [generateQrQuantity, setGenerateQrQuantity] = useState('100');
  const [generateQrBusy, setGenerateQrBusy] = useState(false);
  const [generateQrResult, setGenerateQrResult] = useState(null);
  // Step 1's live existing-vs-missing gap check (debounced) and its own request-sequence guard,
  // same stale-response pattern VendorPicker uses, so a slow older check can't overwrite a newer one.
  const [printRangeCheck, setPrintRangeCheck] = useState({ loading: false, checked: false, total: 0, existingCount: 0, missingCount: 0, error: '' });
  const [printGenerateBusy, setPrintGenerateBusy] = useState(false);
  const printRangeCheckSeq = useRef(0);
  const printProofAttemptRef = useRef(null);
  // Step 3's real proof/preview for a template job: the actual generated PDF, not an approximation.
  const [printProofState, setPrintProofState] = useState({ loading: false, error: '', url: '', ready: false });


  // Separate state per table: one shared box is how a query typed in one view leaks into another.
  const [vendorSearch, setVendorSearch] = useState('');
  const [leadSearch, setLeadSearch] = useState('');
  const vendorSearchRef = useRef('');
  const vendorSearchMounted = useRef(false);
  const adminLoadSeq = useRef(0);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const pageSizeRef = useRef(pageSize);
  // Result of the QR inventory check (POST /admin/qr/repair-status with dry_run), if the admin ran it.
  const [qrRepair, setQrRepair] = useState(null);
  const [qrStatus, setQrStatus] = useState('');
  const [qrAssignment, setQrAssignment] = useState('');

  const [showCreateVendor, setShowCreateVendor] = useState(false);
  const [showBulkCreateVendors, setShowBulkCreateVendors] = useState(false);
  const [showAutoPosters, setShowAutoPosters] = useState(false);
  const [bulkVendorNamesText, setBulkVendorNamesText] = useState('');
  const [bulkVendorAutoPassword, setBulkVendorAutoPassword] = useState(false);
  // Batch metadata, not row data: one state applied to every Vendor this bulk create makes.
  const [bulkVendorState, setBulkVendorState] = useState('');
  const [bulkVendorResult, setBulkVendorResult] = useState(null);
  // Set while a bulk upload is being sent in batches; drives the do-not-close popup.
  const [batchProgress, setBatchProgress] = useState(null);
  const [showImportLeads, setShowImportLeads] = useState(false);
  const [importFile, setImportFile] = useState(null);
  const [importResult, setImportResult] = useState(null);
  const [showTemplateForm, setShowTemplateForm] = useState(false);
  const [showCreateStaff, setShowCreateStaff] = useState(false);

  const [newVendor, setNewVendor] = useState({
    business_name: '',
    owner_name: '',
    login_identifier: '',
    mobile_number: '',
    password: '',
    state: '',
  });
  // Solar Mitra state filter — server-side, same debounced-reload pattern as vendorSearch below.
  const [vendorStateFilter, setVendorStateFilter] = useState('');
  const vendorStateFilterRef = useRef('');
  const [newVendorLocation, setNewVendorLocation] = useState(null);
  const [newVendorCoordsText, setNewVendorCoordsText] = useState('');
  const [vendorLocationError, setVendorLocationError] = useState('');
  const [shopPhotoFile, setShopPhotoFile] = useState(null);
  const [qrPlacementPhotoFile, setQrPlacementPhotoFile] = useState(null);
  const [shopPhotoPreview, setShopPhotoPreview] = useState('');
  const [qrPlacementPhotoPreview, setQrPlacementPhotoPreview] = useState('');
  const [detailOnboardingMedia, setDetailOnboardingMedia] = useState(null);
  const [mediaCoordsText, setMediaCoordsText] = useState('');
  const [mediaLocationError, setMediaLocationError] = useState('');

  const [newStaffUser, setNewStaffUser] = useState({
    name: '',
    username_or_mobile: '',
    password: '',
    role: 'SALES',
  });

  const [qrTemplates, setQrTemplates] = useState([]);
  const [templateDraft, setTemplateDraft] = useState({
    name: 'Solar Mitra Sticker A4',
    page_width_mm: '210',
    page_height_mm: '297',
    dpi: '300',
    qr_x: '40',
    qr_y: '60',
    qr_width: '42',
    qr_height: '42',
    label_enabled: false,
    label_text_x: '0',
    label_text_y: '0',
    label_font_size: '12',
  });
  const [templateArtwork, setTemplateArtwork] = useState(null);
  const [templateArtworkPreview, setTemplateArtworkPreview] = useState('');
  const [templateInteraction, setTemplateInteraction] = useState(null);
  const [confirmDeleteTemplateId, setConfirmDeleteTemplateId] = useState(null);
  const [confirmArchiveTemplateId, setConfirmArchiveTemplateId] = useState(null);
  const [previewTemplate, setPreviewTemplate] = useState(null);
  const [reassignVendorInputs, setReassignVendorInputs] = useState({});
  const [confirmDeleteQrId, setConfirmDeleteQrId] = useState(null);
  const [confirmPurgeQrId, setConfirmPurgeQrId] = useState(null);
  const [purgeQrConfirmText, setPurgeQrConfirmText] = useState('');
  const [confirmAssignQrId, setConfirmAssignQrId] = useState(null);

  const [paidReferenceInputs, setPaidReferenceInputs] = useState({});
  const [confirmPayoutStatusKey, setConfirmPayoutStatusKey] = useState(null);
  const [selectedVendorIds, setSelectedVendorIds] = useState([]);
  const [deletionResult, setDeletionResult] = useState(null);
  const [confirmBulkDeleteVendors, setConfirmBulkDeleteVendors] = useState(false);

  const [editingVendorId, setEditingVendorId] = useState(null);
  const [editVendorDraft, setEditVendorDraft] = useState({});
  const [confirmSaveVendorEdit, setConfirmSaveVendorEdit] = useState(false);
  const [confirmDeleteVendorId, setConfirmDeleteVendorId] = useState(null);
  const [confirmDeactivateVendorId, setConfirmDeactivateVendorId] = useState(null);
  const [confirmResetPasswordVendorId, setConfirmResetPasswordVendorId] = useState(null);
  const [confirmPurgeVendorId, setConfirmPurgeVendorId] = useState(null);
  const [purgeConfirmText, setPurgeConfirmText] = useState('');

  const [staffRoleInputs, setStaffRoleInputs] = useState({});
  const [confirmUpdateRoleId, setConfirmUpdateRoleId] = useState(null);
  const [confirmDeactivateStaffId, setConfirmDeactivateStaffId] = useState(null);

  const [detailLead, setDetailLead] = useState(null);
  const [qrPrintHistory, setQrPrintHistory] = useState(null);
  const [printHistoryFilters, setPrintHistoryFilters] = useState({ template_id: '', kind: '', code: '', vendor: '' });
  const [expandedPrintJob, setExpandedPrintJob] = useState(null);
  const [confirmDeleteLeadId, setConfirmDeleteLeadId] = useState(null);
  const [detailBank, setDetailBank] = useState(null);
  // Full Solar Mitra "Details" view: profile row + bank details + onboarding location/photos, fetched together.
  const [detailVendor, setDetailVendor] = useState(null);
  const [detailAuditLog, setDetailAuditLog] = useState(null);
  const [expandedVendorGroups, setExpandedVendorGroups] = useState({});
  const [expandedCommissionGroups, setExpandedCommissionGroups] = useState({});

  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState('');
  const [loading, setLoading] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

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
    // navigation between them) — if the admin scrolled while filling the login form, that
    // scroll position otherwise carries straight into the dashboard, landing them mid-page
    // with the sticky header overlapping content. Only fires once, on the login->dashboard
    // transition itself, not on every later data refresh.
    if (portalData && !hasScrolledToDashboardRef.current) {
      window.scrollTo(0, 0);
      hasScrolledToDashboardRef.current = true;
    }
  }, [portalData]);

  function handleTemplateArtworkSelect(event) {
    const file = event.target.files?.[0] || null;
    let problem = '';
    if (file && !QR_ARTWORK_TYPES.includes(file.type)) {
      problem = 'Upload a PNG, JPG, or single-page PDF artwork file.';
    } else if (file && file.size > QR_ARTWORK_MAX_MB * 1024 * 1024) {
      problem = `QR artwork must be ${QR_ARTWORK_MAX_MB} MB or smaller.`;
    }
    if (problem) {
      event.target.value = '';
      setTemplateArtwork(null);
      setMessage(problem);
      setMessageType('error');
      return;
    }
    setTemplateArtwork(file);
  }

  useEffect(() => {
    if (!templateArtwork) {
      setTemplateArtworkPreview('');
      return undefined;
    }
    const previewUrl = URL.createObjectURL(templateArtwork);
    setTemplateArtworkPreview(previewUrl);
    return () => URL.revokeObjectURL(previewUrl);
  }, [templateArtwork]);

  useEffect(() => {
    if (!templateInteraction) return undefined;

    function handlePointerMove(event) {
      const editor = document.querySelector('[data-qr-template-editor]');
      if (!editor) return;
      const bounds = editor.getBoundingClientRect();
      const pageWidth = Number(templateDraft.page_width_mm) || 210;
      const pageHeight = Number(templateDraft.page_height_mm) || 297;
      const scaleX = pageWidth / bounds.width;
      const scaleY = pageHeight / bounds.height;
      const deltaX = (event.clientX - templateInteraction.startX) * scaleX;
      const deltaY = (event.clientY - templateInteraction.startY) * scaleY;
      const startSize = templateInteraction.startSize;
      const nextSize = templateInteraction.mode === 'resize'
        ? Math.max(10, Math.min(pageWidth, pageHeight, startSize + Math.max(deltaX, deltaY)))
        : startSize;
      const nextX = templateInteraction.mode === 'resize'
        ? templateInteraction.startXmm
        : templateInteraction.startXmm + deltaX;
      const nextY = templateInteraction.mode === 'resize'
        ? templateInteraction.startYmm
        : templateInteraction.startYmm + deltaY;
      const clampedSize = Math.min(nextSize, pageWidth, pageHeight);
      setTemplateDraft((current) => ({
        ...current,
        qr_x: String(Math.max(0, Math.min(pageWidth - clampedSize, nextX)).toFixed(1)),
        qr_y: String(Math.max(0, Math.min(pageHeight - clampedSize, nextY)).toFixed(1)),
        qr_width: String(clampedSize.toFixed(1)),
        qr_height: String(clampedSize.toFixed(1)),
      }));
    }

    function handlePointerUp() {
      setTemplateInteraction(null);
    }

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [templateDraft.page_height_mm, templateDraft.page_width_mm, templateInteraction]);

  // Print QR Codes, Step 1: debounced live existence check as soon as a valid range/code is
  // entered. Unconditional hook (rules of hooks — renderPrintWizard is a plain conditionally
  // invoked function, not a component, so any effect it needs must live up here instead), with
  // its own request-sequence guard so a slow older check can never overwrite a newer one.
  useEffect(() => {
    if (resource !== 'print-qr' || printWizardStep !== 1) return undefined;
    const normalize = (value) => {
      const normalized = String(value || '').trim().toUpperCase();
      const match = normalized.match(/^V-(\d+)$/);
      return match ? `V-${match[1].padStart(4, '0')}` : normalized;
    };
    const start = printWizardMode === 'range' ? normalize(printWizardDraft.range_start) : normalize(printWizardDraft.code);
    const end = printWizardMode === 'range' ? normalize(printWizardDraft.range_end) : normalize(printWizardDraft.code);
    const valid = /^V-\d{4,}$/.test(start) && /^V-\d{4,}$/.test(end) && Number(start.replace(/\D/g, '')) <= Number(end.replace(/\D/g, ''));
    if (!valid) {
      setPrintRangeCheck({ loading: false, checked: false, total: 0, existingCount: 0, missingCount: 0, error: '' });
      return undefined;
    }
    const seq = printRangeCheckSeq.current + 1;
    printRangeCheckSeq.current = seq;
    setPrintRangeCheck((current) => ({ ...current, loading: true, error: '' }));
    const timer = setTimeout(() => {
      apiRequest(`/admin/qr/range-check?range_start=${encodeURIComponent(start)}&range_end=${encodeURIComponent(end)}`, { forceRefresh: true })
        .then((result) => {
          if (seq !== printRangeCheckSeq.current) return;
          setPrintRangeCheck({ loading: false, checked: true, total: result.total, existingCount: result.existingCount, missingCount: result.missingCount, error: '' });
        })
        .catch((error) => {
          if (seq !== printRangeCheckSeq.current) return;
          setPrintRangeCheck({ loading: false, checked: false, total: 0, existingCount: 0, missingCount: 0, error: error.message });
        });
    }, 300);
    return () => clearTimeout(timer);
  }, [resource, printWizardStep, printWizardMode, printWizardDraft.range_start, printWizardDraft.range_end, printWizardDraft.code]);

  // Print QR Codes, Step 3: for a template + range job, auto-generate the real proof (the same
  // composer production uses) the moment the step is entered, rather than making the admin
  // click a separate button before seeing anything. A template + single code has no persisted
  // job to proof, so this only runs for the range/template combination.
  useEffect(() => {
    if (resource !== 'print-qr' || printWizardStep !== 3) return undefined;
    if (printWizardMode === 'individual' || !printWizardDraft.template_id || !printWizardJob?.id) return undefined;
    // Ref (not state) guards this to exactly once per job id, so a failed proof doesn't loop —
    // a manual Retry in Step 3 calls runPrintProof directly, bypassing this guard.
    if (printProofAttemptRef.current === printWizardJob.id) return undefined;
    printProofAttemptRef.current = printWizardJob.id;
    runPrintProof(printWizardJob.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resource, printWizardStep, printWizardMode, printWizardDraft.template_id, printWizardJob?.id]);

  async function runPrintProof(jobId) {
    setPrintProofState({ loading: true, error: '', url: '', ready: false });
    try {
      // POST generates/refreshes the proof PDF (job.proofPath); the signed download URL comes
      // back only from the separate GET — the POST response has no proof_url field.
      const generated = await apiRequest(`/admin/qr/print-batch/${encodeURIComponent(jobId)}/proof`, { method: 'POST', body: '{}', label: 'Generating proof', dedupe: true });
      setPrintWizardJob(generated.job);
      const signed = await apiRequest(`/admin/qr/print-batch/${encodeURIComponent(jobId)}/proof`, { forceRefresh: true });
      setPrintProofState({ loading: false, error: '', url: signed.proof_url, ready: true });
    } catch (error) {
      setPrintProofState({ loading: false, error: error.message, url: '', ready: false });
    }
  }

  useEffect(() => {
    restoreSession();

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function restoreSession() {
    try {
      const session = await apiRequest('/auth/session?portal=admin');

      if (!mountedRef.current || !['ADMIN', 'STAFF'].includes(session.role)) return;

      setPortalData({
        account: session.account,
        data: null,
      });

      await openLanding(session.account);
    } catch (error) {
      // No active Admin session.
    } finally {
      if (mountedRef.current) setSessionChecked(true);
    }
  }

  // A custom role may not include the dashboard: open the first screen it can use instead.
  async function openLanding(account) {
    accountRef.current = account;
    const first = landingResource(account);
    setResource(first || 'dashboard');
    setAdminPage(1);
    if (first) await loadAdminResource(first, 1);
  }

  async function signIn(event) {
    event.preventDefault();

    setLoading(true);
    setMessage('');
    setMessageType('');

    try {
      const result = await apiRequest('/auth/login?portal=admin', {
        method: 'POST',
        body: JSON.stringify({
          username_or_mobile: login.identifier.trim(),
          password: login.password,
        }),
      });

      if (!['ADMIN', 'STAFF'].includes(result.user?.role)) {
        throw new Error('Admin access is required.');
      }

      setPortalData({
        account: result.user,
        data: null,
      });

      await openLanding(result.user);

      setMessage('Signed in successfully.');
      setMessageType('success');
    } catch (error) {
      setMessage(error.message);
      setMessageType('error');
    } finally {
      setLoading(false);
    }
  }

  async function signOutCurrent() {
    setLoading(true);

    try {
      await apiRequest('/auth/logout?portal=admin', {
        method: 'POST',
      });
    } catch (error) {
      // Clear local state regardless.
    } finally {
      setPortalData(null);
      setLoading(false);
      setMessage('');
      setMessageType('');
    }
  }

  async function loadAdminResource(
    nextResource = resource,
    page = 1,
    statusOverride,
    assignmentOverride,
    forceRefresh = false
  ) {
    // Only the most recent load may write its result: a slow earlier response (an older
    // search, page, or a resource the admin has since left) must never overwrite a newer one.
    const seq = adminLoadSeq.current + 1;
    adminLoadSeq.current = seq;

    setLoading(true);
    if (nextResource === 'vendors') setSelectedVendorIds([]);
    if (nextResource === 'leads') setSelectedLeadIds([]);
    setMessage('');
    setMessageType('');

    try {
      const effectiveStatus =
        statusOverride !== undefined ? statusOverride : qrStatus;

      const effectiveAssignment =
        assignmentOverride !== undefined
          ? assignmentOverride
          : qrAssignment;

      if (nextResource === 'dashboard') {
        const data = await apiRequest('/admin/dashboard', { forceRefresh });

        if (!mountedRef.current || seq !== adminLoadSeq.current) return;

        setAdminPage(1);
        setPortalData((current) => ({
          ...current,
          data,
        }));
        if (data.retention) setRetentionStatus(data.retention);

        return;
      }

      const limit = PAGE_SIZE_RESOURCES.includes(nextResource) ? pageSizeRef.current : 50;
      let query = `?page=${page}&limit=${limit}`;

      if (nextResource === 'qr' && effectiveStatus) {
        query += `&status=${encodeURIComponent(effectiveStatus)}`;
      }

      if (nextResource === 'qr' && effectiveAssignment) {
        query += `&assignment=${encodeURIComponent(effectiveAssignment)}`;
      }

      // Print History reads the print-job list rather than a same-named resource endpoint.
      if (nextResource === 'print-history') {
        const filterQuery = printHistoryQuery();
        // Templates power the filter dropdown; fetched here too so opening Print History
        // directly (without visiting QR Management first) still offers the full list.
        // One after the other (templates are cached for minutes) rather than two at once.
        const data = await apiRequest(`/admin/qr/print-jobs${query}${filterQuery ? `&${filterQuery}` : ''}`, { forceRefresh, supersede: 'admin-list' });
        const templates = await apiRequest('/admin/qr/templates', { forceRefresh });
        if (!mountedRef.current || seq !== adminLoadSeq.current) return;
        setAdminPage(page);
        setExpandedPrintJob(null);
        setQrTemplates(templates.templates || []);
        setPortalData((current) => ({ ...current, data }));
        return;
      }

      if (nextResource === 'templates') {
        // Refresh also clears the browser cache (other pages keep their own copy of the template list)
        // and asks the server to skip its short cache.
        if (forceRefresh) clearApiCache();
        const data = await apiRequest(forceRefresh ? '/admin/qr/templates?refresh=1' : '/admin/qr/templates', { forceRefresh });
        if (!mountedRef.current || seq !== adminLoadSeq.current) return;
        setQrTemplates(data.templates || []);
        setPortalData((current) => ({ ...current, data }));
        return;
      }

      if (nextResource === 'print-qr') {
        const data = await apiRequest('/admin/qr/templates', { forceRefresh });
        if (!mountedRef.current || seq !== adminLoadSeq.current) return;
        setQrTemplates(data.templates || []);
        setPortalData((current) => ({ ...current, data: current?.data || {} }));
        return;
      }

      // The Solar Mitras list searches on the server, so a match on page 7 is found from page 1
      // (the previous client-side filter only ever saw the 50 rows already loaded).
      if (nextResource === 'vendors' && vendorSearchRef.current.trim()) {
        query += `&search=${encodeURIComponent(vendorSearchRef.current.trim())}`;
      }
      if (nextResource === 'vendors' && vendorStateFilterRef.current) {
        query += `&state=${encodeURIComponent(vendorStateFilterRef.current)}`;
      }

      if (nextResource === 'vendor-applications') {
        query += `&status=${encodeURIComponent(applicationStatusRef.current)}`;
      }

      if (nextResource === 'leads') {
        if (leadAssignFilterRef.current) query += `&assigned_to=${encodeURIComponent(leadAssignFilterRef.current)}`;
        if (leadStatusFilterRef.current) query += `&status=${encodeURIComponent(leadStatusFilterRef.current)}`;
      }

      const data = await apiRequest(`/admin/${nextResource}${query}`, { forceRefresh, supersede: 'admin-list' });

      if (!mountedRef.current || seq !== adminLoadSeq.current) return;

      if (nextResource === 'vendor-applications' && typeof data.pending_count === 'number') {
        setPendingApplications(data.pending_count);
      }
      setAdminPage(page);

      setPortalData((current) => ({
        ...current,
        data,
      }));
      if (data.retention) setRetentionStatus(data.retention);

      if (nextResource === 'qr' && accountRef.current?.role === 'ADMIN') {
        // Solar Mitras are no longer preloaded for the QR table: each picker searches the
        // server when it is opened, so this page no longer fetches the whole vendor list.
        // (Templates are for printing, which only the super-admin does.)
        const templates = await apiRequest('/admin/qr/templates', { forceRefresh });

        if (mountedRef.current) {
          setQrTemplates(templates.templates || []);
        }
      }

      if (nextResource === 'users') {
        const access = await apiRequest('/admin/roles', { forceRefresh: true });
        if (mountedRef.current) {
          setAccessRoles(access.roles || []);
          setPermissionCatalog(access.catalog || []);
        }
      }

      if (nextResource === 'leads' && canUse(accountRef.current, 'leads.assign')) {
        const staff = await apiRequest('/admin/staff/assignable', { forceRefresh });
        if (mountedRef.current) setAssignableStaff(staff.users || []);
      }
    } catch (error) {
      // A newer load replaced this one while it was still queued: nothing to report.
      if (error?.name === 'AbortError') return;
      if (seq === adminLoadSeq.current) {
        setMessage(error.message);
        setMessageType('error');
      }
    } finally {
      if (seq === adminLoadSeq.current) setLoading(false);
    }
  }

  // Debounced server-side reload when the Solar Mitra search changes. A new query always goes
  // back to page 1. The ref is updated first so loadAdminResource (and the Prev/Next/Refresh
  // buttons that also call it) all see the same current query.
  useEffect(() => {
    vendorSearchRef.current = vendorSearch;
    vendorStateFilterRef.current = vendorStateFilter;
    if (!vendorSearchMounted.current) {
      vendorSearchMounted.current = true;
      return undefined;
    }
    if (resource !== 'vendors') return undefined;
    const timer = setTimeout(() => loadAdminResource('vendors', 1), 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vendorSearch, vendorStateFilter]);

  // Picking a new page size returns to page 1 and keeps the current search/filters (they are read
  // from refs/state inside loadAdminResource).
  function changePageSize(nextSize) {
    if (!PAGE_SIZE_OPTIONS.includes(nextSize) || nextSize === pageSizeRef.current) return;
    pageSizeRef.current = nextSize;
    setPageSize(nextSize);
    loadAdminResource(resource, 1);
  }

  // Inventory check: a dry run reports how many codes are marked Active without a Solar Mitra; only
  // the explicit "Fix" step writes anything.
  async function checkQrInventory(apply = false) {
    setLoading(true);
    try {
      const result = await apiRequest('/admin/qr/repair-status', { method: 'POST', body: JSON.stringify({ dry_run: !apply }), label: 'Checking inventory' });
      if (apply) {
        setQrRepair(null);
        setMessage(`${result.affected} QR code${result.affected === 1 ? '' : 's'} fixed.`);
        setMessageType('success');
        await loadAdminResource('qr', 1, undefined, undefined, true);
      } else {
        setQrRepair({ affected: result.affected });
      }
    } catch (error) {
      setMessage(error.message);
      setMessageType('error');
    } finally {
      setLoading(false);
    }
  }

  // Sidebar count of applications waiting for approval, fetched once after sign-in (the list itself
  // refreshes it whenever it loads).
  const signedIn = Boolean(portalData);
  useEffect(() => {
    if (!signedIn || !can('applications.view')) return undefined;
    let cancelled = false;
    apiRequest('/admin/vendor-applications?limit=1')
      .then((data) => {
        if (!cancelled && typeof data.pending_count === 'number') setPendingApplications(data.pending_count);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn]);

  function changeApplicationStatus(nextStatus) {
    applicationStatusRef.current = nextStatus;
    setApplicationStatus(nextStatus);
    setRejectingApplicationId('');
    loadAdminResource('vendor-applications', 1);
  }

  // Approve creates the Solar Mitra (the server does it in one transaction); reject keeps the row with a reason.
  // A 409 means someone else already handled it: show that and reload, never retry.
  async function reviewApplication(application, action) {
    setApplicationBusyId(application.id);
    let notice = null;
    try {
      const body = action === 'approve'
        ? { ...(application.state ? {} : { state: applicationStates[application.id] }) }
        : { reason: rejectReason.trim() || undefined };
      await apiRequest(`/admin/vendor-applications/${application.id}/${action}`, { method: 'POST', body: JSON.stringify(body) });
      notice = {
        type: 'success',
        text: action === 'approve' ? `${application.businessName} is now a Solar Mitra. Their first password is their phone number.` : `${application.businessName}'s application was rejected.`,
      };
      setRejectingApplicationId('');
      setRejectReason('');
    } catch (error) {
      notice = { type: 'error', text: error.message };
    } finally {
      setApplicationBusyId('');
      // Reloading clears any message, so the result is shown after the list has refreshed.
      await loadAdminResource('vendor-applications', adminPage, undefined, undefined, true);
      if (notice) {
        setMessage(notice.text);
        setMessageType(notice.type);
      }
    }
  }

  function navigate(nextResource) {
    if (nextResource === 'vendor-applications') {
      applicationStatusRef.current = 'PENDING';
      setApplicationStatus('PENDING');
      setRejectingApplicationId('');
    }
    setResource(nextResource);
    setAdminPage(1);
    setVendorSearch('');
    setVendorStateFilter('');
    setLeadSearch('');
    setSelectedVendorIds([]);
    setMobileNavOpen(false);
    setResourceLoading(true);

    loadAdminResource(nextResource, 1).finally(() =>
      setResourceLoading(false)
    );
  }

  // Mirrors PublicPage.jsx's "Use my location" pattern, adapted for Admin standing at (or
  // near) the shop while onboarding — enableHighAccuracy on since precision is worth it here.
  // Admin isn't physically at the shop, so there's no GPS capture here — the coordinates are
  // typed or pasted (e.g. relayed by the Sales rep, or copied from Google Maps), usually as
  // "lat, lng". Returns { latitude, longitude } or throws a descriptive Error.
  function parseCoordsText(text) {
    const parts = text.split(',').map((part) => part.trim()).filter(Boolean);
    if (parts.length !== 2) {
      throw new Error('Enter coordinates as "latitude, longitude", e.g. 18.5204, 73.8567.');
    }
    const [latitude, longitude] = parts.map(Number);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      throw new Error('Enter coordinates as "latitude, longitude", e.g. 18.5204, 73.8567.');
    }
    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
      throw new Error('Latitude must be between -90 and 90, longitude between -180 and 180.');
    }
    return { latitude, longitude };
  }

  function applyVendorCoordsText() {
    setVendorLocationError('');
    try {
      const { latitude, longitude } = parseCoordsText(newVendorCoordsText);
      setNewVendorLocation({ latitude, longitude, accuracy: null, capturedAt: new Date().toISOString() });
    } catch (error) {
      setNewVendorLocation(null);
      setVendorLocationError(error.message);
    }
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
    setNewVendorLocation(null);
    setNewVendorCoordsText('');
    setVendorLocationError('');
    setShopPhotoFile(null);
    setQrPlacementPhotoFile(null);
    setShopPhotoPreview('');
    setQrPlacementPhotoPreview('');
  }

  async function uploadOnboardingPhoto(vendorId, kind, file) {
    const body = new FormData();
    body.append('photo', file);
    await apiRequest(`/admin/vendors/${vendorId}/photos/${kind}`, { method: 'POST', body });
  }

  async function createVendor(event) {
    event.preventDefault();

    setLoading(true);
    setMessage('');
    setMessageType('');

    try {
      const body = { ...newVendor };

      if (!body.password) {
        delete body.password;
      }
      if (newVendorLocation) {
        body.latitude = newVendorLocation.latitude;
        body.longitude = newVendorLocation.longitude;
        body.accuracy = newVendorLocation.accuracy;
        body.captured_at = newVendorLocation.capturedAt;
      }

      const result = await apiRequest('/admin/vendors', {
        method: 'POST',
        body: JSON.stringify(body),
      });
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

      setNewVendor({
        business_name: '',
        owner_name: '',
        login_identifier: '',
        mobile_number: '',
        password: '',
        state: '',
      });
      resetOnboardingCapture();

      setShowCreateVendor(false);

      await loadAdminResource('vendors', adminPage);

      if (photoFailures.length) {
        const labels = { shop: 'shop', 'qr-placement': 'QR placement' };
        setMessage(`Solar Mitra created, but the ${photoFailures.map((kind) => labels[kind]).join(' and ')} photo failed to upload — retry from its "Onboarding media" panel.`);
        setMessageType('error');
      } else {
        setMessage('Solar Mitra created.');
        setMessageType('success');
      }
    } catch (error) {
      setMessage(error.message);
      setMessageType('error');
    } finally {
      setLoading(false);
    }
  }

  async function bulkCreateVendors(event) {
    event.preventDefault();
    const { rows } = parseBulkVendorRows(bulkVendorNamesText);
    if (!rows.length || rows.length > MAX_BULK_ROWS || rows.some((row) => !row.name)) return;

    // Any phone in the list means rows mode for every row (a name-only row then fails with
    // "Phone number missing"); a list with no phones at all keeps the legacy name-only mode.
    const rowsMode = rows.some((row) => row.phone);
    const state = bulkVendorState || undefined;
    const items = rowsMode ? rows : parseBulkVendorNames(rows.map((row) => row.name).join('\n'));
    // runBatches freezes each batch's body once, so a retry resends the byte-identical request.
    const serialize = (batch) => JSON.stringify(rowsMode
      ? { rows: batch.items, state }
      : { names: batch.items, auto_password: bulkVendorAutoPassword, state });

    setLoading(true);
    setMessage('');
    setMessageType('');

    try {
      const run = await runBatches({
        items,
        batchSize: VENDOR_BATCH_SIZE,
        serialize,
        send: (batch) => apiRequest('/admin/vendors/bulk-create', {
          method: 'POST',
          body: batch.body,
          signal: AbortSignal.timeout(BATCH_TIMEOUT_MS),
        }).then((result) => result.summary),
        verify: verifyVendorBatch,
        onProgress: (progress) => setBatchProgress({ title: 'Creating Solar Mitras', ...progress }),
      });

      setBulkVendorResult(mergeVendorRun(run, items.length));
      // Only a finished run clears the form. A stopped run keeps the list so it can be submitted
      // again: rows already created come back as "already used" and are skipped safely.
      if (!run.failed) {
        setShowBulkCreateVendors(false);
        setBulkVendorNamesText('');
        setBulkVendorAutoPassword(false);
        setBulkVendorState('');
      }

      await loadAdminResource('vendors', adminPage, undefined, undefined, true);
    } catch (error) {
      setMessage(error.message);
      setMessageType('error');
    } finally {
      setBatchProgress(null);
      setLoading(false);
    }
  }

  async function deactivateVendor(vendorId, businessName) {
    setLoading(true);

    try {
      await apiRequest(`/admin/vendors/${vendorId}/deactivate`, {
        method: 'POST',
      });

      await loadAdminResource('vendors', adminPage);

      setMessage('Solar Mitra deactivated.');
      setMessageType('success');
    } catch (error) {
      setMessage(error.message);
      setMessageType('error');
    } finally {
      setLoading(false);
      setConfirmDeactivateVendorId(null);
    }
  }

  async function deleteVendor(vendorId, businessName) {
    setLoading(true);

    try {
      await apiRequest(`/admin/vendors/${vendorId}/delete`, {
        method: 'POST',
      });

      await loadAdminResource('vendors', adminPage);

      setMessage('Solar Mitra deleted.');
      setMessageType('success');
    } catch (error) {
      setMessage(error.message);
      setMessageType('error');
    } finally {
      setLoading(false);
      setConfirmDeleteVendorId(null);
    }
  }

  // window.prompt()/window.confirm() are unsupported in some embedded/managed browser
  // contexts (they throw "prompt() is not supported"), so the two-step "type the exact
  // business name, then confirm" gate is inline instead: purgeConfirmVendorId arms the row,
  // purgeConfirmText holds what's typed so far, and the Confirm button itself stays disabled
  // until the typed text exactly matches the business name — same safety guarantee, no dialogs.
  async function purgeVendor(vendorId, businessName) {
    const confirmation = purgeConfirmText.trim();
    if (confirmation !== businessName) return;

    setLoading(true);
    try {
      await apiRequest(`/admin/vendors/${vendorId}/purge`, {
        method: 'POST',
        body: JSON.stringify({ confirm_vendor_name: confirmation }),
      });
      await loadAdminResource('vendors', adminPage, undefined, undefined, true);
      setMessage(`${businessName} was permanently cleaned up. Its Leads remain labeled as a deleted Solar Mitra.`);
      setMessageType('success');
    } catch (error) {
      setMessage(error.message);
      setMessageType('error');
    } finally {
      setLoading(false);
      setConfirmPurgeVendorId(null);
      setPurgeConfirmText('');
    }
  }

  function leadVendorLabel(lead) {
    return lead.vendor?.businessName || lead.vendorNameSnapshot || 'Deleted Solar Mitra';
  }

  function startEditVendor(vendor) {
    setEditingVendorId(vendor.id);

    setEditVendorDraft({
      business_name: vendor.businessName,
      owner_name: vendor.ownerName,
      login_identifier: vendor.loginIdentifier,
      mobile_number: vendor.mobileNumber,
      state: vendor.state || '',
    });
  }

  async function saveVendorEdit(event, vendorId) {
    event.preventDefault();

    setLoading(true);

    try {
      await apiRequest(`/admin/vendors/${vendorId}`, {
        method: 'PATCH',
        body: JSON.stringify({ ...editVendorDraft, state: editVendorDraft.state || undefined }),
      });

      setEditingVendorId(null);

      await loadAdminResource('vendors', adminPage);

      setMessage('Solar Mitra updated.');
      setMessageType('success');
    } catch (error) {
      setMessage(error.message);
      setMessageType('error');
    } finally {
      setLoading(false);
      setConfirmSaveVendorEdit(false);
    }
  }

  async function resetVendorPassword(vendorId, businessName) {
    setLoading(true);

    try {
      const result = await apiRequest(
        `/admin/vendors/${vendorId}/reset-password`,
        {
          method: 'POST',
        }
      );

      setMessage(
        result.reset_token
          ? `${result.message} (dev reset token: ${result.reset_token})`
          : result.message
      );

      setMessageType('success');
    } catch (error) {
      setMessage(error.message);
      setMessageType('error');
    } finally {
      setLoading(false);
      setConfirmResetPasswordVendorId(null);
    }
  }

  async function createQrTemplate(event) {
    event.preventDefault();
    setLoading(true);
    setMessage('');
    setMessageType('');

    try {
      const fields = {
        name: templateDraft.name.trim(),
        page_width_mm: Number(templateDraft.page_width_mm),
        page_height_mm: Number(templateDraft.page_height_mm),
        dpi: Number(templateDraft.dpi),
        qr_x: Number(templateDraft.qr_x),
        qr_y: Number(templateDraft.qr_y),
        qr_width: Number(templateDraft.qr_width),
        qr_height: Number(templateDraft.qr_height),
        label_enabled: Boolean(templateDraft.label_enabled),
      };
      if (templateDraft.label_enabled) {
        fields.label_text_x = Number(templateDraft.label_text_x || 0);
        fields.label_text_y = Number(templateDraft.label_text_y || 0);
        fields.label_font_size = Number(templateDraft.label_font_size || 12);
      }
      const body = templateArtwork ? new FormData() : JSON.stringify(fields);
      if (templateArtwork) {
        Object.entries(fields).forEach(([key, value]) => body.append(key, String(value)));
        body.append('artwork', templateArtwork);
      }

      const result = await apiRequest('/admin/qr/templates', {
        method: 'POST',
        body,
      });

      setShowTemplateForm(false);
      setTemplateArtwork(null);
      setTemplateDraft({
        name: 'Solar Mitra Sticker A4',
        page_width_mm: '210',
        page_height_mm: '297',
        dpi: '300',
        qr_x: '40',
        qr_y: '60',
        qr_width: '42',
        qr_height: '42',
        label_enabled: false,
        label_text_x: '0',
        label_text_y: '0',
        label_font_size: '12',
      });

      setMessage(result.artworkWarning
        ? `Template created: ${result.template.name}. ${result.artworkWarning}`
        : `Template created: ${result.template.name}`);
      setMessageType(result.artworkWarning ? 'error' : 'success');
      await loadAdminResource('qr', adminPage);
    } catch (error) {
      setMessage(error.message);
      setMessageType('error');
    } finally {
      setLoading(false);
    }
  }

  function beginTemplateInteraction(event, mode) {
    event.preventDefault();
    event.stopPropagation();
    setTemplateInteraction({
      mode,
      startX: event.clientX,
      startY: event.clientY,
      startXmm: Number(templateDraft.qr_x) || 0,
      startYmm: Number(templateDraft.qr_y) || 0,
      startSize: Number(templateDraft.qr_width) || 35,
    });
  }

  // The design Solar Mitras get when they download their own poster (also what Auto-QR posters shows).
  async function setSolarMitraPosterTemplate(templateId) {
    setLoading(true);
    try {
      await apiRequest(`/admin/qr/templates/${templateId}/vendor-poster`, { method: 'POST', body: '{}' });
      setMessage('Solar Mitras will now download this design.');
      setMessageType('success');
      await loadAdminResource('templates', 1, undefined, undefined, true);
    } catch (error) {
      setMessage(error.message);
      setMessageType('error');
    } finally {
      setLoading(false);
    }
  }

  async function publishQrTemplate(templateId) {
    setLoading(true);
    try {
      await apiRequest(`/admin/qr/templates/${templateId}/publish`, { method: 'POST' });
      setMessage('Template published.');
      setMessageType('success');
      await loadAdminResource('qr', adminPage);
    } catch (error) {
      setMessage(error.message);
      setMessageType('error');
    } finally {
      setLoading(false);
    }
  }

  // Only reaches the backend when the row's own inline Confirm is clicked — the backend
  // independently re-checks print-job usage regardless of what this page currently shows.
  async function deleteQrTemplate(templateId) {
    setLoading(true);
    try {
      await apiRequest(`/admin/qr/templates/${templateId}/delete`, { method: 'POST' });
      setMessage('Template deleted.');
      setMessageType('success');
      await loadAdminResource('qr', adminPage);
    } catch (error) {
      setMessage(error.message);
      setMessageType('error');
      // Already gone (deleted in another tab/session): refresh so the stale row disappears.
      if (error.code === 'QR_TEMPLATE_NOT_FOUND') await loadAdminResource('qr', adminPage).catch(() => {});
    } finally {
      setLoading(false);
      setConfirmDeleteTemplateId(null);
    }
  }

  async function archiveQrTemplate(templateId) {
    setLoading(true);
    try {
      await apiRequest(`/admin/qr/templates/${templateId}/archive`, { method: 'POST' });
      setMessage('Template archived. It can be restored later.');
      setMessageType('success');
      await loadAdminResource('qr', adminPage);
    } catch (error) {
      setMessage(error.message);
      setMessageType('error');
    } finally {
      setLoading(false);
      setConfirmArchiveTemplateId(null);
    }
  }

  async function restoreQrTemplate(templateId) {
    setLoading(true);
    try {
      await apiRequest(`/admin/qr/templates/${templateId}/restore`, { method: 'POST' });
      setMessage('Template restored.');
      setMessageType('success');
      await loadAdminResource('qr', adminPage);
    } catch (error) {
      setMessage(error.message);
      setMessageType('error');
    } finally {
      setLoading(false);
    }
  }

  async function viewPrintProof(job) {
    try {
      const result = await apiRequest(`/admin/qr/print-batch/${encodeURIComponent(job.id)}/proof`, { forceRefresh: true });
      window.open(result.proof_url, '_blank', 'noopener,noreferrer');
    } catch (error) {
      setMessage(error.message);
      setMessageType('error');
    }
  }

  // The artwork URL already on `template` (from the last /qr/templates load) is a signed URL —
  // it can go stale if the page has sat open a while, so this refetches fresh right before
  // opening it, same reasoning as viewPrintProof above.
  async function previewQrTemplateArtwork(template) {
    try {
      const result = await apiRequest('/admin/qr/templates', { forceRefresh: true });
      const fresh = (result.templates || []).find((item) => item.id === template.id);
      if (!fresh?.artworkUrl) {
        setMessage('No artwork is available for this template.');
        setMessageType('error');
        return;
      }
      setPreviewTemplate(fresh);
    } catch (error) {
      setMessage(error.message);
      setMessageType('error');
    }
  }

  async function assignQr(qr, reassign = false) {
    const vendorId = (
      reassignVendorInputs[qr.id] || ''
    ).trim();

    if (!vendorId) {
      setMessage('Select a Solar Mitra first.');
      setMessageType('error');
      return;
    }

    setLoading(true);

    try {
      await apiRequest(
        `/admin/qr/${qr.id}/${reassign ? 'reassign' : 'assign'}`,
        {
          method: 'POST',
          body: JSON.stringify({
            vendor_id: vendorId,
          }),
        }
      );

      setReassignVendorInputs({
        ...reassignVendorInputs,
        [qr.id]: '',
      });

      await loadAdminResource('qr', adminPage);

      setMessage(
        reassign
          ? 'QR reassigned successfully.'
          : 'QR assigned successfully.'
      );

      setMessageType('success');
    } catch (error) {
      setMessage(error.message);
      setMessageType('error');
    } finally {
      setLoading(false);
      setConfirmAssignQrId(null);
    }
  }

  function armAssignQr(qr) {
    const vendorId = (reassignVendorInputs[qr.id] || '').trim();
    if (!vendorId) {
      setMessage('Select a Solar Mitra first.');
      setMessageType('error');
      return;
    }
    setConfirmAssignQrId(qr.id);
  }

  async function deleteQr(qr) {
    setLoading(true);
    try {
      await apiRequest(`/admin/qr/${qr.id}/delete`, { method: 'POST' });
      await loadAdminResource('qr', adminPage, undefined, undefined, true);
      setMessage('Unused QR code deleted.');
      setMessageType('success');
    } catch (error) {
      setMessage(error.message);
      setMessageType('error');
    } finally {
      setLoading(false);
      setConfirmDeleteQrId(null);
    }
  }

  async function purgeQr(qr) {
    if (purgeQrConfirmText.trim() !== qr.code) return;
    setLoading(true);

    try {
      await apiRequest(`/admin/qr/${qr.id}/purge`, {
        method: 'POST',
        body: JSON.stringify({ confirm_qr_code: purgeQrConfirmText.trim() }),
      });
      await loadAdminResource('qr', adminPage, undefined, undefined, true);
      setMessage('QR code and all of its business history were permanently deleted. Only the audit record was retained.');
      setMessageType('success');
    } catch (error) {
      setMessage(error.message);
      setMessageType('error');
    } finally {
      setLoading(false);
      setConfirmPurgeQrId(null);
      setPurgeQrConfirmText('');
    }
  }

  async function bulkDeleteVendors() {
    if (!selectedVendorIds.length) return;
    setLoading(true);
    try {
      const result = await apiRequest('/admin/vendors/bulk-delete', { method: 'POST', body: JSON.stringify({ ids: selectedVendorIds }) });
      setDeletionResult({ entity: 'Solar Mitras', deleted: result.count, blocked: [] });
      setSelectedVendorIds([]);
      await loadAdminResource('vendors', adminPage, undefined, undefined, true);
    } catch (error) {
      if (error.code === 'BULK_DELETE_BLOCKED') setDeletionResult({ entity: 'Solar Mitras', deleted: 0, blocked: error.details || [] });
      else { setMessage(error.message); setMessageType('error'); }
    } finally {
      setLoading(false);
      setConfirmBulkDeleteVendors(false);
    }
  }

  async function updatePayoutStatus(payout, status) {
    const reference = (
      paidReferenceInputs[payout.id] || ''
    ).trim();

    setLoading(true);

    try {
      const body = {
        status,
      };

      if (reference) {
        body.paid_reference = reference;
      }

      await apiRequest(`/admin/payouts/${payout.id}/status`, {
        method: 'POST',
        body: JSON.stringify(body),
      });

      setPaidReferenceInputs({
        ...paidReferenceInputs,
        [payout.id]: '',
      });

      await loadAdminResource('payouts', adminPage);

      setMessage(`Payout marked as ${status.toLowerCase()}.`);
      setMessageType('success');
    } catch (error) {
      setMessage(error.message);
      setMessageType('error');
    } finally {
      setLoading(false);
      setConfirmPayoutStatusKey(null);
    }
  }

  function armPayoutStatus(payout, status) {
    const reference = (paidReferenceInputs[payout.id] || '').trim();
    if ((status === 'PAID' || status === 'PARTIAL') && !reference) {
      setMessage('Enter a payment reference before marking this payout.');
      setMessageType('error');
      return;
    }
    setConfirmPayoutStatusKey(`${payout.id}:${status}`);
  }

  // Single reset path so a chosen state can never leak into the next batch, from any close point.
  function closeBulkCreateVendors() {
    setShowBulkCreateVendors(false);
    setBulkVendorState('');
  }

  async function viewVendorBankDetails(vendor) {
    setLoading(true);
    try {
      const result = await apiRequest(`/admin/vendors/${vendor.id}/bank-details`, { forceRefresh: true });
      setDetailBank({ vendor, details: result.bank_details });
    } catch (error) {
      setMessage(error.message);
      setMessageType('error');
    } finally {
      setLoading(false);
    }
  }

  async function viewVendorOnboardingMedia(vendor) {
    setMediaCoordsText('');
    setMediaLocationError('');
    setLoading(true);
    try {
      const result = await apiRequest(`/admin/vendors/${vendor.id}/onboarding-media`, { forceRefresh: true });
      setDetailOnboardingMedia({ vendor, media: result.onboarding_media });
    } catch (error) {
      setMessage(error.message);
      setMessageType('error');
    } finally {
      setLoading(false);
    }
  }

  // Uploads/replaces a photo from inside the "Onboarding media" modal — same endpoint the
  // create form uses, just targeting an existing vendor. Re-fetches so the modal shows the
  // new signed URL immediately instead of a stale one.
  async function replaceOnboardingPhoto(vendorId, kind, event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setLoading(true);
    setMessage('');
    setMessageType('');
    try {
      await uploadOnboardingPhoto(vendorId, kind, file);
      const result = await apiRequest(`/admin/vendors/${vendorId}/onboarding-media`, { forceRefresh: true });
      setDetailOnboardingMedia((current) => (current ? { ...current, media: result.onboarding_media } : current));
      setMessage(`${kind === 'shop' ? 'Shop' : 'QR placement'} photo saved.`);
      setMessageType('success');
    } catch (error) {
      setMessage(error.message);
      setMessageType('error');
    } finally {
      setLoading(false);
    }
  }

  // Same type-or-paste approach as the create form's coordinates field, but submits
  // immediately against an already-existing vendor instead of staging local state.
  async function applyMediaCoordsText(vendorId) {
    setMediaLocationError('');
    let coords;
    try {
      coords = parseCoordsText(mediaCoordsText);
    } catch (error) {
      setMediaLocationError(error.message);
      return;
    }
    setLoading(true);
    setMessage('');
    setMessageType('');
    try {
      await apiRequest(`/admin/vendors/${vendorId}/location`, {
        method: 'PATCH',
        body: JSON.stringify({ latitude: coords.latitude, longitude: coords.longitude }),
      });
      const result = await apiRequest(`/admin/vendors/${vendorId}/onboarding-media`, { forceRefresh: true });
      setDetailOnboardingMedia((current) => (current ? { ...current, media: result.onboarding_media } : current));
      setMediaCoordsText('');
      setMessage('Location saved.');
      setMessageType('success');
    } catch (error) {
      setMessage(error.message);
      setMessageType('error');
    } finally {
      setLoading(false);
    }
  }

  function changeLeadFilters(status, assignee) {
    leadStatusFilterRef.current = status;
    leadAssignFilterRef.current = assignee;
    setLeadStatusFilter(status);
    setLeadAssignFilter(assignee);
    loadAdminResource('leads', 1);
  }

  // All-or-nothing on the server: if any selected lead changed or vanished, nothing is assigned (409).
  async function bulkAssignLeads() {
    setLoading(true);
    try {
      const result = await apiRequest('/admin/leads/assign-bulk', {
        method: 'POST',
        body: JSON.stringify({ lead_ids: selectedLeadIds, assigned_to_id: bulkAssignee === '__none' ? null : bulkAssignee }),
      });
      setSelectedLeadIds([]);
      setBulkAssignee('');
      await loadAdminResource('leads', adminPage, undefined, undefined, true);
      setMessage(`${result.changed} lead${result.changed === 1 ? '' : 's'} updated.`);
      setMessageType('success');
    } catch (error) {
      setMessage(error.code === 'LEADS_CHANGED' ? 'Some leads changed or were removed, so nothing was assigned. The list was refreshed.' : error.message);
      setMessageType('error');
      if (error.code === 'LEADS_CHANGED') await loadAdminResource('leads', adminPage, undefined, undefined, true);
    } finally {
      setLoading(false);
    }
  }

  // One-click assignment from the row; the server re-checks the assignee (active BDE) and records history.
  async function assignLeadInline(lead, assigneeId) {
    if (assigneeId === (lead.assignedToId || '')) return;
    setLoading(true);
    try {
      await apiRequest(`/admin/leads/${lead.id}/assignment`, { method: 'PATCH', body: JSON.stringify({ assigned_to_id: assigneeId || null }) });
      await loadAdminResource('leads', adminPage, undefined, undefined, true);
      setMessage(assigneeId ? 'Lead assigned.' : 'Lead unassigned.');
      setMessageType('success');
    } catch (error) {
      setMessage(error.message);
      setMessageType('error');
    } finally {
      setLoading(false);
    }
  }

  async function updateLeadStatus(lead, status) {
    if (status === lead.status) return;
    setLoading(true);
    try {
      await apiRequest(`/admin/leads/${lead.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      await loadAdminResource('leads', adminPage, undefined, undefined, true);
      setDetailLead(null);
      setMessage(`Lead marked as ${status.toLowerCase()}.`);
      setMessageType('success');
    } catch (error) {
      setMessage(error.message);
      setMessageType('error');
    } finally {
      setLoading(false);
    }
  }

  async function deleteLead(lead) {
    setLoading(true);

    try {
      await apiRequest(`/admin/leads/${lead.id}/delete`, { method: 'POST' });
      await loadAdminResource('leads', adminPage, undefined, undefined, true);
      setDetailLead(null);
      setMessage('Lead deleted.');
      setMessageType('success');
    } catch (error) {
      setMessage(error.message);
      setMessageType('error');
    } finally {
      setLoading(false);
      setConfirmDeleteLeadId(null);
    }
  }

  async function createStaffUser(event) {
    event.preventDefault();

    setLoading(true);

    try {
      await apiRequest('/admin/users', {
        method: 'POST',
        body: JSON.stringify({
          name: newStaffUser.name,
          username_or_mobile: newStaffUser.username_or_mobile,
          password: newStaffUser.password,
          ...accountTypePayload(newStaffUser.role),
        }),
      });

      setNewStaffUser({
        name: '',
        username_or_mobile: '',
        password: '',
        role: ACCOUNT_TYPE_SALES,
      });

      setShowCreateStaff(false);

      await loadAdminResource('users', adminPage);

      setMessage('Staff user created.');
      setMessageType('success');
    } catch (error) {
      setMessage(error.message);
      setMessageType('error');
    } finally {
      setLoading(false);
    }
  }

  async function updateStaffUserRole(user) {
    const nextType =
      staffRoleInputs[user.id] || accountTypeOf(user);

    setLoading(true);

    try {
      const result = await apiRequest(`/admin/users/${user.id}`, {
        method: 'PATCH',
        body: JSON.stringify(accountTypePayload(nextType)),
      });

      await loadAdminResource('users', adminPage);

      setMessage(result.released_leads ? `Account type updated. ${result.released_leads} lead${result.released_leads === 1 ? '' : 's'} returned to the unassigned pool.` : 'Account type updated.');
      setMessageType('success');
    } catch (error) {
      setMessage(error.message);
      setMessageType('error');
    } finally {
      setLoading(false);
      setConfirmUpdateRoleId(null);
    }
  }

  function armUpdateStaffUserRole(user) {
    const nextType = staffRoleInputs[user.id] || accountTypeOf(user);
    if (nextType === accountTypeOf(user)) {
      setMessage('Select a different account type first.');
      setMessageType('error');
      return;
    }
    setConfirmUpdateRoleId(user.id);
  }

  async function deactivateStaffUser(user) {
    setLoading(true);

    try {
      const result = await apiRequest(
        `/admin/users/${user.id}/deactivate`,
        {
          method: 'POST',
        }
      );

      await loadAdminResource('users', adminPage);

      setMessage(result.released_leads ? `Staff user deactivated. ${result.released_leads} lead${result.released_leads === 1 ? '' : 's'} returned to the unassigned pool.` : 'Staff user deactivated.');
      setMessageType('success');
    } catch (error) {
      setMessage(error.message);
      setMessageType('error');
    } finally {
      setLoading(false);
      setConfirmDeactivateStaffId(null);
    }
  }

  // Reactivation is a plain status change; the account keeps its type and role, and returned leads stay unassigned.
  async function activateStaffUser(user) {
    setLoading(true);
    try {
      await apiRequest(`/admin/users/${user.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'ACTIVE' }) });
      await loadAdminResource('users', adminPage, undefined, undefined, true);
      setMessage('Staff user activated.');
      setMessageType('success');
    } catch (error) {
      setMessage(error.message);
      setMessageType('error');
    } finally {
      setLoading(false);
    }
  }




  // Used by the blocking retention-warning modal specifically. Unlike the Export button (ExportRangeButton)
  // above, this one's success/failure actually matters — the modal only dismisses once the
  // download is confirmed to have worked, so it needs a real fetch (a plain navigation gives
  // no success/failure signal in JS at all).
  async function confirmRetentionExport() {
    setRetentionExportState({ loading: true, error: '' });
    try {
      const response = await fetch(`${API_BASE_URL}/admin/audit-logs/export`, { credentials: 'include' });
      if (!response.ok) {
        throw new Error('Export failed. Please try again.');
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'solarium-audit-logs.csv';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      setRetentionExportState({ loading: false, error: '' });
      setRetentionStatus((current) => (current ? { ...current, needsAcknowledgment: false } : current));
    } catch (error) {
      setRetentionExportState({ loading: false, error: error.message });
    }
  }

  function downloadLeadsImportTemplate() {
    window.location.href = `${API_BASE_URL}/admin/leads/import-template`;
  }

  async function importLeadsCsv(event) {
    event.preventDefault();
    if (!importFile) return;
    setLoading(true);
    setMessage('');
    setMessageType('');

    try {
      const fail = (text) => {
        setMessage(text);
        setMessageType('error');
      };
      if (importFile.size > 5 * 1024 * 1024) return fail('CSV file must be 5 MB or smaller.');

      // Parsed here (not on the server) so the list can be sent in small batches. Header
      // normalization matches the server's own CSV path.
      let records;
      try {
        records = parseCsv(await importFile.text(), {
          columns: (headerRow) => headerRow.map((header) => String(header).trim().toLowerCase().replace(/\s+/g, '_')),
          trim: true,
          skip_empty_lines: true,
          relax_column_count: true,
          bom: true,
        });
      } catch (parseError) {
        return fail('Could not read the CSV file. Check the format and try again.');
      }
      if (records.length === 0) return fail('The CSV file has no data rows.');
      if (records.length > MAX_BULK_ROWS) {
        return fail(`This file has ${records.length.toLocaleString()} rows; the limit is ${MAX_BULK_ROWS.toLocaleString()} per upload. Split the file and try again.`);
      }

      // CSV row 1 is the header, so data record i is row i + 2. A record with a field over the
      // server's limit is sent as an empty placeholder so every later row keeps its row number.
      const overLengthRows = new Set();
      const items = records.map((record, index) => {
        const { item, tooLong } = toLeadUploadItem(record);
        if (tooLong) overLengthRows.add(index + 2);
        return item;
      });

      const run = await runBatches({
        items,
        batchSize: LEAD_BATCH_SIZE,
        serialize: (batch) => JSON.stringify({ rows: batch.items, row_offset: batch.offset }),
        send: (batch) => apiRequest('/admin/leads/import-batch', {
          method: 'POST',
          body: batch.body,
          signal: AbortSignal.timeout(BATCH_TIMEOUT_MS),
        }).then((result) => result.summary),
        verify: verifyLeadBatch,
        onProgress: (progress) => setBatchProgress({ title: 'Importing customers', ...progress }),
      });

      setImportResult(mergeLeadRun(run, items.length, overLengthRows));
      // A stopped run keeps the file selected so the same file can be imported again safely.
      if (!run.failed) {
        setImportFile(null);
        setShowImportLeads(false);
      }
      await loadAdminResource('leads', adminPage, undefined, undefined, true);
    } catch (error) {
      setMessage(error.message);
      setMessageType('error');
    } finally {
      setBatchProgress(null);
      setLoading(false);
    }
  }

  function renderStats() {
    const data = portalData?.data || {};

    const stats = [
      ['Total Solar Mitras', data.totalVendors ?? 0, 'store'],
      ['Active Solar Mitras', data.activeVendors ?? 0, 'users'],
      ['Total QR Codes', data.totalQrCodes ?? 0, 'qr'],
      ['Unassigned QR', data.unassignedQrCodes ?? 0, 'qr'],
      ['Total Scans', data.totalScans ?? 0, 'scan'],
      ['Unique Customers', data.uniqueCustomers ?? 0, 'users'],
      ['Total Leads', data.totalLeads ?? 0, 'lead'],
      ['Qualified Leads', data.qualifiedLeads ?? 0, 'lead'],
      ['Converted Leads', data.convertedLeads ?? 0, 'check'],
      ['Pending Commission', data.pendingCommission ?? 0, 'money'],
      ['Paid Commission', data.paidCommission ?? 0, 'money'],
    ];

    const insights = [
      ['QR assigned', formatRatio(data.assignedQrCodes ?? 0, data.totalQrCodes ?? 0), `${(data.assignedQrCodes ?? 0).toLocaleString()} of ${(data.totalQrCodes ?? 0).toLocaleString()} QR codes`],
      ['Solar Mitras active', formatRatio(data.activeVendors ?? 0, data.totalVendors ?? 0), `${(data.activeVendors ?? 0).toLocaleString()} of ${(data.totalVendors ?? 0).toLocaleString()} (excludes deleted)`],
      ['Leads qualified', formatRatio(data.qualifiedLeads ?? 0, data.totalLeads ?? 0), `${(data.qualifiedLeads ?? 0).toLocaleString()} of ${(data.totalLeads ?? 0).toLocaleString()} leads`],
      ['Leads converted', formatRatio(data.convertedLeads ?? 0, data.totalLeads ?? 0), `${(data.convertedLeads ?? 0).toLocaleString()} of ${(data.totalLeads ?? 0).toLocaleString()} leads`],
      ['Scan-to-lead', formatRatio(data.scanLinkedLeads ?? 0, data.totalScans ?? 0), `${(data.scanLinkedLeads ?? 0).toLocaleString()} leads from scans / ${(data.totalScans ?? 0).toLocaleString()} scans`],
      ['Payouts settled', formatRatio(data.paidCommission ?? 0, (data.paidCommission ?? 0) + (data.pendingCommission ?? 0)), `${(data.paidCommission ?? 0).toLocaleString()} paid of ${((data.paidCommission ?? 0) + (data.pendingCommission ?? 0)).toLocaleString()} payouts (counts)`],
    ];

    return (
      <div className="admin-dashboard">
        <div className="admin-section-heading">
          <div>
            <span className="admin-eyebrow">OVERVIEW</span>
            <h2>System at a glance</h2>
            <p>
              Everything important across Solar Mitras, QR,
              customers, leads and commissions.
            </p>
          </div>

          <button
            className="admin-outline-button"
            onClick={() =>
              loadAdminResource('dashboard', 1, undefined, undefined, true)
            }
            disabled={loading}
          >
            <Icon path={ICONS.refresh} />
            Refresh
          </button>
        </div>

        {data.retention?.atCapacity && (
          <p className="admin-audit-capacity-note">
            Audit log storage is at its {data.retention.cap}-row limit. Older entries are removed automatically as new ones are added.
          </p>
        )}

        <div className="admin-stat-grid">
          {stats.map(([label, value, icon]) => (
            <div className="admin-stat-card" key={label}>
              <div className="admin-stat-icon">
                <Icon
                  path={
                    ICONS[icon] ||
                    ICONS.dashboard
                  }
                />
              </div>

              <div>
                <span>{label}</span>
                <strong>
                  {typeof value === 'number'
                    ? value.toLocaleString()
                    : value}
                </strong>
              </div>
            </div>
          ))}
        </div>

        <div className="admin-section-heading">
          <div>
            <span className="admin-eyebrow">ALL-TIME RATIOS</span>
            <p>Counts over the whole history (no date range). Each ratio shows what it divides.</p>
          </div>
        </div>
        <div className="admin-stat-grid">
          {insights.map(([label, value, detail]) => (
            <div className="admin-stat-card" key={label}>
              <div>
                <span>{label}</span>
                <strong>{value}</strong>
                <small>{detail}</small>
              </div>
            </div>
          ))}
        </div>
        {data.qrStatusMismatch && (
          <p className="admin-audit-capacity-note">
            QR status and assignments disagree for some codes. Open QR management and run Check inventory.
          </p>
        )}

        <div className="admin-quick-grid">
          {can('vendors.view') && (
          <button
            onClick={() => navigate('vendors')}
            className="admin-quick-card"
          >
            <Icon path={ICONS.store} />
            <div>
              <strong>Manage Solar Mitras</strong>
              <span>View, edit and control Solar Mitra access</span>
            </div>
            <Icon path={ICONS.arrow} />
          </button>
          )}

          {can('qr.view') && (
          <button
            onClick={() => navigate('qr')}
            className="admin-quick-card"
          >
            <Icon path={ICONS.qr} />
            <div>
              <strong>Manage QR codes</strong>
              <span>Assign, reassign and generate QR inventory</span>
            </div>
            <Icon path={ICONS.arrow} />
          </button>
          )}

          {can('leads.view') && (
          <button
            onClick={() => navigate('leads')}
            className="admin-quick-card"
          >
            <Icon path={ICONS.lead} />
            <div>
              <strong>Review leads</strong>
              <span>Track customer enquiries and attribution</span>
            </div>
            <Icon path={ICONS.arrow} />
          </button>
          )}

          {can('payouts.view') && (
          <button
            onClick={() => navigate('payouts')}
            className="admin-quick-card"
          >
            <Icon path={ICONS.money} />
            <div>
              <strong>Process commissions</strong>
              <span>Review and update payout status</span>
            </div>
            <Icon path={ICONS.arrow} />
          </button>
          )}
        </div>
      </div>
    );
  }

  function renderVendors() {
    const vendors =
      portalData?.data?.vendors || [];

    // Filtering happens on the server now (see loadAdminResource); this is just the current page.
    const filtered = vendors;
    const selectableVendors = filtered.filter((vendor) => !isProtectedDirectVendor(vendor));
    const allVisibleVendorsSelected = selectableVendors.length > 0 && selectableVendors.every((vendor) => selectedVendorIds.includes(vendor.id));

    return (
      <div className="admin-resource">
        <div className="admin-resource-heading">
          <div>
            <span className="admin-eyebrow">
              SOLAR MITRA MANAGEMENT
            </span>
            <h2>Solar Mitras</h2>
            <p>
              Manage every Solar Mitra account and its QR
              relationship.
            </p>
          </div>

          <div className="admin-heading-actions">
            {can('vendors.export') && (
              <ExportRangeButton
                path="/admin/vendors/export"
                params={{ search: vendorSearch.trim(), state: vendorStateFilter }}
                fallbackName="solarium-solar-mitras.csv"
                dateLabel="by the date each Solar Mitra joined"
                note={vendorSearch.trim() || vendorStateFilter ? 'Your current search and state filter also apply.' : undefined}
              />
            )}

            {can('vendors.create') && (
              <button
                className="admin-primary-button"
                onClick={() =>
                  setShowCreateVendor(
                    (current) => !current
                  )
                }
              >
                <Icon path={ICONS.plus} />
                Add Solar Mitra
              </button>
            )}

            {can('vendors.bulk_create') && (
              <button
                className="admin-outline-button"
                onClick={() => {
                  setBulkVendorState('');
                  setShowBulkCreateVendors(true);
                }}
              >
                <Icon path={ICONS.plus} />
                Bulk create
              </button>
            )}

            {portalData.account.role === 'ADMIN' && (
              <button
                className="admin-outline-button"
                onClick={() => setShowAutoPosters(true)}
              >
                <Icon path={ICONS.qr} />
                Auto-QR posters
              </button>
            )}
          </div>
        </div>

        {showCreateVendor && can('vendors.create') && (
          <form
            onSubmit={createVendor}
            className="admin-form-card"
          >
            <div className="admin-form-title">
              Create Solar Mitra
            </div>

            <div className="admin-form-grid">
              <label className="admin-form-field">
                <span>Business name</span>
                <input
                  id="new-vendor-business-name"
                  name="business_name"
                  required
                  autoComplete="off"
                  placeholder="e.g. Sunrise Solar"
                  value={newVendor.business_name}
                  onChange={(event) =>
                    setNewVendor({
                      ...newVendor,
                      business_name:
                        event.target.value,
                    })
                  }
                />
              </label>

              <label className="admin-form-field">
                <span>Owner name</span>
                <input
                  id="new-vendor-owner-name"
                  name="owner_name"
                  required
                  autoComplete="off"
                  placeholder="e.g. Ram Kumar"
                  value={newVendor.owner_name}
                  onChange={(event) =>
                    setNewVendor({
                      ...newVendor,
                      owner_name:
                        event.target.value,
                    })
                  }
                />
              </label>

              <label className="admin-form-field">
                <span>Username</span>
                <input
                  id="new-vendor-username"
                  name="vendor_username"
                  required
                  autoComplete="off"
                  placeholder="e.g. sunrise-solar"
                  value={newVendor.login_identifier}
                  onChange={(event) =>
                    setNewVendor({
                      ...newVendor,
                      login_identifier:
                        event.target.value,
                    })
                  }
                />
                <small>
                  This is what the Solar Mitra will type to sign in — not their name or business name.
                </small>
              </label>

              <label className="admin-form-field">
                <span>Mobile number</span>
                <input
                  id="new-vendor-mobile"
                  name="mobile_number"
                  required
                  type="tel"
                  inputMode="tel"
                  autoComplete="off"
                  placeholder="10-digit mobile number"
                  value={newVendor.mobile_number}
                  onChange={(event) =>
                    setNewVendor({
                      ...newVendor,
                      mobile_number:
                        event.target.value,
                    })
                  }
                />
              </label>

              <label className="admin-form-field">
                <span>Initial password (optional)</span>
                <input
                  id="new-vendor-password"
                  name="vendor_password"
                  minLength="8"
                  type="password"
                  autoComplete="new-password"
                  placeholder="Leave blank to use phone number as password"
                  value={newVendor.password}
                  onChange={(event) =>
                    setNewVendor({
                      ...newVendor,
                      password:
                        event.target.value,
                    })
                  }
                />
              </label>

              <label className="admin-form-field">
                <span>State</span>
                <select
                  id="new-vendor-state"
                  name="state"
                  required
                  value={newVendor.state}
                  onChange={(event) =>
                    setNewVendor({
                      ...newVendor,
                      state: event.target.value,
                    })
                  }
                >
                  <option value="">Select state</option>
                  {INDIAN_STATES.map((state) => (
                    <option key={state} value={state}>{state}</option>
                  ))}
                </select>
              </label>

              <div className="admin-form-field">
                <span>Shop coordinates (optional — type or paste from Sales/Google Maps)</span>
                <div className="admin-coords-row">
                  <input
                    type="text"
                    placeholder="e.g. 18.5204, 73.8567"
                    value={newVendorCoordsText}
                    onChange={(event) => setNewVendorCoordsText(event.target.value)}
                  />
                  <button type="button" className={`admin-outline-button${newVendorLocation ? ' captured' : ''}`} onClick={applyVendorCoordsText}>
                    <Icon path={ICONS.target} />
                    {newVendorLocation ? 'Location saved' : 'Use these coordinates'}
                    {newVendorLocation && <Icon path={ICONS.check} />}
                  </button>
                </div>
                {vendorLocationError && <small className="admin-field-error">{vendorLocationError}</small>}
              </div>

              <label className="admin-form-field">
                <span>Shop photo (optional)</span>
                <input type="file" accept="image/jpeg,image/png" onChange={(event) => handlePhotoSelect('shop', event)} />
                {shopPhotoPreview && <img src={shopPhotoPreview} alt="Shop preview" className="admin-photo-preview" />}
              </label>

              <label className="admin-form-field">
                <span>QR placement photo (optional)</span>
                <input type="file" accept="image/jpeg,image/png" onChange={(event) => handlePhotoSelect('qr-placement', event)} />
                {qrPlacementPhotoPreview && <img src={qrPlacementPhotoPreview} alt="QR placement preview" className="admin-photo-preview" />}
              </label>
            </div>

            <div className="admin-form-actions">
              <button
                type="button"
                className="admin-outline-button"
                onClick={() => {
                  setShowCreateVendor(false);
                  resetOnboardingCapture();
                }}
              >
                Cancel
              </button>

              <button
                className="admin-primary-button"
                disabled={loading}
              >
                {loading
                  ? 'Creating...'
                  : 'Create Solar Mitra'}
              </button>
            </div>
          </form>
        )}

        <div className="admin-toolbar">
          <div className="admin-search">
            <Icon path={ICONS.search} />
            <input
              id="vendor-search"
              name="vendor_search"
              placeholder="Search Solar Mitras..."
              value={vendorSearch}
              onChange={(event) =>
                setVendorSearch(event.target.value)
              }
            />
          </div>

          <div className="admin-filter">
            <Icon path={ICONS.filter} />
            <select
              value={vendorStateFilter}
              onChange={(event) => setVendorStateFilter(event.target.value)}
            >
              <option value="">All states</option>
              {INDIAN_STATES.map((state) => (
                <option key={state} value={state}>{state}</option>
              ))}
            </select>
          </div>

          <button
            className="admin-outline-button"
            onClick={() =>
              loadAdminResource(
                'vendors',
                adminPage,
                undefined,
                undefined,
                true
              )
            }
            disabled={loading}
          >
            <Icon path={ICONS.refresh} />
            Refresh
          </button>
        </div>

        {portalData.account.role === 'ADMIN' && (
        <div className="admin-selection-toolbar">
          <label className="admin-select-all">
            <input type="checkbox" checked={allVisibleVendorsSelected} onChange={(event) => setSelectedVendorIds(event.target.checked ? selectableVendors.map((vendor) => vendor.id) : [])} />
            Select current page
          </label>
          <span>{selectedVendorIds.length} selected</span>
          {confirmBulkDeleteVendors ? (
            <span className="admin-inline-confirm">
              <button type="button" className="admin-mini-button danger solid" disabled={loading} onClick={bulkDeleteVendors}>Confirm</button>
              <button type="button" className="admin-mini-button admin-inline-confirm-cancel" disabled={loading} onClick={() => setConfirmBulkDeleteVendors(false)} aria-label="Cancel delete">
                <Icon path={ICONS.close} />
              </button>
            </span>
          ) : (
            <button type="button" className="admin-mini-button danger" disabled={!selectedVendorIds.length || loading} onClick={() => setConfirmBulkDeleteVendors(true)}>Delete selected</button>
          )}
        </div>
        )}

        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                {portalData.account.role === 'ADMIN' && <th className="admin-check-cell">Select</th>}
                <th>Solar Mitra</th>
                <th>Owner</th>
                <th>State</th>
                <th>QR</th>
                <th>Status</th>
                <th>Leads</th>
                <th>Actions</th>
              </tr>
            </thead>

            <tbody>
              {filtered.length ? (
                filtered.map((vendor) => (
                  <tr key={vendor.id}>
                    {portalData.account.role === 'ADMIN' && (
                    <td className="admin-check-cell">
                      <input type="checkbox" disabled={isProtectedDirectVendor(vendor)} checked={selectedVendorIds.includes(vendor.id)} onChange={(event) => setSelectedVendorIds((current) => event.target.checked ? [...new Set([...current, vendor.id])] : current.filter((id) => id !== vendor.id))} aria-label={`Select ${vendor.businessName}`} />
                    </td>
                    )}
                    <td>
                      {editingVendorId === vendor.id ? (
                        <input
                          className="admin-table-input"
                          value={
                            editVendorDraft.business_name ||
                            ''
                          }
                          onChange={(event) =>
                            setEditVendorDraft({
                              ...editVendorDraft,
                              business_name:
                                event.target.value,
                            })
                          }
                        />
                      ) : (
                        <div className="admin-primary-cell">
                          <strong>
                            {vendor.businessName}
                          </strong>
                          <small>
                            {vendor.id}
                          </small>
                        </div>
                      )}
                    </td>

                    <td>
                      {editingVendorId === vendor.id ? (
                        <input
                          className="admin-table-input"
                          value={
                            editVendorDraft.owner_name ||
                            ''
                          }
                          onChange={(event) =>
                            setEditVendorDraft({
                              ...editVendorDraft,
                              owner_name:
                                event.target.value,
                            })
                          }
                        />
                      ) : (
                        vendor.ownerName
                      )}
                    </td>

                    <td>
                      {editingVendorId === vendor.id ? (
                        <select
                          className="admin-table-select"
                          value={editVendorDraft.state || ''}
                          onChange={(event) =>
                            setEditVendorDraft({
                              ...editVendorDraft,
                              state: event.target.value,
                            })
                          }
                        >
                          <option value="">—</option>
                          {INDIAN_STATES.map((state) => (
                            <option key={state} value={state}>{state}</option>
                          ))}
                        </select>
                      ) : (
                        vendor.state || '—'
                      )}
                    </td>

                    <td>
                      <div className="admin-primary-cell">
                        <span
                          className={`admin-status ${
                            vendor.qrAssigned
                              ? 'active'
                              : 'inactive'
                          }`}
                        >
                          {vendor.qrAssigned
                            ? 'Assigned'
                            : 'Unassigned'}
                        </span>
                        {vendor.currentQr && (
                          <small className="admin-code">
                            {vendor.currentQr}
                          </small>
                        )}
                      </div>
                    </td>

                    <td>
                      <span
                        className={`admin-status ${
                          vendor.status === 'ACTIVE'
                            ? 'active'
                            : 'inactive'
                        }`}
                      >
                        {vendor.status ||
                          'ACTIVE'}
                      </span>
                    </td>

                    <td>
                      {vendor.leadCount ?? 0}
                    </td>

                    <td>
                      <div className="admin-row-actions">
                        {editingVendorId ===
                        vendor.id ? (
                          <>
                            {confirmSaveVendorEdit ? (
                              <span className="admin-inline-confirm">
                                <button
                                  className="admin-mini-button success"
                                  disabled={loading}
                                  onClick={(event) =>
                                    saveVendorEdit(
                                      event,
                                      vendor.id
                                    )
                                  }
                                >
                                  Confirm
                                </button>
                                <button
                                  className="admin-mini-button admin-inline-confirm-cancel"
                                  disabled={loading}
                                  onClick={() => setConfirmSaveVendorEdit(false)}
                                  aria-label="Cancel save"
                                >
                                  <Icon path={ICONS.close} />
                                </button>
                              </span>
                            ) : (
                              <button
                                className="admin-mini-button success"
                                disabled={loading}
                                onClick={() => setConfirmSaveVendorEdit(true)}
                              >
                                <Icon
                                  path={ICONS.check}
                                />
                              </button>
                            )}

                            <button
                              className="admin-mini-button"
                              disabled={loading}
                              onClick={() => {
                                setEditingVendorId(null);
                                setConfirmSaveVendorEdit(false);
                              }}
                            >
                              Cancel
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              className="admin-mini-button"
                              onClick={() => viewVendorDetails(vendor)}
                            >
                              Details
                            </button>

                            {can('vendors.edit') && (
                            <button
                              className="admin-mini-button"
                              onClick={() =>
                                startEditVendor(
                                  vendor
                                )
                              }
                            >
                              <Icon
                                path={ICONS.edit}
                              />
                              Edit
                            </button>
                            )}

                            {!can('vendors.reset_password') ? null : confirmResetPasswordVendorId === vendor.id ? (
                              <span className="admin-inline-confirm">
                                <button
                                  className="admin-mini-button primary solid"
                                  disabled={loading}
                                  onClick={() =>
                                    resetVendorPassword(
                                      vendor.id,
                                      vendor.businessName
                                    )
                                  }
                                >
                                  Confirm
                                </button>
                                <button
                                  className="admin-mini-button admin-inline-confirm-cancel"
                                  disabled={loading}
                                  onClick={() => setConfirmResetPasswordVendorId(null)}
                                  aria-label="Cancel reset"
                                >
                                  <Icon path={ICONS.close} />
                                </button>
                              </span>
                            ) : (
                              <button
                                className="admin-mini-button"
                                disabled={loading}
                                onClick={() => setConfirmResetPasswordVendorId(vendor.id)}
                              >
                                Reset
                              </button>
                            )}

                            {!can('vendors.edit') ? null : confirmDeactivateVendorId === vendor.id ? (
                              <span className="admin-inline-confirm">
                                <button
                                  className="admin-mini-button danger solid"
                                  disabled={loading}
                                  onClick={() =>
                                    deactivateVendor(
                                      vendor.id,
                                      vendor.businessName
                                    )
                                  }
                                >
                                  Confirm
                                </button>
                                <button
                                  className="admin-mini-button admin-inline-confirm-cancel"
                                  disabled={loading}
                                  onClick={() => setConfirmDeactivateVendorId(null)}
                                  aria-label="Cancel deactivation"
                                >
                                  <Icon path={ICONS.close} />
                                </button>
                              </span>
                            ) : (
                              <button
                                className="admin-mini-button danger"
                                disabled={loading}
                                onClick={() => setConfirmDeactivateVendorId(vendor.id)}
                              >
                                Deactivate
                              </button>
                            )}

                            {portalData.account.role === 'ADMIN' && !isProtectedDirectVendor(vendor) && (confirmDeleteVendorId === vendor.id ? (
                              <span className="admin-inline-confirm">
                                <button
                                  className="admin-mini-button danger solid"
                                  disabled={loading}
                                  onClick={() =>
                                    deleteVendor(
                                      vendor.id,
                                      vendor.businessName
                                    )
                                  }
                                >
                                  Confirm
                                </button>
                                <button
                                  className="admin-mini-button admin-inline-confirm-cancel"
                                  disabled={loading}
                                  onClick={() => setConfirmDeleteVendorId(null)}
                                  aria-label="Cancel delete"
                                >
                                  <Icon path={ICONS.close} />
                                </button>
                              </span>
                            ) : (
                              <button
                                className="admin-mini-button danger"
                                disabled={loading}
                                onClick={() => setConfirmDeleteVendorId(vendor.id)}
                              >
                                Delete
                              </button>
                            ))}
                            {portalData.account.role === 'ADMIN' && !isProtectedDirectVendor(vendor) && (confirmPurgeVendorId === vendor.id ? (
                              <>
                              <small className="admin-field-error" style={{ display: 'block', width: '100%' }}>
                                This also permanently deletes the Solar Mitra "{vendor.businessName}" itself, not just its history.
                              </small>
                              <span className="admin-inline-confirm">
                                <input
                                  type="text"
                                  className="admin-inline-confirm-input"
                                  placeholder={`Type "${vendor.businessName}" to confirm`}
                                  title={`Hard delete ${vendor.businessName}: removes assignments, scans, sessions, registration, and bank documents. Leads remain as Deleted Solar Mitra records. Vendors with payout history cannot be hard-deleted. This cannot be undone.`}
                                  value={purgeConfirmText}
                                  disabled={loading}
                                  onChange={(event) => setPurgeConfirmText(event.target.value)}
                                />
                                <button
                                  className="admin-mini-button danger solid"
                                  disabled={loading || purgeConfirmText.trim() !== vendor.businessName}
                                  onClick={() => purgeVendor(vendor.id, vendor.businessName)}
                                >
                                  Confirm
                                </button>
                                <button
                                  className="admin-mini-button admin-inline-confirm-cancel"
                                  disabled={loading}
                                  onClick={() => {
                                    setConfirmPurgeVendorId(null);
                                    setPurgeConfirmText('');
                                  }}
                                  aria-label="Cancel purge"
                                >
                                  <Icon path={ICONS.close} />
                                </button>
                              </span>
                              </>
                            ) : (
                              <button
                                className="admin-mini-button danger"
                                disabled={loading}
                                title={`Permanent cleanup will remove ${vendor.businessName}, assignments, scans, sessions, registration, and bank documents. Leads will remain as Deleted Solar Mitra records. This cannot be undone.`}
                                onClick={() => {
                                  setConfirmPurgeVendorId(vendor.id);
                                  setPurgeConfirmText('');
                                }}
                              >
                                Hard delete history
                              </button>
                            ))}
                            {can('vendors.edit') && (
                              <button
                                className="admin-mini-button"
                                onClick={() => viewVendorOnboardingMedia(vendor)}
                              >
                                Onboarding media
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td
                    colSpan={9}
                    className="admin-empty"
                  >
                    {vendorSearch.trim() ? `No Solar Mitras match "${vendorSearch.trim()}".` : 'No Solar Mitras found.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {renderPagination()}
      </div>
    );
  }

  function renderPrintHistory() {
    const jobs = portalData?.data?.print_jobs || [];

    function applyFilters(next) {
      setPrintHistoryFilters(next);
    }

    return (
      <div className="admin-panel">
        <div className="admin-panel-heading">
          <div>
            <span className="admin-eyebrow">PRINT HISTORY</span>
            <div className="admin-form-title">Which template printed which QR</div>
            <p>Every print batch and single designed PDF, with the template used and the Solar Mitra currently holding each code.</p>
          </div>
          <div className="admin-qr-action">
            <ExportRangeButton
              path="/admin/qr/print-history/export"
              params={printHistoryFilters}
              fallbackName="qr-print-history.csv"
              dateLabel="by the date each batch was printed"
              note="Your current filters also apply. At most the 5,000 newest rows are exported."
            />
            <button
              type="button"
              className="admin-outline-button"
              disabled={loading}
              onClick={() => loadAdminResource('print-history', adminPage, undefined, undefined, true)}
            >
              <Icon path={ICONS.refresh} />
              Refresh
            </button>
          </div>
        </div>

        <div className="admin-print-filters">
          <label>
            Template
            <select
              value={printHistoryFilters.template_id}
              onChange={(event) => applyFilters({ ...printHistoryFilters, template_id: event.target.value })}
            >
              <option value="">All templates</option>
              {qrTemplates.map((template) => (
                <option key={template.id} value={template.id}>{template.name}</option>
              ))}
            </select>
          </label>

          <label>
            Print type
            <select
              value={printHistoryFilters.kind}
              onChange={(event) => applyFilters({ ...printHistoryFilters, kind: event.target.value })}
            >
              <option value="">All types</option>
              <option value="BATCH">Print batch</option>
              <option value="SINGLE">Single print</option>
            </select>
          </label>

          <label>
            QR code
            <input
              value={printHistoryFilters.code}
              placeholder="e.g. V-0116"
              onChange={(event) => applyFilters({ ...printHistoryFilters, code: event.target.value })}
            />
          </label>

          <label>
            Solar Mitra
            <input
              value={printHistoryFilters.vendor}
              placeholder="Business name"
              onChange={(event) => applyFilters({ ...printHistoryFilters, vendor: event.target.value })}
            />
          </label>

          <button
            type="button"
            className="admin-primary-button"
            disabled={loading}
            onClick={() => loadAdminResource('print-history', 1, undefined, undefined, true)}
          >
            Apply
          </button>
        </div>

        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Printed</th>
                <th>Template</th>
                <th>Type</th>
                <th>QR codes</th>
                <th>Printed by</th>
                <th>Status</th>
                <th>Codes</th>
              </tr>
            </thead>
            <tbody>
              {jobs.length ? (
                jobs.map((job) => (
                  <Fragment key={job.id}>
                    <tr>
                      <td>
                        {new Date(job.generatedAt || job.createdAt).toLocaleString()}
                        <br />
                        <small className="admin-muted-text">{job.id}</small>
                      </td>
                      <td>
                        {job.template?.name || '—'}
                        <br />
                        <small className="admin-muted-text">{job.templateId}</small>
                      </td>
                      <td>{job.kind === 'SINGLE' ? 'Single print' : 'Print batch'}</td>
                      <td>
                        {job.rangeStart === job.rangeEnd ? job.rangeStart : `${job.rangeStart} – ${job.rangeEnd}`}
                        <br />
                        <small className="admin-muted-text">{job.itemCount} code(s)</small>
                      </td>
                      <td>{job.createdBy?.name || '—'}</td>
                      <td><span className="admin-status">{job.status}</span></td>
                      <td>
                        <button type="button" className="admin-mini-button" onClick={() => loadPrintJobDetail(job.id)}>
                          {expandedPrintJob?.jobId === job.id ? 'Hide' : 'View codes'}
                        </button>
                      </td>
                    </tr>
                    {expandedPrintJob?.jobId === job.id && (
                      <tr>
                        <td colSpan={7}>
                          {expandedPrintJob.loading ? (
                            <p>Loading codes...</p>
                          ) : (
                            <table className="admin-table">
                              <thead>
                                <tr><th>QR code</th><th>QR ID</th><th>QR status</th><th>Current Solar Mitra</th><th>Solar Mitra ID</th></tr>
                              </thead>
                              <tbody>
                                {expandedPrintJob.items.map((item) => (
                                  <tr key={item.qrId}>
                                    <td>{item.code}</td>
                                    <td><small>{item.qrId}</small></td>
                                    <td>{item.qrStatus || '—'}</td>
                                    <td>{item.currentVendor?.businessName || 'Unassigned'}</td>
                                    <td><small>{item.currentVendor?.id || '—'}</small></td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))
              ) : (
                <tr><td colSpan={7}>No print jobs match these filters.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {renderPagination()}
      </div>
    );
  }

  // Clears every piece of print-wizard state and starts a new batch (fresh idempotency nonce).
  function resetPrintWizardState() {
    printBatchNonceRef.current = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    setPrintDone(false);
    setPrintWizardStep(1);
    setPrintWizardMode('range');
    setPrintWizardDraft({ range_start: '', range_end: '', code: '', template_id: '' });
    setPrintWizardJob(null);
    setPrintRangeCheck({ loading: false, checked: false, total: 0, existingCount: 0, missingCount: 0, error: '' });
    setPrintProofState({ loading: false, error: '', url: '', ready: false });
    printProofAttemptRef.current = null;
  }

  function openPrintWizard() {
    resetPrintWizardState();
    setResource('print-qr');
    setAdminPage(1);
    setMobileNavOpen(false);
    loadAdminResource('print-qr', 1);
  }

  function qrStatusLabel(status) {
    return status === 'PUBLISHED' ? 'Ready to print' : status.charAt(0) + status.slice(1).toLowerCase();
  }

  function printCountLabel(template) {
    const counts = template.printJobCounts || { batch: 0, single: 0 };
    if (!template.printJobCount) return 'Not used yet';
    return `${counts.batch} batch${counts.batch === 1 ? '' : 'es'} · ${counts.single} single print${counts.single === 1 ? '' : 's'}`;
  }

  function startTemplateVersion(template) {
    setTemplateDraft({
      name: `${template.name} - New version`,
      page_width_mm: String(template.pageWidthMm),
      page_height_mm: String(template.pageHeightMm),
      dpi: String(template.dpi),
      qr_x: String(template.qrX),
      qr_y: String(template.qrY),
      qr_width: String(template.qrWidth),
      qr_height: String(template.qrHeight),
      label_enabled: Boolean(template.labelEnabled),
      label_text_x: String(template.labelTextX || 0),
      label_text_y: String(template.labelTextY || 0),
      label_font_size: String(template.labelFontSize || 12),
    });
    setTemplateArtwork(null);
    setShowTemplateForm(true);
  }

  async function generateQrBatch(event) {
    event.preventDefault();
    const quantity = Number(generateQrQuantity);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 5000) {
      setMessage('Enter a quantity between 1 and 5000.');
      setMessageType('error');
      return;
    }
    setGenerateQrBusy(true);
    try {
      const result = await apiRequest('/admin/qr/generate', { method: 'POST', body: JSON.stringify({ quantity }) });
      setGenerateQrResult({ count: result.count, codes: result.codes, rangeStart: result.codes[0], rangeEnd: result.codes[result.codes.length - 1] });
      setMessage(`${result.count} QR code${result.count === 1 ? '' : 's'} generated.`);
      setMessageType('success');
      await loadAdminResource('qr', 1, undefined, undefined, true);
    } catch (error) {
      setMessage(error.message);
      setMessageType('error');
    } finally {
      setGenerateQrBusy(false);
    }
  }

  // Jumps straight into the Print QR Codes wizard with the just-generated range pre-filled —
  // "generate, then map to a template" without retyping the range by hand.
  function printGeneratedCodes() {
    if (!generateQrResult) return;
    printBatchNonceRef.current = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    setPrintDone(false);
    setPrintWizardStep(1);
    setPrintWizardMode('range');
    setPrintWizardDraft({ range_start: generateQrResult.rangeStart, range_end: generateQrResult.rangeEnd, code: '', template_id: '' });
    setPrintWizardJob(null);
    setPrintRangeCheck({ loading: false, checked: false, total: 0, existingCount: 0, missingCount: 0, error: '' });
    setPrintProofState({ loading: false, error: '', url: '', ready: false });
    printProofAttemptRef.current = null;
    setShowGenerateQr(false);
    setGenerateQrResult(null);
    setResource('print-qr');
    setAdminPage(1);
    setMobileNavOpen(false);
    loadAdminResource('print-qr', 1);
  }

  function renderQrInventory() {
    const qrs = portalData?.data?.data || [];
    const qrTotal = portalData?.data?.pagination?.total || 0;
    const qrSummary = portalData?.data?.summary;
    return (
      <div className="admin-resource">
        <div className="admin-resource-heading">
          <div>
            <span className="admin-eyebrow">QR INVENTORY</span>
            <h2>QR Management</h2>
            <p>See which QR codes exist, who holds them, and what was printed most recently.</p>
          </div>
          <div className="admin-heading-actions">
            {can('qr.create') && (
              <button className="admin-outline-button" onClick={() => { setShowGenerateQr((current) => !current); setGenerateQrResult(null); }}>
                <Icon path={ICONS.plus} />
                Generate QR codes
              </button>
            )}
            {portalData.account.role === 'ADMIN' && (
              <button className="admin-primary-button" onClick={openPrintWizard}>
                <Icon path={ICONS.qr} />
                Print QR Codes
              </button>
            )}
          </div>
        </div>
        {showGenerateQr && can('qr.create') && (
          <div className="admin-form-card admin-qr-generate-panel">
            {generateQrResult ? (
              <>
                <p><strong>{generateQrResult.count} QR code{generateQrResult.count === 1 ? '' : 's'} generated</strong>: {generateQrResult.rangeStart}{generateQrResult.rangeEnd !== generateQrResult.rangeStart ? ` – ${generateQrResult.rangeEnd}` : ''}.</p>
                <div className="admin-form-actions">
                  <button type="button" className="admin-outline-button" onClick={() => setGenerateQrResult(null)}>Generate more</button>
                  <button type="button" className="admin-primary-button" onClick={printGeneratedCodes}>Print these codes <Icon path={ICONS.arrow} /></button>
                </div>
              </>
            ) : (
              <form onSubmit={generateQrBatch} className="admin-qr-generate-form">
                <label>
                  How many QR codes?
                  <input type="number" min="1" max="5000" value={generateQrQuantity} onChange={(event) => setGenerateQrQuantity(event.target.value)} />
                </label>
                <small>Codes continue sequentially from the highest existing V-#### code (e.g. V-0100 – V-0199 for 100). Assign them to a Solar Mitra, or map a range to a template from Print QR Codes afterward.</small>
                <div className="admin-form-actions">
                  <button type="button" className="admin-outline-button" onClick={() => setShowGenerateQr(false)}>Cancel</button>
                  <button type="submit" className="admin-primary-button" disabled={generateQrBusy}>{generateQrBusy ? 'Generating...' : 'Generate'}</button>
                </div>
              </form>
            )}
          </div>
        )}
        <div className="admin-qr-overview">
          <div className="admin-qr-overview-intro"><span className="admin-eyebrow">INVENTORY CONTROL</span><strong>{(qrSummary?.total ?? qrTotal).toLocaleString()} QR codes</strong><small>Assignment and print status at a glance.</small></div>
          {qrSummary && <div className="admin-qr-overview-stat success"><span>Assigned</span><strong>{qrSummary.assigned.toLocaleString()}</strong></div>}
          {qrSummary && <div className="admin-qr-overview-stat warning"><span>Unassigned</span><strong>{qrSummary.unassigned.toLocaleString()}</strong></div>}
          <div className="admin-qr-overview-stat"><span>Showing</span><strong>{qrs.length.toLocaleString()} of {qrTotal.toLocaleString()}</strong></div>
        </div>
        {qrSummary && qrSummary.consistent === false && can('qr.repair') && (
          <p className="admin-audit-capacity-note" role="alert">
            Inventory check needed: assigned + unassigned does not add up to the total.{' '}
            {qrRepair ? (qrRepair.affected > 0
              ? <button type="button" className="admin-mini-button" disabled={loading} onClick={() => checkQrInventory(true)}>Fix {qrRepair.affected} code{qrRepair.affected === 1 ? '' : 's'}</button>
              : 'Nothing to repair automatically; the counts need a manual look.')
              : <button type="button" className="admin-mini-button" disabled={loading} onClick={() => checkQrInventory(false)}>Check inventory</button>}
          </p>
        )}
        <div className="admin-filter-bar">
          <div className="admin-filter"><Icon path={ICONS.filter} /><select value={qrStatus} onChange={(event) => { setQrStatus(event.target.value); loadAdminResource('qr', 1, event.target.value, qrAssignment); }}><option value="">All statuses</option><option value="ACTIVE">Active</option><option value="UNASSIGNED">Unassigned</option></select></div>
          <div className="admin-filter"><Icon path={ICONS.store} /><select value={qrAssignment} onChange={(event) => { setQrAssignment(event.target.value); loadAdminResource('qr', 1, qrStatus, event.target.value); }}><option value="">All assignments</option><option value="ASSIGNED">Assigned</option><option value="UNASSIGNED">Unassigned</option></select></div>
          <button className="admin-outline-button" disabled={loading} onClick={() => loadAdminResource('qr', adminPage, undefined, undefined, true)}><Icon path={ICONS.refresh} /> Refresh</button>
        </div>
        <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>QR code</th><th>Current Solar Mitra</th><th>Latest design</th><th>Status</th><th>Assigned</th><th>Actions</th></tr></thead><tbody>
          {qrs.length ? qrs.map((qr) => {
            const currentVendor = qr.assignments?.[0]?.vendor;
            const displayStatus = currentVendor ? qr.status : 'UNASSIGNED';
            return <tr key={qr.id}>
              <td><span className="admin-qr-code"><Icon path={ICONS.qr} />{qr.code}</span></td>
              <td>{currentVendor?.businessName || 'Unassigned'}</td>
              <td>{qr.latestPrint ? <div className="admin-primary-cell"><strong>{qr.latestPrint.templateName}</strong><small>{new Date(qr.latestPrint.printedAt).toLocaleDateString()} · {qr.latestPrint.kind === 'SINGLE' ? 'single' : 'batch'}</small>{portalData.account.role === 'ADMIN' && <button type="button" className="admin-mini-button" onClick={() => openQrPrintHistory(qr)}>History</button>}</div> : <span className="admin-muted-text">Not printed</span>}</td>
              <td><span className={`admin-status ${displayStatus === 'UNASSIGNED' ? 'warning' : displayStatus === 'ACTIVE' ? 'active' : 'inactive'}`}>{displayStatus}</span></td>
              <td>{qr.assignments?.[0]?.assignedAt ? new Date(qr.assignments[0].assignedAt).toLocaleDateString() : '—'}</td>
              <td><div className="admin-qr-action">{(currentVendor ? can('qr.reassign') : can('qr.assign')) && <><VendorPicker fetchPage={fetchAssignableVendors} value={reassignVendorInputs[qr.id] || ''} onChange={(id) => setReassignVendorInputs({ ...reassignVendorInputs, [qr.id]: id })} ariaLabel={`Solar Mitra for ${qr.code}`} />{confirmAssignQrId === qr.id ? <span className="admin-inline-confirm"><button className="admin-mini-button primary solid" disabled={loading} onClick={() => assignQr(qr, Boolean(currentVendor))}>Confirm</button><button className="admin-mini-button admin-inline-confirm-cancel" disabled={loading} onClick={() => setConfirmAssignQrId(null)} aria-label="Cancel assignment"><Icon path={ICONS.close} /></button></span> : <button className="admin-mini-button" disabled={loading} onClick={() => armAssignQr(qr)}>{currentVendor ? 'Reassign' : 'Assign'}</button>}</>}{portalData.account.role === 'ADMIN' && !currentVendor && (confirmDeleteQrId === qr.id ? <span className="admin-inline-confirm"><button className="admin-mini-button danger solid" disabled={loading} onClick={() => deleteQr(qr)}>Confirm delete</button><button className="admin-mini-button admin-inline-confirm-cancel" disabled={loading} onClick={() => setConfirmDeleteQrId(null)} aria-label="Cancel delete"><Icon path={ICONS.close} /></button></span> : <button className="admin-mini-button danger" disabled={loading} title="Delete only if this QR has never been used" onClick={() => setConfirmDeleteQrId(qr.id)}>Delete</button>)}{portalData.account.role === 'ADMIN' && <button className="admin-mini-button danger" disabled={loading} title="Permanently remove this QR and all linked history" onClick={() => { setConfirmPurgeQrId(qr.id); setPurgeQrConfirmText(''); }}>Purge history</button>}</div></td>
            </tr>;
          }) : <tr><td colSpan="6" className="admin-empty">No QR codes found.</td></tr>}
        </tbody></table></div>
        {renderPagination()}
      </div>
    );
  }

  function renderTemplates() {
    return (
      <div className="admin-resource">
        <div className="admin-resource-heading"><div><span className="admin-eyebrow">PRINT DESIGNS</span><h2>Templates</h2><p>Reusable designs for printing QR codes.</p></div><div className="admin-row-actions"><button className="admin-outline-button" disabled={loading} onClick={() => loadAdminResource('templates', 1, undefined, undefined, true)}><Icon path={ICONS.refresh} /> Refresh</button><button className="admin-primary-button" onClick={() => setShowTemplateForm(true)}><Icon path={ICONS.plus} /> Create Template</button></div></div>
        {showTemplateForm && renderTemplateEditor()}
        <div className="admin-template-cards">
          {(qrTemplates || []).length ? qrTemplates.map((template) => <div className="admin-template-card" key={template.id}>
            <button type="button" className="admin-template-thumb" onClick={() => template.artworkUrl && previewQrTemplateArtwork(template)} aria-label={`Preview ${template.name}`}>
              {template.artworkUrl ? <img src={template.artworkUrl} alt="" /> : <span>Blank page</span>}
              <span className="admin-template-thumb-qr">QR</span>
            </button>
            <div className="admin-template-card-body"><div className="admin-template-card-heading"><div><strong>{template.name}</strong><span>{qrStatusLabel(template.status)}</span>{template.vendorPoster && template.status === 'PUBLISHED' && <span className="admin-status active">Used for Solar Mitra posters</span>}</div><small>v{template.version}</small></div><p>{template.pageWidthMm} × {template.pageHeightMm} mm · {template.dpi} DPI</p><small className="admin-muted-text">{printCountLabel(template)}</small><div className="admin-template-card-actions"><button type="button" className="admin-mini-button" onClick={() => template.artworkUrl && previewQrTemplateArtwork(template)}>Preview</button>{template.status !== 'ARCHIVED' && <button type="button" className="admin-mini-button" onClick={() => startTemplateVersion(template)}>New version</button>}{template.status === 'ARCHIVED' ? <button type="button" className="admin-mini-button" onClick={() => restoreQrTemplate(template.id)}>Restore</button> : <button type="button" className="admin-mini-button" onClick={() => template.printJobCount ? setConfirmArchiveTemplateId(template.id) : setConfirmDeleteTemplateId(template.id)}>{template.printJobCount ? 'Archive' : 'Delete'}</button>}{template.status === 'DRAFT' && <button type="button" className="admin-mini-button primary" onClick={() => publishQrTemplate(template.id)}>Publish</button>}{template.status === 'PUBLISHED' && !template.vendorPoster && <button type="button" className="admin-mini-button" disabled={loading} onClick={() => setSolarMitraPosterTemplate(template.id)}>Use for Solar Mitras</button>}</div></div>
          </div>) : <div className="admin-empty admin-empty-block">No templates yet. Create the first reusable print design.</div>}
        </div>
        {confirmArchiveTemplateId && <div className="admin-template-inline-notice"><span>This template has print history. Archive it to remove it from future printing.</span><button className="admin-mini-button primary solid" onClick={() => archiveQrTemplate(confirmArchiveTemplateId)}>Confirm archive</button><button className="admin-mini-button" onClick={() => setConfirmArchiveTemplateId(null)}>Cancel</button></div>}
        {confirmDeleteTemplateId && <div className="admin-template-inline-notice"><span>This unused template can be deleted permanently.</span><button className="admin-mini-button danger solid" onClick={() => deleteQrTemplate(confirmDeleteTemplateId)}>Confirm delete</button><button className="admin-mini-button" onClick={() => setConfirmDeleteTemplateId(null)}>Cancel</button></div>}
      </div>
    );
  }

  function renderTemplateEditor() {
    return <form onSubmit={createQrTemplate} className="admin-template-editor-shell">
      <div className="admin-template-editor-title"><div><span className="admin-eyebrow">CREATE TEMPLATE</span><h3>Build a reusable print design</h3><p>Upload the artwork, place the QR, review the page, then publish it for printing.</p></div><button type="button" className="admin-outline-button" onClick={() => setShowTemplateForm(false)}>Cancel</button></div>
      <div className="admin-template-editor-layout"><div><div className="admin-template-preview-heading"><div><strong>QR placement preview</strong><small>Drag the square QR marker or resize it from the corner.</small></div><span>QR size: {Number(templateDraft.qr_width || 0).toFixed(1)} × {Number(templateDraft.qr_height || 0).toFixed(1)} mm</span></div><div className="admin-template-preview" data-qr-template-editor style={{ aspectRatio: `${Number(templateDraft.page_width_mm) || 210} / ${Number(templateDraft.page_height_mm) || 297}` }}>{templateArtworkPreview && templateArtwork?.type === 'application/pdf' && <iframe src={`${templateArtworkPreview}#toolbar=0&navpanes=0&scrollbar=0&view=Fit`} title="Uploaded artwork preview" />}{templateArtworkPreview && templateArtwork?.type !== 'application/pdf' && <img src={templateArtworkPreview} alt="Uploaded artwork" />}{!templateArtworkPreview && <div className="admin-template-preview-empty">Upload artwork to see the physical page.</div>}<div className="admin-qr-placeholder" style={{ left: `${(Number(templateDraft.qr_x) / (Number(templateDraft.page_width_mm) || 210)) * 100}%`, top: `${(Number(templateDraft.qr_y) / (Number(templateDraft.page_height_mm) || 297)) * 100}%`, width: `${(Number(templateDraft.qr_width) / (Number(templateDraft.page_width_mm) || 210)) * 100}%`, height: `${(Number(templateDraft.qr_height) / (Number(templateDraft.page_height_mm) || 297)) * 100}%` }} onPointerDown={(event) => beginTemplateInteraction(event, 'drag')}><span>QR</span><button type="button" aria-label="Resize QR placeholder" onPointerDown={(event) => beginTemplateInteraction(event, 'resize')} /></div></div></div><div className="admin-template-editor-note"><span className="admin-eyebrow">PHYSICAL PLACEMENT</span><strong>What you see here is what will print.</strong><p>PNG, JPG or single-page PDF · Maximum 8 MB</p></div></div>
      <div className="admin-template-editor-fields"><label>Template name<input required value={templateDraft.name} onChange={(event) => setTemplateDraft({ ...templateDraft, name: event.target.value })} /></label><label>Artwork upload<input required={false} type="file" accept="image/png,image/jpeg,application/pdf" onChange={handleTemplateArtworkSelect} /><small>{templateArtwork ? templateArtwork.name : 'PNG, JPG or single-page PDF · Maximum 8 MB'}</small></label><label>Page width (mm)<input type="number" value={templateDraft.page_width_mm} onChange={(event) => setTemplateDraft({ ...templateDraft, page_width_mm: event.target.value })} /></label><label>Page height (mm)<input type="number" value={templateDraft.page_height_mm} onChange={(event) => setTemplateDraft({ ...templateDraft, page_height_mm: event.target.value })} /></label><label>DPI<input type="number" value={templateDraft.dpi} onChange={(event) => setTemplateDraft({ ...templateDraft, dpi: event.target.value })} /></label></div>
      <details className="admin-advanced-placement"><summary>Advanced placement</summary><div className="admin-template-editor-fields"><label>QR X<input type="number" value={templateDraft.qr_x} onChange={(event) => setTemplateDraft({ ...templateDraft, qr_x: event.target.value })} /></label><label>QR Y<input type="number" value={templateDraft.qr_y} onChange={(event) => setTemplateDraft({ ...templateDraft, qr_y: event.target.value })} /></label><label>QR size<input type="number" value={templateDraft.qr_width} onChange={(event) => setTemplateDraft({ ...templateDraft, qr_width: event.target.value, qr_height: event.target.value })} /></label></div></details>
      <label className="admin-toggle-row"><input type="checkbox" checked={templateDraft.label_enabled} onChange={(event) => setTemplateDraft({ ...templateDraft, label_enabled: event.target.checked })} /> Add QR text label</label>
      {templateDraft.label_enabled && <div className="admin-template-editor-fields"><label>Label X<input type="number" value={templateDraft.label_text_x} onChange={(event) => setTemplateDraft({ ...templateDraft, label_text_x: event.target.value })} /></label><label>Label Y<input type="number" value={templateDraft.label_text_y} onChange={(event) => setTemplateDraft({ ...templateDraft, label_text_y: event.target.value })} /></label><label>Font size<input type="number" value={templateDraft.label_font_size} onChange={(event) => setTemplateDraft({ ...templateDraft, label_font_size: event.target.value })} /></label></div>}
      <div className="admin-form-actions"><button type="button" className="admin-outline-button" onClick={() => setShowTemplateForm(false)}>Save draft later</button><button className="admin-primary-button" disabled={loading}>{loading ? 'Saving...' : 'Save template'}</button></div>
    </form>;
  }

  function renderPrintWizard() {
    const selectedTemplate = qrTemplates.find((template) => template.id === printWizardDraft.template_id);
    function normalizeWizardCode(value) {
      const normalized = String(value || '').trim().toUpperCase();
      const match = normalized.match(/^V-(\d+)$/);
      return match ? `V-${match[1].padStart(4, '0')}` : normalized;
    }
    const rangeStart = printWizardMode === 'range' ? normalizeWizardCode(printWizardDraft.range_start) : normalizeWizardCode(printWizardDraft.code);
    const rangeEnd = printWizardMode === 'range' ? normalizeWizardCode(printWizardDraft.range_end) : normalizeWizardCode(printWizardDraft.code);
    const validCodes = /^V-\d{4,}$/.test(rangeStart) && /^V-\d{4,}$/.test(rangeEnd);
    const rangeOrderValid = printWizardMode !== 'range' || (validCodes && Number(rangeStart.replace(/\D/g, '')) <= Number(rangeEnd.replace(/\D/g, '')));
    const selectedCount = printWizardMode === 'range' && rangeOrderValid ? Number(rangeEnd.replace(/\D/g, '')) - Number(rangeStart.replace(/\D/g, '')) + 1 : printWizardMode === 'individual' && validCodes ? 1 : 0;
    // Step 1 cannot be left behind a range/code with missing QR codes — this is what turns the
    // old dead-end (a 409 two steps later, on "Review placement") into something the admin can
    // actually see and fix right here.
    const hasGap = printRangeCheck.checked && printRangeCheck.missingCount > 0;
    const canContinue = printWizardStep === 1
      ? validCodes && rangeOrderValid && printRangeCheck.checked && !printRangeCheck.loading && !printRangeCheck.error && !hasGap
      : true;
    async function generateMissingCodes() {
      setPrintGenerateBusy(true);
      try {
        const result = await apiRequest('/admin/qr/generate-range', { method: 'POST', body: JSON.stringify({ range_start: rangeStart, range_end: rangeEnd }) });
        const recheck = await apiRequest(`/admin/qr/range-check?range_start=${encodeURIComponent(rangeStart)}&range_end=${encodeURIComponent(rangeEnd)}`, { forceRefresh: true });
        setPrintRangeCheck({ loading: false, checked: true, total: recheck.total, existingCount: recheck.existingCount, missingCount: recheck.missingCount, error: '' });
        setMessage(`${result.created} QR code${result.created === 1 ? '' : 's'} generated.`);
        setMessageType('success');
      } catch (error) {
        setMessage(error.message);
        setMessageType('error');
      } finally {
        setPrintGenerateBusy(false);
      }
    }
    async function createWizardJob() {
      if (printWizardMode === 'individual' || !printWizardDraft.template_id) { setPrintWizardStep(3); return; }
      if (printBusyRef.current) return;
      printBusyRef.current = true;
      setPrintWizardBusy(true);
      setPrintProofState({ loading: false, error: '', url: '', ready: false });
      printProofAttemptRef.current = null;
      if (!printBatchNonceRef.current) printBatchNonceRef.current = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      const idempotencyKey = `qr-print-${printBatchNonceRef.current}-${printWizardDraft.template_id}-${rangeStart}-${rangeEnd}`;
      try {
        const result = await apiRequest('/admin/qr/print-batch', { method: 'POST', body: JSON.stringify({ template_id: printWizardDraft.template_id, range_start: rangeStart, range_end: rangeEnd, idempotency_key: idempotencyKey }), label: 'Creating print batch', dedupe: true });
        setPrintWizardJob(result.job);
        setPrintWizardStep(3);
      } catch (error) {
        setMessage(error.message);
        setMessageType('error');
      } finally {
        printBusyRef.current = false;
        setPrintWizardBusy(false);
      }
    }
    async function approveWizardJob() {
      if (!printWizardJob || printBusyRef.current) return;
      printBusyRef.current = true;
      setPrintWizardBusy(true);
      try {
        const result = await apiRequest(`/admin/qr/print-batch/${encodeURIComponent(printWizardJob.id)}/approve`, { method: 'POST', body: '{}', label: 'Approving proof', dedupe: true });
        setPrintWizardJob(result.job);
        setPrintWizardStep(4);
      } catch (error) {
        setMessage(error.message);
        setMessageType('error');
      } finally {
        printBusyRef.current = false;
        setPrintWizardBusy(false);
      }
    }
    // One download path for all three print types. Errors keep the user on step 4 so they can retry;
    // success flips to the finish state (no automatic navigation - the user picks what happens next).
    async function runWizardDownload() {
      if (printBusyRef.current) return;
      printBusyRef.current = true;
      setPrintWizardBusy(true);
      try {
        if (!selectedTemplate) {
          const params = new URLSearchParams(printWizardMode === 'individual' ? { code: rangeStart } : { range_start: rangeStart, range_end: rangeEnd });
          await downloadFile(`/admin/qr/pdf?${params.toString()}`, `${rangeStart}-qr-codes.pdf`, 'Generating PDF');
        } else if (printWizardMode === 'individual') {
          const params = new URLSearchParams({ template_id: printWizardDraft.template_id, code: rangeStart });
          await downloadFile(`/admin/qr/template-pdf?${params.toString()}`, `${rangeStart}-template.pdf`, 'Generating PDF');
        } else {
          await downloadFile(`/admin/qr/print-batch/${encodeURIComponent(printWizardJob.id)}/pdf`, selectedCount > PRINT_PDF_CHUNK_PAGES ? `${rangeStart}-print-files.zip` : `${rangeStart}-template.pdf`, selectedCount > PRINT_PDF_CHUNK_PAGES ? 'Preparing print files' : 'Generating PDF');
        }
        setPrintDone(true);
      } catch (error) {
        setMessage(error.message);
        setMessageType('error');
      } finally {
        printBusyRef.current = false;
        setPrintWizardBusy(false);
      }
    }
    return <div className="admin-resource admin-print-wizard"><div className="admin-resource-heading"><div><span className="admin-eyebrow">PRINT WORKFLOW</span><h2>Print QR Codes</h2><p>Select the codes, choose a design, review the proof, then print.</p></div><button className="admin-outline-button" onClick={() => setResource('qr')}>Back to QR Management</button></div><div className="admin-qr-wizard-steps">{['Select QR codes', 'Choose design', 'Review proof', 'Generate PDF'].map((label, index) => <span key={label} className={printWizardStep === index + 1 ? 'active' : ''}><b>{index + 1}</b>{label}</span>)}</div>
      {printWizardStep === 1 && <section className="admin-wizard-panel"><span className="admin-eyebrow">STEP 1</span><h3>What do you want to print?</h3><div className="admin-wizard-choice-grid"><button type="button" className={printWizardMode === 'range' ? 'selected' : ''} onClick={() => setPrintWizardMode('range')}><strong>QR range</strong><small>Print a continuous range of QR codes</small></button><button type="button" className={printWizardMode === 'individual' ? 'selected' : ''} onClick={() => setPrintWizardMode('individual')}><strong>Specific QR code</strong><small>Print one QR code</small></button></div>{printWizardMode === 'range' ? <div className="admin-wizard-fields"><label>Range start<input placeholder="V-0001" value={printWizardDraft.range_start} onChange={(event) => setPrintWizardDraft({ ...printWizardDraft, range_start: event.target.value })} /></label><label>Range end<input placeholder="V-0100" value={printWizardDraft.range_end} onChange={(event) => setPrintWizardDraft({ ...printWizardDraft, range_end: event.target.value })} /></label></div> : <label className="admin-wizard-field-wide">QR code<input placeholder="V-0042" value={printWizardDraft.code} onChange={(event) => setPrintWizardDraft({ ...printWizardDraft, code: event.target.value })} /></label>}<div className="admin-wizard-count">{selectedCount ? `${selectedCount.toLocaleString()} QR code${selectedCount === 1 ? '' : 's'} selected` : 'Use a code such as V-0001, or enter a start and end range.'}{selectedCount > 0 && printRangeCheck.loading && ' — checking inventory...'}{selectedCount > 0 && printRangeCheck.checked && !printRangeCheck.loading && (hasGap ? ` — ${printRangeCheck.existingCount} already exist, ${printRangeCheck.missingCount} will need generating` : ' — all already exist in inventory')}</div>{printRangeCheck.error && <p role="alert" className="admin-wizard-helper">{printRangeCheck.error}</p>}{hasGap && <div className="admin-wizard-gap-notice"><span>{printRangeCheck.missingCount} of these QR codes don't exist yet. Generate them here, or narrow the range to codes already in inventory.</span><button type="button" className="admin-outline-button" disabled={printGenerateBusy} onClick={generateMissingCodes}>{printGenerateBusy ? 'Generating...' : `Generate ${printRangeCheck.missingCount} missing QR code${printRangeCheck.missingCount === 1 ? '' : 's'}`}</button></div>}<div className="admin-form-actions"><button type="button" className="admin-primary-button" disabled={!canContinue} onClick={() => setPrintWizardStep(2)}>Choose design <Icon path={ICONS.arrow} /></button></div></section>}
      {printWizardStep === 2 && <section className="admin-wizard-panel"><span className="admin-eyebrow">STEP 2</span><h3>Choose a design</h3><p className="admin-wizard-helper">Pick a published template or print simple QR codes without artwork.</p><div className="admin-design-grid"><button type="button" className={`admin-design-card ${!printWizardDraft.template_id ? 'selected' : ''}`} onClick={() => setPrintWizardDraft({ ...printWizardDraft, template_id: '' })}><div className="admin-design-thumb blank">QR</div><strong>Blank QR</strong><small>Print QR codes without artwork</small></button>{qrTemplates.filter((template) => template.status === 'PUBLISHED').map((template) => <button type="button" key={template.id} className={`admin-design-card ${printWizardDraft.template_id === template.id ? 'selected' : ''}`} onClick={() => setPrintWizardDraft({ ...printWizardDraft, template_id: template.id })}><div className="admin-design-thumb">{template.artworkUrl && <img src={template.artworkUrl} alt="" />}<span>QR</span></div><strong>{template.name}</strong><small>{qrStatusLabel(template.status)} · {template.pageWidthMm} × {template.pageHeightMm} mm</small></button>)}</div><div className="admin-form-actions"><button className="admin-outline-button" onClick={() => setPrintWizardStep(1)}>Back</button><button className="admin-primary-button" onClick={createWizardJob}>Review placement <Icon path={ICONS.arrow} /></button></div></section>}
      {printWizardStep === 3 && <section className="admin-wizard-panel"><span className="admin-eyebrow">STEP 3</span><h3>Review proof</h3>{selectedTemplate && printWizardMode !== 'individual' && <>{printProofState.loading && <div className="admin-wizard-blank-preview"><Icon path={ICONS.qr} /><strong>Generating proof...</strong><span>Rendering the real artwork and QR placement.</span></div>}{printProofState.error && <div className="admin-wizard-gap-notice"><span role="alert">{printProofState.error}</span><button type="button" className="admin-outline-button" onClick={() => runPrintProof(printWizardJob.id)}>Retry</button></div>}{printProofState.ready && <div className="admin-wizard-review"><iframe className="admin-template-preview-frame" src={printProofState.url} title="Print proof" /><div className="admin-wizard-summary"><strong>{selectedTemplate.name}</strong><span>QR: {rangeStart}{rangeEnd !== rangeStart ? ` → ${rangeEnd}` : ''}</span><span>QR size: {selectedTemplate.qrWidth} × {selectedTemplate.qrHeight} mm</span><span>Page: {selectedTemplate.pageWidthMm} × {selectedTemplate.pageHeightMm} mm</span>{selectedTemplate.labelEnabled && <span>Label: on</span>}</div></div>}</>}{selectedTemplate && printWizardMode === 'individual' && <div className="admin-wizard-review"><iframe className="admin-template-preview-frame" src={`${API_BASE_URL}/admin/qr/template-pdf?${new URLSearchParams({ template_id: printWizardDraft.template_id, code: rangeStart, inline: 'true' }).toString()}`} title="Print preview" /><div className="admin-wizard-summary"><strong>{selectedTemplate.name}</strong><span>QR: {rangeStart}</span><span>QR size: {selectedTemplate.qrWidth} × {selectedTemplate.qrHeight} mm</span><span>Page: {selectedTemplate.pageWidthMm} × {selectedTemplate.pageHeightMm} mm</span></div></div>}{!selectedTemplate && <div className="admin-wizard-blank-preview"><Icon path={ICONS.qr} /><strong>Blank QR</strong><span>The QR codes will print without artwork.</span></div>}<div className="admin-form-actions"><button className="admin-outline-button" onClick={() => setPrintWizardStep(2)}>Back</button>{selectedTemplate && printWizardMode !== 'individual' ? <button className="admin-primary-button" disabled={!printProofState.ready || printWizardBusy} onClick={approveWizardJob}>{printWizardBusy ? 'Approving...' : 'Approve proof'}</button> : <button className="admin-primary-button" onClick={() => setPrintWizardStep(4)}>Continue <Icon path={ICONS.arrow} /></button>}</div></section>}
      {printWizardStep === 4 && <section className="admin-wizard-panel"><span className="admin-eyebrow">STEP 4</span><h3>Generate PDF</h3><div className="admin-wizard-final-summary"><strong>{selectedCount.toLocaleString()} QR codes ready</strong><span>QR: {rangeStart}{rangeEnd !== rangeStart ? ` → ${rangeEnd}` : ''}</span><span>Design: {selectedTemplate?.name || 'Blank QR'}</span><span>Print type: {selectedTemplate ? (printWizardMode === 'individual' ? 'Single designed print' : 'Print batch') : 'Blank QR'}</span></div>{printDone ? <div className="admin-wizard-review" role="status"><strong>Download complete.</strong><span>{selectedCount > PRINT_PDF_CHUNK_PAGES && selectedTemplate && printWizardMode !== 'individual' ? `Unzip it: each PDF holds up to ${PRINT_PDF_CHUNK_PAGES} QR codes, in order. ` : ''}Check your downloads folder. What next?</span><div className="admin-form-actions"><button className="admin-primary-button" onClick={openPrintWizard}>Print another batch</button><button className="admin-outline-button" onClick={() => { resetPrintWizardState(); setResource('qr'); }}>Back to QR Management</button></div></div> : <div className="admin-form-actions"><button className="admin-outline-button" disabled={printWizardBusy} onClick={() => setPrintWizardStep(3)}>Back</button>{selectedTemplate && printWizardMode !== 'individual' && <button className="admin-outline-button" disabled={printWizardBusy} onClick={() => viewPrintProof(printWizardJob)}>View proof again</button>}<button className="admin-primary-button" disabled={printWizardBusy} onClick={runWizardDownload}>{printWizardBusy ? (selectedCount > PRINT_PDF_CHUNK_PAGES && selectedTemplate && printWizardMode !== 'individual' ? 'Preparing print files…' : 'Generating PDF…') : (selectedCount > PRINT_PDF_CHUNK_PAGES && selectedTemplate && printWizardMode !== 'individual' ? 'Download print files (ZIP)' : 'Generate Print PDF')}</button></div>}</section>}
    </div>;
  }

  function renderQr() {
    return renderQrInventory();
  }

  function renderLeads() {
    const leads =
      portalData?.data?.leads || [];

    return (
      <div className="admin-resource">
        <div className="admin-resource-heading">
          <div>
            <span className="admin-eyebrow">
              LEAD MANAGEMENT
            </span>
            <h2>Leads</h2>
            <p>
              Review customer enquiries and preserve
              their referral attribution.
            </p>
          </div>

          <div className="admin-heading-actions">
            {can('leads.export') && (
              <ExportRangeButton
                path="/admin/leads/export"
                fallbackName="solarium-leads.csv"
                dateLabel="by the date each lead was created"
              />
            )}

            {can('leads.import') && (
              <button
                className="admin-primary-button"
                onClick={() => setShowImportLeads((current) => !current)}
              >
                <Icon path={ICONS.plus} />
                Import CSV
              </button>
            )}

            <button
              className="admin-outline-button"
              onClick={() =>
                loadAdminResource(
                  'leads',
                  adminPage,
                  undefined,
                  undefined,
                  true
                )
              }
            >
              <Icon path={ICONS.refresh} />
              Refresh
            </button>
          </div>
        </div>

        {showImportLeads && can('leads.import') && (
          <form onSubmit={importLeadsCsv} className="admin-form-card admin-leads-import">
            <div>
              <div className="admin-form-title">Import company leads</div>
              <p>
                Upload a CSV of leads the company already has. Imported
                leads are stored as "Company Uploaded Leads" — no QR scan
                or Solar Mitra referral is involved.
              </p>
            </div>
            <button
              type="button"
              className="admin-outline-button"
              onClick={downloadLeadsImportTemplate}
            >
              Download template
            </button>
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(event) =>
                setImportFile(event.target.files?.[0] || null)
              }
            />
            <small>
              {importFile ? importFile.name : 'Select a .csv file (max 5 MB, 2000 rows)'}
            </small>
            <button className="admin-primary-button" disabled={loading || !importFile}>
              {loading ? 'Importing...' : 'Import'}
            </button>
            <button
              type="button"
              className="admin-outline-button"
              disabled={loading}
              onClick={() => {
                setShowImportLeads(false);
                setImportFile(null);
              }}
            >
              Cancel
            </button>
          </form>
        )}

        <div className="admin-toolbar">
          <div className="admin-search">
            <Icon path={ICONS.search} />
            <input
              placeholder="Search leads..."
              value={leadSearch}
              onChange={(event) =>
                setLeadSearch(event.target.value)
              }
            />
          </div>

          <div className="admin-filter">
            <Icon path={ICONS.filter} />
            <select
              aria-label="Filter by status"
              value={leadStatusFilter}
              onChange={(event) => changeLeadFilters(event.target.value, leadAssignFilter)}
            >
              <option value="">All statuses</option>
              {LEAD_STATUS_OPTIONS.map((status) => <option key={status} value={status}>{status}</option>)}
            </select>
          </div>

          <div className="admin-filter">
            <Icon path={ICONS.filter} />
            <select
              aria-label="Filter by assignee"
              value={leadAssignFilter}
              onChange={(event) => changeLeadFilters(leadStatusFilter, event.target.value)}
            >
              <option value="">Everyone</option>
              <option value="unassigned">Unassigned</option>
              {assignableStaff.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}
            </select>
          </div>
        </div>

        {can('leads.assign') && selectedLeadIds.length > 0 && (
          <div className="admin-bulk-bar" role="region" aria-label="Assign selected leads">
            <strong>{selectedLeadIds.length} selected</strong>
            <select aria-label="Assign to" value={bulkAssignee} onChange={(event) => setBulkAssignee(event.target.value)}>
              <option value="">Choose a BDE...</option>
              <option value="__none">Unassign</option>
              {assignableStaff.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}
            </select>
            <button className="admin-primary-button" disabled={loading || !bulkAssignee} onClick={bulkAssignLeads}>Assign</button>
            <button className="admin-outline-button" onClick={() => setSelectedLeadIds([])}>Clear</button>
          </div>
        )}

        {renderLeadsByVendor(leads)}

        {renderPagination()}
      </div>
    );
  }

  function renderLeadsByVendor(leads) {
    const query = leadSearch.trim().toLowerCase();

    const filtered = leads.filter((lead) => {
      if (!query) return true;
      return [
        lead.customerName,
        lead.phone,
        lead.email,
        lead.pincode,
        lead.averageElectricityBill,
        lead.solarSize,
        lead.id,
        leadVendorLabel(lead),
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query));
    });

    if (!filtered.length) {
      return <div className="admin-empty admin-empty-block">No leads yet.</div>;
    }

    // One vendor's leads together under a collapsible header, instead of a flat table where
    // finding "everything for vendor X" means scanning every row — this is per-page grouping
    // (grouping the leads already loaded for the current page), not a separate unbounded fetch.
    const groups = new Map();
    for (const lead of filtered) {
      const key = lead.vendorId || 'unknown';
      if (!groups.has(key)) {
        groups.set(key, { vendorName: leadVendorLabel(lead), leads: [] });
      }
      groups.get(key).leads.push(lead);
    }

    // Searching should surface matches immediately rather than requiring the admin to also
    // expand the right group by hand.
    const autoExpand = Boolean(query);

    return (
      <div className="admin-vendor-groups">
        {Array.from(groups.entries()).map(([vendorId, group]) => {
          const isOpen = autoExpand || Boolean(expandedVendorGroups[vendorId]);

          return (
            <div className="admin-vendor-group" key={vendorId}>
              <button
                type="button"
                className="admin-vendor-group-header"
                onClick={() =>
                  setExpandedVendorGroups({
                    ...expandedVendorGroups,
                    [vendorId]: !expandedVendorGroups[vendorId],
                  })
                }
                aria-expanded={isOpen}
              >
                <Icon
                  path={ICONS.arrow}
                  className={`admin-vendor-group-chevron ${isOpen ? 'open' : ''}`}
                />
                <span className="admin-vendor-group-name">{group.vendorName}</span>
                <span className="admin-vendor-group-count">
                  {group.leads.length} {group.leads.length === 1 ? 'lead' : 'leads'}
                </span>
              </button>

              {isOpen && (
                <div className="admin-table-wrap">
                  <table className="admin-table">
                    <thead>
                      <tr>
                        {can('leads.assign') && (
                          <th>
                            <input
                              type="checkbox"
                              aria-label={`Select all ${group.vendorName} leads`}
                              checked={group.leads.every((lead) => selectedLeadIds.includes(lead.id))}
                              onChange={(event) => {
                                const ids = group.leads.map((lead) => lead.id);
                                setSelectedLeadIds((current) => (event.target.checked ? [...new Set([...current, ...ids])] : current.filter((id) => !ids.includes(id))));
                              }}
                            />
                          </th>
                        )}
                        <th>Customer</th>
                        <th>QR</th>
                        <th>Location</th>
                        <th>Qualification</th>
                        <th>Status</th>
                        <th>Assigned to</th>
                        <th>Lead date</th>
                        {can('payouts.view') && <th>Commission</th>}
                        <th />
                      </tr>
                    </thead>

                    <tbody>
                      {group.leads.map((lead) => (
                        <tr key={lead.id}>
                          {can('leads.assign') && (
                            <td>
                              <input
                                type="checkbox"
                                aria-label={`Select ${lead.customerName}`}
                                checked={selectedLeadIds.includes(lead.id)}
                                onChange={(event) => setSelectedLeadIds((current) => (event.target.checked ? [...current, lead.id] : current.filter((id) => id !== lead.id)))}
                              />
                            </td>
                          )}
                          <td>
                            <div className="admin-primary-cell">
                              <strong>{lead.customerName}</strong>
                              <small>{lead.phone || lead.email || lead.id}</small>
                            </div>
                          </td>

                          <td>
                            <span className="admin-code">
                              {lead.qr?.code || lead.qrId || '—'}
                            </span>
                          </td>

                          <td>
                            <div className="admin-primary-cell">
                              <strong>{lead.location || '—'}</strong>
                              {lead.geoLocation && (
                                <small title={`Captured ${new Date(lead.geoLocation.capturedAt).toLocaleString()}`}>
                                  {lead.geoLocation.latitude.toFixed(5)}, {lead.geoLocation.longitude.toFixed(5)}
                                  {lead.geoLocation.accuracy != null ? ` (±${Math.round(lead.geoLocation.accuracy)}m)` : ''}
                                </small>
                              )}
                            </div>
                          </td>

                          <td>
                            <div className="admin-primary-cell">
                              <strong>{lead.pincode || '—'}</strong>
                              <small>{[lead.averageElectricityBill, lead.solarSize].filter(Boolean).join(' · ') || 'No details'}</small>
                            </div>
                          </td>

                          <td>
                            {can('leads.edit') && (can('leads.convert') || lead.status !== 'CONVERTED') ? (
                              <select
                                className="admin-inline-select"
                                value={lead.status || 'NEW'}
                                disabled={loading}
                                onChange={(event) => updateLeadStatus(lead, event.target.value)}
                              >
                                {LEAD_STATUS_OPTIONS.filter((status) => can('leads.convert') || status !== 'CONVERTED').map((status) => (
                                  <option key={status} value={status}>{status}</option>
                                ))}
                              </select>
                            ) : (
                              <span className="admin-status">{lead.status || 'NEW'}</span>
                            )}
                          </td>

                          <td>
                            {can('leads.assign') ? (
                              <select
                                className="admin-inline-select"
                                aria-label={`Assign ${lead.customerName} to`}
                                value={lead.assignedToId || ''}
                                disabled={loading}
                                onChange={(event) => assignLeadInline(lead, event.target.value)}
                              >
                                <option value="">Unassigned</option>
                                {assignableStaff.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}
                              </select>
                            ) : (
                              lead.assignedTo?.name || <span className="admin-muted">Unassigned</span>
                            )}
                          </td>

                          <td>
                            {lead.createdAt
                              ? new Date(lead.createdAt).toLocaleDateString()
                              : '—'}
                          </td>

                          {can('payouts.view') && <td>{lead.payout?.status || '—'}</td>}

                          <td>
                            <div className="admin-row-actions">
                              <button
                                className="admin-mini-button"
                                onClick={() => setDetailLead(lead)}
                              >
                                <Icon path={ICONS.eye} />
                                View
                              </button>
                              {portalData.account.role !== 'ADMIN' ? null : confirmDeleteLeadId === lead.id ? (
                                <span className="admin-inline-confirm">
                                  <button
                                    className="admin-mini-button danger solid"
                                    disabled={loading}
                                    onClick={() => deleteLead(lead)}
                                  >
                                    Confirm
                                  </button>
                                  <button
                                    className="admin-mini-button admin-inline-confirm-cancel"
                                    disabled={loading}
                                    onClick={() => setConfirmDeleteLeadId(null)}
                                    aria-label="Cancel delete"
                                  >
                                    <Icon path={ICONS.close} />
                                  </button>
                                </span>
                              ) : (
                                <button
                                  className="admin-mini-button danger"
                                  disabled={loading}
                                  onClick={() => setConfirmDeleteLeadId(lead.id)}
                                >
                                  Delete
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  async function openQrPrintHistory(qr) {
    setQrPrintHistory({ qr, loading: true, prints: [], currentVendor: null });
    try {
      const result = await apiRequest(`/admin/qr/${encodeURIComponent(qr.id)}/print-history`, { forceRefresh: true });
      setQrPrintHistory({ qr, loading: false, prints: result.prints || [], currentVendor: result.currentVendor || null });
    } catch (error) {
      setQrPrintHistory(null);
      setMessage(error.message);
      setMessageType('error');
    }
  }

  async function loadPrintJobDetail(jobId) {
    if (expandedPrintJob?.jobId === jobId) {
      setExpandedPrintJob(null);
      return;
    }
    setExpandedPrintJob({ jobId, loading: true, items: [] });
    try {
      const result = await apiRequest(`/admin/qr/print-jobs/${encodeURIComponent(jobId)}`, { forceRefresh: true });
      setExpandedPrintJob({ jobId, loading: false, items: result.items || [] });
    } catch (error) {
      setExpandedPrintJob(null);
      setMessage(error.message);
      setMessageType('error');
    }
  }

  function printHistoryQuery() {
    const params = new URLSearchParams();
    Object.entries(printHistoryFilters).forEach(([key, value]) => {
      if (value) params.set(key, value);
    });
    return params.toString();
  }


  function renderQrPrintHistoryModal() {
    const { qr, loading: historyLoading, prints, currentVendor } = qrPrintHistory;
    return (
      <div className="admin-modal-overlay" onClick={() => setQrPrintHistory(null)}>
        <div className="admin-modal" role="dialog" aria-modal="true" aria-label={`${qr.code} print history`} onClick={(event) => event.stopPropagation()}>
          <div className="admin-modal-header">
            <div>
              <span className="admin-eyebrow">PRINT HISTORY</span>
              <h2>{qr.code}</h2>
            </div>
            <button className="admin-mini-button" onClick={() => setQrPrintHistory(null)} aria-label="Close"><Icon path={ICONS.close} /></button>
          </div>
          <div className="admin-modal-body">
            <div className="admin-detail-grid">
              <div><span>QR ID</span><strong>{qr.id}</strong></div>
              <div><span>Current Solar Mitra</span><strong>{currentVendor?.businessName || 'Unassigned'}</strong></div>
              {currentVendor?.id && <div><span>Solar Mitra ID</span><strong>{currentVendor.id}</strong></div>}
            </div>
            {historyLoading ? (
              <p>Loading print history...</p>
            ) : prints.length ? (
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr><th>Printed</th><th>Template</th><th>Type</th><th>Print job</th><th>By</th></tr>
                  </thead>
                  <tbody>
                    {prints.map((print) => (
                      <tr key={print.jobId}>
                        <td>{new Date(print.printedAt).toLocaleString()}</td>
                        <td>{print.templateName || '—'}<br /><small className="admin-muted-text">{print.templateId}</small></td>
                        <td>{print.kind === 'SINGLE' ? 'Single print' : 'Print batch'}</td>
                        <td><small>{print.jobId}</small></td>
                        <td>{print.printedBy || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p>This QR code has not been printed from a template yet.</p>
            )}
          </div>
        </div>
      </div>
    );
  }

  function renderLeadDetailModal() {
    const lead = detailLead;

    return (
      <div
        className="admin-modal-overlay"
        onClick={() => setDetailLead(null)}
      >
        <div
          className="admin-modal"
          role="dialog"
          aria-modal="true"
          aria-label="Lead details"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="admin-modal-header">
            <div>
              <span className="admin-eyebrow">LEAD DETAILS</span>
              <h2>{lead.customerName || 'Customer'}</h2>
            </div>
            <button
              className="admin-mini-button"
              onClick={() => setDetailLead(null)}
              aria-label="Close"
            >
              <Icon path={ICONS.close} />
            </button>
          </div>

          <div className="admin-modal-body">
            <div className="admin-modal-section">
              <h3>Customer</h3>
              <dl className="admin-modal-fields">
                <dt>Name</dt>
                <dd>{lead.customerName || '—'}</dd>
                <dt>Phone</dt>
                <dd>{lead.phone || '—'}</dd>
                <dt>Email</dt>
                <dd>{lead.email || '—'}</dd>
                <dt>Location (entered)</dt>
                <dd>{lead.location || '—'}</dd>
                <dt>Pincode</dt>
                <dd>{lead.pincode || '—'}</dd>
                <dt>Average electricity bill</dt>
                <dd>{lead.averageElectricityBill || '—'}</dd>
                <dt>Solar system size</dt>
                <dd>{lead.solarSize || '—'}</dd>
                <dt>GPS coordinates</dt>
                <dd>
                  {lead.geoLocation
                    ? `${lead.geoLocation.latitude}, ${lead.geoLocation.longitude}${
                        lead.geoLocation.accuracy != null ? ` (±${Math.round(lead.geoLocation.accuracy)}m)` : ''
                      }`
                    : 'Not captured'}
                </dd>
                {lead.geoLocation && (
                  <>
                    <dt>GPS captured at</dt>
                    <dd>{new Date(lead.geoLocation.capturedAt).toLocaleString()}</dd>
                  </>
                )}
              </dl>
            </div>

            <div className="admin-modal-section">
              <h3>Attribution</h3>
              <dl className="admin-modal-fields">
                <dt>Solar Mitra</dt>
                <dd>{lead.vendor ? lead.vendor.businessName : `Deleted Solar Mitra: ${lead.vendorNameSnapshot || 'Unknown'}`}</dd>
                <dt>QR code</dt>
                <dd>{lead.qr?.code || '—'}</dd>
                <dt>Lead status</dt>
                <dd>{lead.status || '—'}</dd>
                {can('payouts.view') && (
                  <>
                    <dt>Commission</dt>
                    <dd>{lead.payout?.status || 'Not created'}</dd>
                  </>
                )}
                <dt>Submitted</dt>
                <dd>{lead.createdAt ? new Date(lead.createdAt).toLocaleString() : '—'}</dd>
              </dl>
            </div>

            {can('leads.view') && (
              <LeadWorkPanel
                lead={lead}
                canAssign={can('leads.assign')}
                canNote={can('leads.edit')}
                assignable={assignableStaff}
                onAssigned={async () => {
                  await loadAdminResource('leads', adminPage, undefined, undefined, true);
                  setDetailLead(null);
                }}
              />
            )}

            {can('payouts.view') && (
            <div className="admin-modal-section">
              <h3>Payout</h3>
              <dl className="admin-modal-fields">
                <dt>Status</dt>
                <dd>{lead.payout?.status || 'No payout record'}</dd>
                {lead.payout?.paidAt && (
                  <>
                    <dt>Paid at</dt>
                    <dd>{new Date(lead.payout.paidAt).toLocaleString()}</dd>
                  </>
                )}
                {lead.payout?.paidReference && (
                  <>
                    <dt>Payment reference</dt>
                    <dd>{lead.payout.paidReference}</dd>
                  </>
                )}
              </dl>
            </div>
            )}

            <div className="admin-modal-section">
              <h3>Record IDs</h3>
              <dl className="admin-modal-fields mono">
                <dt>Lead ID</dt>
                <dd>{lead.id}</dd>
                <dt>Solar Mitra ID</dt>
                <dd>{lead.vendorId}</dd>
                <dt>QR ID</dt>
                <dd>{lead.qrId}</dd>
                <dt>Scan ID</dt>
                <dd>{lead.scanId}</dd>
              </dl>
            </div>
          </div>
        </div>
      </div>
    );
  }

  function renderScans() {
    const scans =
      portalData?.data?.scans || [];

    return (
      <div className="admin-resource">
        <div className="admin-resource-heading">
          <div>
            <span className="admin-eyebrow">
              ATTRIBUTION
            </span>
            <h2>Scans</h2>
            <p>
              Monitor QR scans and their resolved
              Solar Mitra attribution.
            </p>
          </div>

          <button
            className="admin-outline-button"
            onClick={() =>
              loadAdminResource(
                'scans',
                adminPage,
                undefined,
                undefined,
                true
              )
            }
          >
            <Icon path={ICONS.refresh} />
            Refresh
          </button>
        </div>

        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Scan ID</th>
                <th>QR</th>
                <th>Solar Mitra</th>
                <th>Customer</th>
                <th>Scanned</th>
              </tr>
            </thead>

            <tbody>
              {scans.length ? (
                scans.map((scan) => (
                  <tr key={scan.id}>
                    <td>
                      <span className="admin-code">
                        {scan.id}
                      </span>
                    </td>

                    <td>
                      {scan.qrId ||
                        scan.qr?.code ||
                        '—'}
                    </td>

                    <td>
                      {scan.vendor?.businessName ||
                        '—'}
                    </td>

                    <td>
                      {scan.customerMasked ||
                        scan.customerName ||
                        '—'}
                    </td>

                    <td>
                      {scan.createdAt
                        ? new Date(
                            scan.createdAt
                          ).toLocaleString()
                        : '—'}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td
                    colSpan="5"
                    className="admin-empty"
                  >
                    No scans yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {renderPagination()}
      </div>
    );
  }

  function renderPayouts() {
    const payouts =
      portalData?.data?.payouts || [];

    const groups = new Map();
    for (const payout of payouts) {
      const vendorId = payout.vendor?.id || 'unknown';
      if (!groups.has(vendorId)) {
        groups.set(vendorId, {
          vendor: payout.vendor,
          payouts: [],
        });
      }
      groups.get(vendorId).payouts.push(payout);
    }

    return (
      <div className="admin-resource">
        <div className="admin-resource-heading">
          <div>
            <span className="admin-eyebrow">
              COMMISSIONS
            </span>
            <h2>Commissions & payouts</h2>
            <p>
              Control payout state and record payment
              references.
            </p>
          </div>

          <button
            className="admin-outline-button"
            onClick={() =>
              loadAdminResource(
                'payouts',
                adminPage,
                undefined,
                undefined,
                true
              )
            }
          >
            <Icon path={ICONS.refresh} />
            Refresh
          </button>
        </div>

        {payouts.length ? (
          <div className="admin-vendor-groups">
            {Array.from(groups.entries()).map(([vendorId, group]) => {
              const isOpen = Boolean(expandedCommissionGroups[vendorId]);
              return (
                <div className="admin-vendor-group" key={vendorId}>
                  <button
                    type="button"
                    className="admin-vendor-group-header"
                    onClick={() => setExpandedCommissionGroups({
                      ...expandedCommissionGroups,
                      [vendorId]: !isOpen,
                    })}
                    aria-expanded={isOpen}
                  >
                    <Icon path={ICONS.arrow} className={`admin-vendor-group-chevron ${isOpen ? 'open' : ''}`} />
                    <span className="admin-vendor-group-name">{group.vendor?.businessName || 'Unknown Solar Mitra'}</span>
                    <span className="admin-vendor-group-count">{group.payouts.length} {group.payouts.length === 1 ? 'commission' : 'commissions'}</span>
                  </button>

                  {isOpen && (
                    <div className="admin-table-wrap">
                      <table className="admin-table">
                        <thead>
                          <tr>
                            <th>Customer</th>
                            <th>Lead</th>
                            <th>Lead status</th>
                            <th>Status</th>
                            <th>Payment reference</th>
                            <th>Created / paid</th>
                            <th>Update</th>
                          </tr>
                        </thead>
                        <tbody>
                          {group.payouts.map((payout) => (
                            <tr key={payout.id}>
                              <td><strong>{payout.lead?.customerName || 'Customer'}</strong></td>
                              <td><span className="admin-code">{payout.leadId}</span></td>
                              <td>{payout.lead?.status || '—'}</td>
                              <td><span className="admin-status active">{payout.status}</span></td>
                              <td>
                                <input
                                  className="admin-table-input"
                                  placeholder="Payment reference"
                                  value={paidReferenceInputs[payout.id] || ''}
                                  onChange={(event) => setPaidReferenceInputs({ ...paidReferenceInputs, [payout.id]: event.target.value })}
                                />
                              </td>
                              <td>{payout.paidAt ? new Date(payout.paidAt).toLocaleDateString() : payout.createdAt ? new Date(payout.createdAt).toLocaleDateString() : '—'}</td>
                              <td>
                                <div className="admin-row-actions">
                                  {can('payouts.mark_paid') && ['UNPAID', 'PARTIAL', 'PAID'].map((status) => (
                                    confirmPayoutStatusKey === `${payout.id}:${status}` ? (
                                      <span key={status} className="admin-inline-confirm">
                                        <button
                                          className="admin-mini-button primary solid"
                                          disabled={loading}
                                          onClick={() => updatePayoutStatus(payout, status)}
                                        >
                                          Confirm
                                        </button>
                                        <button
                                          className="admin-mini-button admin-inline-confirm-cancel"
                                          disabled={loading}
                                          onClick={() => setConfirmPayoutStatusKey(null)}
                                          aria-label="Cancel status change"
                                        >
                                          <Icon path={ICONS.close} />
                                        </button>
                                      </span>
                                    ) : (
                                      <button
                                        key={status}
                                        className={`admin-mini-button ${payout.status === status ? 'selected' : ''}`}
                                        disabled={loading}
                                        onClick={() => armPayoutStatus(payout, status)}
                                      >
                                        {payout.status === status ? '✓ ' : ''}{status}
                                      </button>
                                    )
                                  ))}
                                  {group.vendor && can('vendors.bank_details') && (
                                    <button className="admin-mini-button" onClick={() => viewVendorBankDetails(group.vendor)}>
                                      Bank details
                                    </button>
                                  )}
                                  {group.vendor && can('vendors.edit') && (
                                    <button className="admin-mini-button" onClick={() => viewVendorOnboardingMedia(group.vendor)}>
                                      Onboarding media
                                    </button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : <div className="admin-empty admin-empty-block">No payout records yet.</div>}

        {renderPagination()}
      </div>
    );
  }

  function accountTypeOptions() {
    return (
      <>
        <option value={ACCOUNT_TYPE_SALES}>BDE / Sales (own assigned leads)</option>
        {accessRoles.map((role) => (
          <option key={role.id} value={`role:${role.id}`}>{role.name}</option>
        ))}
        <option value="ADMIN">Super admin (full access)</option>
      </>
    );
  }

  function renderUsers() {
    const users =
      portalData?.data?.users || [];

    return (
      <div className="admin-resource">
        <div className="admin-resource-heading">
          <div>
            <span className="admin-eyebrow">
              ACCESS CONTROL
            </span>
            <h2>Staff users</h2>
            <p>
              Control internal Sales, custom-role and Admin access.
            </p>
          </div>

          <button
            className="admin-primary-button"
            onClick={() =>
              setShowCreateStaff(
                (current) => !current
              )
            }
          >
            <Icon path={ICONS.plus} />
            Add staff
          </button>
        </div>

        {showCreateStaff && (
          <form
            onSubmit={createStaffUser}
            className="admin-form-card"
          >
            <div className="admin-form-title">
              Create staff user
            </div>

            <div className="admin-form-grid">
              <input
                required
                placeholder="Name"
                value={newStaffUser.name}
                onChange={(event) =>
                  setNewStaffUser({
                    ...newStaffUser,
                    name: event.target.value,
                  })
                }
              />

              <input
                required
                placeholder="Username or mobile"
                value={
                  newStaffUser.username_or_mobile
                }
                onChange={(event) =>
                  setNewStaffUser({
                    ...newStaffUser,
                    username_or_mobile:
                      event.target.value,
                  })
                }
              />

              <input
                required
                minLength="8"
                type="password"
                placeholder="Password"
                value={newStaffUser.password}
                onChange={(event) =>
                  setNewStaffUser({
                    ...newStaffUser,
                    password:
                      event.target.value,
                  })
                }
              />

              <select
                value={newStaffUser.role}
                onChange={(event) =>
                  setNewStaffUser({
                    ...newStaffUser,
                    role: event.target.value,
                  })
                }
              >
                {accountTypeOptions()}
              </select>
            </div>

            <div className="admin-form-actions">
              <button
                type="button"
                className="admin-outline-button"
                onClick={() =>
                  setShowCreateStaff(false)
                }
              >
                Cancel
              </button>

              <button
                className="admin-primary-button"
                disabled={loading}
              >
                {loading
                  ? 'Creating...'
                  : 'Create staff user'}
              </button>
            </div>
          </form>
        )}

        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Login</th>
                <th>Role</th>
                <th>Status</th>
                <th>Change account type</th>
                <th />
              </tr>
            </thead>

            <tbody>
              {users.length ? (
                users.map((user) => (
                  <tr key={user.id}>
                    <td>
                      <div className="admin-primary-cell">
                        <strong>
                          {user.name}
                        </strong>
                        <small>
                          {user.id}
                        </small>
                      </div>
                    </td>

                    <td>
                      {user.usernameMobile}
                    </td>

                    <td>
                      <span className="admin-role">
                        {user.role === 'STAFF' ? user.roleName : user.role === 'SALES' ? 'BDE / Sales' : 'Super admin'}
                      </span>
                    </td>

                    <td>
                      <span
                        className={`admin-status ${
                          user.status ===
                          'ACTIVE'
                            ? 'active'
                            : 'inactive'
                        }`}
                      >
                        {user.status ||
                          'ACTIVE'}
                      </span>
                    </td>

                    <td>
                      <div className="admin-qr-action">
                        <select
                          value={
                            staffRoleInputs[
                              user.id
                            ] ||
                            accountTypeOf(user)
                          }
                          onChange={(event) =>
                            setStaffRoleInputs({
                              ...staffRoleInputs,
                              [user.id]:
                                event.target.value,
                            })
                          }
                        >
                          {accountTypeOptions()}
                        </select>

                        {confirmUpdateRoleId === user.id ? (
                          <span className="admin-inline-confirm">
                            {user.role === 'SALES' && user.assignedLeadCount > 0 && (staffRoleInputs[user.id] || accountTypeOf(user)) !== ACCOUNT_TYPE_SALES && (
                              <small>{user.assignedLeadCount} lead{user.assignedLeadCount === 1 ? '' : 's'} will return to the unassigned pool.</small>
                            )}
                            <button
                              className="admin-mini-button primary solid"
                              disabled={loading}
                              onClick={() => updateStaffUserRole(user)}
                            >
                              Confirm
                            </button>
                            <button
                              className="admin-mini-button admin-inline-confirm-cancel"
                              disabled={loading}
                              onClick={() => setConfirmUpdateRoleId(null)}
                              aria-label="Cancel role change"
                            >
                              <Icon path={ICONS.close} />
                            </button>
                          </span>
                        ) : (
                          <button
                            className="admin-mini-button"
                            disabled={loading}
                            onClick={() => armUpdateStaffUserRole(user)}
                          >
                            Update
                          </button>
                        )}
                      </div>
                    </td>

                    <td>
                      {user.status !== 'ACTIVE' ? (
                        <button
                          className="admin-mini-button success"
                          disabled={loading}
                          onClick={() => activateStaffUser(user)}
                        >
                          Activate
                        </button>
                      ) : confirmDeactivateStaffId === user.id ? (
                        <span className="admin-inline-confirm">
                          {user.assignedLeadCount > 0 && <small>{user.assignedLeadCount} lead{user.assignedLeadCount === 1 ? '' : 's'} will return to the unassigned pool.</small>}
                          <button
                            className="admin-mini-button danger solid"
                            disabled={loading}
                            onClick={() => deactivateStaffUser(user)}
                          >
                            Confirm
                          </button>
                          <button
                            className="admin-mini-button admin-inline-confirm-cancel"
                            disabled={loading}
                            onClick={() => setConfirmDeactivateStaffId(null)}
                            aria-label="Cancel deactivation"
                          >
                            <Icon path={ICONS.close} />
                          </button>
                        </span>
                      ) : (
                        <button
                          className="admin-mini-button danger"
                          disabled={loading}
                          onClick={() => setConfirmDeactivateStaffId(user.id)}
                        >
                          Deactivate
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td
                    colSpan="6"
                    className="admin-empty"
                  >
                    No staff users found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {renderPagination()}

        <RolesPanel
          roles={accessRoles}
          catalog={permissionCatalog}
          onChanged={async (text, isError) => {
            await loadAdminResource('users', adminPage, undefined, undefined, true);
            setMessage(text);
            setMessageType(isError ? 'error' : 'success');
          }}
        />
      </div>
    );
  }

  function renderApplications() {
    const applications = portalData?.data?.applications || [];
    const statusLabel = { PENDING: 'Pending', ONBOARDED: 'Approved', REJECTED: 'Rejected' };
    const statusTone = { PENDING: 'warning', ONBOARDED: 'active', REJECTED: 'inactive' };

    return (
      <div className="admin-resource">
        <div className="admin-resource-heading">
          <div>
            <span className="admin-eyebrow">NEW PARTNERS</span>
            <h2>Solar Mitra applications</h2>
            <p>People who applied on the website. Approving creates their Solar Mitra account.</p>
          </div>

          <div className="admin-heading-actions">
            <select
              value={applicationStatus}
              disabled={loading}
              onChange={(event) => changeApplicationStatus(event.target.value)}
              aria-label="Filter applications by status"
            >
              <option value="PENDING">Pending</option>
              <option value="ONBOARDED">Approved</option>
              <option value="REJECTED">Rejected</option>
              <option value="ALL">All</option>
            </select>
            <button
              className="admin-outline-button"
              onClick={() => loadAdminResource('vendor-applications', adminPage, undefined, undefined, true)}
            >
              <Icon path={ICONS.refresh} />
              Refresh
            </button>
          </div>
        </div>

        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Applicant</th>
                <th>Mobile</th>
                <th>State</th>
                <th>Applied</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {applications.length ? applications.map((application) => (
                <tr key={application.id}>
                  <td>
                    <strong>{application.businessName}</strong>
                    <div className="admin-muted-line">{application.ownerName}</div>
                  </td>
                  <td>{application.mobileNumber}</td>
                  <td>
                    {application.state || (application.status === 'PENDING' ? (
                      <select
                        className="admin-table-select"
                        value={applicationStates[application.id] || ''}
                        onChange={(event) => setApplicationStates((current) => ({ ...current, [application.id]: event.target.value }))}
                        aria-label={`State for ${application.businessName}`}
                      >
                        <option value="">Choose state</option>
                        {INDIAN_STATES.map((state) => <option key={state} value={state}>{state}</option>)}
                      </select>
                    ) : '—')}
                  </td>
                  <td>{application.createdAt ? new Date(application.createdAt).toLocaleDateString() : '—'}</td>
                  <td>
                    <span className={`admin-status ${statusTone[application.status] || ''}`}>{statusLabel[application.status] || application.status}</span>
                    {application.status === 'REJECTED' && application.rejectionReason && (
                      <div className="admin-muted-line">{application.rejectionReason}</div>
                    )}
                  </td>
                  <td>
                    {application.status === 'PENDING' && !can('applications.review') ? (
                      <span className="admin-muted-line">Awaiting review</span>
                    ) : application.status === 'PENDING' ? (
                      rejectingApplicationId === application.id ? (
                        <span className="admin-inline-confirm">
                          <input
                            className="admin-inline-confirm-input"
                            placeholder="Reason (optional)"
                            maxLength={500}
                            value={rejectReason}
                            onChange={(event) => setRejectReason(event.target.value)}
                            aria-label="Rejection reason"
                          />
                          <button type="button" className="admin-mini-button danger" disabled={applicationBusyId === application.id} onClick={() => reviewApplication(application, 'reject')}>Confirm reject</button>
                          <button type="button" className="admin-mini-button" onClick={() => { setRejectingApplicationId(''); setRejectReason(''); }}>Cancel</button>
                        </span>
                      ) : (
                        <span className="admin-inline-confirm">
                          <button
                            type="button"
                            className="admin-mini-button"
                            disabled={applicationBusyId === application.id || (!application.state && !applicationStates[application.id])}
                            onClick={() => reviewApplication(application, 'approve')}
                          >
                            {applicationBusyId === application.id ? 'Working...' : 'Approve'}
                          </button>
                          <button type="button" className="admin-mini-button danger" disabled={applicationBusyId === application.id} onClick={() => { setRejectingApplicationId(application.id); setRejectReason(''); }}>Reject</button>
                        </span>
                      )
                    ) : (
                      <span className="admin-muted-line">{application.reviewedAt ? new Date(application.reviewedAt).toLocaleDateString() : '—'}</span>
                    )}
                  </td>
                </tr>
              )) : (
                <tr>
                  <td colSpan="6" className="admin-empty">
                    {resourceLoading || loading ? 'Loading...' : `No ${applicationStatus === 'ALL' ? '' : `${(statusLabel[applicationStatus] || '').toLowerCase()} `}applications.`}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {renderPagination()}
      </div>
    );
  }

  function renderAuditLogs() {
    // The backend returns the list under `audit_logs` (see GET /api/admin/audit-logs).
    const logs =
      portalData?.data?.audit_logs ||
      portalData?.data?.auditLogs ||
      portalData?.data?.logs ||
      [];

    return (
      <div className="admin-resource">
        <div className="admin-resource-heading">
          <div>
            <span className="admin-eyebrow">
              SYSTEM HISTORY
            </span>
            <h2>Audit logs</h2>
            <p>
              Immutable administrative activity and
              operational history.
            </p>
          </div>

          <div className="admin-heading-actions">
            <ExportRangeButton
              path="/admin/audit-logs/export"
              fallbackName="solarium-audit-logs.csv"
              allowCopy={false}
              dateLabel="by the time of each log entry"
              note="Only an all-time export counts as the backup that clears the clean-up warning."
            />
            <button
              className="admin-outline-button"
              onClick={() =>
                loadAdminResource(
                  'audit-logs',
                  adminPage,
                  undefined,
                  undefined,
                  true
                )
              }
            >
              <Icon path={ICONS.refresh} />
              Refresh
            </button>
          </div>
        </div>

        {portalData?.data?.retention?.atCapacity && (
          <p className="admin-audit-capacity-note">
            Audit log storage is at its {portalData.data.retention.cap}-row limit. Older entries are removed automatically as new ones are added.
          </p>
        )}

        <div className="admin-audit-list">
          {logs.length ? (
            logs.map((log) => (
              <div className="admin-audit-row" key={log.id}>
                <span className={`admin-audit-icon ${auditActionTone(log.action)}`}>
                  <Icon path={auditActionIcon(log.action)} />
                </span>

                <div className="admin-audit-main">
                  <div className="admin-audit-line">
                    <strong>{formatAuditAction(log.action)}</strong>
                    <span className="admin-audit-entity">
                      {log.entity ? `${log.entity}${log.entityId ? ` · ${log.entityId}` : ''}` : ''}
                    </span>
                  </div>
                  <div className="admin-audit-meta">
                    {log.actor?.name || log.actorRole || 'System'}
                    {' · '}
                    {log.timestamp ? new Date(log.timestamp).toLocaleString() : '—'}
                  </div>
                </div>

                <button
                  className="admin-mini-button"
                  onClick={() => setDetailAuditLog(log)}
                  aria-label="View details"
                >
                  <Icon path={ICONS.eye} />
                  Details
                </button>
              </div>
            ))
          ) : (
            <div className="admin-empty admin-empty-block">No audit records yet.</div>
          )}
        </div>

        {renderPagination()}
      </div>
    );
  }

  // Server-side pagination already bounds every audit-log request to 50 rows by default
  // (100 max — see pagination() in backend/src/routes/admin.js) — this view never fetches
  // the full table, which will grow into the millions over time. Full metadata for a single
  // row is only ever fetched implicitly (it's already in the page payload) and only rendered
  // on demand via the Details modal below, not dumped inline for every row at once.
  function auditActionTone(action) {
    const value = String(action || '');
    if (/DELETE|DEACTIVAT|REJECT|LOCKOUT/.test(value)) return 'danger';
    if (/CREATE|GENERAT|ONBOARD|ASSIGN(?!ED_)/.test(value)) return 'success';
    if (/REASSIGN|UPDATE|CHANGE|RESET/.test(value)) return 'info';
    return 'neutral';
  }

  function auditActionIcon(action) {
    const value = String(action || '');
    if (/DELETE|DEACTIVAT|REJECT|LOCKOUT/.test(value)) return ICONS.close;
    if (/CREATE|GENERAT|ONBOARD/.test(value)) return ICONS.plus;
    if (/ASSIGN/.test(value)) return ICONS.qr;
    if (/PAYOUT|PAID/.test(value)) return ICONS.money;
    if (/LEAD/.test(value)) return ICONS.lead;
    return ICONS.dashboard;
  }

  function formatAuditAction(action) {
    return String(action || '')
      .split('_')
      .map((word) => word.charAt(0) + word.slice(1).toLowerCase())
      .join(' ');
  }

  function renderAuditLogDetailModal() {
    const log = detailAuditLog;

    return (
      <div
        className="admin-modal-overlay"
        onClick={() => setDetailAuditLog(null)}
      >
        <div
          className="admin-modal"
          role="dialog"
          aria-modal="true"
          aria-label="Audit log details"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="admin-modal-header">
            <div>
              <span className="admin-eyebrow">AUDIT LOG</span>
              <h2>{formatAuditAction(log.action)}</h2>
            </div>
            <button
              className="admin-mini-button"
              onClick={() => setDetailAuditLog(null)}
              aria-label="Close"
            >
              <Icon path={ICONS.close} />
            </button>
          </div>

          <div className="admin-modal-body">
            <div className="admin-modal-section">
              <h3>Event</h3>
              <dl className="admin-modal-fields">
                <dt>Actor</dt>
                <dd>{log.actor?.name || log.actorRole || 'System'}</dd>
                <dt>Role</dt>
                <dd>{log.actorRole || '—'}</dd>
                <dt>Timestamp</dt>
                <dd>{log.timestamp ? new Date(log.timestamp).toLocaleString() : '—'}</dd>
                <dt>Entity</dt>
                <dd>{log.entity || '—'}</dd>
                <dt>Entity ID</dt>
                <dd>{log.entityId || '—'}</dd>
              </dl>
            </div>

            <div className="admin-modal-section">
              <h3>Metadata</h3>
              {log.metadata && Object.keys(log.metadata).length ? (
                <dl className="admin-modal-fields mono">
                  {Object.entries(log.metadata).map(([key, value]) => (
                    <Fragment key={key}>
                      <dt>{key}</dt>
                      <dd>
                        {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                      </dd>
                    </Fragment>
                  ))}
                </dl>
              ) : (
                <p className="admin-scan-assign-blocked">No additional metadata for this event.</p>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  async function viewVendorDetails(vendor) {
    // Bank details are no longer fetched here — AdminBankForm below loads (and reloads) its own
    // copy, since it now writes as well as reads.
    if (!can('vendors.edit')) {
      setDetailVendor({ vendor, loading: false, media: null, error: '' });
      return;
    }
    setDetailVendor({ vendor, loading: true, media: null, error: '' });
    try {
      const media = await apiRequest(`/admin/vendors/${vendor.id}/onboarding-media`, { forceRefresh: true });
      setDetailVendor((current) => (current?.vendor.id === vendor.id ? { vendor, loading: false, media: media.onboarding_media, error: '' } : current));
    } catch (error) {
      setDetailVendor((current) => (current?.vendor.id === vendor.id ? { ...current, loading: false, error: error.message } : current));
    }
  }

  function renderVendorDetailsModal() {
    const { vendor, loading: detailLoading, media, error } = detailVendor;
    const dash = (value) => (value === null || value === undefined || value === '' ? '—' : value);
    return (
      <div className="admin-modal-overlay" onClick={() => setDetailVendor(null)}>
        <div className="admin-modal" role="dialog" aria-modal="true" aria-label="Solar Mitra details" onClick={(event) => event.stopPropagation()}>
          <div className="admin-modal-header">
            <div>
              <span className="admin-eyebrow">SOLAR MITRA DETAILS</span>
              <h2>{vendor.businessName}</h2>
            </div>
            <button className="admin-mini-button" onClick={() => setDetailVendor(null)} aria-label="Close"><Icon path={ICONS.close} /></button>
          </div>
          <div className="admin-modal-body">
            <h3>Profile</h3>
            <dl className="admin-modal-fields">
              <dt>Business name</dt><dd>{dash(vendor.businessName)}</dd>
              <dt>Owner</dt><dd>{dash(vendor.ownerName)}</dd>
              <dt>Phone number</dt><dd>{dash(vendor.mobileNumber)}</dd>
              <dt>State</dt><dd>{dash(vendor.state)}</dd>
              <dt>Login ID</dt><dd>{dash(vendor.loginIdentifier)}</dd>
              <dt>Status</dt><dd>{dash(vendor.status)}</dd>
              <dt>Current QR</dt><dd>{dash(vendor.currentQr)}</dd>
              <dt>Leads</dt><dd>{vendor.leadCount ?? 0}</dd>
              <dt>Created</dt><dd>{vendor.createdAt ? new Date(vendor.createdAt).toLocaleString() : '—'}</dd>
            </dl>
            {can('vendors.bank_details') && (
              <>
                <h3>Bank details</h3>
                <AdminBankForm vendorId={vendor.id} />
              </>
            )}

            {detailLoading && <p>Loading location…</p>}
            {error && <p className="admin-scan-assign-blocked" role="alert">{error}</p>}
            {can('vendors.edit') && !detailLoading && !error && (
              <>
                <h3>Shop location and photos</h3>
                {media ? (
                  <>
                    <dl className="admin-modal-fields">
                      <dt>Location</dt>
                      <dd>{media.latitude !== null && media.latitude !== undefined ? <a href={`https://www.google.com/maps?q=${media.latitude},${media.longitude}`} target="_blank" rel="noreferrer">{media.latitude}, {media.longitude}</a> : '—'}</dd>
                      <dt>Captured</dt><dd>{media.capturedAt ? new Date(media.capturedAt).toLocaleString() : '—'}</dd>
                    </dl>
                    <div className="admin-row-actions">
                      {media.shopPhotoUrl && <a className="admin-mini-button" href={media.shopPhotoUrl} target="_blank" rel="noreferrer">Open shop photo</a>}
                      {media.qrPlacementPhotoUrl && <a className="admin-mini-button" href={media.qrPlacementPhotoUrl} target="_blank" rel="noreferrer">Open QR placement photo</a>}
                    </div>
                  </>
                ) : <p className="admin-scan-assign-blocked">No location or photos added yet.</p>}
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  function renderBankDetailsModal() {
    const details = detailBank.details;
    return (
      <div className="admin-modal-overlay" onClick={() => setDetailBank(null)}>
        <div className="admin-modal" role="dialog" aria-modal="true" aria-label="Solar Mitra bank details" onClick={(event) => event.stopPropagation()}>
          <div className="admin-modal-header">
            <div>
              <span className="admin-eyebrow">PAYOUT ACCOUNT</span>
              <h2>{detailBank.vendor.businessName}</h2>
            </div>
            <button className="admin-mini-button" onClick={() => setDetailBank(null)} aria-label="Close"><Icon path={ICONS.close} /></button>
          </div>
          <div className="admin-modal-body">
            {details ? (
              <>
                <dl className="admin-modal-fields">
                  <dt>UPI number</dt><dd>{details.upiNumber || '—'}</dd>
                  <dt>UPI ID</dt><dd>{details.upiId || '—'}</dd>
                  <dt>Account holder</dt><dd>{details.accountHolderName || '—'}</dd>
                  <dt>Account number</dt><dd>{details.accountNumber || '—'}</dd>
                  <dt>IFSC code</dt><dd>{details.ifscCode || '—'}</dd>
                </dl>
                <div className="admin-row-actions">
                  {details.passbookUrl && <a className="admin-mini-button" href={details.passbookUrl} target="_blank" rel="noreferrer">Open passbook</a>}
                  {details.chequeUrl && <a className="admin-mini-button" href={details.chequeUrl} target="_blank" rel="noreferrer">Open cancelled cheque</a>}
                </div>
              </>
            ) : <p className="admin-scan-assign-blocked">No bank details submitted yet.</p>}
          </div>
        </div>
      </div>
    );
  }

  function closeOnboardingMediaModal() {
    setDetailOnboardingMedia(null);
    setMediaCoordsText('');
    setMediaLocationError('');
  }

  // Deliberately no backdrop-click dismiss and no close button — this one only closes once
  // the export is confirmed to have actually worked (see confirmRetentionExport).
  function renderRetentionGateModal() {
    return (
      <div className="admin-modal-overlay">
        <div className="admin-modal" role="dialog" aria-modal="true" aria-label="Audit log storage warning">
          <div className="admin-modal-header">
            <div>
              <span className="admin-eyebrow">STORAGE WARNING</span>
              <h2>Audit log storage is almost full</h2>
            </div>
          </div>
          <div className="admin-modal-body">
            <p>
              Audit logs are at {retentionStatus?.count} of {retentionStatus?.cap} rows.
              Download a copy before older entries are automatically deleted.
            </p>
            {retentionExportState.error && (
              <p className="admin-field-error">{retentionExportState.error}</p>
            )}
            <button
              type="button"
              className="admin-primary-button"
              disabled={retentionExportState.loading}
              onClick={confirmRetentionExport}
            >
              {retentionExportState.loading
                ? 'Downloading…'
                : retentionExportState.error
                ? 'Retry download'
                : 'Download audit logs'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  function renderTemplatePreviewModal() {
    const isPdf = previewTemplate.artworkMimeType === 'application/pdf';
    return (
      <div className="admin-modal-overlay" onClick={() => setPreviewTemplate(null)}>
        <div className="admin-modal admin-template-preview-modal" role="dialog" aria-modal="true" aria-label={`${previewTemplate.name} artwork preview`} onClick={(event) => event.stopPropagation()}>
          <div className="admin-modal-header">
            <div>
              <span className="admin-eyebrow">TEMPLATE ARTWORK</span>
              <h2>{previewTemplate.name}</h2>
            </div>
            <button className="admin-mini-button" onClick={() => setPreviewTemplate(null)} aria-label="Close">
              <Icon path={ICONS.close} />
            </button>
          </div>
          <div className="admin-modal-body">
            {isPdf ? (
              <iframe src={previewTemplate.artworkUrl} title={`${previewTemplate.name} artwork`} className="admin-template-preview-frame" />
            ) : (
              <img src={previewTemplate.artworkUrl} alt={`${previewTemplate.name} artwork`} className="admin-template-preview-image" />
            )}
          </div>
        </div>
      </div>
    );
  }

  function renderOnboardingMediaModal() {
    const { vendor, media } = detailOnboardingMedia;
    return (
      <div className="admin-modal-overlay" onClick={closeOnboardingMediaModal}>
        <div className="admin-modal" role="dialog" aria-modal="true" aria-label="Solar Mitra onboarding media" onClick={(event) => event.stopPropagation()}>
          <div className="admin-modal-header">
            <div>
              <span className="admin-eyebrow">ONBOARDING MEDIA</span>
              <h2>{vendor.businessName}</h2>
            </div>
            <button className="admin-mini-button" onClick={closeOnboardingMediaModal} aria-label="Close"><Icon path={ICONS.close} /></button>
          </div>
          <div className="admin-modal-body">
            <dl className="admin-modal-fields">
              <dt>Shop location</dt>
              <dd>
                {media?.latitude != null && media?.longitude != null ? (
                  <a href={`https://maps.google.com/?q=${media.latitude},${media.longitude}`} target="_blank" rel="noreferrer">
                    {media.latitude.toFixed(5)}, {media.longitude.toFixed(5)}
                    {media.accuracy != null ? ` (±${Math.round(media.accuracy)}m)` : ''}
                  </a>
                ) : 'Not captured yet.'}
              </dd>
            </dl>

            <div className="admin-form-field">
              <span>Set or fix shop coordinates (type or paste)</span>
              <div className="admin-coords-row">
                <input
                  type="text"
                  placeholder="e.g. 18.5204, 73.8567"
                  value={mediaCoordsText}
                  onChange={(event) => setMediaCoordsText(event.target.value)}
                />
                <button type="button" className="admin-outline-button" disabled={loading} onClick={() => applyMediaCoordsText(vendor.id)}>
                  <Icon path={ICONS.target} />
                  Save location
                </button>
              </div>
              {mediaLocationError && <small className="admin-field-error">{mediaLocationError}</small>}
            </div>

            <div className="admin-onboarding-photos">
              <div className="admin-form-field">
                <span>Shop photo</span>
                {media?.shopPhotoUrl
                  ? <img src={media.shopPhotoUrl} alt="Shop" className="admin-photo-preview" />
                  : <p className="admin-scan-assign-blocked">Not uploaded yet.</p>}
                <input type="file" accept="image/jpeg,image/png" disabled={loading} onChange={(event) => replaceOnboardingPhoto(vendor.id, 'shop', event)} />
              </div>

              <div className="admin-form-field">
                <span>QR placement photo</span>
                {media?.qrPlacementPhotoUrl
                  ? <img src={media.qrPlacementPhotoUrl} alt="QR placement" className="admin-photo-preview" />
                  : <p className="admin-scan-assign-blocked">Not uploaded yet.</p>}
                <input type="file" accept="image/jpeg,image/png" disabled={loading} onChange={(event) => replaceOnboardingPhoto(vendor.id, 'qr-placement', event)} />
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  function renderQrPurgeModal() {
    const qr = (portalData?.data?.data || []).find((item) => item.id === confirmPurgeQrId);
    if (!qr) return null;

    return (
      <div className="admin-modal-overlay" onClick={() => {
        setConfirmPurgeQrId(null);
        setPurgeQrConfirmText('');
      }}>
        <div className="admin-modal admin-deletion-modal" role="dialog" aria-modal="true" aria-labelledby="qr-purge-title" onClick={(event) => event.stopPropagation()}>
          <div className="admin-modal-header">
            <div>
              <span className="admin-eyebrow">PERMANENT QR DELETION</span>
              <h2 id="qr-purge-title">Delete {qr.code} permanently?</h2>
            </div>
            <button
              className="admin-mini-button"
              onClick={() => {
                setConfirmPurgeQrId(null);
                setPurgeQrConfirmText('');
              }}
              aria-label="Close"
            >
              <Icon path={ICONS.close} />
            </button>
          </div>
          <div className="admin-modal-body">
            <div className="admin-purge-warning">
              <strong>Nothing will be left except the audit record.</strong>
              <span>This permanently removes the QR, assignments, scans, leads, payouts, and print history. This cannot be undone.</span>
            </div>
            <label className="admin-form-field" htmlFor="qr-purge-confirmation">
              <span>Type <strong>{qr.code}</strong> to confirm</span>
              <input
                id="qr-purge-confirmation"
                className="admin-table-input admin-purge-confirm-input"
                type="text"
                autoFocus
                autoComplete="off"
                value={purgeQrConfirmText}
                disabled={loading}
                onChange={(event) => setPurgeQrConfirmText(event.target.value)}
              />
            </label>
            <div className="admin-form-actions">
              <button
                type="button"
                className="admin-outline-button"
                disabled={loading}
                onClick={() => {
                  setConfirmPurgeQrId(null);
                  setPurgeQrConfirmText('');
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="admin-primary-button danger"
                disabled={loading || purgeQrConfirmText.trim() !== qr.code}
                onClick={() => purgeQr(qr)}
              >
                {loading ? 'Deleting...' : 'Permanently delete'}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  function renderDeletionResultModal() {
    if (!deletionResult) return null;
    const blocked = deletionResult.blocked || [];
    return (
      <div className="admin-modal-overlay" onClick={() => setDeletionResult(null)}>
        <div className="admin-modal admin-deletion-modal" role="dialog" aria-modal="true" aria-label="Bulk deletion result" onClick={(event) => event.stopPropagation()}>
          <div className="admin-modal-header">
            <div>
              <span className="admin-eyebrow">BULK DELETE</span>
              <h2>{blocked.length ? 'Deletion blocked' : 'Deletion complete'}</h2>
            </div>
            <button className="admin-mini-button" onClick={() => setDeletionResult(null)} aria-label="Close"><Icon path={ICONS.close} /></button>
          </div>
          <div className="admin-modal-body">
            {blocked.length ? (
              <>
                <p className="admin-deletion-lead">No {deletionResult.entity} were deleted. Resolve these items first, then try again.</p>
                <div className="admin-deletion-blocked-list">
                  {blocked.map((item) => (
                    <div className="admin-deletion-blocked-item" key={item.id}>
                      <strong>{item.name || item.code || item.id}</strong>
                      <small>{item.message}</small>
                      <span>{item.reasons?.join(' · ')}</span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <p className="admin-deletion-lead">{deletionResult.deleted} {deletionResult.entity} deleted successfully.</p>
            )}
            <div className="admin-form-actions">
              <button className="admin-primary-button" onClick={() => setDeletionResult(null)}>Done</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Shared by both bulk result modals: a run that stopped early, and batches that needed a retry.
  function renderBatchRunNotes(result) {
    const retriedRows = (result.retried || []).reduce((sum, batch) => sum + batch.alreadyExisting, 0);
    return (
      <>
        {result.stopped && (
          <p className="admin-field-error" role="alert">
            <strong>Stopped early.</strong> Batch {result.stopped.batch} of {result.stopped.batches} failed: {result.stopped.message}{' '}
            {result.processed.toLocaleString()} of {result.totalRows.toLocaleString()} rows were processed. Rows from row{' '}
            {result.stopped.firstRow.toLocaleString()} onward were NOT processed. Submit the same list again once the problem is
            fixed: rows that were already saved are skipped safely.
          </p>
        )}
        {result.retried?.length > 0 && (
          <p>
            {result.retried.length} batch(es) needed a retry after a connection problem
            {retriedRows > 0 ? `. ${retriedRows} row(s) in ${result.retried.length === 1 ? 'it' : 'them'} are reported below as already existing; they were most likely saved by the first attempt rather than being real duplicates` : ''}.
          </p>
        )}
      </>
    );
  }

  function renderImportResultModal() {
    if (!importResult) return null;
    const duplicates = importResult.duplicates || [];
    const invalid = importResult.invalid || [];
    return (
      <div className="admin-modal-overlay" onClick={() => setImportResult(null)}>
        <div className="admin-modal admin-deletion-modal" role="dialog" aria-modal="true" aria-label="Lead import result" onClick={(event) => event.stopPropagation()}>
          <div className="admin-modal-header">
            <div>
              <span className="admin-eyebrow">CSV IMPORT</span>
              <h2>{importResult.stopped ? 'Import stopped early' : 'Import complete'}</h2>
            </div>
            <button className="admin-mini-button" onClick={() => setImportResult(null)} aria-label="Close"><Icon path={ICONS.close} /></button>
          </div>
          <div className="admin-modal-body">
            <p className="admin-deletion-lead">
              {importResult.imported} of {importResult.totalRows} rows imported successfully.
            </p>
            {renderBatchRunNotes(importResult)}
            {duplicates.length > 0 && (
              <>
                <p>{duplicates.length} row(s) skipped as duplicates (phone already has a lead){duplicates.length > RESULT_LIST_LIMIT ? ` (first ${RESULT_LIST_LIMIT} shown)` : ''}:</p>
                <div className="admin-deletion-blocked-list">
                  {duplicates.slice(0, RESULT_LIST_LIMIT).map((item) => (
                    <div className="admin-deletion-blocked-item" key={`dup-${item.row}`}>
                      <strong>Row {item.row}</strong>
                      <small>{item.phone}</small>
                    </div>
                  ))}
                </div>
              </>
            )}
            {invalid.length > 0 && (
              <>
                <p>{invalid.length} row(s) could not be imported{invalid.length > RESULT_LIST_LIMIT ? ` (first ${RESULT_LIST_LIMIT} shown)` : ''}:</p>
                <div className="admin-deletion-blocked-list">
                  {invalid.slice(0, RESULT_LIST_LIMIT).map((item) => (
                    <div className="admin-deletion-blocked-item" key={`invalid-${item.row}`}>
                      <strong>Row {item.row}</strong>
                      <small>{BULK_VENDOR_FAILURE_LABELS[item.reason] || item.reason}</small>
                    </div>
                  ))}
                </div>
              </>
            )}
            <div className="admin-form-actions">
              <button className="admin-primary-button" onClick={() => setImportResult(null)}>Done</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  function renderBulkCreateVendorsModal() {
    const { rows: detectedRows, error: parseError } = parseBulkVendorRows(bulkVendorNamesText);
    const rowsWithPhone = detectedRows.filter((row) => row.phone).length;
    const rowsMissingName = detectedRows.filter((row) => !row.name).length;
    const rowsMode = rowsWithPhone > 0;
    const detectedCount = rowsMode ? detectedRows.length : parseBulkVendorNames(detectedRows.map((row) => row.name).join('\n')).length;
    const overLimit = detectedCount > MAX_BULK_ROWS;

    function downloadVendorImportTemplate() {
      window.location.href = `${API_BASE_URL}/admin/vendors/bulk-import-template`;
    }

    async function handleBulkFileRead(event) {
      const file = event.target.files?.[0];
      if (!file) return;
      const text = await file.text();
      setBulkVendorNamesText((current) => (current ? `${current}\n${text}` : text));
      event.target.value = '';
    }

    return (
      <div
        className="admin-modal-overlay"
        onClick={closeBulkCreateVendors}
      >
        <div
          className="admin-modal"
          role="dialog"
          aria-modal="true"
          aria-label="Bulk create Solar Mitras"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="admin-modal-header">
            <div>
              <span className="admin-eyebrow">SOLAR MITRA MANAGEMENT</span>
              <h2>Bulk create Solar Mitras</h2>
            </div>
            <button
              className="admin-mini-button"
              onClick={closeBulkCreateVendors}
              aria-label="Close"
            >
              <Icon path={ICONS.close} />
            </button>
          </div>

          <form onSubmit={bulkCreateVendors} className="admin-modal-body">
            <p>
              Columns: <strong>name, phone, password</strong>, plus optional bank
              details — <strong>upi_number, upi_id, account_holder_name, account_number,
              ifsc_code</strong>. Paste rows from a spreadsheet or upload a .csv
              file — up to 2,000 at a time. Leave password blank to use the phone
              number as the initial password (changing it later is optional).
              Bank fields are format-checked only, not verified — a malformed
              one is skipped with a warning, the Solar Mitra is still created.
            </p>

            <button
              type="button"
              className="admin-outline-button"
              onClick={downloadVendorImportTemplate}
            >
              Download CSV template
            </button>

            <textarea
              rows={10}
              placeholder={'name,phone,password\nRam Store,9876543210,\nA1 Solar Co.,9812345678,MyPass123'}
              value={bulkVendorNamesText}
              onChange={(event) => setBulkVendorNamesText(event.target.value)}
            />

            <input
              type="file"
              accept=".csv,.txt,text/csv,text/plain"
              onChange={handleBulkFileRead}
            />

            <small>
              {rowsMode
                ? `${detectedRows.length} row${detectedRows.length === 1 ? '' : 's'} detected · ${rowsWithPhone} with a phone number`
                : `${detectedCount} name${detectedCount === 1 ? '' : 's'} detected`}
              {overLimit ? ' — over the 2,000 limit, trim the list' : ''}
            </small>
            {parseError && <small role="alert">{parseError}</small>}
            {rowsMissingName > 0 && (
              <small role="alert">{rowsMissingName} row{rowsMissingName === 1 ? ' has' : 's have'} no name — fix or remove before creating.</small>
            )}
            {rowsMode && detectedRows.length > rowsWithPhone && (
              <small>{detectedRows.length - rowsWithPhone} row(s) have no phone number and will be reported as failed.</small>
            )}

            <label className="admin-form-field">
              <span>State (optional) — applied to every Solar Mitra in this batch</span>
              <select
                value={bulkVendorState}
                onChange={(event) => setBulkVendorState(event.target.value)}
              >
                <option value="">No state selected</option>
                {INDIAN_STATES.map((state) => (
                  <option key={state} value={state}>{state}</option>
                ))}
              </select>
            </label>

            {!rowsMode && (
              <label className="admin-toggle-row">
                <input
                  type="checkbox"
                  checked={bulkVendorAutoPassword}
                  onChange={(event) => setBulkVendorAutoPassword(event.target.checked)}
                />
                Set an initial password automatically (businessname@123)
              </label>
            )}

            {loading && (
              <small>Sending in batches of {VENDOR_BATCH_SIZE}. Keep this page open until it finishes.</small>
            )}

            <div className="admin-form-actions">
              <button
                type="button"
                className="admin-outline-button"
                disabled={loading}
                onClick={closeBulkCreateVendors}
              >
                Cancel
              </button>
              <button
                className="admin-primary-button"
                disabled={loading || detectedCount === 0 || overLimit || rowsMissingName > 0 || Boolean(parseError)}
              >
                {loading ? 'Creating...' : `Create ${detectedCount} Solar Mitra${detectedCount === 1 ? '' : 's'}`}
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  function renderBulkVendorResultModal() {
    if (!bulkVendorResult) return null;
    const failures = bulkVendorResult.failures || [];
    const warnings = bulkVendorResult.warnings || [];
    return (
      <div className="admin-modal-overlay" onClick={() => setBulkVendorResult(null)}>
        <div className="admin-modal admin-deletion-modal" role="dialog" aria-modal="true" aria-label="Bulk Solar Mitra creation result" onClick={(event) => event.stopPropagation()}>
          <div className="admin-modal-header">
            <div>
              <span className="admin-eyebrow">BULK CREATE</span>
              <h2>{bulkVendorResult.stopped ? 'Bulk create stopped early' : 'Solar Mitras created'}</h2>
            </div>
            <button className="admin-mini-button" onClick={() => setBulkVendorResult(null)} aria-label="Close"><Icon path={ICONS.close} /></button>
          </div>
          <div className="admin-modal-body">
            <p className="admin-deletion-lead">
              {bulkVendorResult.created} of {bulkVendorResult.totalRows} Solar Mitra(s) created successfully.
            </p>
            {renderBatchRunNotes(bulkVendorResult)}
            {failures.length > 0 && (
              <>
                <p>{failures.length} row(s) could not be created{failures.length > RESULT_LIST_LIMIT ? ` (first ${RESULT_LIST_LIMIT} shown)` : ''}:</p>
                <div className="admin-deletion-blocked-list">
                  {failures.slice(0, RESULT_LIST_LIMIT).map((item) => (
                    <div className="admin-deletion-blocked-item" key={`bulk-vendor-fail-${item.row}`}>
                      <strong>Row {item.row}: {item.businessName}</strong>
                      <small>{BULK_VENDOR_FAILURE_LABELS[item.reason] || item.reason}</small>
                    </div>
                  ))}
                </div>
              </>
            )}
            {warnings.length > 0 && (
              <>
                <p>{warnings.length} bank field(s) were skipped — the Solar Mitra was still created{warnings.length > RESULT_LIST_LIMIT ? ` (first ${RESULT_LIST_LIMIT} shown)` : ''}:</p>
                <div className="admin-deletion-blocked-list">
                  {warnings.slice(0, RESULT_LIST_LIMIT).map((item) => (
                    <div className="admin-deletion-blocked-item" key={`bulk-vendor-warn-${item.row}-${item.field}`}>
                      <strong>Row {item.row}: {BULK_VENDOR_BANK_FIELD_LABELS[item.field] || item.field}</strong>
                      <small>{item.reason}</small>
                    </div>
                  ))}
                </div>
              </>
            )}
            <div className="admin-form-actions">
              <button className="admin-primary-button" onClick={() => setBulkVendorResult(null)}>Done</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  function renderPagination() {
    const meta =
      portalData?.data?.pagination;

    if (!meta) return null;

    const {
      page,
      limit,
      total,
    } = meta;

    const start =
      total === 0
        ? 0
        : (page - 1) * limit + 1;

    const end = Math.min(
      page * limit,
      total
    );

    return (
      <div className="admin-pagination">
        <span>
          {total === 0
            ? 'No records'
            : `Showing ${start}–${end} of ${total}`}
        </span>

        {PAGE_SIZE_RESOURCES.includes(resource) && (
          <label className="admin-page-size">
            <span>Rows per page</span>
            <select
              value={pageSize}
              disabled={loading}
              onChange={(event) => changePageSize(Number(event.target.value))}
            >
              {PAGE_SIZE_OPTIONS.map((size) => (
                <option key={size} value={size}>{size}</option>
              ))}
            </select>
          </label>
        )}

        <div>
          <button
            className="admin-outline-button"
            disabled={
              loading || page <= 1
            }
            onClick={() =>
              loadAdminResource(
                resource,
                page - 1
              )
            }
          >
            Previous
          </button>

          <button
            className="admin-outline-button"
            disabled={
              loading ||
              page * limit >= total
            }
            onClick={() =>
              loadAdminResource(
                resource,
                page + 1
              )
            }
          >
            Next
          </button>
        </div>
      </div>
    );
  }

  function renderResourceSkeleton() {
    return (
      <div className="admin-resource" aria-hidden="true">
        <div className="admin-resource-heading">
          <div style={{ display: 'grid', gap: '8px' }}>
            <SkeletonBlock width="120px" height="12px" />
            <SkeletonBlock width="200px" height="26px" />
          </div>
        </div>

        <div className="admin-skeleton-table">
          {Array.from({ length: 6 }).map((_, index) => (
            <SkeletonBlock key={index} height="48px" radius="8px" />
          ))}
        </div>
      </div>
    );
  }

  function renderCurrentResource() {
    if (resourceLoading) {
      return renderResourceSkeleton();
    }

    if (resource === 'dashboard') {
      return renderStats();
    }

    if (resource === 'vendors') {
      return renderVendors();
    }

    if (resource === 'qr') {
      return renderQr();
    }

    if (resource === 'print-qr') {
      return renderPrintWizard();
    }

    if (resource === 'templates') {
      return renderTemplates();
    }

    if (resource === 'print-history') {
      return renderPrintHistory();
    }

    if (resource === 'leads') {
      return renderLeads();
    }

    if (resource === 'scans') {
      return renderScans();
    }

    if (resource === 'payouts') {
      return renderPayouts();
    }

    if (resource === 'users') {
      return renderUsers();
    }

    if (resource === 'vendor-applications') {
      return renderApplications();
    }

    if (resource === 'audit-logs') {
      return renderAuditLogs();
    }

    return null;
  }

  if (!sessionChecked) {
    return (
      <div className="admin-page">
        <aside className="admin-sidebar">
          <div className="admin-sidebar-logo">
            <div className="admin-logo">
              <img className="admin-logo-image" src="/Sol_logo.jpg" alt="Solarium" />
            </div>
          </div>
          <div className="admin-skeleton-nav">
            {Array.from({ length: 8 }).map((_, index) => (
              // eslint-disable-next-line react/no-array-index-key
              <SkeletonBlock key={index} height="38px" radius="10px" />
            ))}
          </div>
        </aside>

        <main className="admin-main">
          <header className="admin-topbar">
            <SkeletonBlock width="160px" height="20px" />
            <SkeletonBlock width="90px" height="36px" radius="18px" />
          </header>

          <div className="admin-content">
            <div className="admin-stat-grid">
              {Array.from({ length: 8 }).map((_, index) => (
                <div className="admin-stat-card" key={index}>
                  <SkeletonBlock width="38px" height="38px" radius="10px" />
                  <div style={{ display: 'grid', gap: '8px', marginTop: '10px' }}>
                    <SkeletonBlock width="70%" height="12px" />
                    <SkeletonBlock width="45%" height="22px" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </main>
      </div>
    );
  }

  if (!portalData) {
    return (
      <div className="admin-page admin-login-page">
        <div className="admin-login-background" />

        <main className="admin-login-card">
          <div className="admin-logo">
            <img className="admin-logo-image" src="/Sol_logo.jpg" alt="Solarium" />
          </div>

          <div className="admin-login-heading">
            <span className="admin-eyebrow">
              ADMINISTRATION
            </span>

            <h1>
              Complete control.
              <br />
              One workspace.
            </h1>

            <p>
              Manage Solar Mitras, QR inventory, leads,
              commissions and system activity.
            </p>
          </div>

          <form
            onSubmit={signIn}
            className="admin-login-form"
          >
            <label>
              Username or mobile
            </label>

            <input
              required
              id="admin-login-identifier"
              name="username_or_mobile"
              autoComplete="username"
              placeholder="Enter your login"
              value={login.identifier}
              onChange={(event) =>
                setLogin({
                  ...login,
                  identifier:
                    event.target.value,
                })
              }
            />

            <label>
              Password
            </label>

            <input
              required
              id="admin-login-password"
              name="password"
              type="password"
              autoComplete="current-password"
              placeholder="Enter your password"
              value={login.password}
              onChange={(event) =>
                setLogin({
                  ...login,
                  password:
                    event.target.value,
                })
              }
            />

            <button
              className="admin-primary-button admin-login-button"
              disabled={loading}
            >
              {loading
                ? 'Signing in...'
                : 'Sign in'}

              {!loading && (
                <Icon path={ICONS.arrow} />
              )}
            </button>
          </form>

          {message && (
            <div
              className={`admin-message ${messageType}`}
              role="status"
            >
              <Icon
                path={
                  messageType === 'error'
                    ? ICONS.alert
                    : ICONS.check
                }
              />
              {message}
            </div>
          )}

          <div className="admin-login-security">
            Secure administrative access
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="admin-page">
      <aside
        className={`admin-sidebar ${
          mobileNavOpen ? 'open' : ''
        }`}
      >
        <div className="admin-sidebar-logo">
          <div className="admin-logo">
              <img className="admin-logo-image" src="/Sol_logo.jpg" alt="Solarium" />
          </div>

          <button
            className="admin-mobile-close"
            onClick={() =>
              setMobileNavOpen(false)
            }
          >
            <Icon path={ICONS.close} />
          </button>
        </div>

        <div className="admin-sidebar-label">
          CONTROL CENTER
        </div>

        <nav className="admin-nav">
          {NAV_ITEMS.filter(([key]) => portalData.account.role === 'ADMIN' || (NAV_PERMISSION[key] && can(NAV_PERMISSION[key]))).map(
            ([key, label]) => (
              <button
                key={key}
                className={
                  resource === key
                    ? 'active'
                    : ''
                }
                onClick={() =>
                  navigate(key)
                }
              >
                <Icon
                  path={
                    ICONS[key] ||
                    ICONS.dashboard
                  }
                />
                <span>{label}</span>
                {key === 'vendor-applications' && pendingApplications > 0 && (
                  <span className="admin-nav-badge" aria-label={`${pendingApplications} pending`}>{pendingApplications}</span>
                )}
              </button>
            )
          )}
        </nav>

        <div className="admin-sidebar-bottom">
          <div className="admin-account-card">
            <div className="admin-avatar">
              {(
                portalData.account.name ||
                'A'
              )
                .charAt(0)
                .toUpperCase()}
            </div>

            <div>
              <strong>
                {portalData.account.name}
              </strong>
              <span>{portalData.account.role === 'STAFF' ? portalData.account.roleName || 'Staff' : 'Administrator'}</span>
            </div>
          </div>

          <button
            className="admin-sidebar-logout"
            onClick={signOutCurrent}
            disabled={loading}
          >
            <Icon path={ICONS.logout} />
            Sign out
          </button>
        </div>
      </aside>

      {mobileNavOpen && (
        <button
          className="admin-sidebar-overlay"
          onClick={() =>
            setMobileNavOpen(false)
          }
          aria-label="Close navigation"
        />
      )}

      <main className="admin-main">
        <header className="admin-topbar">
          <button
            className="admin-mobile-menu"
            onClick={() =>
              setMobileNavOpen(true)
            }
          >
            <Icon path={ICONS.menu} />
          </button>

          <div className="admin-breadcrumb">
            <span>Admin</span>
            <strong>/</strong>
            <b>
              {
                NAV_ITEMS.find(
                  ([key]) =>
                    key === resource
                )?.[1]
              }
            </b>
          </div>

          <div className="admin-topbar-right">
            <span className="admin-live-dot" />
            System operational

            <div className="admin-topbar-avatar">
              {(
                portalData.account.name ||
                'A'
              )
                .charAt(0)
                .toUpperCase()}
            </div>
          </div>
        </header>

        <div className="admin-content">
          {portalData.account.role === 'STAFF' && !landingResource(portalData.account)
            ? <div className="admin-empty admin-empty-block">Your role has no screens yet. Ask an administrator to update it.</div>
            : renderCurrentResource()}

          {message && (
            <div
              className={`admin-floating-message ${
                messageType
              }`}
              role="status"
            >
              <Icon
                path={
                  messageType === 'error'
                    ? ICONS.alert
                    : ICONS.check
                }
              />
              <span>{message}</span>

              <button
                onClick={() => {
                  setMessage('');
                  setMessageType('');
                }}
              >
                <Icon path={ICONS.close} />
              </button>
            </div>
          )}
        </div>

        {detailLead && renderLeadDetailModal()}
        {qrPrintHistory && renderQrPrintHistoryModal()}
        {detailBank && renderBankDetailsModal()}
        {detailVendor && renderVendorDetailsModal()}
        {detailOnboardingMedia && renderOnboardingMediaModal()}
        {detailAuditLog && renderAuditLogDetailModal()}
        {deletionResult && renderDeletionResultModal()}
        {importResult && renderImportResultModal()}
        {showBulkCreateVendors && renderBulkCreateVendorsModal()}
        {showAutoPosters && <AutoPosterModal onClose={() => setShowAutoPosters(false)} />}
        {bulkVendorResult && renderBulkVendorResultModal()}
        {batchProgress && <BatchProgressModal title={batchProgress.title} progress={batchProgress} />}
        <SessionExpiryGuard portal="admin" onSignOut={signOutCurrent} />
        {retentionStatus?.needsAcknowledgment && renderRetentionGateModal()}
        {previewTemplate && renderTemplatePreviewModal()}
        {confirmPurgeQrId && renderQrPurgeModal()}
      </main>
    </div>
  );
}

export default AdminPage;