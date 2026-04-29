import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { fetchAuthSession, signOut } from 'aws-amplify/auth';
import './AdminDashboard.css';

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:3002/api/v1';

const EMPTY_FORM = {
  clientSlug: '', name: '', url: '', status: 'active',
  cognitoUserPoolId: '', cognitoClientId: '', cognitoRegion: 'ap-south-1',
  primaryColor: '#2A598F', primaryColorLight: '#6895BF',
  bgFrom: '#0f1419', bgTo: '#1a1d29', accentColor: '#4e9af1',
  logoUrl: '', headerImageUrl: '', faviconUrl: '',
  // Snowflake credentials (per-client)
  snowflakeAccount: '', snowflakeUser: '', snowflakePassword: '', snowflakeWarehouse: '',
  // Snowflake data location
  snowflakeDatabase: '', snowflakeSchema: '',
  snowflakeTable: '', snowflakeStageName: '',
  faqs: [],
};

const UPLOAD_MODES = [
  {
    value: 'replace',
    label: 'Full Replace',
    desc: 'Wipe existing data and reload everything from this CSV',
    icon: '↺',
  },
  {
    value: 'append',
    label: 'Append Rows',
    desc: 'Add new rows — CSV must have the same columns as the existing table',
    icon: '+',
  },
  {
    value: 'append_extend',
    label: 'Append + New Columns',
    desc: 'Add rows and extend the table schema with any new columns in the CSV',
    icon: '⊕',
  },
];

