import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { LuCircleCheck, LuCircleAlert, LuInfo, LuTriangleAlert, LuX } from 'react-icons/lu';

const ToastContext = createContext(null);

const ICONS = {
  success: LuCircleCheck,
  danger: LuCircleAlert,
  warn: LuTriangleAlert,
  info: LuInfo,
};

let seq = 0;

/**
 * Lightweight toast host. Replaces the blocking window.alert() calls the
 * original UI used for validation feedback.
 */
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const dismiss = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (toast) => {
      seq += 1;
      const id = seq;
      const duration = toast.duration ?? 5000;
      setToasts((prev) => [...prev, { ...toast, id }]);
      if (duration > 0) {
        setTimeout(() => dismiss(id), duration);
      }
      return id;
    },
    [dismiss]
  );

  const value = useMemo(
    () => ({
      toast: push,
      success: (title, message) => push({ tone: 'success', title, message }),
      error: (title, message) => push({ tone: 'danger', title, message, duration: 8000 }),
      warn: (title, message) => push({ tone: 'warn', title, message }),
      info: (title, message) => push({ tone: 'info', title, message }),
      dismiss,
    }),
    [push, dismiss]
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-host" role="region" aria-label="Notifications">
        {toasts.map((t) => {
          const Icon = ICONS[t.tone] || LuInfo;
          return (
            <div key={t.id} className={`toast toast--${t.tone || 'info'}`} role="status" aria-live="polite">
              <span className="toast__icon" aria-hidden="true">
                <Icon />
              </span>
              <div className="toast__body">
                <p className="toast__title">{t.title}</p>
                {t.message && <p className="toast__message">{t.message}</p>}
              </div>
              <button
                type="button"
                className="toast__close"
                onClick={() => dismiss(t.id)}
                aria-label="Dismiss notification"
              >
                <LuX aria-hidden="true" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used inside a ToastProvider');
  }
  return ctx;
}
