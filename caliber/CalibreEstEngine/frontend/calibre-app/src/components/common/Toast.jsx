import { useEffect } from 'react';
import { useRoleContext } from '../../contexts/RoleContext';

export function Toast() {
  const { toasts, dismissToast } = useRoleContext();

  return (
    <div className="toast-container" aria-live="assertive" aria-atomic="true">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="toast"
          style={{ borderLeftColor: toast.color }}
          role="alert"
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: toast.color,
              flexShrink: 0,
              display: 'inline-block',
            }}
          />
          {toast.message}
        </div>
      ))}
    </div>
  );
}
