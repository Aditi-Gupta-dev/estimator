import { useState, useEffect, useCallback } from 'react';
import {
  IconX,
  IconUsers,
  IconSearch,
  IconPlus,
  IconCrown,
  IconShield,
  IconTool,
  IconStar,
  IconCalculator,
  IconCheck,
  IconDots,
  IconEdit,
  IconTrash,
  IconUserCheck,
  IconUserX,
  IconFilter,
  IconLoader2,
} from '@tabler/icons-react';
import { ROLES } from '../../constants/roles';
import * as authApi from '../../services/authApi';
import '../../styles/manage-users.css';

/* ── Maps the real API's user shape to this panel's existing field names
   (dept instead of department, lastActive instead of last_active_at) so
   the rest of the component — search/filter/table — stays untouched. */
function fromApiUser(u) {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    unit: u.unit || '',
    dept: u.department,
    status: u.status,
    lastActive: u.last_active_at ? new Date(u.last_active_at).toLocaleString() : 'Never',
  };
}

const ROLE_ICONS = {
  admin:       IconCrown,
  super:       IconShield,
  sme:         IconTool,
  senior_mgmt: IconStar,
  estimator:   IconCalculator,
};

const UNITS = ['All Units', 'COE', 'Oracle ERP', 'SAP', 'Salesforce'];
const STATUSES = ['all', 'active', 'inactive', 'pending'];

function RoleBadge({ roleId }) {
  const role = ROLES[roleId];
  const Icon = ROLE_ICONS[roleId];
  if (!role || !Icon) return null;
  return (
    <span
      className="um-role-badge"
      style={{ color: role.color, background: role.glowColor, borderColor: `${role.color}40` }}
    >
      <Icon size={11} strokeWidth={2.5} />
      {role.label}
    </span>
  );
}

