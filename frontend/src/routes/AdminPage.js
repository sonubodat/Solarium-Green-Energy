// AdminPage.js

import { useEffect, useRef, useState } from 'react';
import { apiRequest, API_BASE_URL } from '../api/client';
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
  const [resource, setResource] = useState('dashboard');
  const [adminPage, setAdminPage] = useState(1);

  const [vendorLookup, setVendorLookup] = useState([]);

  const [search, setSearch] = useState('');
  const [qrStatus, setQrStatus] = useState('');
  const [qrAssignment, setQrAssignment] = useState('');

  const [showCreateVendor, setShowCreateVendor] = useState(false);
  const [showGenerateQr, setShowGenerateQr] = useState(false);
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
  const [reassignVendorInputs, setReassignVendorInputs] = useState({});
  const [paidReferenceInputs, setPaidReferenceInputs] = useState({});

  const [editingVendorId, setEditingVendorId] = useState(null);
  const [editVendorDraft, setEditVendorDraft] = useState({});

  const [staffRoleInputs, setStaffRoleInputs] = useState({});

  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState('');
  const [loading, setLoading] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    restoreSession();

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function restoreSession() {
    try {
      const session = await apiRequest('/auth/session');

      if (!mountedRef.current || session.role !== 'ADMIN') return;

      setPortalData({
        account: session.account,
        data: null,
      });

      await loadAdminResource('dashboard', 1);
    } catch (error) {
      // No active Admin session.
    }
  }

  async function signIn(event) {
    event.preventDefault();

    setLoading(true);
    setMessage('');
    setMessageType('');

    try {
      const result = await apiRequest('/auth/login', {
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
      await apiRequest('/auth/logout', {
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
        const lookup = await apiRequest('/admin/vendors/lookup', { forceRefresh });

        if (mountedRef.current) {
          setVendorLookup(lookup.vendors || []);
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
    setMobileNavOpen(false);

    loadAdminResource(nextResource, 1);
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
    const query = params.toString();
    // Same-window navigation (not a new tab) so the request shows up in this tab's own
    // Network tab for debugging — the print sheet is server-rendered HTML outside the SPA,
    // so this does leave the Admin app; use the browser's back button to return.
    window.location.href = `${API_BASE_URL}/admin/qr/print${query ? `?${query}` : ''}`;
  }

  function downloadQrPdf() {
    // Same status filter as the print sheet. The endpoint sends Content-Disposition: attachment,
    // so the browser downloads the file in place without navigating away from the app.
    const validPrintStatuses = ['UNASSIGNED', 'ACTIVE', 'INACTIVE', 'RETIRED'];
    const params = new URLSearchParams();
    if (validPrintStatuses.includes(qrStatus)) params.set('status', qrStatus);
    const query = params.toString();
    window.location.href = `${API_BASE_URL}/admin/qr/pdf${query ? `?${query}` : ''}`;
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
              <input
                required
                placeholder="Business name"
                value={newVendor.business_name}
                onChange={(event) =>
                  setNewVendor({
                    ...newVendor,
                    business_name:
                      event.target.value,
                  })
                }
              />

              <input
                required
                placeholder="Owner name"
                value={newVendor.owner_name}
                onChange={(event) =>
                  setNewVendor({
                    ...newVendor,
                    owner_name:
                      event.target.value,
                  })
                }
              />

              <input
                required
                placeholder="Login identifier"
                value={newVendor.login_identifier}
                onChange={(event) =>
                  setNewVendor({
                    ...newVendor,
                    login_identifier:
                      event.target.value,
                  })
                }
              />

              <input
                required
                placeholder="Mobile number"
                value={newVendor.mobile_number}
                onChange={(event) =>
                  setNewVendor({
                    ...newVendor,
                    mobile_number:
                      event.target.value,
                  })
                }
              />

              <input
                minLength="8"
                type="password"
                placeholder="Initial password (optional)"
                value={newVendor.password}
                onChange={(event) =>
                  setNewVendor({
                    ...newVendor,
                    password:
                      event.target.value,
                  })
                }
              />
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

        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
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
                      <span className="admin-code">
                        {vendor.currentQr ||
                          'Unassigned'}
                      </span>
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
                      {vendor.totalLeads ?? 0}
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
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td
                    colSpan="6"
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

          <div className="admin-heading-actions">
            <button
              className="admin-outline-button"
              onClick={openQrPrintSheet}
            >
              Print sheet
            </button>

            <button
              className="admin-outline-button"
              onClick={downloadQrPdf}
            >
              Download all as PDF
            </button>

            <button
              className="admin-primary-button"
              onClick={() =>
                setShowGenerateQr(
                  (current) => !current
                )
              }
            >
              <Icon path={ICONS.plus} />
              Generate QR
            </button>
          </div>
        </div>

        {showGenerateQr && (
          <form
            onSubmit={generateQrBatch}
            className="admin-form-card admin-qr-generate"
          >
            <div>
              <div className="admin-form-title">
                Batch generation
              </div>
              <p>
                Generate a new batch of unassigned QR
                codes.
              </p>
            </div>

            <input
              type="number"
              min="1"
              max="5000"
              value={qrQuantity}
              onChange={(event) =>
                setQrQuantity(event.target.value)
              }
            />

            <button
              className="admin-primary-button"
              disabled={loading}
            >
              {loading
                ? 'Generating...'
                : 'Generate'}
            </button>
          </form>
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

        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Customer</th>
                <th>Vendor</th>
                <th>QR</th>
                <th>Status</th>
                <th>Lead date</th>
                <th>Commission</th>
                <th />
              </tr>
            </thead>

            <tbody>
              {leads.length ? (
                leads
                  .filter((lead) => {
                    if (!search.trim()) {
                      return true;
                    }

                    const q =
                      search.toLowerCase();

                    return [
                      lead.customerName,
                      lead.phone,
                      lead.email,
                      lead.id,
                      lead.vendor?.businessName,
                    ]
                      .filter(Boolean)
                      .some((value) =>
                        String(value)
                          .toLowerCase()
                          .includes(q)
                      );
                  })
                  .map((lead) => (
                    <tr key={lead.id}>
                      <td>
                        <div className="admin-primary-cell">
                          <strong>
                            {lead.customerName}
                          </strong>
                          <small>
                            {lead.phone ||
                              lead.email ||
                              lead.id}
                          </small>
                        </div>
                      </td>

                      <td>
                        {lead.vendor?.businessName ||
                          lead.vendorName ||
                          '—'}
                      </td>

                      <td>
                        <span className="admin-code">
                          {lead.qrId || '—'}
                        </span>
                      </td>

                      <td>
                        <span className="admin-status active">
                          {lead.status}
                        </span>
                      </td>

                      <td>
                        {lead.createdAt
                          ? new Date(
                              lead.createdAt
                            ).toLocaleDateString()
                          : '—'}
                      </td>

                      <td>
                        {lead.commission?.status ||
                          '—'}
                      </td>

                      <td>
                        <button className="admin-mini-button">
                          <Icon path={ICONS.eye} />
                          View
                        </button>
                      </td>
                    </tr>
                  ))
              ) : (
                <tr>
                  <td
                    colSpan="7"
                    className="admin-empty"
                  >
                    No leads yet.
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

        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Vendor</th>
                <th>Lead</th>
                <th>Status</th>
                <th>Payment reference</th>
                <th>Created / paid</th>
                <th>Update</th>
              </tr>
            </thead>

            <tbody>
              {payouts.length ? (
                payouts.map((payout) => (
                  <tr key={payout.id}>
                    <td>
                      <strong>
                        {payout.vendor
                          ?.businessName ||
                          'Unknown vendor'}
                      </strong>
                    </td>

                    <td>
                      <span className="admin-code">
                        {payout.leadId}
                      </span>
                    </td>

                    <td>
                      <span className="admin-status active">
                        {payout.status}
                      </span>
                    </td>

                    <td>
                      <input
                        className="admin-table-input"
                        placeholder="Payment reference"
                        value={
                          paidReferenceInputs[
                            payout.id
                          ] || ''
                        }
                        onChange={(event) =>
                          setPaidReferenceInputs({
                            ...paidReferenceInputs,
                            [payout.id]:
                              event.target.value,
                          })
                        }
                      />
                    </td>

                    <td>
                      {payout.paidAt
                        ? new Date(
                            payout.paidAt
                          ).toLocaleDateString()
                        : payout.createdAt
                        ? new Date(
                            payout.createdAt
                          ).toLocaleDateString()
                        : '—'}
                    </td>

                    <td>
                      <div className="admin-row-actions">
                        {[
                          'UNPAID',
                          'PARTIAL',
                          'PAID',
                        ].map((status) => (
                          <button
                            key={status}
                            className={`admin-mini-button ${
                              payout.status ===
                              status
                                ? 'selected'
                                : ''
                            }`}
                            disabled={loading}
                            onClick={() =>
                              updatePayoutStatus(
                                payout,
                                status
                              )
                            }
                          >
                            {payout.status ===
                            status
                              ? '✓ '
                              : ''}
                            {status}
                          </button>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td
                    colSpan="6"
                    className="admin-empty"
                  >
                    No payout records yet.
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

        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Actor</th>
                <th>Action</th>
                <th>Resource</th>
                <th>Details</th>
              </tr>
            </thead>

            <tbody>
              {logs.length ? (
                logs.map((log) => (
                  <tr key={log.id}>
                    <td>
                      {log.timestamp
                        ? new Date(
                            log.timestamp
                          ).toLocaleString()
                        : '—'}
                    </td>

                    <td>
                      {log.actor?.name ||
                        log.actorRole ||
                        'System'}
                    </td>

                    <td>
                      <span className="admin-code">
                        {log.action}
                      </span>
                    </td>

                    <td>
                      {log.entity
                        ? `${log.entity} ${log.entityId || ''}`.trim()
                        : '—'}
                    </td>

                    <td>
                      {log.metadata && Object.keys(log.metadata).length
                        ? JSON.stringify(log.metadata)
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
                    No audit records yet.
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

  function renderCurrentResource() {
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

  if (!portalData) {
    return (
      <div className="admin-page admin-login-page">
        <div className="admin-login-background" />

        <main className="admin-login-card">
          <div className="admin-logo">
            <span>solarium</span>
            <strong>energy</strong>
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
            <span>solarium</span>
            <strong>energy</strong>
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
      </main>
    </div>
  );
}

export default AdminPage;