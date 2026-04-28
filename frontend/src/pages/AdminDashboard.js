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
  // Snowflake / CSV pipeline
  snowflakeAccount: '', snowflakeUser: '', snowflakePassword: '',
  snowflakeWarehouse: '', snowflakeDatabase: '', snowflakeSchema: '',
  snowflakeTable: '', snowflakeStageName: '', idPrefix: 'L-',
};

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
  // CSV upload state
  const [csvFile, setCsvFile]               = useState(null);
  const [uploading, setUploading]           = useState(false);
  const [uploadResult, setUploadResult]     = useState(null);
  const [uploadError, setUploadError]       = useState('');
  const fileInputRef = useRef(null);

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
    const withLogo = clients.filter(c => !!c.logoUrl).length;
    return { total: clients.length, active, inactive, withLogo };
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

  const openAddForm = () => {
    setForm(EMPTY_FORM);
    setFormError('');
    setEditClient(null);
    setShowAddForm(true);
    resetCsvState();
  };

  const openEditForm = (client) => {
    setForm({ ...EMPTY_FORM, ...client });
    setFormError('');
    setEditClient(client);
    setShowAddForm(true);
    resetCsvState();
  };

  const closeForm = () => {
    setShowAddForm(false);
    setEditClient(null);
    setFormError('');
    resetCsvState();
  };

  const resetCsvState = () => {
    setCsvFile(null);
    setUploadResult(null);
    setUploadError('');
    setUploading(false);
  };

  // ── Create client ─────────────────────────────────────────────
  const handleCreate = async (e) => {
    e.preventDefault();
    setFormError('');
    if (!form.clientSlug.trim() || !form.name.trim() || !form.url.trim()) {
      setFormError('Slug, name and URL are required.');
      return;
    }
    setSaving(true);
    try {
      const headers = { ...(await getAuthHeader()), 'Content-Type': 'application/json' };
      const res     = await fetch(`${API_BASE_URL}/admin/clients`, {
        method: 'POST', headers, body: JSON.stringify(form),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || `Error ${res.status}`);
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
    if (!csvFile || !editClient) return;
    setUploading(true);
    setUploadError('');
    setUploadResult(null);
    try {
      const authHeader = await getAuthHeader();
      const formData   = new FormData();
      formData.append('file', csvFile);
      const res  = await fetch(
        `${API_BASE_URL}/admin/clients/${editClient.clientSlug}/upload-csv`,
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
    <div className="admin-shell">

      {/* ── Sidebar ───────────────────────────────────── */}
      <aside className="admin-sidebar">
        <div className="admin-brand">
          <div className="admin-brand-mark">N</div>
          <div>
            <div className="admin-brand-name">Navigate IQ</div>
            <div className="admin-brand-sub">Admin Console</div>
          </div>
        </div>

        <nav className="admin-nav">
          <button
            className={`admin-nav-item ${activeSection === 'clients' ? 'active' : ''}`}
            onClick={() => setActiveSection('clients')}
          >
            <span className="admin-nav-icon">◈</span>
            <span>Clients</span>
            <span className="admin-nav-count">{stats.total}</span>
          </button>
          <button
            className={`admin-nav-item ${activeSection === 'active' ? 'active' : ''}`}
            onClick={() => { setActiveSection('clients'); setStatusFilter('active'); }}
          >
            <span className="admin-nav-icon">●</span>
            <span>Active</span>
            <span className="admin-nav-count">{stats.active}</span>
          </button>
          <button
            className={`admin-nav-item ${activeSection === 'inactive' ? 'active' : ''}`}
            onClick={() => { setActiveSection('clients'); setStatusFilter('inactive'); }}
          >
            <span className="admin-nav-icon">○</span>
            <span>Inactive</span>
            <span className="admin-nav-count">{stats.inactive}</span>
          </button>
        </nav>

        <div className="admin-sidebar-footer">
          <button className="admin-signout" onClick={handleSignOut}>
            <span>⎋</span> Sign out
          </button>
        </div>
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
            <button className="admin-btn-outline" onClick={loadClients} disabled={loading}>
              {loading ? 'Refreshing…' : '↻ Refresh'}
            </button>
            <button className="admin-btn-primary" onClick={openAddForm}>
              + Add Client
            </button>
          </div>
        </header>

        {/* Stat cards */}
        <section className="admin-stats">
          <StatCard label="Total Clients" value={stats.total}    tone="blue"   />
          <StatCard label="Active"         value={stats.active}  tone="green"  />
          <StatCard label="Inactive"       value={stats.inactive} tone="red"   />
          <StatCard label="With Logo"      value={stats.withLogo} tone="purple" />
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
              placeholder="Search by name, slug or URL…"
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

      {/* ── Drawer form (add / edit) ───────────────── */}
      {showAddForm && (
        <div className="admin-drawer-overlay" onClick={closeForm}>
          <aside className="admin-drawer" onClick={e => e.stopPropagation()}>
            <div className="admin-drawer-header">
              <h2 className="admin-drawer-title">
                {editClient ? `Edit — ${editClient.name}` : 'Add New Client'}
              </h2>
              <button className="admin-btn-ghost-sm" onClick={closeForm}>✕</button>
            </div>

            <div className="admin-drawer-body">
              <form onSubmit={editClient ? handleUpdate : handleCreate}>

                {/* ── Basic info ─────────────────────────── */}
                <div className="admin-form-section">
                  <div className="admin-form-section-title">Basic Info</div>
                  <div className="admin-form-grid">
                    <div className="admin-form-field">
                      <label className="admin-label">Slug *</label>
                      <input
                        className="admin-input"
                        name="clientSlug"
                        value={form.clientSlug}
                        onChange={handleChange}
                        disabled={!!editClient}
                        placeholder="e.g. demandarc"
                      />
                    </div>
                    <div className="admin-form-field">
                      <label className="admin-label">Display Name *</label>
                      <input
                        className="admin-input"
                        name="name"
                        value={form.name}
                        onChange={handleChange}
                        placeholder="e.g. DemandARC"
                      />
                    </div>
                    <div className="admin-form-field admin-form-field--full">
                      <label className="admin-label">URL *</label>
                      <input
                        className="admin-input"
                        name="url"
                        value={form.url}
                        onChange={handleChange}
                        placeholder="https://navigateiq.demandarc.com"
                      />
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

                {/* ── Snowflake Connection ───────────────── */}
                <div className="admin-form-section admin-form-section--snowflake">
                  <div className="admin-form-section-title">
                    <span className="admin-section-icon">❄</span> Snowflake Connection
                  </div>
                  <div className="admin-form-grid">
                    <div className="admin-form-field admin-form-field--full">
                      <label className="admin-label">Account Identifier</label>
                      <input className="admin-input" name="snowflakeAccount" value={form.snowflakeAccount} onChange={handleChange} placeholder="xy12345.us-east-1" />
                    </div>
                    <div className="admin-form-field">
                      <label className="admin-label">Username</label>
                      <input className="admin-input" name="snowflakeUser" value={form.snowflakeUser} onChange={handleChange} placeholder="NAVIGATE_USER" />
                    </div>
                    <div className="admin-form-field">
                      <label className="admin-label">Password</label>
                      <input className="admin-input" type="password" name="snowflakePassword" value={form.snowflakePassword} onChange={handleChange} placeholder="••••••••" />
                    </div>
                    <div className="admin-form-field">
                      <label className="admin-label">Warehouse</label>
                      <input className="admin-input" name="snowflakeWarehouse" value={form.snowflakeWarehouse} onChange={handleChange} placeholder="COMPUTE_WH" />
                    </div>
                    <div className="admin-form-field">
                      <label className="admin-label">Database</label>
                      <input className="admin-input" name="snowflakeDatabase" value={form.snowflakeDatabase} onChange={handleChange} placeholder="CLIENT_DB" />
                    </div>
                    <div className="admin-form-field">
                      <label className="admin-label">Schema</label>
                      <input className="admin-input" name="snowflakeSchema" value={form.snowflakeSchema} onChange={handleChange} placeholder="PUBLIC" />
                    </div>
                  </div>
                </div>

                {/* ── Data Config ────────────────────────── */}
                <div className="admin-form-section">
                  <div className="admin-form-section-title">Data Config</div>
                  <div className="admin-form-grid">
                    <div className="admin-form-field">
                      <label className="admin-label">Target Table Name</label>
                      <input className="admin-input" name="snowflakeTable" value={form.snowflakeTable} onChange={handleChange} placeholder="LEADS_DATA" />
                    </div>
                    <div className="admin-form-field">
                      <label className="admin-label">Stage Name</label>
                      <input className="admin-input" name="snowflakeStageName" value={form.snowflakeStageName} onChange={handleChange} placeholder="CSV_UPLOAD_STAGE" />
                    </div>
                    <div className="admin-form-field">
                      <label className="admin-label">ID Prefix</label>
                      <input className="admin-input" name="idPrefix" value={form.idPrefix} onChange={handleChange} placeholder='L- (leave empty for no ID column)' />
                    </div>
                  </div>
                </div>

                {formError && (
                  <div className="admin-form-error">
                    <span>⚠</span> {formError}
                  </div>
                )}

                <div className="admin-drawer-footer">
                  <button type="button" className="admin-btn-outline" onClick={closeForm}>Cancel</button>
                  <button type="submit" className="admin-btn-primary" disabled={saving}>
                    {saving ? 'Saving…' : (editClient ? 'Save Changes' : 'Create Client')}
                  </button>
                </div>
              </form>

              {/* ── CSV Upload (edit mode only) ─────────── */}
              {editClient && (
                <div className="admin-csv-section">
                  <div className="admin-csv-header">
                    <span className="admin-section-icon">⬆</span>
                    <div>
                      <div className="admin-csv-title">Upload Dataset</div>
                      <div className="admin-csv-sub">
                        CSV → auto-detect date formats → load into Snowflake table
                        {form.snowflakeTable ? ` (${form.snowflakeTable.toUpperCase()})` : ''}
                      </div>
                    </div>
                  </div>

                  <div className="admin-csv-drop">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".csv"
                      id="csv-file-input"
                      style={{ display: 'none' }}
                      onChange={e => {
                        setCsvFile(e.target.files[0] || null);
                        setUploadResult(null);
                        setUploadError('');
                      }}
                    />
                    <label htmlFor="csv-file-input" className="admin-csv-pick-btn">
                      {csvFile ? `📄 ${csvFile.name}` : '📂 Choose CSV file'}
                    </label>
                    {csvFile && (
                      <button
                        className="admin-btn-primary admin-csv-upload-btn"
                        onClick={handleCsvUpload}
                        disabled={uploading}
                      >
                        {uploading ? (
                          <><span className="admin-spinner-sm" /> Uploading…</>
                        ) : 'Upload & Load'}
                      </button>
                    )}
                  </div>

                  {/* Upload error */}
                  {uploadError && (
                    <div className="admin-csv-error">
                      <span>⚠</span> {uploadError}
                    </div>
                  )}

                  {/* Upload result */}
                  {uploadResult && (
                    <div className="admin-csv-result">
                      <div className="admin-csv-result-header">
                        <span className="admin-csv-result-icon">✓</span>
                        <div>
                          <strong>{uploadResult.rowsLoaded.toLocaleString()} rows</strong> loaded into{' '}
                          <code>{uploadResult.tableName}</code>
                        </div>
                      </div>

                      {/* Column detection summary */}
                      <div className="admin-csv-cols">
                        {uploadResult.columnsDetected.map(col => (
                          <span key={col.name} className={`admin-csv-col-tag admin-csv-col-${col.type}`}>
                            {col.name}
                            {col.type === 'date' && ` (${col.format}${!col.confident ? ' ⚠' : ''})`}
                            {col.type === 'numeric' && ' #'}
                          </span>
                        ))}
                      </div>

                      {/* Ambiguous date warning */}
                      {uploadResult.ambiguousColumns?.length > 0 && (
                        <div className="admin-csv-warn">
                          <strong>⚠ Auto-guessed date format</strong> for:{' '}
                          {uploadResult.ambiguousColumns.join(', ')}. If dates look wrong, update
                          the date format saved in the client config and re-upload.
                        </div>
                      )}

                      {/* NULL warnings */}
                      {uploadResult.warnings?.map((w, i) => (
                        <div key={i} className="admin-csv-warn">{w.message}</div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </aside>
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

export default AdminDashboard;
