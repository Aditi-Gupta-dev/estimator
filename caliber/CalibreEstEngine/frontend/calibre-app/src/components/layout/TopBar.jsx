import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { ManageUsersPanel } from './ManageUsersPanel';
import {
  IconAdjustmentsHorizontal,
  IconUsers,
  IconLogout,
  IconChevronDown,
  IconBell,
} from '@tabler/icons-react';
import { useRoleContext } from '../../contexts/RoleContext';
import { CAPABILITIES } from '../../constants/capabilities';
import { navItemsFor } from '../../constants/dashboards';
import * as estimatesApi from '../../services/estimatesApi';
import '../../styles/topbar.css';
import '../../styles/estimates.css';

const NOTIF_POLL_MS = 60_000;

function fmtRelative(iso) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(iso).toLocaleDateString();
}

function NotificationBell({ onOpenEstimates, onOpenProjects }) {
  const { can } = useRoleContext();
  const [notifications, setNotifications] = useState([]);
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const enabled = can(CAPABILITIES.ESTIMATE_SAVE);

  const load = useCallback(() => {
    if (!enabled) return;
    estimatesApi.listNotifications().then(setNotifications).catch(() => {});
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return undefined;
    load();
    const id = setInterval(load, NOTIF_POLL_MS);
    return () => clearInterval(id);
  }, [enabled, load]);

  useEffect(() => {
    function handleOutsideClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    if (open) document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [open]);

  if (!enabled) return null;
  const unreadCount = notifications.filter((n) => !n.readAt).length;

  const handleItemClick = async (n) => {
    if (!n.readAt) {
      try {
        await estimatesApi.markNotificationRead(n.id);
        setNotifications((prev) => prev.map((p) => (p.id === n.id ? { ...p, readAt: new Date().toISOString() } : p)));
      } catch { /* non-fatal — worst case it stays unread */ }
    }
    setOpen(false);
    // Project-scoped notifications (project created/status changed/estimate
    // review signal) open Projects; everything else (review/reviewer
    // events) opens Estimates & Reviews, same as before Phase 4.
    if (n.projectId) onOpenProjects?.();
    else onOpenEstimates?.();
  };

  return (
    <div className="notif-bell-wrapper" ref={ref}>
      <button
        className="notif-bell-btn"
        aria-label={`Notifications${unreadCount ? `, ${unreadCount} unread` : ''}`}
        onClick={() => { setOpen((p) => !p); if (!open) load(); }}
      >
        <IconBell size={16} strokeWidth={2} />
        {unreadCount > 0 && <span className="notif-bell-badge">{unreadCount > 9 ? '9+' : unreadCount}</span>}
      </button>
      {open && (
        <div className="notif-dropdown" role="menu" aria-label="Notifications">
          <div className="notif-dropdown-header">Notifications</div>
          {notifications.length === 0 ? (
            <div className="notif-empty">No notifications yet.</div>
          ) : (
            notifications.slice(0, 20).map((n) => (
              <button key={n.id} className={`notif-item${n.readAt ? '' : ' unread'}`} onClick={() => handleItemClick(n)}>
                <div className="notif-item-msg">{n.message}</div>
                <div className="notif-item-time">{fmtRelative(n.createdAt)}</div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

export function TopBar({
  manageUsersOpen, setManageUsersOpen, onOpenEstimates, onOpenProjects,
}) {
  const { user, currentRole, logout, can } = useRoleContext();
  const navigate = useNavigate();
  const location = useLocation();
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef(null);

  // Close dropdown on outside click
  useEffect(() => {
    function handleOutsideClick(e) {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target)) {
        setUserMenuOpen(false);
      }
    }
    if (userMenuOpen) {
      document.addEventListener('mousedown', handleOutsideClick);
    }
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [userMenuOpen]);

  const handleLogout = async () => {
    setUserMenuOpen(false);
    await logout();
    navigate('/login');
  };

  return (
    <header className="topbar" role="banner">
      {/* ── Brand ── */}
      <div className="topbar-brand" aria-label="Calibre home">
        <div className="topbar-logo-mark">
          <IconAdjustmentsHorizontal size={18} strokeWidth={2.5} />
        </div>
        <div className="topbar-wordmark">
          <div className="topbar-name">
            <span>C</span>alibre
          </div>
          <div className="topbar-glow-strip" />
        </div>
      </div>

      {/* ── Center ──
          Role/department used to be a free-click switcher here — removed
          with real authentication, since nothing should let you click your
          way into being a different role. Both now come from the signed-in
          account (see RoleContext), shown read-only via the user chip on
          the right. */}
      <nav className="topbar-center topbar-nav" aria-label="Main navigation">
        {navItemsFor(can).map((item) => (
          <button
            key={item.to}
            className={`topbar-nav-link${location.pathname === item.to ? ' active' : ''}`}
            onClick={() => navigate(item.to)}
            aria-current={location.pathname === item.to ? 'page' : undefined}
          >
            {item.label}
          </button>
        ))}
      </nav>

      {/* ── Right ── */}
      <div className="topbar-right">
        {/* Governance — capability-gated, not role-string-gated */}
        {can(CAPABILITIES.USER_MANAGE) && (
          <button
            className="manage-users-chip"
            aria-label="Manage users"
            onClick={() => setManageUsersOpen(true)}
          >
            <IconUsers size={13} strokeWidth={2} />
            Manage Users
          </button>
        )}

        {/* Manage Users Panel */}
        {manageUsersOpen && <ManageUsersPanel onClose={() => setManageUsersOpen(false)} />}

        <NotificationBell onOpenEstimates={onOpenEstimates} onOpenProjects={onOpenProjects} />

        {/* User chip with logout dropdown */}
        <div className="user-chip-wrapper" ref={userMenuRef}>
          <button
            className={`user-chip${userMenuOpen ? ' open' : ''}`}
            aria-label={`Logged in as ${user.name} (${currentRole.label}). Click to open user menu`}
            aria-expanded={userMenuOpen}
            aria-haspopup="menu"
            onClick={() => setUserMenuOpen((prev) => !prev)}
          >
            <div
              className="user-avatar"
              style={{
                background: currentRole.glowColor,
                borderColor: currentRole.color,
                color: currentRole.color,
              }}
            >
              {currentRole.initials}
            </div>
            <div className="user-info">
              <span className="user-name">{user.name}</span>
              <span className="user-role" style={{ color: currentRole.color }}>
                {currentRole.label}
              </span>
            </div>
            <IconChevronDown
              size={13}
              strokeWidth={2}
              className={`user-chip-chevron${userMenuOpen ? ' rotated' : ''}`}
            />
          </button>

          {/* Dropdown menu */}
          {userMenuOpen && (
            <div className="user-dropdown" role="menu" aria-label="User menu">
              <div className="user-dropdown-header">
                <div
                  className="user-dropdown-avatar"
                  style={{
                    background: currentRole.glowColor,
                    borderColor: currentRole.color,
                    color: currentRole.color,
                  }}
                >
                  {currentRole.initials}
                </div>
                <div>
                  <div className="user-dropdown-name">{user.name}</div>
                  <div className="user-dropdown-role" style={{ color: currentRole.color }}>
                    {currentRole.label}
                  </div>
                </div>
              </div>
              <div className="user-dropdown-divider" />
              <button
                className="user-dropdown-item logout"
                role="menuitem"
                onClick={handleLogout}
                aria-label="Sign out of Calibre"
              >
                <IconLogout size={14} strokeWidth={2} />
                Sign Out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
