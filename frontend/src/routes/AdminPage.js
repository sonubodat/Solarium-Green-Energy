// AdminPage.js

import { Fragment, useEffect, useRef, useState } from 'react';
import { apiRequest, API_BASE_URL } from '../api/client';
import { SkeletonBlock } from '../components/Skeleton';
import QrScanner from '../components/QrScanner';
import './AdminPage.css';

const ICONS = {
  dashboard: 'M4 4h6v6H4V4Zm10 0h6v6h-6V4ZM4 14h6v6H4v-6Zm10 0h6v6h-6v-6Z',
  store: 'M4 10h16v10H4V10Zm2 0V6h12v4M3 10h18',
  qr: 'M4 4h6v6H4V4Zm10 0h6v6h-6V4ZM4 14h6v6H4v-6Zm10 1h2v2h-2v-2Zm3-1h3v3h-3v-3Zm-3 4h2v2h-2v-2Z',
  users: 'M16 20v-1.5c0-2.2-1.8-4-4-4H7c-2.2 0-4 1.8-4 4V20m6-9a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm7-6a3 3 0 0 1 0 6m2 9v-1.5a4 4 0 0 0-3-3.9',
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

const NAV_ITEMS = [
  ['dashboard', 'Dashboard'],
  ['vendors', 'Vendors'],
  ['qr', 'QR Management'],
  ['leads', 'Leads'],
  ['scans', 'Scans'],
  ['payouts', 'Commissions'],
  ['users', 'Staff Users'],
  ['audit-logs', 'Audit Logs'],
];

function AdminPage() {
  const [login, setLogin] = useState({
    identifier: '',
    password: '',
  });

  const [portalData, setPortalData] = useState(null);
  // Distinguishes "still checking whether a session cookie is valid" from "confirmed logged
  // out" — without this, the login form flashes on every page load/reload for an already
  // signed-in Admin while restoreSession()'s request is in flight (worse the slower the
  // backend is, e.g. a cold Render instance waking up), before silently swapping to the
  // dashboard. Shows a skeleton instead of that flash.
  const [sessionChecked, setSessionChecked] = useState(false);
  const [resource, setResource] = useState('dashboard');
  // Scoped to switching resources specifically (sidebar nav clicks), not every filter change,
  // pagination click, or Refresh — those already show their own loading state on the button and
  // switching skeletons under them would be more distracting than helpful. Without this, clicking
  // a sidebar item briefly rendered an empty "No leads yet" (etc.) state while the new resource's
  // data was still in flight, which looked like a bug rather than a load in progress.
  const [resourceLoading, setResourceLoading] = useState(false);
  const [adminPage, setAdminPage] = useState(1);

  const [vendorLookup, setVendorLookup] = useState([]);

  const [search, setSearch] = useState('');
  const [qrStatus, setQrStatus] = useState('');
  const [qrAssignment, setQrAssignment] = useState('');

  const [showCreateVendor, setShowCreateVendor] = useState(false);
  const [showGenerateQr, setShowGenerateQr] = useState(false);
  const [outputMode, setOutputMode] = useState(null);
  const [showTemplateForm, setShowTemplateForm] = useState(false);
  const [showCreateStaff, setShowCreateStaff] = useState(false);

  const [newVendor, setNewVendor] = useState({
    business_name: '',
    owner_name: '',
    login_identifier: '',
    mobile_number: '',
    password: '',
  });

  const [newStaffUser, setNewStaffUser] = useState({
    name: '',
    username_or_mobile: '',
    password: '',
    role: 'SALES',
  });

  const [qrQuantity, setQrQuantity] = useState('20');
  const [qrTemplates, setQrTemplates] = useState([]);
  const [templateDraft, setTemplateDraft] = useState({
    name: 'Vendor Sticker A4',
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
  const [printBatchDraft, setPrintBatchDraft] = useState({ template_id: '', range_start: '', range_end: '' });
  const [lastPrintJob, setLastPrintJob] = useState(null);
  const [templateSingleDraft, setTemplateSingleDraft] = useState({ template_id: '', code: '' });
  const [reassignVendorInputs, setReassignVendorInputs] = useState({});

  const [showScanAssign, setShowScanAssign] = useState(false);
  const [singleQrCode, setSingleQrCode] = useState('');
  const [scannedQr, setScannedQr] = useState(null);
  const [scanVendorId, setScanVendorId] = useState('');
  const [paidReferenceInputs, setPaidReferenceInputs] = useState({});
  const [selectedVendorIds, setSelectedVendorIds] = useState([]);
  const [deletionResult, setDeletionResult] = useState(null);

  const [editingVendorId, setEditingVendorId] = useState(null);
  const [editVendorDraft, setEditVendorDraft] = useState({});

  const [staffRoleInputs, setStaffRoleInputs] = useState({});

  const [detailLead, setDetailLead] = useState(null);
  const [detailBank, setDetailBank] = useState(null);
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

  useEffect(() => {
    restoreSession();

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function restoreSession() {
    try {
      const session = await apiRequest('/auth/session?portal=admin');

      if (!mountedRef.current || session.role !== 'ADMIN') return;

      setPortalData({
        account: session.account,
        data: null,
      });

      await loadAdminResource('dashboard', 1);
    } catch (error) {
      // No active Admin session.
    } finally {
      if (mountedRef.current) setSessionChecked(true);
    }
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

      if (result.user?.role !== 'ADMIN') {
        throw new Error('Admin access is required.');
      }

      setPortalData({
        account: result.user,
        data: null,
      });

      setResource('dashboard');
      setAdminPage(1);

      await loadAdminResource('dashboard', 1);

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
    if (!portalData && nextResource !== 'dashboard') {
      return;
    }

    setLoading(true);
    if (nextResource === 'vendors') setSelectedVendorIds([]);
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

        if (!mountedRef.current) return;

        setAdminPage(1);
        setPortalData((current) => ({
          ...current,
          data,
        }));

        return;
      }

      let query = `?page=${page}&limit=50`;

      if (nextResource === 'qr' && effectiveStatus) {
        query += `&status=${encodeURIComponent(effectiveStatus)}`;
      }

      if (nextResource === 'qr' && effectiveAssignment) {
        query += `&assignment=${encodeURIComponent(effectiveAssignment)}`;
      }

      const data = await apiRequest(`/admin/${nextResource}${query}`, { forceRefresh });

      if (!mountedRef.current) return;

      setAdminPage(page);

      setPortalData((current) => ({
        ...current,
        data,
      }));

      if (nextResource === 'qr') {
        const [lookup, templates] = await Promise.all([
          apiRequest('/admin/vendors/lookup', { forceRefresh }),
          apiRequest('/admin/qr/templates', { forceRefresh }),
        ]);

        if (mountedRef.current) {
          setVendorLookup(lookup.vendors || []);
          setQrTemplates(templates.templates || []);
        }
      }
    } catch (error) {
      setMessage(error.message);
      setMessageType('error');
    } finally {
      setLoading(false);
    }
  }

  function navigate(nextResource) {
    setResource(nextResource);
    setAdminPage(1);
    setSearch('');
    setSelectedVendorIds([]);
    setMobileNavOpen(false);
    setResourceLoading(true);

    loadAdminResource(nextResource, 1).finally(() =>
      setResourceLoading(false)
    );
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

      await apiRequest('/admin/vendors', {
        method: 'POST',
        body: JSON.stringify(body),
      });

      setNewVendor({
        business_name: '',
        owner_name: '',
        login_identifier: '',
        mobile_number: '',
        password: '',
      });

      setShowCreateVendor(false);

      await loadAdminResource('vendors', adminPage);

      setMessage('Vendor created.');
      setMessageType('success');
    } catch (error) {
      setMessage(error.message);
      setMessageType('error');
    } finally {
      setLoading(false);
    }
  }

  async function deactivateVendor(vendorId, businessName) {
    if (
      !window.confirm(
        `Deactivate ${businessName}? Historical records are preserved.`
      )
    ) {
      return;
    }

    setLoading(true);

    try {
      await apiRequest(`/admin/vendors/${vendorId}/deactivate`, {
        method: 'POST',
      });

      await loadAdminResource('vendors', adminPage);

      setMessage('Vendor deactivated.');
      setMessageType('success');
    } catch (error) {
      setMessage(error.message);
      setMessageType('error');
    } finally {
      setLoading(false);
    }
  }

  async function deleteVendor(vendorId, businessName) {
    if (
      !window.confirm(
        `Delete ${businessName}? This only succeeds if the Vendor has no leads, scans, payouts, or QR assignments.`
      )
    ) {
      return;
    }

    setLoading(true);

    try {
      await apiRequest(`/admin/vendors/${vendorId}/delete`, {
        method: 'POST',
      });

      await loadAdminResource('vendors', adminPage);

      setMessage('Vendor deleted.');
      setMessageType('success');
    } catch (error) {
      setMessage(error.message);
      setMessageType('error');
    } finally {
      setLoading(false);
    }
  }

  async function purgeVendor(vendorId, businessName) {
    const confirmation = window.prompt(
      `Permanent cleanup will remove ${businessName}, assignments, scans, sessions, registration, and bank documents. Leads will remain as Deleted Vendor records. Type the exact business name to continue:`,
      ''
    );
    if (confirmation === null) return;
    if (confirmation.trim() !== businessName) {
      setMessage('Vendor purge cancelled: the business name did not match exactly.');
      setMessageType('error');
      return;
    }
    if (!window.confirm(`Permanently clean up ${businessName}? This cannot be undone. Paid/unpaid payout history blocks the operation.`)) return;

    setLoading(true);
    try {
      await apiRequest(`/admin/vendors/${vendorId}/purge`, {
        method: 'POST',
        body: JSON.stringify({ confirm_vendor_name: confirmation.trim() }),
      });
      await loadAdminResource('vendors', adminPage, undefined, undefined, true);
      setMessage(`${businessName} was permanently cleaned up. Its Leads remain labeled as a deleted Vendor.`);
      setMessageType('success');
    } catch (error) {
      setMessage(error.message);
      setMessageType('error');
    } finally {
      setLoading(false);
    }
  }

  function leadVendorLabel(lead) {
    return lead.vendor?.businessName || lead.vendorNameSnapshot || 'Deleted Vendor';
  }

  function startEditVendor(vendor) {
    setEditingVendorId(vendor.id);

    setEditVendorDraft({
      business_name: vendor.businessName,
      owner_name: vendor.ownerName,
      login_identifier: vendor.loginIdentifier,
      mobile_number: vendor.mobileNumber,
    });
  }

  async function saveVendorEdit(event, vendorId) {
    event.preventDefault();

    if (!window.confirm('Save these changes to the Vendor record?')) {
      return;
    }

    setLoading(true);

    try {
      await apiRequest(`/admin/vendors/${vendorId}`, {
        method: 'PATCH',
        body: JSON.stringify(editVendorDraft),
      });

      setEditingVendorId(null);

      await loadAdminResource('vendors', adminPage);

      setMessage('Vendor updated.');
      setMessageType('success');
    } catch (error) {
      setMessage(error.message);
      setMessageType('error');
    } finally {
      setLoading(false);
    }
  }

  async function resetVendorPassword(vendorId, businessName) {
    if (
      !window.confirm(
        `Issue a temporary password reset for ${businessName}?`
      )
    ) {
      return;
    }

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
    }
  }

  async function generateQrBatch(event) {
    event.preventDefault();

    const quantity = Number.parseInt(qrQuantity, 10);

    if (!Number.isInteger(quantity) || quantity < 1) {
      setMessage('Enter a valid quantity.');
      setMessageType('error');
      return;
    }

    setLoading(true);

    try {
      const result = await apiRequest('/admin/qr/generate', {
        method: 'POST',
        body: JSON.stringify({
          quantity,
        }),
      });

      setShowGenerateQr(false);

      await loadAdminResource('qr', adminPage);

      setMessage(`Generated ${result.count} QR codes.`);
      setMessageType('success');
    } catch (error) {
      setMessage(error.message);
      setMessageType('error');
    } finally {
      setLoading(false);
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
        name: 'Vendor Sticker A4',
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

      setMessage(`Template created: ${result.template.name}`);
      setMessageType('success');
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

  async function createPrintBatch(event) {
    event.preventDefault();
    const { template_id, range_start, range_end } = printBatchDraft;
    if (!template_id || !range_start || !range_end) {
      setMessage('Select a template and add a QR range before creating a batch.');
      setMessageType('error');
      return;
    }

    setLoading(true);
    try {
      const result = await apiRequest('/admin/qr/print-batch', {
        method: 'POST',
        body: JSON.stringify({
          template_id: template_id,
          range_start: range_start.trim(),
          range_end: range_end.trim(),
          idempotency_key: `qr-print-${Date.now()}`,
        }),
      });

      setPrintBatchDraft({ template_id: '', range_start: '', range_end: '' });
      setLastPrintJob(result.job);
      setMessage(`Print batch created: ${result.job.rangeStart} → ${result.job.rangeEnd}.`);
      setMessageType('success');
      await loadAdminResource('qr', adminPage);
    } catch (error) {
      setMessage(error.message);
      setMessageType('error');
    } finally {
      setLoading(false);
    }
  }

  async function generatePrintProof(job) {
    if (!job?.id) return;
    setLoading(true);
    try {
      const result = await apiRequest(`/admin/qr/print-batch/${encodeURIComponent(job.id)}/proof`, { method: 'POST' });
      setLastPrintJob(result.job);
      setMessage('Proof generated and every representative QR was verified.');
      setMessageType('success');
    } catch (error) {
      setMessage(error.message);
      setMessageType('error');
    } finally {
      setLoading(false);
    }
  }

  async function approvePrintProof(job) {
    if (!job?.id || !window.confirm('Approve this verified proof and allow the designed PDF to be downloaded?')) return;
    setLoading(true);
    try {
      const result = await apiRequest(`/admin/qr/print-batch/${encodeURIComponent(job.id)}/approve`, { method: 'POST' });
      setLastPrintJob(result.job);
      setMessage('Proof approved. The designed template PDF is ready to download.');
      setMessageType('success');
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

  function downloadTemplatePdf(job) {
    if (!job?.id) return;
    window.location.href = `${API_BASE_URL}/admin/qr/print-batch/${encodeURIComponent(job.id)}/pdf`;
  }

  function printTemplatePdf(job) {
    if (!job?.id) return;
    window.open(`${API_BASE_URL}/admin/qr/print-batch/${encodeURIComponent(job.id)}/pdf?inline=true`, '_blank', 'noopener,noreferrer');
  }

  function downloadSingleTemplatePdf(inline = false) {
    const { template_id: templateId, code } = templateSingleDraft;
    if (!templateId || !code.trim()) {
      setMessage('Select a published template and enter a QR code first.');
      setMessageType('error');
      return;
    }
    const params = new URLSearchParams({ template_id: templateId, code: code.trim(), ...(inline ? { inline: 'true' } : {}) });
    window.open(`${API_BASE_URL}/admin/qr/template-pdf?${params.toString()}`, '_blank', 'noopener,noreferrer');
  }

  async function assignQr(qr, reassign = false) {
    const vendorId = (
      reassignVendorInputs[qr.id] || ''
    ).trim();

    if (!vendorId) {
      setMessage('Select a vendor first.');
      setMessageType('error');
      return;
    }

    const vendor = vendorLookup.find(
      (item) => item.id === vendorId
    );

    if (
      !window.confirm(
        `${reassign ? 'Reassign' : 'Assign'} ${qr.code} to ${
          vendor?.businessName || 'the selected Vendor'
        }?`
      )
    ) {
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
    }
  }

  async function deleteQr(qr) {
    if (
      !window.confirm(
        `Delete ${qr.code}? This only works for QR codes that have never been assigned, and cannot be undone.`
      )
    ) {
      return;
    }

    setLoading(true);

    try {
      await apiRequest(`/admin/qr/${qr.id}/delete`, { method: 'POST' });
      await loadAdminResource('qr', adminPage);
      setMessage('QR code deleted.');
      setMessageType('success');
    } catch (error) {
      setMessage(error.message);
      setMessageType('error');
    } finally {
      setLoading(false);
    }
  }

  async function bulkDeleteVendors() {
    if (!selectedVendorIds.length) return;
    if (!window.confirm(`Delete ${selectedVendorIds.length} selected Vendor${selectedVendorIds.length === 1 ? '' : 's'}? Vendors with history will block the entire operation.`)) return;
    setLoading(true);
    try {
      const result = await apiRequest('/admin/vendors/bulk-delete', { method: 'POST', body: JSON.stringify({ ids: selectedVendorIds }) });
      setDeletionResult({ entity: 'Vendors', deleted: result.count, blocked: [] });
      setSelectedVendorIds([]);
      await loadAdminResource('vendors', adminPage, undefined, undefined, true);
    } catch (error) {
      if (error.code === 'BULK_DELETE_BLOCKED') setDeletionResult({ entity: 'Vendors', deleted: 0, blocked: error.details || [] });
      else { setMessage(error.message); setMessageType('error'); }
    } finally {
      setLoading(false);
    }
  }

  async function lookupScannedQr(code) {
    setLoading(true);
    setMessage('');
    setMessageType('');

    try {
      const result = await apiRequest(
        `/admin/qr/lookup/${encodeURIComponent(code.trim())}`
      );
      setScannedQr(result.qr);
      setScanVendorId('');
    } catch (error) {
      setScannedQr(null);
      setMessage(error.message);
      setMessageType('error');
    } finally {
      setLoading(false);
    }
  }

  function handleScanAssignDetected(code) {
    setShowScanAssign(false);
    lookupScannedQr(code);
  }

  async function assignScannedQr() {
    if (!scannedQr || !scanVendorId) return;

    const isReassign = scannedQr.status === 'ACTIVE';
    const vendor = vendorLookup.find(
      (item) => item.id === scanVendorId
    );

    if (
      !window.confirm(
        `${isReassign ? 'Reassign' : 'Assign'} ${scannedQr.code} to ${
          vendor?.businessName || 'the selected Vendor'
        }?`
      )
    ) {
      return;
    }

    setLoading(true);

    try {
      await apiRequest(
        `/admin/qr/${scannedQr.id}/${
          isReassign ? 'reassign' : 'assign'
        }`,
        {
          method: 'POST',
          body: JSON.stringify({ vendor_id: scanVendorId }),
        }
      );

      setScannedQr(null);
      setScanVendorId('');

      await loadAdminResource('qr', adminPage);

      setMessage(
        isReassign
          ? 'QR reassigned successfully.'
          : 'QR assigned successfully.'
      );
      setMessageType('success');
    } catch (error) {
      setMessage(error.message);
      setMessageType('error');
    } finally {
      setLoading(false);
    }
  }

  async function updatePayoutStatus(payout, status) {
    const reference = (
      paidReferenceInputs[payout.id] || ''
    ).trim();

    if (
      (status === 'PAID' || status === 'PARTIAL') &&
      !reference
    ) {
      setMessage(
        'Enter a payment reference before marking this payout.'
      );
      setMessageType('error');
      return;
    }

    if (
      !window.confirm(
        `Mark ${
          payout.vendor?.businessName || 'this Vendor'
        } payout as ${status}?`
      )
    ) {
      return;
    }

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
    }
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

  async function createStaffUser(event) {
    event.preventDefault();

    setLoading(true);

    try {
      await apiRequest('/admin/users', {
        method: 'POST',
        body: JSON.stringify(newStaffUser),
      });

      setNewStaffUser({
        name: '',
        username_or_mobile: '',
        password: '',
        role: 'SALES',
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
    const nextRole =
      staffRoleInputs[user.id] || user.role;

    if (nextRole === user.role) {
      setMessage('Select a different role first.');
      setMessageType('error');
      return;
    }

    if (
      !window.confirm(
        `Change ${user.name}'s role from ${user.role} to ${nextRole}?`
      )
    ) {
      return;
    }

    setLoading(true);

    try {
      await apiRequest(`/admin/users/${user.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          role: nextRole,
        }),
      });

      await loadAdminResource('users', adminPage);

      setMessage('Staff user role updated.');
      setMessageType('success');
    } catch (error) {
      setMessage(error.message);
      setMessageType('error');
    } finally {
      setLoading(false);
    }
  }

  async function deactivateStaffUser(user) {
    if (
      !window.confirm(
        `Deactivate staff user ${user.name}?`
      )
    ) {
      return;
    }

    setLoading(true);

    try {
      await apiRequest(
        `/admin/users/${user.id}/deactivate`,
        {
          method: 'POST',
        }
      );

      await loadAdminResource('users', adminPage);

      setMessage('Staff user deactivated.');
      setMessageType('success');
    } catch (error) {
      setMessage(error.message);
      setMessageType('error');
    } finally {
      setLoading(false);
    }
  }

  function openQrPrintSheet() {
    // Was missing the /api prefix entirely — that opened this app's own client-side "/admin/qr/print"
    // route (which doesn't exist) instead of the backend endpoint, and silently fell through to the
    // catch-all redirect to the public customer page. Also reuses whatever status filter is currently
    // applied to the QR list, so what's on screen is what gets printed.
    // "ASSIGNED"/"DEACTIVATED" are options in the status filter dropdown but aren't real
    // QrStatus values the backend accepts here (only UNASSIGNED/ACTIVE/INACTIVE/RETIRED) —
    // passing either through would 400. Only forward status when it's one of those.
    const validPrintStatuses = ['UNASSIGNED', 'ACTIVE', 'INACTIVE', 'RETIRED'];
    const params = new URLSearchParams();
    if (validPrintStatuses.includes(qrStatus)) params.set('status', qrStatus);
    if (qrAssignment) params.set('assignment', qrAssignment);
    const query = params.toString();
    // Same-window navigation (not a new tab) so the request shows up in this tab's own
    // Network tab for debugging — the print sheet is server-rendered HTML outside the SPA,
    // so this does leave the Admin app; use the browser's back button to return.
    window.location.href = `${API_BASE_URL}/admin/qr/print${query ? `?${query}` : ''}`;
  }

  function downloadQrPdf() {
    // Same status/assignment filters as the print sheet and the QR list. The endpoint sends
    // Content-Disposition: attachment, so the browser downloads the file in place without
    // navigating away from the app.
    const validPrintStatuses = ['UNASSIGNED', 'ACTIVE', 'INACTIVE', 'RETIRED'];
    const params = new URLSearchParams();
    if (validPrintStatuses.includes(qrStatus)) params.set('status', qrStatus);
    if (qrAssignment) params.set('assignment', qrAssignment);
    const query = params.toString();
    window.location.href = `${API_BASE_URL}/admin/qr/pdf${query ? `?${query}` : ''}`;
  }

  async function downloadSingleQrPdf(event) {
    event.preventDefault();
    const code = singleQrCode.trim();
    if (!code) return;

    setMessage('');
    setMessageType('');

    try {
      // Confirm the code exists before navigating — a bare window.location.href to a 404
      // takes over the whole page with the raw API JSON instead of staying in the app, since
      // that's a full-page navigation, not a fetch this UI can catch and show nicely.
      await apiRequest(`/admin/qr/lookup/${encodeURIComponent(code)}`);
      window.location.href = `${API_BASE_URL}/admin/qr/pdf?code=${encodeURIComponent(code)}`;
    } catch (error) {
      setMessage(
        error.code === 'QR_NOT_FOUND'
          ? `No QR code matching "${code}" was found. Check the code and try again.`
          : error.message
      );
      setMessageType('error');
    }
  }

  function downloadLeadsCsv() {
    window.location.href = `${API_BASE_URL}/admin/leads/export`;
  }

  function renderStats() {
    const data = portalData?.data || {};

    const stats = [
      ['Total Vendors', data.totalVendors ?? 0, 'store'],
      ['Active Vendors', data.activeVendors ?? 0, 'users'],
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

    return (
      <div className="admin-dashboard">
        <div className="admin-section-heading">
          <div>
            <span className="admin-eyebrow">OVERVIEW</span>
            <h2>System at a glance</h2>
            <p>
              Everything important across vendors, QR,
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

        <div className="admin-quick-grid">
          <button
            onClick={() => navigate('vendors')}
            className="admin-quick-card"
          >
            <Icon path={ICONS.store} />
            <div>
              <strong>Manage vendors</strong>
              <span>View, edit and control vendor access</span>
            </div>
            <Icon path={ICONS.arrow} />
          </button>

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
        </div>
      </div>
    );
  }

  function renderVendors() {
    const vendors =
      portalData?.data?.vendors || [];

    const filtered = vendors.filter((vendor) => {
      if (!search.trim()) return true;

      const query = search.toLowerCase();

      return [
        vendor.businessName,
        vendor.ownerName,
        vendor.loginIdentifier,
        vendor.mobileNumber,
        vendor.id,
      ]
        .filter(Boolean)
        .some((value) =>
          String(value)
            .toLowerCase()
            .includes(query)
        );
    });
    const allVisibleVendorsSelected = filtered.length > 0 && filtered.every((vendor) => selectedVendorIds.includes(vendor.id));

    return (
      <div className="admin-resource">
        <div className="admin-resource-heading">
          <div>
            <span className="admin-eyebrow">
              VENDOR MANAGEMENT
            </span>
            <h2>Vendors</h2>
            <p>
              Manage every vendor account and its QR
              relationship.
            </p>
          </div>

          <button
            className="admin-primary-button"
            onClick={() =>
              setShowCreateVendor(
                (current) => !current
              )
            }
          >
            <Icon path={ICONS.plus} />
            Add vendor
          </button>
        </div>

        {showCreateVendor && (
          <form
            onSubmit={createVendor}
            className="admin-form-card"
          >
            <div className="admin-form-title">
              Create vendor
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
                  This is what the Vendor will type to sign in — not their name or business name.
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
                  placeholder="Leave blank to set later via Reset Password"
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
            </div>

            <div className="admin-form-actions">
              <button
                type="button"
                className="admin-outline-button"
                onClick={() =>
                  setShowCreateVendor(false)
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
                  : 'Create vendor'}
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
              placeholder="Search vendors..."
              value={search}
              onChange={(event) =>
                setSearch(event.target.value)
              }
            />
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

        <div className="admin-selection-toolbar">
          <label className="admin-select-all">
            <input type="checkbox" checked={allVisibleVendorsSelected} onChange={(event) => setSelectedVendorIds(event.target.checked ? filtered.map((vendor) => vendor.id) : [])} />
            Select current page
          </label>
          <span>{selectedVendorIds.length} selected</span>
          <button type="button" className="admin-mini-button danger" disabled={!selectedVendorIds.length || loading} onClick={bulkDeleteVendors}>Delete selected</button>
        </div>

        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th className="admin-check-cell">Select</th>
                <th>Vendor</th>
                <th>Owner</th>
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
                    <td className="admin-check-cell">
                      <input type="checkbox" checked={selectedVendorIds.includes(vendor.id)} onChange={(event) => setSelectedVendorIds((current) => event.target.checked ? [...new Set([...current, vendor.id])] : current.filter((id) => id !== vendor.id))} aria-label={`Select ${vendor.businessName}`} />
                    </td>
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
                            <button
                              className="admin-mini-button success"
                              onClick={(event) =>
                                saveVendorEdit(
                                  event,
                                  vendor.id
                                )
                              }
                            >
                              <Icon
                                path={ICONS.check}
                              />
                            </button>

                            <button
                              className="admin-mini-button"
                              onClick={() =>
                                setEditingVendorId(
                                  null
                                )
                              }
                            >
                              Cancel
                            </button>
                          </>
                        ) : (
                          <>
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

                            <button
                              className="admin-mini-button"
                              onClick={() =>
                                resetVendorPassword(
                                  vendor.id,
                                  vendor.businessName
                                )
                              }
                            >
                              Reset
                            </button>

                            <button
                              className="admin-mini-button danger"
                              onClick={() =>
                                deactivateVendor(
                                  vendor.id,
                                  vendor.businessName
                                )
                              }
                            >
                              Deactivate
                            </button>

                            <button
                              className="admin-mini-button danger"
                              onClick={() =>
                                deleteVendor(
                                  vendor.id,
                                  vendor.businessName
                                )
                              }
                            >
                              Delete
                            </button>
                            <button
                              className="admin-mini-button danger"
                              onClick={() => purgeVendor(vendor.id, vendor.businessName)}
                            >
                              Purge history
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td
                    colSpan="7"
                    className="admin-empty"
                  >
                    No vendors found.
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

  function renderQr() {
    // The backend returns the QR list under `data` (see GET /api/admin/qr), not `qr`.
    const qrs = portalData?.data?.data || [];
    const qrTotal = portalData?.data?.pagination?.total || 0;
    const unassignedCount = qrs.filter((qr) => qr.status === 'UNASSIGNED').length;
    const activeCount = qrs.filter((qr) => qr.status === 'ACTIVE').length;

    return (
      <div className="admin-resource">
        <div className="admin-resource-heading">
          <div>
            <span className="admin-eyebrow">
              QR INVENTORY
            </span>
            <h2>QR Management</h2>
            <p>
              Generate, assign, reassign and control
              physical QR inventory.
            </p>
          </div>

          <div className="admin-heading-actions admin-qr-heading-actions">
            <button
              className="admin-outline-button"
              onClick={openQrPrintSheet}
            >
              QR-only print sheet
            </button>

            <button
              className="admin-outline-button"
              onClick={downloadQrPdf}
            >
              QR-only PDF
            </button>

            <button
              className="admin-outline-button"
              onClick={() => setShowScanAssign(true)}
            >
              <Icon path={ICONS.qr} />
              Scan to assign
            </button>

            <button
              className="admin-primary-button"
              onClick={() => {
                setOutputMode('quick');
                setShowGenerateQr((current) => !current);
              }}
            >
              <Icon path={ICONS.plus} />
              Generate codes
            </button>
          </div>
        </div>

        <div className="admin-qr-overview" aria-label="QR inventory summary">
          <div className="admin-qr-overview-intro">
            <span className="admin-eyebrow">INVENTORY CONTROL</span>
            <strong>QR code operations</strong>
            <small>Assign physical codes, prepare artwork, and print verified batches.</small>
          </div>
          <div className="admin-qr-overview-stat"><span>Total inventory</span><strong>{qrTotal.toLocaleString()}</strong></div>
          <div className="admin-qr-overview-stat"><span>Loaded page</span><strong>{qrs.length.toLocaleString()}</strong></div>
          <div className="admin-qr-overview-stat warning"><span>Unassigned here</span><strong>{unassignedCount.toLocaleString()}</strong></div>
          <div className="admin-qr-overview-stat success"><span>Active here</span><strong>{activeCount.toLocaleString()}</strong></div>
        </div>

        <form
          className="admin-single-qr-form"
          onSubmit={downloadSingleQrPdf}
        >
          <input
            id="qr-single-code"
            name="qr_single_code"
            type="text"
            placeholder="e.g. V-0023"
            value={singleQrCode}
            onChange={(event) =>
              setSingleQrCode(event.target.value)
            }
          />
          <button
            type="submit"
            className="admin-outline-button"
            disabled={!singleQrCode.trim()}
          >
            Download this QR as PDF
          </button>
          <small>
            Just need one code? Type it above instead of downloading the
            whole batch.
          </small>
        </form>

        {showScanAssign && (
          <QrScanner
            onDetected={handleScanAssignDetected}
            onClose={() => setShowScanAssign(false)}
          />
        )}

        {scannedQr && (
          <div className="admin-form-card admin-scan-assign">
            <div className="admin-form-title">
              Scanned: {scannedQr.code}
            </div>

            <p>
              Status: <strong>{scannedQr.status}</strong>
              {scannedQr.currentVendor && (
                <>
                  {' '}
                  &middot; Currently with{' '}
                  <strong>{scannedQr.currentVendor.businessName}</strong>
                </>
              )}
            </p>

            {(scannedQr.status === 'UNASSIGNED' || scannedQr.status === 'ACTIVE') ? (
              <div className="admin-scan-assign-actions">
                <select
                  value={scanVendorId}
                  onChange={(event) => setScanVendorId(event.target.value)}
                >
                  <option value="">Select a vendor...</option>
                  {vendorLookup.map((vendor) => (
                    <option key={vendor.id} value={vendor.id}>
                      {vendor.businessName}
                    </option>
                  ))}
                </select>

                <button
                  className="admin-primary-button"
                  disabled={loading || !scanVendorId}
                  onClick={assignScannedQr}
                >
                  {scannedQr.status === 'ACTIVE' ? 'Reassign' : 'Assign'}
                </button>

                <button
                  className="admin-outline-button"
                  onClick={() => {
                    setScannedQr(null);
                    setScanVendorId('');
                  }}
                >
                  Cancel
                </button>
              </div>
            ) : (
              <p className="admin-scan-assign-blocked">
                This QR is {scannedQr.status.toLowerCase()} and can&apos;t be assigned.
              </p>
            )}
          </div>
        )}

        <section className="admin-qr-output-section">
          <div className="admin-qr-section-heading">
            <div>
              <span className="admin-eyebrow">OUTPUT</span>
              <h3>What do you want to produce?</h3>
              <p>Choose a quick QR export or a designed print using saved artwork.</p>
            </div>
          </div>
          <div className="admin-qr-output-grid">
            <button type="button" className={`admin-qr-output-card ${outputMode === 'quick' ? 'selected' : ''}`} onClick={() => setOutputMode(outputMode === 'quick' ? null : 'quick')}>
              <span className="admin-qr-output-icon"><Icon path={ICONS.qr} /></span>
              <span className="admin-qr-output-copy"><strong>Quick QR export</strong><small>Simple PDF containing QR codes only. No artwork or template required.</small></span>
              <span className="admin-qr-output-action">{outputMode === 'quick' ? 'Close' : 'Generate PDF'} <Icon path={ICONS.arrow} /></span>
            </button>
            <button type="button" className={`admin-qr-output-card designed ${outputMode === 'designed' ? 'selected' : ''}`} onClick={() => setOutputMode(outputMode === 'designed' ? null : 'designed')}>
              <span className="admin-qr-output-icon"><Icon path={ICONS.edit} /></span>
              <span className="admin-qr-output-copy"><strong>Designed print</strong><small>Use artwork and a saved template, then review the proof before PDF generation.</small></span>
              <span className="admin-qr-output-action">{outputMode === 'designed' ? 'Close' : 'Create print job'} <Icon path={ICONS.arrow} /></span>
            </button>
          </div>
        </section>

        {outputMode === 'quick' && (
          <section className="admin-qr-output-panel admin-qr-quick-panel">
            <div className="admin-qr-panel-heading"><div><span className="admin-eyebrow">QUICK EXPORT</span><h3>Generate a QR-only PDF</h3><p>Use the current inventory filters, or enter one code below.</p></div></div>
            {showGenerateQr && (
              <form onSubmit={generateQrBatch} className="admin-form-card admin-qr-generate">
                <div><div className="admin-form-title">Add QR codes to inventory</div><p>Generate a new batch of unassigned QR codes.</p></div>
                <input type="number" min="1" max="5000" value={qrQuantity} onChange={(event) => setQrQuantity(event.target.value)} />
                <button className="admin-primary-button" disabled={loading}>{loading ? 'Generating...' : 'Generate'}</button>
                <button type="button" className="admin-outline-button" disabled={loading} onClick={() => setShowGenerateQr(false)}>Cancel</button>
              </form>
            )}
            <div className="admin-qr-quick-actions">
              <button type="button" className="admin-primary-button" onClick={downloadQrPdf}>Generate filtered PDF</button>
              <button type="button" className="admin-outline-button" onClick={openQrPrintSheet}>Open print sheet</button>
            </div>
          </section>
        )}

        {outputMode === 'designed' && (
          <section className="admin-qr-output-panel admin-qr-designed-panel">
            <div className="admin-qr-panel-heading"><div><span className="admin-eyebrow">DESIGNED PRINT</span><h3>Create print job</h3><p>Select QR codes, choose a published template, then generate and approve the proof.</p></div><span className="admin-workspace-status"><i /> Proof-first</span></div>
            <div className="admin-qr-wizard-steps"><span className="active"><b>1</b> QR codes</span><span><b>2</b> Template</span><span><b>3</b> Review proof</span><span><b>4</b> PDF ready</span></div>
        <div className="admin-form-card admin-qr-workspace">
          <div className="admin-workspace-heading">
            <div>
              <span className="admin-eyebrow">PRINT WORKSPACE</span>
              <div className="admin-form-title">Templates and print batches</div>
              <p>Lock the physical layout once, then prepare a deterministic range for proof and approval.</p>
            </div>
            <span className="admin-workspace-status"><i /> Proof-first workflow</span>
          </div>

          <div className="admin-qr-template-actions">
            <button type="button" className="admin-outline-button" onClick={() => setShowTemplateForm((current) => !current)}>
              {showTemplateForm ? 'Hide template form' : 'Create template'}
            </button>
          </div>

          {showTemplateForm && (
            <form onSubmit={createQrTemplate} className="admin-template-form">
              <div className="admin-template-editor-layout">
                <div>
                  <div className="admin-template-preview-heading">
                    <div>
                      <strong>Placement preview</strong>
                      <small>Drag the square QR marker. Pull its corner to resize.</small>
                    </div>
                    <span>{Number(templateDraft.qr_width || 0).toFixed(1)} mm x {Number(templateDraft.qr_height || 0).toFixed(1)} mm</span>
                  </div>
                  <div
                    className="admin-template-preview"
                    data-qr-template-editor
                    style={{ aspectRatio: `${Number(templateDraft.page_width_mm) || 210} / ${Number(templateDraft.page_height_mm) || 297}` }}
                  >
                    {templateArtworkPreview && templateArtwork?.type !== 'application/pdf' && (
                      <img src={templateArtworkPreview} alt="Uploaded template artwork" />
                    )}
                    {templateArtworkPreview && templateArtwork?.type === 'application/pdf' && (
                      <iframe src={templateArtworkPreview} title="Uploaded template artwork preview" />
                    )}
                    {!templateArtworkPreview && <div className="admin-template-preview-empty">Upload artwork to preview the physical page.</div>}
                    <div
                      className="admin-qr-placeholder"
                      style={{
                        left: `${(Number(templateDraft.qr_x) / (Number(templateDraft.page_width_mm) || 210)) * 100}%`,
                        top: `${(Number(templateDraft.qr_y) / (Number(templateDraft.page_height_mm) || 297)) * 100}%`,
                        width: `${(Number(templateDraft.qr_width) / (Number(templateDraft.page_width_mm) || 210)) * 100}%`,
                        height: `${(Number(templateDraft.qr_height) / (Number(templateDraft.page_height_mm) || 297)) * 100}%`,
                      }}
                      onPointerDown={(event) => beginTemplateInteraction(event, 'drag')}
                    >
                      <span>QR</span>
                      <button type="button" aria-label="Resize QR placeholder" onPointerDown={(event) => beginTemplateInteraction(event, 'resize')} />
                    </div>
                  </div>
                </div>
                <div className="admin-template-editor-note">
                  <span className="admin-eyebrow">PHYSICAL PLACEMENT</span>
                  <strong>Keep the marker over the intended print area.</strong>
                  <p>The saved coordinates are calculated in millimetres from the page edges. The QR stays square for reliable scanning.</p>
                </div>
              </div>
              <div className="admin-grid-two">
                <label>
                  Template name
                  <input id="template-name" name="template_name" value={templateDraft.name} onChange={(event) => setTemplateDraft({ ...templateDraft, name: event.target.value })} />
                </label>
                <label className="admin-upload-field">
                  Artwork file
                  <input id="template-artwork" name="artwork" type="file" accept="image/png,image/jpeg,application/pdf" onChange={(event) => setTemplateArtwork(event.target.files?.[0] || null)} />
                  <small>{templateArtwork ? templateArtwork.name : 'PNG, JPG, or PDF up to 2 MB'}</small>
                </label>
                <label>
                  Page width (mm)
                  <input id="template-page-width" name="page_width_mm" type="number" value={templateDraft.page_width_mm} onChange={(event) => setTemplateDraft({ ...templateDraft, page_width_mm: event.target.value })} />
                </label>
                <label>
                  Page height (mm)
                  <input id="template-page-height" name="page_height_mm" type="number" value={templateDraft.page_height_mm} onChange={(event) => setTemplateDraft({ ...templateDraft, page_height_mm: event.target.value })} />
                </label>
                <label>
                  DPI
                  <input id="template-dpi" name="dpi" type="number" value={templateDraft.dpi} onChange={(event) => setTemplateDraft({ ...templateDraft, dpi: event.target.value })} />
                </label>
              </div>

              <details className="admin-advanced-placement">
                <summary>Advanced placement</summary>
                <div className="admin-grid-two">
                  <label>
                    QR X (mm)
                    <input id="template-qr-x" name="qr_x" type="number" value={templateDraft.qr_x} onChange={(event) => setTemplateDraft({ ...templateDraft, qr_x: event.target.value })} />
                  </label>
                  <label>
                    QR Y (mm)
                    <input id="template-qr-y" name="qr_y" type="number" value={templateDraft.qr_y} onChange={(event) => setTemplateDraft({ ...templateDraft, qr_y: event.target.value })} />
                  </label>
                  <label>
                    QR size (mm)
                    <input id="template-qr-size" name="qr_size" type="number" value={templateDraft.qr_width} onChange={(event) => setTemplateDraft({ ...templateDraft, qr_width: event.target.value, qr_height: event.target.value })} />
                  </label>
                </div>
              </details>

              <label className="admin-toggle-row">
                <input id="template-label-enabled" name="label_enabled" type="checkbox" checked={templateDraft.label_enabled} onChange={(event) => setTemplateDraft({ ...templateDraft, label_enabled: event.target.checked })} />
                Add QR text label
              </label>

              {templateDraft.label_enabled && (
                <div className="admin-grid-two">
                  <label>
                    Label X
                    <input id="template-label-x" name="label_text_x" type="number" value={templateDraft.label_text_x} onChange={(event) => setTemplateDraft({ ...templateDraft, label_text_x: event.target.value })} />
                  </label>
                  <label>
                    Label Y
                    <input id="template-label-y" name="label_text_y" type="number" value={templateDraft.label_text_y} onChange={(event) => setTemplateDraft({ ...templateDraft, label_text_y: event.target.value })} />
                  </label>
                  <label>
                    Font size
                    <input id="template-label-font-size" name="label_font_size" type="number" value={templateDraft.label_font_size} onChange={(event) => setTemplateDraft({ ...templateDraft, label_font_size: event.target.value })} />
                  </label>
                </div>
              )}

              <div className="admin-qr-template-actions">
                <button type="submit" className="admin-primary-button" disabled={loading}>Save template</button>
                <button type="button" className="admin-outline-button" onClick={() => setShowTemplateForm(false)}>Cancel</button>
              </div>
            </form>
          )}

          <form onSubmit={createPrintBatch} className="admin-template-form admin-batch-form">
            <div className="admin-grid-two">
              <label>
                Published template
                <select id="print-template-id" name="template_id" value={printBatchDraft.template_id} onChange={(event) => setPrintBatchDraft({ ...printBatchDraft, template_id: event.target.value })}>
                  <option value="">Select template</option>
                  {qrTemplates.filter((template) => template.status === 'PUBLISHED').map((template) => (
                    <option key={template.id} value={template.id}>{template.name} (v{template.version})</option>
                  ))}
                </select>
              </label>
              <label>
                Range start
                <input id="print-range-start" name="range_start" value={printBatchDraft.range_start} onChange={(event) => setPrintBatchDraft({ ...printBatchDraft, range_start: event.target.value })} placeholder="V-0001" />
              </label>
              <label>
                Range end
                <input id="print-range-end" name="range_end" value={printBatchDraft.range_end} onChange={(event) => setPrintBatchDraft({ ...printBatchDraft, range_end: event.target.value })} placeholder="V-0100" />
              </label>
            </div>
            <div className="admin-qr-template-actions admin-batch-actions">
              <small>Only published templates and existing QR codes can enter a batch.</small>
              <button type="submit" className="admin-primary-button" disabled={loading}>Create proof batch</button>
            </div>
            {lastPrintJob && (
              <div className="admin-print-success">
                <div>
                  <strong>Batch ready: {lastPrintJob.rangeStart} to {lastPrintJob.rangeEnd}</strong>
                  <small>{lastPrintJob.itemCount?.toLocaleString() || 0} pages use the saved template geometry. Status: {lastPrintJob.status}.</small>
                </div>
                <div className="admin-print-success-actions">
                  <button type="button" className="admin-outline-button" disabled={loading} onClick={() => generatePrintProof(lastPrintJob)}>
                    {lastPrintJob.proofCheckedAt ? 'Regenerate proof' : 'Generate proof'}
                  </button>
                  {lastPrintJob.proofCheckedAt && (
                    <button type="button" className="admin-outline-button" disabled={loading} onClick={() => viewPrintProof(lastPrintJob)}>
                      View proof
                    </button>
                  )}
                  {lastPrintJob.status === 'PENDING_APPROVAL' && lastPrintJob.proofCheckedAt && (
                    <button type="button" className="admin-primary-button" disabled={loading} onClick={() => approvePrintProof(lastPrintJob)}>
                      Approve proof
                    </button>
                  )}
                  {(lastPrintJob.status === 'APPROVED' || process.env.NODE_ENV === 'development') && (
                    <>
                      <button type="button" className="admin-primary-button" disabled={loading} onClick={() => downloadTemplatePdf(lastPrintJob)}>
                        Download template PDF
                      </button>
                      <button type="button" className="admin-outline-button" disabled={loading} onClick={() => printTemplatePdf(lastPrintJob)}>
                        Print designed PDF
                      </button>
                    </>
                  )}
                </div>
              </div>
            )}
          </form>

          <div className="admin-template-form admin-single-template-form">
            <div className="admin-template-subheading">
              <div>
                <strong>Single QR with template</strong>
                <small>Use the saved artwork and placement for one code.</small>
              </div>
              <span>1 page</span>
            </div>
            <div className="admin-single-template-fields">
              <select value={templateSingleDraft.template_id} onChange={(event) => setTemplateSingleDraft({ ...templateSingleDraft, template_id: event.target.value })}>
                <option value="">Select published template</option>
                {qrTemplates.filter((template) => template.status === 'PUBLISHED').map((template) => (
                  <option key={template.id} value={template.id}>{template.name} (v{template.version})</option>
                ))}
              </select>
              <input value={templateSingleDraft.code} onChange={(event) => setTemplateSingleDraft({ ...templateSingleDraft, code: event.target.value })} placeholder="V-0001" />
              <button type="button" className="admin-outline-button" onClick={() => downloadSingleTemplatePdf(false)}>Download designed PDF</button>
              <button type="button" className="admin-outline-button" onClick={() => downloadSingleTemplatePdf(true)}>Print designed PDF</button>
            </div>
          </div>

          {qrTemplates.length > 0 && (
            <div className="admin-template-list">
              <h3>Saved templates</h3>
              {qrTemplates.map((template) => (
                <div key={template.id} className="admin-template-item">
                  <div>
                    <strong>{template.name}</strong>
                    <div className="muted">{template.status} · {template.pageWidthMm} × {template.pageHeightMm} mm · {template.dpi} DPI</div>
                  </div>
                  {template.status !== 'PUBLISHED' && (
                    <button type="button" className="admin-mini-button" onClick={() => publishQrTemplate(template.id)}>
                      Publish
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
          </section>
        )}

        <div className="admin-filter-bar">
          <div className="admin-filter">
            <Icon path={ICONS.filter} />

            <select
              value={qrStatus}
              onChange={(event) => {
                setQrStatus(event.target.value);
                loadAdminResource(
                  'qr',
                  1,
                  event.target.value,
                  qrAssignment
                );
              }}
            >
              <option value="">All statuses</option>
              <option value="ACTIVE">Active</option>
              <option value="UNASSIGNED">
                Unassigned
              </option>
              <option value="ASSIGNED">
                Assigned
              </option>
              <option value="DEACTIVATED">
                Deactivated
              </option>
            </select>
          </div>

          <div className="admin-filter">
            <Icon path={ICONS.store} />

            <select
              value={qrAssignment}
              onChange={(event) => {
                setQrAssignment(
                  event.target.value
                );

                loadAdminResource(
                  'qr',
                  1,
                  qrStatus,
                  event.target.value
                );
              }}
            >
              <option value="">
                All assignments
              </option>
              <option value="ASSIGNED">
                Assigned
              </option>
              <option value="UNASSIGNED">
                Unassigned
              </option>
            </select>
          </div>

          <button
            className="admin-outline-button"
            onClick={() =>
              loadAdminResource('qr', adminPage, undefined, undefined, true)
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
                <th>QR ID</th>
                <th>Current vendor</th>
                <th>Status</th>
                <th>Assigned date</th>
                <th>Vendor action</th>
              </tr>
            </thead>

            <tbody>
              {qrs.length ? (
                qrs.map((qr) => {
                  const currentVendor =
                    qr.assignments?.[0]?.vendor;

                  return (
                    <tr key={qr.id}>
                      <td>
                        <span className="admin-qr-code">
                          <Icon path={ICONS.qr} />
                          {qr.code}
                        </span>
                      </td>

                      <td>
                        {currentVendor?.businessName ||
                          'Unassigned'}
                      </td>

                      <td>
                        <span
                          className={`admin-status ${
                            qr.status ===
                            'UNASSIGNED'
                              ? 'warning'
                              : qr.status ===
                                'ACTIVE'
                              ? 'active'
                              : 'inactive'
                          }`}
                        >
                          {qr.status}
                        </span>
                      </td>

                      <td>
                        {qr.assignments?.[0]
                          ?.assignedAt
                          ? new Date(
                              qr.assignments[0]
                                .assignedAt
                            ).toLocaleDateString()
                          : '—'}
                      </td>

                      <td>
                        <div className="admin-qr-action">
                          <select
                            value={
                              reassignVendorInputs[
                                qr.id
                              ] || ''
                            }
                            onChange={(event) =>
                              setReassignVendorInputs({
                                ...reassignVendorInputs,
                                [qr.id]:
                                  event.target.value,
                              })
                            }
                          >
                            <option value="">
                              Select vendor
                            </option>

                            {vendorLookup.map(
                              (vendor) => (
                                <option
                                  key={vendor.id}
                                  value={vendor.id}
                                >
                                  {
                                    vendor.businessName
                                  }
                                </option>
                              )
                            )}
                          </select>

                          <button
                            className="admin-mini-button"
                            disabled={loading}
                            onClick={() =>
                              assignQr(
                                qr,
                                Boolean(
                                  currentVendor
                                )
                              )
                            }
                          >
                            {currentVendor
                              ? 'Reassign'
                              : 'Assign'}
                          </button>

                          {qr.status === 'UNASSIGNED' && (
                            <button
                              className="admin-mini-button danger"
                              disabled={loading}
                              onClick={() => deleteQr(qr)}
                            >
                              Delete
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td
                    colSpan="5"
                    className="admin-empty"
                  >
                    No QR codes found.
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
            <button
              className="admin-outline-button"
              onClick={downloadLeadsCsv}
            >
              Export CSV
            </button>

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

        <div className="admin-toolbar">
          <div className="admin-search">
            <Icon path={ICONS.search} />
            <input
              placeholder="Search leads..."
              value={search}
              onChange={(event) =>
                setSearch(event.target.value)
              }
            />
          </div>

          <div className="admin-filter">
            <Icon path={ICONS.filter} />
            <select>
              <option>All statuses</option>
              <option>NEW</option>
              <option>CONTACTED</option>
              <option>QUALIFIED</option>
              <option>CONVERTED</option>
              <option>LOST</option>
            </select>
          </div>
        </div>

        {renderLeadsByVendor(leads)}

        {renderPagination()}
      </div>
    );
  }

  function renderLeadsByVendor(leads) {
    const query = search.trim().toLowerCase();

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
                        <th>Customer</th>
                        <th>QR</th>
                        <th>Location</th>
                        <th>Qualification</th>
                        <th>Status</th>
                        <th>Lead date</th>
                        <th>Commission</th>
                        <th />
                      </tr>
                    </thead>

                    <tbody>
                      {group.leads.map((lead) => (
                        <tr key={lead.id}>
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
                            <select
                              className="admin-inline-select"
                              value={lead.status || 'NEW'}
                              disabled={loading}
                              onChange={(event) => updateLeadStatus(lead, event.target.value)}
                            >
                              {['NEW', 'CONTACTED', 'QUALIFIED', 'CONVERTED', 'LOST', 'REJECTED', 'DUPLICATE'].map((status) => (
                                <option key={status} value={status}>{status}</option>
                              ))}
                            </select>
                          </td>

                          <td>
                            {lead.createdAt
                              ? new Date(lead.createdAt).toLocaleDateString()
                              : '—'}
                          </td>

                          <td>{lead.commission?.status || '—'}</td>

                          <td>
                            <button
                              className="admin-mini-button"
                              onClick={() => setDetailLead(lead)}
                            >
                              <Icon path={ICONS.eye} />
                              View
                            </button>
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
                <dt>Vendor</dt>
                <dd>{lead.vendor ? lead.vendor.businessName : `Deleted Vendor: ${lead.vendorNameSnapshot || 'Unknown'}`}</dd>
                <dt>QR code</dt>
                <dd>{lead.qr?.code || '—'}</dd>
                <dt>Lead status</dt>
                <dd>{lead.status || '—'}</dd>
                <dt>Commission</dt>
                <dd>{lead.payout?.status || 'Not created'}</dd>
                <dt>Submitted</dt>
                <dd>{lead.createdAt ? new Date(lead.createdAt).toLocaleString() : '—'}</dd>
              </dl>
            </div>

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

            <div className="admin-modal-section">
              <h3>Record IDs</h3>
              <dl className="admin-modal-fields mono">
                <dt>Lead ID</dt>
                <dd>{lead.id}</dd>
                <dt>Vendor ID</dt>
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
              vendor attribution.
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
                <th>Vendor</th>
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
                    <span className="admin-vendor-group-name">{group.vendor?.businessName || 'Unknown vendor'}</span>
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
                                  {['UNPAID', 'PARTIAL', 'PAID'].map((status) => (
                                    <button
                                      key={status}
                                      className={`admin-mini-button ${payout.status === status ? 'selected' : ''}`}
                                      disabled={loading}
                                      onClick={() => updatePayoutStatus(payout, status)}
                                    >
                                      {payout.status === status ? '✓ ' : ''}{status}
                                    </button>
                                  ))}
                                  {group.vendor && (
                                    <button className="admin-mini-button" onClick={() => viewVendorBankDetails(group.vendor)}>
                                      Bank details
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
              Control internal Sales and Admin access.
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
                <option value="SALES">
                  SALES
                </option>
                <option value="ADMIN">
                  ADMIN
                </option>
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
                <th>Change role</th>
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
                      {user.usernameOrMobile}
                    </td>

                    <td>
                      <span className="admin-role">
                        {user.role}
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
                            user.role
                          }
                          onChange={(event) =>
                            setStaffRoleInputs({
                              ...staffRoleInputs,
                              [user.id]:
                                event.target.value,
                            })
                          }
                        >
                          <option value="SALES">
                            SALES
                          </option>
                          <option value="ADMIN">
                            ADMIN
                          </option>
                        </select>

                        <button
                          className="admin-mini-button"
                          onClick={() =>
                            updateStaffUserRole(
                              user
                            )
                          }
                        >
                          Update
                        </button>
                      </div>
                    </td>

                    <td>
                      <button
                        className="admin-mini-button danger"
                        onClick={() =>
                          deactivateStaffUser(
                            user
                          )
                        }
                      >
                        Deactivate
                      </button>
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

  function renderBankDetailsModal() {
    const details = detailBank.details;
    return (
      <div className="admin-modal-overlay" onClick={() => setDetailBank(null)}>
        <div className="admin-modal" role="dialog" aria-modal="true" aria-label="Vendor bank details" onClick={(event) => event.stopPropagation()}>
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
              Manage vendors, QR inventory, leads,
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
          {NAV_ITEMS.map(
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
              <span>Administrator</span>
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
          {renderCurrentResource()}

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
        {detailBank && renderBankDetailsModal()}
        {detailAuditLog && renderAuditLogDetailModal()}
        {deletionResult && renderDeletionResultModal()}
      </main>
    </div>
  );
}

export default AdminPage;