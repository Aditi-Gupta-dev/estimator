import { useState, useRef, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { ManageUsersPanel } from './ManageUsersPanel';
import {
  IconAdjustmentsHorizontal,
  IconUsers,
  IconLogout,
  IconChevronDown,
} from '@tabler/icons-react';
import { useRoleContext } from '../../contexts/RoleContext';
import { CAPABILITIES } from '../../constants/capabilities';
import { navItemsFor } from '../../constants/dashboards';
import '../../styles/topbar.css';

export function TopBar({ manageUsersOpen, setManageUsersOpen }) {
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