function AdminDashboard() {
  const [clients, setClients]               = useState([]);
  const [loading, setLoading]               = useState(true);
  const [showAddForm, setShowAddForm]       = useState(false);
  const [editClient, setEditClient]         = useState(null);
  const [deleteTarget, setDeleteTarget]     = useState(null);
  const [form, setForm]                     = useState(EMPTY_FORM);
  const [saving, setSaving]                 = useState(false);
  const [formError, setFormError]           = useState('');
  const [successMsg, setSuccessMsg]         = useState('');
  const [search, setSearch]                 = useState('');
  const [statusFilter, setStatusFilter]     = useState('all');
  const [activeSection, setActiveSection]   = useState('clients');
  const [dark, setDark]                     = useState(true);
  const [showDataUpload, setShowDataUpload] = useState(false);
  const [dataUploadClient, setDataUploadClient] = useState(null);
  // CSV upload state
  const [csvFile, setCsvFile]               = useState(null);
  const [uploadMode, setUploadMode]         = useState('replace');
  const [uploading, setUploading]           = useState(false);
  const [uploadResult, setUploadResult]     = useState(null);
  const [uploadError, setUploadError]       = useState('');
  const fileInputRef = useRef(null);
  const [faqInput, setFaqInput] = useState('');
  // Add-client CSV bootstrap state
  const [bootstrapCsvFile, setBootstrapCsvFile]       = useState(null);
  const [bootstrapUploading, setBootstrapUploading]   = useState(false);
  const [bootstrapResult, setBootstrapResult]         = useState(null);
  const [bootstrapError, setBootstrapError]           = useState('');
  const [showPassword, setShowPassword]               = useState(false);
  const bootstrapFileRef = useRef(null);

  // ── Auth header ───────────────────────────────────────────────
  const getAuthHeader = async () => {
    const session = await fetchAuthSession();
    const token   = session?.tokens?.accessToken?.toString();
    return token ? { Authorization: `Bearer ${token}` } : {};
  };

  // ── Load clients ──────────────────────────────────────────────
  const loadClients = useCallback(async () => {
    setLoading(true);
    try {
      const headers = await getAuthHeader();
      const res     = await fetch(`${API_BASE_URL}/admin/clients`, { headers });
      const data    = await res.json();
      const sorted  = (Array.isArray(data) ? data : []).sort(
        (a, b) => new Date(b.createdAt) - new Date(a.createdAt),
      );
      setClients(sorted);
    } catch (err) {
      console.error('Failed to load clients', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadClients(); }, [loadClients]);

  // ── Derived stats ─────────────────────────────────────────────
  const stats = useMemo(() => {
    const active   = clients.filter(c => c.status === 'active').length;
    const inactive = clients.length - active;
    return { total: clients.length, active, inactive };
  }, [clients]);

  const filteredClients = useMemo(() => {
    const q = search.trim().toLowerCase();
    return clients.filter(c => {
      if (statusFilter !== 'all' && c.status !== statusFilter) return false;
      if (!q) return true;
      return (
        (c.name || '').toLowerCase().includes(q) ||
        (c.clientSlug || '').toLowerCase().includes(q) ||
        (c.url || '').toLowerCase().includes(q)
      );
    });
  }, [clients, search, statusFilter]);

  // ── Form handlers ─────────────────────────────────────────────
  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm(prev => ({ ...prev, [name]: value }));
  };

  const resetBootstrapState = () => {
    setBootstrapCsvFile(null);
    setBootstrapUploading(false);
    setBootstrapResult(null);
    setBootstrapError('');
    setShowPassword(false);
    if (bootstrapFileRef.current) bootstrapFileRef.current.value = '';
  };

  const openAddForm = () => {
    setForm(EMPTY_FORM);
    setFormError('');
    setFaqInput('');
    setEditClient(null);
    setShowAddForm(true);
    resetCsvState();
    resetBootstrapState();
  };

  const openEditForm = (client) => {
    setForm({ ...EMPTY_FORM, ...client, faqs: client.faqs ?? [] });
    setFormError('');
    setFaqInput('');
    setEditClient(client);
    setShowAddForm(true);
    resetCsvState();
  };

  const closeForm = () => {
    setShowAddForm(false);
    setEditClient(null);
    setFormError('');
    setFaqInput('');
    resetCsvState();
    resetBootstrapState();
  };

  const openDataUploadModal = (client) => {
    setDataUploadClient(client);
    setShowDataUpload(true);
    resetCsvState();
  };

  const closeDataUpload = () => {
    setShowDataUpload(false);
    setDataUploadClient(null);
    resetCsvState();
  };

  const resetCsvState = () => {
    setCsvFile(null);
    setUploadMode('replace');
    setUploadResult(null);
    setUploadError('');
    setUploading(false);
  };

  // ── Create client ─────────────────────────────────────────────
  const handleCreate = async (e) => {
    e.preventDefault();
    setFormError('');
    setBootstrapError('');
    if (!form.clientSlug.trim() || !form.name.trim() || !form.url.trim()) {
      setFormError('Slug, name and URL are required.');
      return;
    }
    setSaving(true);
    try {
      const authHeaders = await getAuthHeader();
      const headers = { ...authHeaders, 'Content-Type': 'application/json' };
      const res = await fetch(`${API_BASE_URL}/admin/clients`, {
        method: 'POST', headers, body: JSON.stringify(form),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || `Error ${res.status}`);
      }

      // If a bootstrap CSV was selected, upload it now
      if (bootstrapCsvFile) {
        setBootstrapUploading(true);
        try {
          const fd = new FormData();
          fd.append('file', bootstrapCsvFile);
          fd.append('mode', 'replace');
          const uploadRes = await fetch(
            `${API_BASE_URL}/admin/clients/${form.clientSlug.trim()}/upload-csv`,
            { method: 'POST', headers: authHeaders, body: fd },
          );
          const uploadData = await uploadRes.json().catch(() => ({}));
          if (!uploadRes.ok) {
            setBootstrapError(uploadData.message || 'Dataset upload failed — client was created but data was not loaded.');
          } else {
            setBootstrapResult(uploadData);
          }
        } catch (uploadErr) {
          setBootstrapError(uploadErr.message || 'Dataset upload failed.');
        } finally {
          setBootstrapUploading(false);
        }
      }

      showSuccess(`Client "${form.name}" created successfully.`);
      closeForm();
      await loadClients();
    } catch (err) {
      setFormError(err.message || 'Failed to create client.');
    } finally {
      setSaving(false);
    }
  };

  // ── Update client ─────────────────────────────────────────────
  const handleUpdate = async (e) => {
    e.preventDefault();
    setFormError('');
    setSaving(true);
    try {
      const { clientSlug, createdAt, ...updates } = form;
      const headers = { ...(await getAuthHeader()), 'Content-Type': 'application/json' };
      const res     = await fetch(`${API_BASE_URL}/admin/clients/${editClient.clientSlug}`, {
        method: 'PATCH', headers, body: JSON.stringify(updates),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || `Error ${res.status}`);
      }
      showSuccess(`Client "${form.name}" updated successfully.`);
      closeForm();
      await loadClients();
    } catch (err) {
      setFormError(err.message || 'Failed to update client.');
    } finally {
      setSaving(false);
    }
  };

  // ── Delete client ─────────────────────────────────────────────
  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      const headers = await getAuthHeader();
      await fetch(`${API_BASE_URL}/admin/clients/${deleteTarget.clientSlug}`, {
        method: 'DELETE', headers,
      });
      showSuccess(`Client "${deleteTarget.name}" deleted.`);
      setDeleteTarget(null);
      await loadClients();
    } catch (err) {
      console.error('Failed to delete client', err);
    }
  };

  // ── Toggle status ─────────────────────────────────────────────
  const toggleStatus = async (client) => {
    const newStatus = client.status === 'active' ? 'inactive' : 'active';
    try {
      const headers = { ...(await getAuthHeader()), 'Content-Type': 'application/json' };
      await fetch(`${API_BASE_URL}/admin/clients/${client.clientSlug}`, {
        method: 'PATCH', headers, body: JSON.stringify({ status: newStatus }),
      });
      await loadClients();
    } catch (err) {
      console.error('Failed to update status', err);
    }
  };

  // ── CSV upload ────────────────────────────────────────────────
  const handleCsvUpload = async () => {
    const targetClient = editClient || dataUploadClient;
    if (!csvFile || !targetClient) return;
    setUploading(true);
    setUploadError('');
    setUploadResult(null);
    try {
      const authHeader = await getAuthHeader();
      const formData   = new FormData();
      formData.append('file', csvFile);
      formData.append('mode', uploadMode);
      const targetClient = editClient || dataUploadClient;
      const res  = await fetch(
        `${API_BASE_URL}/admin/clients/${targetClient.clientSlug}/upload-csv`,
        { method: 'POST', headers: authHeader, body: formData },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || `Error ${res.status}`);
      setUploadResult(data);
      setCsvFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (err) {
      setUploadError(err.message || 'Upload failed.');
    } finally {
      setUploading(false);
    }
  };

  const handleSignOut = async () => {
    try { await signOut(); }
    catch (err) { console.error('Sign out failed', err); }
    finally { window.location.reload(); }
  };

  const showSuccess = (msg) => {
    setSuccessMsg(msg);
    setTimeout(() => setSuccessMsg(''), 4000);
  };

  const previewSrc = (url) => {
    if (!url) return '';
    const sep = url.includes('?') ? '&' : '?';
    return `${url}${sep}p=${Date.now()}`;
  };

  const formatDate = (iso) => {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  // ── Render ────────────────────────────────────────────────────
  return (
    <div className={`admin-shell${dark ? '' : ' admin-light'}`}>

      {/* ── Sidebar ───────────────────────────────────── */}
      <aside className="admin-sidebar">
        <div className="admin-brand">
          <img src="/niq_icon-1.png" alt="Navigate IQ" className="admin-brand-logo" />
          <div>
            <div className="admin-brand-name">Navigate IQ</div>
            <div className="admin-brand-sub">Admin Console</div>
          </div>
        </div>

        <p className="admin-nav-label">MAIN MENU</p>

        <nav className="admin-nav">
          <button
            className={`admin-nav-item ${activeSection === 'clients' ? 'active' : ''}`}
            onClick={() => { setActiveSection('clients'); setStatusFilter('all'); }}
          >
            <span className="admin-nav-icon"><IconClients /></span>
            <span>Clients</span>
            <span className="admin-nav-count">{stats.total}</span>
          </button>
          <button
            className={`admin-nav-item ${statusFilter === 'active' ? 'active' : ''}`}
            onClick={() => { setActiveSection('clients'); setStatusFilter('active'); }}
          >
            <span className="admin-nav-icon"><IconActive /></span>
            <span>Active</span>
            <span className="admin-nav-count">{stats.active}</span>
          </button>
          <button
            className={`admin-nav-item ${statusFilter === 'inactive' ? 'active' : ''}`}
            onClick={() => { setActiveSection('clients'); setStatusFilter('inactive'); }}
          >
            <span className="admin-nav-icon"><IconInactive /></span>
            <span>Inactive</span>
            <span className="admin-nav-count">{stats.inactive}</span>
          </button>
        </nav>
      </aside>

      {/* ── Main ──────────────────────────────────────── */}
      <main className="admin-main">

        {/* Top bar */}
        <header className="admin-topbar">
          <div>
            <h1 className="admin-title">Client Deployments</h1>
            <p className="admin-subtitle">Manage tenants, themes, Snowflake data and S3 assets</p>
          </div>
          <div className="admin-topbar-actions">
            <button className="admin-btn-outline admin-btn-refresh" onClick={loadClients} disabled={loading} title="Refresh">
              {loading
                ? <><span className="admin-spinner-sm" />Refreshing…</>
                : <><i className="fas fa-redo" />&nbsp;Refresh</>}
            </button>
            {/* <button className="admin-btn-primary" onClick={openAddForm}>
              + Add Client
            </button> */}
            <button
              className="admin-theme-btn"
              onClick={() => setDark(d => !d)}
              aria-label="Toggle dark mode"
              title="Toggle dark mode"
            >
              {dark ? <IconSun /> : <IconMoon />}
            </button>
            <button className="admin-logout-btn" onClick={handleSignOut}>
              <IconLogout /> Logout
            </button>
          </div>
        </header>

        {/* Stat cards */}
        <section className="admin-stats">
          <StatCard label="Total Clients" value={stats.total}    tone="blue"   />
          <StatCard label="Active"         value={stats.active}  tone="green"  />
          <StatCard label="Inactive"       value={stats.inactive} tone="red"   />
        </section>

        {/* Success banner */}
        {successMsg && (
          <div className="admin-success">
            <span className="admin-success-icon">✓</span>
            {successMsg}
          </div>
        )}

        {/* Toolbar */}
        <div className="admin-toolbar">
          <div className="admin-search">
            <span className="admin-search-icon">⌕</span>
            <input
              className="admin-search-input"
              placeholder="Search by name"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="admin-filter-pills">
            {['all', 'active', 'inactive'].map(s => (
              <button
                key={s}
                className={`admin-pill ${statusFilter === s ? 'active' : ''}`}
                onClick={() => setStatusFilter(s)}
              >
                {s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {/* Clients table */}
        <section className="admin-table-card">
          {loading ? (
            <div className="admin-empty">
              <div className="admin-spinner" />
              <p>Loading clients…</p>
            </div>
          ) : filteredClients.length === 0 ? (
            <div className="admin-empty">
              <div className="admin-empty-icon">◳</div>
              <p className="admin-empty-title">
                {clients.length === 0 ? 'No clients yet' : 'No matches'}
              </p>
              <p className="admin-empty-sub">
                {clients.length === 0
                  ? 'Add your first client to get started.'
                  : 'Try a different search term or filter.'}
              </p>
              {clients.length === 0 && (
                <button className="admin-btn-primary" onClick={openAddForm}>
                  + Add First Client
                </button>
              )}
            </div>
          ) : (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th style={{ width: 52 }}></th>
                    <th>Client</th>
                    <th>URL</th>
                    <th>Theme</th>
                    <th>Assets</th>
                    <th>Data Upload</th>
                    <th>Status</th>
                    <th>Created</th>
                    <th style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredClients.map(client => (
                    <tr key={client.clientSlug}>
                      {/* Logo thumb */}
                      <td>
                        <div
                          className="admin-logo-thumb"
                          style={{ background: client.primaryColor || '#2A598F' }}
                        >
                          {client.logoUrl ? (
                            <img
                              src={previewSrc(client.logoUrl)}
                              alt={client.name}
                              onError={(e) => { e.currentTarget.style.display = 'none'; }}
                            />
                          ) : (
                            <span>{(client.name || '?').charAt(0).toUpperCase()}</span>
                          )}
                        </div>
                      </td>
                      {/* Client name + slug */}
                      <td>
                        <div className="admin-cell-name">{client.name}</div>
                        <code className="admin-code">{client.clientSlug}</code>
                      </td>
                      {/* URL */}
                      <td>
                        <a href={client.url} target="_blank" rel="noreferrer" className="admin-link">
                          {client.url}
                          <span className="admin-link-arrow">↗</span>
                        </a>
                      </td>
                      {/* Theme swatches */}
                      <td>
                        <div className="admin-swatches">
                          {[client.primaryColor, client.primaryColorLight, client.accentColor, client.bgFrom, client.bgTo]
                            .filter(Boolean)
                            .map((c, i) => (
                              <span key={i} className="admin-swatch" style={{ background: c }} title={c} />
                            ))}
                        </div>
                      </td>
                      {/* Assets */}
                      <td>
                        <div className="admin-asset-dots">
                          <span className={`admin-asset-dot ${client.logoUrl ? 'filled' : ''}`} title="Logo">L</span>
                          <span className={`admin-asset-dot ${client.headerImageUrl ? 'filled' : ''}`} title="Header">H</span>
                          <span className={`admin-asset-dot ${client.faviconUrl ? 'filled' : ''}`} title="Favicon">F</span>
                          <span className={`admin-asset-dot ${client.snowflakeTable ? 'filled sf' : ''}`} title="Snowflake">S</span>
                        </div>
                      </td>
                      {/* Data Upload */}
                      <td>
                        <div className="admin-data-upload-cell">
                          {client.snowflakeTable ? (
                            <code className="admin-code">{client.snowflakeTable.toUpperCase()}</code>
                          ) : (
                            <span className="admin-data-upload-none">Not configured</span>
                          )}
                          <button
                            className="admin-data-upload-btn"
                            onClick={() => openDataUploadModal(client)}
                            title="Upload data"
                          >
                            ⬆ Upload
                          </button>
                        </div>
                      </td>
                      {/* Status toggle */}
                      <td>
                        <button
                          className={`admin-badge ${client.status === 'active' ? 'active' : 'inactive'}`}
                          onClick={() => toggleStatus(client)}
                          title="Click to toggle"
                        >
                          {client.status === 'active' ? '● Active' : '○ Inactive'}
                        </button>
                      </td>
                      {/* Created date */}
                      <td>
                        <span className="admin-date">{formatDate(client.createdAt)}</span>
                      </td>
                      {/* Actions */}
                      <td style={{ textAlign: 'right' }}>
                        <div className="admin-actions">
                          <button
                            className="admin-btn-ghost-sm admin-btn-edit"
                            onClick={() => openEditForm(client)}
                            title="Edit"
                          >✎</button>
                          <button
                            className="admin-btn-ghost-sm admin-btn-delete"
                            onClick={() => setDeleteTarget(client)}
                            title="Delete"
                          >✕</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>

      {/* ── Client form modal (add / edit) ────────── */}
      {showAddForm && (
        <div className="admin-modal-overlay" onClick={closeForm}>
          <div className="admin-form-modal" onClick={e => e.stopPropagation()}>
            <div className="admin-form-modal-header">
              <h2 className="admin-drawer-title">
                {editClient ? `Edit — ${editClient.name}` : 'Add New Client'}
              </h2>
              <button className="admin-btn-ghost-sm" onClick={closeForm}>✕</button>
            </div>

            <div className="admin-form-modal-body">
              <form onSubmit={editClient ? handleUpdate : handleCreate}>

                {/* ── Basic info ─────────────────────────── */}
                <div className="admin-form-section">
                  <div className="admin-form-section-title">Basic Info</div>
                  <div className="admin-form-grid">
                    <div className="admin-form-field">
                      <label className="admin-label">Slug *</label>
                      <input className="admin-input" name="clientSlug" value={form.clientSlug} onChange={handleChange} disabled={!!editClient} placeholder="e.g. demandarc" />
                    </div>
                    <div className="admin-form-field">
                      <label className="admin-label">Display Name *</label>
                      <input className="admin-input" name="name" value={form.name} onChange={handleChange} placeholder="e.g. DemandARC" />
                    </div>
                    <div className="admin-form-field admin-form-field--full">
                      <label className="admin-label">URL *</label>
                      <input className="admin-input" name="url" value={form.url} onChange={handleChange} placeholder="https://navigateiq.demandarc.com" />
                    </div>
                    <div className="admin-form-field">
                      <label className="admin-label">Status</label>
                      <select className="admin-select" name="status" value={form.status} onChange={handleChange}>
                        <option value="active">Active</option>
                        <option value="inactive">Inactive</option>
                      </select>
                    </div>
                  </div>
                </div>

                {/* ── Cognito ────────────────────────────── */}
                <div className="admin-form-section">
                  <div className="admin-form-section-title">Cognito</div>
                  <div className="admin-form-grid">
                    <div className="admin-form-field admin-form-field--full">
                      <label className="admin-label">User Pool ID</label>
                      <input className="admin-input" name="cognitoUserPoolId" value={form.cognitoUserPoolId} onChange={handleChange} placeholder="ap-south-1_XXXXXXXX" />
                    </div>
                    <div className="admin-form-field">
                      <label className="admin-label">Client ID</label>
                      <input className="admin-input" name="cognitoClientId" value={form.cognitoClientId} onChange={handleChange} placeholder="App client ID" />
                    </div>
                    <div className="admin-form-field">
                      <label className="admin-label">Region</label>
                      <input className="admin-input" name="cognitoRegion" value={form.cognitoRegion} onChange={handleChange} placeholder="ap-south-1" />
                    </div>
                  </div>
                </div>

                {/* ── Theme ─────────────────────────────── */}
                <div className="admin-form-section">
                  <div className="admin-form-section-title">Theme</div>
                  <div className="admin-form-grid">
                    {[
                      { name: 'primaryColor',      label: 'Primary' },
                      { name: 'primaryColorLight', label: 'Primary Light' },
                      { name: 'accentColor',       label: 'Accent' },
                      { name: 'bgFrom',            label: 'BG From' },
                      { name: 'bgTo',              label: 'BG To' },
                    ].map(({ name, label }) => (
                      <div key={name} className="admin-form-field">
                        <label className="admin-label">{label}</label>
                        <div className="admin-color-row">
                          <input type="color" className="admin-color-input" name={name} value={form[name] || '#000000'} onChange={handleChange} />
                          <input className="admin-input" name={name} value={form[name]} onChange={handleChange} placeholder="#000000" />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* ── Assets ────────────────────────────── */}
                <div className="admin-form-section">
                  <div className="admin-form-section-title">Assets (S3 URLs)</div>
                  <div className="admin-form-grid">
                    <div className="admin-form-field admin-form-field--full">
                      <label className="admin-label">Logo URL</label>
                      <input className="admin-input" name="logoUrl" value={form.logoUrl} onChange={handleChange} placeholder="https://s3.amazonaws.com/..." />
                    </div>
                    <div className="admin-form-field admin-form-field--full">
                      <label className="admin-label">Header Image URL</label>
                      <input className="admin-input" name="headerImageUrl" value={form.headerImageUrl} onChange={handleChange} placeholder="https://s3.amazonaws.com/..." />
                    </div>
                    <div className="admin-form-field admin-form-field--full">
                      <label className="admin-label">Favicon URL</label>
                      <input className="admin-input" name="faviconUrl" value={form.faviconUrl} onChange={handleChange} placeholder="https://s3.amazonaws.com/..." />
                    </div>
                  </div>
                </div>

                {/* ── Snowflake ──────────────────────────── */}
                <div className="admin-form-section admin-form-section--snowflake">
                  <div className="admin-form-section-title">
                    <span className="admin-section-icon">❄</span> Snowflake Data Location
                  </div>
                  {!editClient && (
                    <div className="admin-form-grid" style={{ marginBottom: 12 }}>
                      <div className="admin-form-field">
                        <label className="admin-label">Account <span className="admin-label-hint">e.g. xy12345.us-east-1</span></label>
                        <input className="admin-input" name="snowflakeAccount" value={form.snowflakeAccount} onChange={handleChange} placeholder="xy12345.us-east-1" />
                      </div>
                      <div className="admin-form-field">
                        <label className="admin-label">User</label>
                        <input className="admin-input" name="snowflakeUser" value={form.snowflakeUser} onChange={handleChange} placeholder="NAVIGATE_USER" />
                      </div>
                      <div className="admin-form-field">
                        <label className="admin-label">Password</label>
                        <div className="admin-password-wrap">
                          <input
                            className="admin-input"
                            name="snowflakePassword"
                            type={showPassword ? 'text' : 'password'}
                            value={form.snowflakePassword}
                            onChange={handleChange}
                            placeholder="••••••••"
                          />
                          <button type="button" className="admin-password-eye" onClick={() => setShowPassword(v => !v)}>
                            {showPassword ? '🙈' : '👁'}
                          </button>
                        </div>
                      </div>
                      <div className="admin-form-field">
                        <label className="admin-label">Warehouse</label>
                        <input className="admin-input" name="snowflakeWarehouse" value={form.snowflakeWarehouse} onChange={handleChange} placeholder="COMPUTE_WH" />
                      </div>
                    </div>
                  )}
                  <div className="admin-form-grid">
                    <div className="admin-form-field">
                      <label className="admin-label">Database</label>
                      <input className="admin-input" name="snowflakeDatabase" value={form.snowflakeDatabase} onChange={handleChange} placeholder="NAVIGATE_DB" />
                    </div>
                    <div className="admin-form-field">
                      <label className="admin-label">Schema</label>
                      <input className="admin-input" name="snowflakeSchema" value={form.snowflakeSchema} onChange={handleChange} placeholder="PUBLIC" />
                    </div>
                    <div className="admin-form-field">
                      <label className="admin-label">Target Table Name</label>
                      <input className="admin-input" name="snowflakeTable" value={form.snowflakeTable} onChange={handleChange} placeholder="LEADS_DATA" />
                    </div>
                    <div className="admin-form-field">
                      <label className="admin-label">Stage Name</label>
                      <input className="admin-input" name="snowflakeStageName" value={form.snowflakeStageName} onChange={handleChange} placeholder="CSV_UPLOAD_STAGE" />
                    </div>
                  </div>
                </div>

                {/* ── Dataset Bootstrap (Add mode only) ──── */}
                {!editClient && (
                  <div className="admin-form-section admin-form-section--bootstrap">
                    <div className="admin-form-section-title">
                      <span className="admin-section-icon">📂</span> Initialize Dataset <span className="admin-label-hint">(optional)</span>
                    </div>
                    <p className="admin-sf-env-note">
                      Upload a CSV to automatically create the Snowflake table and semantic model.
                      If the database or table already exists it will be reused. Leave empty to configure later via Data Upload.
                    </p>
                    <div className="admin-bootstrap-upload-row">
                      <input
                        ref={bootstrapFileRef}
                        type="file"
                        accept=".csv"
                        style={{ display: 'none' }}
                        onChange={e => setBootstrapCsvFile(e.target.files?.[0] || null)}
                      />
                      <button
                        type="button"
                        className="admin-btn-outline"
                        onClick={() => bootstrapFileRef.current?.click()}
                      >
                        {bootstrapCsvFile ? `📄 ${bootstrapCsvFile.name}` : '📂 Choose CSV'}
                      </button>
                      {bootstrapCsvFile && (
                        <button type="button" className="admin-faq-remove" style={{ fontSize: 20 }}
                          onClick={() => { setBootstrapCsvFile(null); if (bootstrapFileRef.current) bootstrapFileRef.current.value = ''; }}>
                          ×
                        </button>
                      )}
                    </div>
                    {bootstrapUploading && (
                      <div className="admin-bootstrap-status admin-bootstrap-status--loading">
                        <span className="admin-spinner-sm" /> Uploading dataset and generating semantic model…
                      </div>
                    )}
                    {bootstrapError && (
                      <div className="admin-bootstrap-status admin-bootstrap-status--error">⚠ {bootstrapError}</div>
                    )}
                    {bootstrapResult && (
                      <div className="admin-bootstrap-status admin-bootstrap-status--success">
                        ✓ {bootstrapResult.rowsLoaded?.toLocaleString()} rows loaded into <strong>{bootstrapResult.tableName}</strong>
                      </div>
                    )}
                  </div>
                )}

                {/* ── FAQs ───────────────────────────────── */}
                <div className="admin-form-section">
                  <div className="admin-form-section-title">Frequently Asked Questions</div>
                  <div className="admin-faq-list">
                    {(form.faqs ?? []).map((q, i) => (
                      <div key={i} className="admin-faq-item">
                        <span className="admin-faq-text">{q}</span>
                        <button
                          type="button"
                          className="admin-faq-remove"
                          onClick={() => setForm(f => ({ ...f, faqs: f.faqs.filter((_, idx) => idx !== i) }))}
                          title="Remove"
                        >×</button>
                      </div>
                    ))}
                  </div>
                  <div className="admin-faq-add">
                    <input
                      className="admin-input"
                      value={faqInput}
                      onChange={e => setFaqInput(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          const q = faqInput.trim();
                          if (q) { setForm(f => ({ ...f, faqs: [...(f.faqs ?? []), q] })); setFaqInput(''); }
                        }
                      }}
                      placeholder="Type a question and press Enter or Add"
                    />
                    <button
                      type="button"
                      className="admin-btn-outline admin-faq-add-btn"
                      onClick={() => {
                        const q = faqInput.trim();
                        if (q) { setForm(f => ({ ...f, faqs: [...(f.faqs ?? []), q] })); setFaqInput(''); }
                      }}
                    >Add</button>
                  </div>
                </div>

                {formError && (
                  <div className="admin-form-error"><span>⚠</span> {formError}</div>
                )}

                <div className="admin-form-modal-footer">
                  <button type="button" className="admin-btn-outline" onClick={closeForm}>Cancel</button>
                  <button type="submit" className="admin-btn-primary" disabled={saving}>
                    {saving ? 'Saving…' : (editClient ? 'Save Changes' : 'Create Client')}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* ── Data Upload modal ─────────────────────── */}
      {showDataUpload && dataUploadClient && (
        <div className="admin-modal-overlay" onClick={closeDataUpload}>
          <div className="admin-upload-modal" onClick={e => e.stopPropagation()}>
            <div className="admin-form-modal-header">
              <div>
                <h2 className="admin-drawer-title">Data Upload</h2>
                <p style={{ margin: 0, fontSize: 12, color: 'var(--admin-text-muted)' }}>{dataUploadClient.name}</p>
              </div>
              <button className="admin-btn-ghost-sm" onClick={closeDataUpload}>✕</button>
            </div>
            <div className="admin-form-modal-body">
              {/* Snowflake target info */}
              <div className="admin-form-section admin-form-section--snowflake">
                <div className="admin-form-section-title">
                  <span className="admin-section-icon">❄</span> Snowflake Target
                </div>
                <div className="admin-sf-env-note">
                  Table:{' '}
                  <strong>
                    {dataUploadClient.snowflakeDatabase || '?'}.{dataUploadClient.snowflakeSchema || '?'}.{dataUploadClient.snowflakeTable?.toUpperCase() || '?'}
                  </strong>
                  {!dataUploadClient.snowflakeTable && (
                    <span style={{ color: '#fca5a5', marginLeft: 8 }}>⚠ Configure Snowflake settings in client edit first</span>
                  )}
                </div>
              </div>

              {/* Mode selector */}
              <div className="admin-form-section">
                <div className="admin-form-section-title">Upload Mode</div>
                <div className="admin-csv-modes">
                  {UPLOAD_MODES.map(m => (
                    <label key={m.value} className={`admin-csv-mode ${uploadMode === m.value ? 'selected' : ''}`}>
                      <input type="radio" name="uploadMode" value={m.value} checked={uploadMode === m.value}
                        onChange={() => { setUploadMode(m.value); setUploadResult(null); setUploadError(''); }}
                        style={{ display: 'none' }}
                      />
                      <span className="admin-csv-mode-icon">{m.icon}</span>
                      <div>
                        <div className="admin-csv-mode-label">{m.label}</div>
                        <div className="admin-csv-mode-desc">{m.desc}</div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              {/* File picker */}
              <div className="admin-form-section">
                <div className="admin-form-section-title">CSV File</div>
                <div className="admin-csv-drop">
                  <input ref={fileInputRef} type="file" accept=".csv" id="csv-file-input-modal"
                    style={{ display: 'none' }}
                    onChange={e => { setCsvFile(e.target.files[0] || null); setUploadResult(null); setUploadError(''); }}
                  />
                  <label htmlFor="csv-file-input-modal" className="admin-csv-pick-btn">
                    {csvFile ? `📄 ${csvFile.name}` : '📂 Choose CSV file'}
                  </label>
                  {csvFile && (
                    <button className="admin-btn-primary admin-csv-upload-btn" onClick={handleCsvUpload} disabled={uploading}>
                      {uploading
                        ? <><span className="admin-spinner-sm" /> Processing…</>
                        : `${UPLOAD_MODES.find(m => m.value === uploadMode)?.icon} ${UPLOAD_MODES.find(m => m.value === uploadMode)?.label}`}
                    </button>
                  )}
                </div>
              </div>

              {uploadError && <div className="admin-csv-error"><span>⚠</span> {uploadError}</div>}

              {uploadResult && (
                <div className="admin-csv-result">
                  <div className="admin-csv-result-header">
                    <span className="admin-csv-result-icon">✓</span>
                    <div>
                      <strong>{uploadResult.rowsLoaded.toLocaleString()} rows{' '}
                        {uploadResult.mode === 'replace' ? 'loaded' : 'appended'}
                      </strong>{' '}into <code>{uploadResult.tableName}</code>
                      {uploadResult.mode !== 'replace' && (
                        <span className="admin-csv-mode-badge">{uploadResult.mode === 'append' ? 'Append' : 'Append + Extend'}</span>
                      )}
                    </div>
                  </div>
                  {uploadResult.newColumns?.length > 0 && (
                    <div className="admin-csv-new-cols">
                      <span>New columns:</span>
                      {uploadResult.newColumns.map(c => (
                        <span key={c} className="admin-csv-col-tag admin-csv-col-varchar">{c}</span>
                      ))}
                    </div>
                  )}
                  <div className="admin-csv-cols">
                    {uploadResult.columnsDetected.map(col => (
                      <span key={col.name} className={`admin-csv-col-tag admin-csv-col-${col.type}`}>
                        {col.name}
                        {col.type === 'date' && ` (${col.format}${!col.confident ? ' ⚠' : ''})`}
                        {col.type === 'numeric' && ' #'}
                      </span>
                    ))}
                  </div>
                  {uploadResult.ambiguousColumns?.length > 0 && (
                    <div className="admin-csv-warn">
                      <strong>⚠ Auto-guessed date format</strong> for:{' '}
                      {uploadResult.ambiguousColumns.join(', ')}. Re-upload with Full Replace if dates look wrong.
                    </div>
                  )}
                  {uploadResult.warnings?.map((w, i) => (
                    <div key={i} className="admin-csv-warn">{w.message}</div>
                  ))}
                </div>
              )}

              <div className="admin-form-modal-footer">
                <button type="button" className="admin-btn-outline" onClick={closeDataUpload}>Close</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete confirmation modal ──────────────── */}
      {deleteTarget && (
        <div className="admin-modal-overlay" onClick={() => setDeleteTarget(null)}>
          <div className="admin-modal" onClick={e => e.stopPropagation()}>
            <div className="admin-modal-icon">⚠</div>
            <h3 className="admin-modal-title">Delete Client</h3>
            <p className="admin-modal-body">
              Are you sure you want to delete <strong>{deleteTarget.name}</strong>?
              This action cannot be undone.
            </p>
            <div className="admin-modal-actions">
              <button className="admin-btn-outline" onClick={() => setDeleteTarget(null)}>Cancel</button>
              <button className="admin-btn-danger" onClick={handleDelete}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── StatCard component ────────────────────────────────────────────
function StatCard({ label, value, tone }) {
  return (
    <div className={`admin-stat-card admin-stat-${tone}`}>
      <div className="admin-stat-value">{value}</div>
      <div className="admin-stat-label">{label}</div>
    </div>
  );
}

// ── Icons ─────────────────────────────────────────────────────────
function IconClients() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 20V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>
      <rect width="20" height="14" x="2" y="6" rx="2"/>
    </svg>
  );
}

function IconActive() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/><polyline points="9 12 11 14 15 10"/>
    </svg>
  );
}

function IconInactive() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>
    </svg>
  );
}

function IconLogout() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
    </svg>
  );
}

function IconMoon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
    </svg>
  );
}

function IconSun() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="5"/>
      <line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/>
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
      <line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/>
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
    </svg>
  );
}

export default AdminDashboard;
