import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { LuLoaderCircle, LuX } from 'react-icons/lu';

/* ==========================================================================
   Button
   ========================================================================== */

export function Button({
  children,
  variant = 'secondary',
  size = 'md',
  icon: Icon,
  iconRight: IconRight,
  loading = false,
  disabled = false,
  full = false,
  className = '',
  ...props
}) {
  const isDisabled = disabled || loading;
  return (
    <button
      type="button"
      className={`btn btn--${variant} btn--${size}${full ? ' btn--full' : ''}${
        loading ? ' is-loading' : ''
      } ${className}`.trim()}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? (
        <LuLoaderCircle className="btn__spinner" aria-hidden="true" />
      ) : (
        Icon && <Icon className="btn__icon" aria-hidden="true" />
      )}
      {children && <span className="btn__label">{children}</span>}
      {IconRight && !loading && <IconRight className="btn__icon" aria-hidden="true" />}
    </button>
  );
}

/** Square icon-only button. `label` becomes the accessible name. */
export function IconButton({ icon: Icon, label, variant = 'ghost', className = '', ...props }) {
  return (
    <button
      type="button"
      className={`icon-btn icon-btn--${variant} ${className}`.trim()}
      aria-label={label}
      title={label}
      {...props}
    >
      <Icon aria-hidden="true" />
    </button>
  );
}

/* ==========================================================================
   Surfaces
   ========================================================================== */

export function Card({ children, className = '', as: Tag = 'section', ...props }) {
  return (
    <Tag className={`card ${className}`.trim()} {...props}>
      {children}
    </Tag>
  );
}

export function CardHeader({ title, description, icon: Icon, actions, className = '' }) {
  return (
    <header className={`card__header ${className}`.trim()}>
      {Icon && (
        <span className="card__header-icon" aria-hidden="true">
          <Icon />
        </span>
      )}
      <div className="card__header-text">
        <h3 className="card__title">{title}</h3>
        {description && <p className="card__desc">{description}</p>}
      </div>
      {actions && <div className="card__header-actions">{actions}</div>}
    </header>
  );
}

/* ==========================================================================
   Badge / Pill
   ========================================================================== */

export function Badge({ children, tone = 'neutral', icon: Icon, size = 'md', className = '' }) {
  return (
    <span className={`badge badge--${tone} badge--${size} ${className}`.trim()}>
      {Icon && <Icon aria-hidden="true" />}
      {children}
    </span>
  );
}

/** Small coloured dot, optionally pulsing, for live status. */
export function StatusDot({ tone = 'neutral', pulse = false }) {
  return <span className={`dot dot--${tone}${pulse ? ' dot--pulse' : ''}`} aria-hidden="true" />;
}

/* ==========================================================================
   Loading states
   ========================================================================== */

export function Skeleton({ w = '100%', h = 14, r = 'var(--r-sm)', className = '', style }) {
  return (
    <span
      className={`skeleton ${className}`.trim()}
      style={{ width: w, height: h, borderRadius: r, ...style }}
      aria-hidden="true"
    />
  );
}

export function Spinner({ size = 18, className = '' }) {
  return (
    <LuLoaderCircle
      className={`spinner ${className}`.trim()}
      style={{ width: size, height: size }}
      aria-hidden="true"
    />
  );
}

/** Full-panel loading placeholder with an accessible live message. */
export function LoadingPanel({ label = 'Loading', rows = 3 }) {
  return (
    <div className="loading-panel" role="status" aria-live="polite">
      <span className="zt-sr-only">{label}</span>
      {Array.from({ length: rows }).map((_, i) => (
        <div className="loading-panel__row" key={i}>
          <Skeleton w={44} h={44} r="var(--r-md)" />
          <div className="loading-panel__lines">
            <Skeleton w={`${52 + ((i * 13) % 26)}%`} h={13} />
            <Skeleton w={`${28 + ((i * 9) % 22)}%`} h={11} />
          </div>
          <Skeleton w={78} h={30} r="var(--r-sm)" />
        </div>
      ))}
    </div>
  );
}

/* ==========================================================================
   Empty / error states
   ========================================================================== */

export function EmptyState({ icon: Icon, title, description, action, tone = 'neutral' }) {
  return (
    <div className={`empty empty--${tone}`}>
      {Icon && (
        <span className="empty__icon" aria-hidden="true">
          <Icon />
        </span>
      )}
      <h3 className="empty__title">{title}</h3>
      {description && <p className="empty__desc">{description}</p>}
      {action && <div className="empty__action">{action}</div>}
    </div>
  );
}

/* ==========================================================================
   Alert
   ========================================================================== */