function StatusDot({ status }) {
  return (
    <span className={`um-status-dot um-status-${status}`}>
      <span className="um-dot" />
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

/* ── Add / Edit User Modal ─────────────────────────────────────────────────── */
function UserFormModal({ user, onClose, onSave, saving }) {
  const isEdit = !!user;
  const [form, setForm] = useState(
    user ?? { name: '', email: '', role: 'estimator', unit: 'Oracle ERP', dept: 'delivery', status: 'active' }
  );

  const set = (field, val) => setForm((p) => ({ ...p, [field]: val }));

  return (
    <div className="um-form-overlay" onClick={onClose}>
      <div className="um-form-modal" onClick={(e) => e.stopPropagation()}>
        <div className="um-form-header">
          <h3>{isEdit ? 'Edit User' : 'Add New User'}</h3>
          <button className="um-close-btn" onClick={onClose}><IconX size={16} /></button>
        </div>

        <div className="um-form-body">
          <div className="um-form-row">
            <label>Full Name</label>
            <input className="um-input" value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Priya Sharma" />
          </div>
          <div className="um-form-row">
            <label>Email</label>
            <input className="um-input" value={form.email} onChange={(e) => set('email', e.target.value)} placeholder="name@tcs.com" type="email" />
          </div>
          {!isEdit && (
            <div className="um-form-row">
              <label>Temporary Password</label>
              <input
                className="um-input"
                value={form.password || ''}
                onChange={(e) => set('password', e.target.value)}
                placeholder="Shared with the user to sign in"
                type="text"
              />
            </div>
          )}
          <div className="um-form-row">
            <label>Assign Role</label>
            <div className="um-role-options">
              {Object.values(ROLES).map((r) => {
                const Icon = ROLE_ICONS[r.id];
                return (
                  <button
                    key={r.id}
                    className={`um-role-option${form.role === r.id ? ' selected' : ''}`}
                    style={form.role === r.id ? { borderColor: r.color, background: r.glowColor, color: r.color } : {}}
                    onClick={() => set('role', r.id)}
                  >
                    <Icon size={13} strokeWidth={2} />
                    {r.label}
                    {form.role === r.id && <IconCheck size={11} strokeWidth={3} className="um-role-check" />}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="um-form-2col">
            <div className="um-form-row">
              <label>Business Unit</label>
              <select className="um-select" value={form.unit} onChange={(e) => set('unit', e.target.value)}>
                {UNITS.filter((u) => u !== 'All Units').map((u) => <option key={u}>{u}</option>)}
              </select>
            </div>
            <div className="um-form-row">
              <label>Department</label>
              <select className="um-select" value={form.dept} onChange={(e) => set('dept', e.target.value)}>
                <option value="sales">Sales</option>
                <option value="delivery">Delivery</option>
              </select>
            </div>
          </div>
          <div className="um-form-row">
            <label>Status</label>
            <div className="um-status-options">
              {STATUSES.filter((s) => s !== 'all').map((s) => (
                <button
                  key={s}
                  className={`um-status-option um-status-option-${s}${form.status === s ? ' selected' : ''}`}
                  onClick={() => set('status', s)}
                >
                  {s.charAt(0).toUpperCase() + s.slice(1)}
                  {form.status === s && <IconCheck size={11} strokeWidth={3} />}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="um-form-footer">
          <button className="um-btn-cancel" onClick={onClose} disabled={saving}>Cancel</button>
          <button
            className="um-btn-save"
            onClick={() => onSave(form)}
            disabled={saving || !form.name || !form.email || (!isEdit && !form.password)}
          >
            {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Add User'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Main Manage Users Panel ───────────────────────────────────────────────── */
export function ManageUsersPanel({ onClose }) {
  const [users, setUsers]             = useState([]);
  const [isLoading, setIsLoading]     = useState(true);
  const [error, setError]             = useState('');
  const [search, setSearch]           = useState('');
  const [filterRole, setFilterRole]   = useState('all');
  const [filterUnit, setFilterUnit]   = useState('All Units');
  const [filterStatus, setFilterStatus] = useState('all');
  const [formUser, setFormUser]       = useState(null);   // null = closed, {} = new, {...} = edit
  const [showForm, setShowForm]       = useState(false);
  const [menuOpenId, setMenuOpenId]   = useState(null);
  const [saving, setSaving]           = useState(false);

  const loadUsers = useCallback(async () => {
    setIsLoading(true);
    setError('');
    try {
      const apiUsers = await authApi.listUsers();
      setUsers(apiUsers.map(fromApiUser));
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { loadUsers(); }, [loadUsers]);

  /* Filtered list */
  const filtered = users.filter((u) => {
    const matchSearch = !search ||
      u.name.toLowerCase().includes(search.toLowerCase()) ||
      u.email.toLowerCase().includes(search.toLowerCase());
    const matchRole   = filterRole   === 'all' || u.role === filterRole;
    const matchUnit   = filterUnit   === 'All Units' || u.unit === filterUnit;
    const matchStatus = filterStatus === 'all' || u.status === filterStatus;
    return matchSearch && matchRole && matchUnit && matchStatus;
  });

  /* Summary counts */
  const counts = Object.keys(ROLES).reduce((acc, id) => {
    acc[id] = users.filter((u) => u.role === id).length;
    return acc;
  }, {});

  const handleSave = async (form) => {
    setSaving(true);
    setError('');
    try {
      if (formUser?.id) {
        await authApi.updateUser(formUser.id, {
          name: form.name, email: form.email, role: form.role,
          unit: form.unit, department: form.dept, status: form.status,
        });
      } else {
        await authApi.createUser({
          name: form.name, email: form.email, password: form.password, role: form.role,
          unit: form.unit, department: form.dept, status: form.status,
        });
      }
      await loadUsers();
      setShowForm(false);
      setFormUser(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleToggleStatus = async (id) => {
    setMenuOpenId(null);
    const target = users.find((u) => u.id === id);
    if (!target) return;
    try {
      await authApi.updateUser(id, { status: target.status === 'active' ? 'inactive' : 'active' });
      await loadUsers();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDelete = async (id) => {
    setMenuOpenId(null);
    try {
      await authApi.deleteUser(id);
      await loadUsers();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <>
      {/* Backdrop */}
      <div className="um-backdrop" onClick={onClose} />

      {/* Panel */}
      <aside className="um-panel" aria-label="Manage Users Panel">
        {/* Header */}
        <div className="um-panel-header">
          <div className="um-panel-title">
            <div className="um-panel-icon"><IconUsers size={18} strokeWidth={2} /></div>
            <div>
              <div className="um-panel-name">Manage Users</div>
              <div className="um-panel-sub">{users.length} total · Admin / COE access only</div>
            </div>
          </div>
          <div className="um-header-actions">
            <button className="um-btn-add" onClick={() => { setFormUser({}); setShowForm(true); }}>
              <IconPlus size={14} strokeWidth={2.5} />
              Add User
            </button>
            <button className="um-close-btn" onClick={onClose} aria-label="Close panel">
              <IconX size={18} />
            </button>
          </div>
        </div>

        {/* Role Summary Strip */}
        <div className="um-role-strip">
          {Object.values(ROLES).map((r) => {
            const Icon = ROLE_ICONS[r.id];
            return (
              <button
                key={r.id}
                className={`um-role-pill${filterRole === r.id ? ' active' : ''}`}
                style={filterRole === r.id ? { borderColor: r.color, color: r.color, background: r.glowColor } : {}}
                onClick={() => setFilterRole(filterRole === r.id ? 'all' : r.id)}
              >
                <Icon size={12} strokeWidth={2} />
                {r.label}
                <span className="um-pill-count">{counts[r.id]}</span>
              </button>
            );
          })}
          {filterRole !== 'all' && (
            <button className="um-clear-filter" onClick={() => setFilterRole('all')}>
              <IconX size={11} /> Clear
            </button>
          )}
        </div>

        {/* Search & Filters */}
        <div className="um-toolbar">
          <div className="um-search-box">
            <IconSearch size={14} className="um-search-icon" strokeWidth={2} />
            <input
              className="um-search-input"
              placeholder="Search name or email…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="um-filters">
            <select className="um-filter-select" value={filterUnit} onChange={(e) => setFilterUnit(e.target.value)}>
              {UNITS.map((u) => <option key={u}>{u}</option>)}
            </select>
            <select className="um-filter-select" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
              {STATUSES.map((s) => <option key={s} value={s}>{s === 'all' ? 'All Status' : s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
            </select>
          </div>
        </div>

        {/* Results count */}
        <div className="um-result-count">
          <IconFilter size={12} strokeWidth={2} />
          {filtered.length} user{filtered.length !== 1 ? 's' : ''} shown
        </div>

        {error && (
          <div className="um-error-banner" role="alert">{error}</div>
        )}

        {/* User Table */}
        <div className="um-table-wrapper">
          {isLoading ? (
            <div className="um-loading">
              <IconLoader2 size={20} strokeWidth={2} className="login-spinner" />
              Loading users…
            </div>
          ) : (
          <table className="um-table">
            <thead>
              <tr>
                <th>User</th>
                <th>Role</th>
                <th>Unit</th>
                <th>Status</th>
                <th>Last Active</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="um-empty">No users match your filters.</td>
                </tr>
              ) : (
                filtered.map((u) => {
                  const role = ROLES[u.role];
                  return (
                    <tr key={u.id} className="um-row">
                      <td>
                        <div className="um-user-cell">
                          <div
                            className="um-avatar"
                            style={{ background: role?.glowColor, borderColor: role?.color, color: role?.color }}
                          >
                            {u.name.split(' ').map((n) => n[0]).join('').slice(0, 2)}
                          </div>
                          <div>
                            <div className="um-user-name">{u.name}</div>
                            <div className="um-user-email">{u.email}</div>
                          </div>
                        </div>
                      </td>
                      <td><RoleBadge roleId={u.role} /></td>
                      <td><span className="um-unit-tag">{u.unit}</span></td>
                      <td><StatusDot status={u.status} /></td>
                      <td className="um-last-active">{u.lastActive}</td>
                      <td>
                        <div className="um-actions-cell">
                          <div className="um-menu-wrapper">
                            <button
                              className="um-menu-btn"
                              onClick={() => setMenuOpenId(menuOpenId === u.id ? null : u.id)}
                              aria-label="User actions"
                            >
                              <IconDots size={15} strokeWidth={2} />
                            </button>
                            {menuOpenId === u.id && (
                              <div className="um-menu">
                                <button className="um-menu-item" onClick={() => { setFormUser(u); setShowForm(true); setMenuOpenId(null); }}>
                                  <IconEdit size={13} strokeWidth={2} /> Edit User
                                </button>
                                <button className="um-menu-item" onClick={() => handleToggleStatus(u.id)}>
                                  {u.status === 'active'
                                    ? <><IconUserX size={13} strokeWidth={2} /> Deactivate</>
                                    : <><IconUserCheck size={13} strokeWidth={2} /> Activate</>
                                  }
                                </button>
                                <div className="um-menu-divider" />
                                <button className="um-menu-item danger" onClick={() => handleDelete(u.id)}>
                                  <IconTrash size={13} strokeWidth={2} /> Remove User
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
          )}
        </div>
      </aside>

      {/* Add / Edit Form */}
      {showForm && (
        <UserFormModal
          user={formUser?.id ? formUser : null}
          onClose={() => { setShowForm(false); setFormUser(null); }}
          onSave={handleSave}
          saving={saving}
        />
      )}
    </>
  );
}
