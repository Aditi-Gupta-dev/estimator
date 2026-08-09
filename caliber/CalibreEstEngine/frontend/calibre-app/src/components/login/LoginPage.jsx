import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  IconAdjustmentsHorizontal,
  IconBolt,
  IconBrain,
  IconShieldCheck,
  IconLoader2,
  IconAlertCircle,
} from '@tabler/icons-react';
import { useRoleContext } from '../../contexts/RoleContext';
import { EVAAvatar } from '../eva/EVAAvatar';
import '../../styles/login.css';

const FEATURES = [
  { icon: IconBolt, label: 'AI-Powered', desc: 'Agents by LangChain/LangGraph', color: 'var(--cyan)', bg: 'rgba(0,212,255,0.1)' },
  { icon: IconShieldCheck, label: 'Role-Based', desc: '5 distinct user experiences', color: 'var(--green)', bg: 'rgba(52,211,153,0.1)' },
  { icon: IconBrain, label: 'Audit-Ready', desc: 'Every estimate is traceable', color: 'var(--purple)', bg: 'rgba(167,139,250,0.1)' },
];

export function LoginPage() {
  const { login } = useRoleContext();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email.trim() || !password) return;
    setError('');
    setSubmitting(true);
    try {
      await login(email.trim(), password);
      navigate('/home');
    } catch (err) {
      setError(err.message || 'Login failed. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="login-page">
      {/* Floating orbs */}
      <div className="login-orb login-orb-1" />
      <div className="login-orb login-orb-2" />
      <div className="login-orb login-orb-3" />

      {/* ── Left Panel ── */}
      <div className="login-left">
        {/* Brand */}
        <div className="login-brand">
          <div className="login-logo-mark">
            <IconAdjustmentsHorizontal size={28} strokeWidth={2.2} />
          </div>
          <span className="login-wordmark">
            <span>C</span>alibre
          </span>
        </div>

        {/* Tagline */}
        <h1 className="login-tagline">
          <span className="gradient-text">Intelligent Estimation.</span>
          <br />
          Enterprise Precision.
        </h1>

        <p className="login-sub">
          Calibre is your AI-powered Software Estimation Engine — built for
          consistency, auditability, and speed across Sales and Delivery teams.
        </p>

        {/* Feature bullets */}
        <div className="login-features">
          {FEATURES.map((f) => {
            const Icon = f.icon;
            return (
              <div className="login-feature" key={f.label}>
                <div
                  className="login-feature-icon"
                  style={{ background: f.bg, color: f.color }}
                >
                  <Icon size={18} strokeWidth={2} />
                </div>
                <div>
                  <strong style={{ color: 'var(--text-primary)', fontSize: 13 }}>{f.label}</strong>
                  <span style={{ marginLeft: 8, color: 'var(--text-secondary)', fontSize: 12 }}>{f.desc}</span>
                </div>
              </div>
            );
          })}
        </div>

        {/* EVA teaser */}
        <div className="login-eva-teaser">
          <EVAAvatar size="md" animate />
          <span className="login-eva-label">EVA is ready to assist you</span>
        </div>
      </div>

      {/* ── Right Panel (Form) ── */}
      <div className="login-right">
        <form className="login-card" onSubmit={handleSubmit}>
          <h2 className="login-card-title">Welcome to Calibre</h2>
          <p className="login-card-sub">Sign in with your Calibre account to continue</p>

          <div className="form-label">Email</div>
          <input
            className="login-input"
            type="email"
            autoComplete="username"
            placeholder="name@tcs.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={submitting}
            required
          />

          <div className="form-label" style={{ marginTop: 16 }}>Password</div>
          <input
            className="login-input"
            type="password"
            autoComplete="current-password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={submitting}
            required
          />

          {error && (
            <div className="login-error" role="alert">
              <IconAlertCircle size={15} strokeWidth={2} />
              {error}
            </div>
          )}

          <button
            type="submit"
            className="login-cta"
            disabled={submitting || !email.trim() || !password}
            aria-label="Sign in to Calibre"
            style={{ marginTop: 24 }}
          >
            {submitting ? (
              <><IconLoader2 size={16} strokeWidth={2} className="login-spinner" /> Signing in…</>
            ) : (
              'Sign In →'
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