export function Alert({ tone = 'info', title, children, icon: Icon, actions, className = '' }) {
  return (
    <div className={`alert alert--${tone} ${className}`.trim()} role={tone === 'danger' ? 'alert' : undefined}>
      {Icon && (
        <span className="alert__icon" aria-hidden="true">
          <Icon />
        </span>
      )}
      <div className="alert__body">
        {title && <p className="alert__title">{title}</p>}
        {children && <div className="alert__text">{children}</div>}
        {actions && <div className="alert__actions">{actions}</div>}
      </div>
    </div>
  );
}

/* ==========================================================================
   Progress
   ========================================================================== */

export function ProgressBar({ value = 0, tone = 'brand', indeterminate = false, striped = false }) {
  const pct = Math.max(0, Math.min(100, Number(value) || 0));
  return (
    <div
      className={`progress progress--${tone}${indeterminate ? ' progress--indeterminate' : ''}${
        striped ? ' progress--striped' : ''
      }`}
      role="progressbar"
      aria-valuenow={indeterminate ? undefined : Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className="progress__fill" style={{ width: indeterminate ? '100%' : `${pct}%` }} />
    </div>
  );
}

/** Circular determinate progress indicator. */
export function ProgressRing({ value = 0, size = 190, stroke = 12, tone = 'brand', children }) {
  const pct = Math.max(0, Math.min(100, Number(value) || 0));
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const offset = circumference - (pct / 100) * circumference;

  return (
    <div className={`ring ring--${tone}`} style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle
          className="ring__track"
          cx={size / 2}
          cy={size / 2}
          r={r}
          strokeWidth={stroke}
          fill="none"
        />
        <circle
          className="ring__value"
          cx={size / 2}
          cy={size / 2}
          r={r}
          strokeWidth={stroke}
          fill="none"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <div className="ring__center">{children}</div>
    </div>
  );
}

/* ==========================================================================
   Modal
   ========================================================================== */

export function Modal({ open, onClose, title, description, icon: Icon, tone = 'neutral', children, footer, size = 'md' }) {
  const panelRef = useRef(null);

  // Callers almost always pass an inline arrow (`onClose={() => setOpen(false)}`),
  // which is a fresh identity on every render of the parent. Holding it in a ref
  // keeps the open/close effect below free of that identity, so it runs exactly
  // once per open - not on every keystroke inside the dialog.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return undefined;

    const onKey = (e) => {
      if (e.key === 'Escape') onCloseRef.current?.();
    };
    document.addEventListener('keydown', onKey);

    const previouslyFocused = document.activeElement;

    // Lock the page behind the dialog. <html> is the scrolling element here, so
    // lock it directly rather than relying on body -> viewport overflow
    // propagation, which is easy to defeat. Compensate for the scrollbar that
    // disappears with it, otherwise the layout jumps sideways on open.
    const root = document.documentElement;
    const prevRootOverflow = root.style.overflow;
    const { overflow: prevBodyOverflow, paddingRight: prevPaddingRight } = document.body.style;
    const scrollbar = window.innerWidth - root.clientWidth;

    root.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    if (scrollbar > 0) {
      const current = parseFloat(getComputedStyle(document.body).paddingRight) || 0;
      document.body.style.paddingRight = `${current + scrollbar}px`;
    }

    // Move focus into the dialog so keyboard users land in the right place.
    const timer = setTimeout(() => {
      const target = panelRef.current?.querySelector(
        'input, textarea, select, button:not([disabled])'
      );
      (target || panelRef.current)?.focus();
    }, 40);

    return () => {
      document.removeEventListener('keydown', onKey);
      root.style.overflow = prevRootOverflow;
      document.body.style.overflow = prevBodyOverflow;
      document.body.style.paddingRight = prevPaddingRight;
      clearTimeout(timer);
      if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus();
    };
    // `open` only. Adding `onClose` here made every parent re-render tear this
    // effect down and set it up again, which stole focus out of the dialog
    // (cleanup restored focus to the opener, setup then focused the close
    // button) and thrashed the scroll lock on each keystroke.
  }, [open]);

  if (!open) return null;

  const dialog = (
    <div className="modal-root" role="presentation">
      <div className="modal__backdrop" onClick={onClose} />
      <div
        ref={panelRef}
        className={`modal modal--${size} modal--${tone}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
      >
        <header className="modal__header">
          {Icon && (
            <span className={`modal__icon modal__icon--${tone}`} aria-hidden="true">
              <Icon />
            </span>
          )}
          <div className="modal__heading">
            <h2 className="modal__title">{title}</h2>
            {description && <p className="modal__desc">{description}</p>}
          </div>
          <IconButton icon={LuX} label="Close dialog" onClick={onClose} />
        </header>
        {children && <div className="modal__body">{children}</div>}
        {footer && <footer className="modal__footer">{footer}</footer>}
      </div>
    </div>
  );

  // Render into <body> rather than in place. `position: fixed` resolves against
  // the nearest ancestor with a transform/filter/contain rather than the
  // viewport, and the page-transition animation on .app__content leaves exactly
  // such a transform behind - which pinned the dialog to the middle of the
  // scrolling content instead of the viewport. Portalling puts the dialog
  // outside that subtree for good, so no ancestor can ever capture it again.
  return createPortal(dialog, document.body);
}

/* ==========================================================================
   Form controls
   ========================================================================== */

export function Field({ label, hint, htmlFor, children, className = '' }) {
  return (
    <div className={`field ${className}`.trim()}>
      {label && (
        <label className="field__label" htmlFor={htmlFor}>
          {label}
        </label>
      )}
      {children}
      {hint && <p className="field__hint">{hint}</p>}
    </div>
  );
}

export function Select({ className = '', ...props }) {
  return <select className={`select ${className}`.trim()} {...props} />;
}

export function TextInput({ className = '', ...props }) {
  return <input className={`input ${className}`.trim()} {...props} />;
}

export function Checkbox({ label, description, checked, onChange, id, tone = 'brand' }) {
  return (
    <label className={`checkbox checkbox--${tone}${checked ? ' is-checked' : ''}`} htmlFor={id}>
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={onChange}
        className="checkbox__input"
      />
      <span className="checkbox__box" aria-hidden="true">
        <svg viewBox="0 0 14 14" fill="none">
          <path
            d="M2.5 7.2 5.6 10.3 11.5 4.4"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      <span className="checkbox__text">
        <span className="checkbox__label">{label}</span>
        {description && <span className="checkbox__desc">{description}</span>}
      </span>
    </label>
  );
}

/* ==========================================================================
   Segmented control (used for tabs / view toggles)
   ========================================================================== */

export function Segmented({ options, value, onChange, size = 'md', ariaLabel }) {
  return (
    <div className={`segmented segmented--${size}`} role="tablist" aria-label={ariaLabel}>
      {options.map((opt) => {
        const Icon = opt.icon;
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={active}
            className={`segmented__item${active ? ' is-active' : ''}`}
            onClick={() => onChange(opt.value)}
          >
            {Icon && <Icon aria-hidden="true" />}
            <span>{opt.label}</span>
            {opt.count !== undefined && <span className="segmented__count">{opt.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

/* ==========================================================================
   Copyable monospace value
   ========================================================================== */

export function CopyValue({ value, mono = true, truncate = false, label = 'value' }) {
  const [copied, setCopied] = React.useState(false);

  const copy = async () => {
    const text = String(value ?? '');
    if (!text) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        // Fallback for non-secure contexts, where the async API is unavailable.
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* Clipboard unavailable - silently ignore, the text is still selectable. */
    }
  };

  const empty = value === null || value === undefined || value === '';

  return (
    <span className={`copy-value${truncate ? ' copy-value--truncate' : ''}`}>
      <span className={mono ? 'mono copy-value__text' : 'copy-value__text'}>
        {empty ? 'N/A' : String(value)}
      </span>
      {!empty && (
        <button
          type="button"
          className={`copy-value__btn${copied ? ' is-copied' : ''}`}
          onClick={copy}
          aria-label={copied ? `Copied ${label}` : `Copy ${label}`}
          title={copied ? 'Copied' : 'Copy'}
        >
          {copied ? (
            <svg viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <path d="M2.5 7.2 5.6 10.3 11.5 4.4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          ) : (
            <svg viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <rect x="4.6" y="4.6" width="7.2" height="7.2" rx="1.6" stroke="currentColor" strokeWidth="1.4" />
              <path d="M9.4 4.6V3.4A1.2 1.2 0 0 0 8.2 2.2H3.4a1.2 1.2 0 0 0-1.2 1.2v4.8a1.2 1.2 0 0 0 1.2 1.2h1.2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          )}
        </button>
      )}
    </span>
  );
}

/* ==========================================================================
   Definition list used across detail views
   ========================================================================== */

export function DataList({ items, columns = 2, className = '' }) {
  return (
    <dl className={`datalist datalist--${columns} ${className}`.trim()}>
      {items.map((item) => (
        <div className="datalist__item" key={item.label}>
          <dt className="datalist__label">{item.label}</dt>
          <dd className="datalist__value">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
