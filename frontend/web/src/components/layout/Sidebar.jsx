import React from 'react';
import {
  LuLayoutDashboard,
  LuHardDrive,
  LuScrollText,
  LuShieldCheck,
  LuX,
  LuBookLock,
} from 'react-icons/lu';
import { StatusDot } from '../ui/Primitives';

const NAV = [
  {
    section: 'Operations',
    items: [
      { id: 'dashboard', label: 'Dashboard', icon: LuLayoutDashboard, hint: 'Overview' },
      { id: 'devices', label: 'Drives', icon: LuHardDrive, hint: 'Detect and select' },
    ],
  },
  {
    section: 'Evidence',
    items: [{ id: 'reports', label: 'Certificates', icon: LuScrollText, hint: 'Proof of erasure' }],
  },
];

/** Steps that belong to the wipe workflow all highlight the Drives entry. */
const WORKFLOW_STEPS = ['devices', 'options', 'progress', 'complete'];

function navIdForStep(step) {
  if (WORKFLOW_STEPS.includes(step)) return 'devices';
  if (step === 'certificate') return 'reports';
  return step;
}

export default function Sidebar({ step, onNavigate, backendStatus, open, onClose }) {
  const activeId = navIdForStep(step);

  return (
    <>
      <div
        className={`sidebar-scrim${open ? ' is-open' : ''}`}
        onClick={onClose}
        aria-hidden="true"
      />
      <aside className={`sidebar${open ? ' is-open' : ''}`} aria-label="Primary">
        <div className="sidebar__top">
          <a
            className="brand"
            href="#dashboard"
            onClick={(e) => {
              e.preventDefault();
              onNavigate('dashboard');
            }}
          >
            <span className="brand__mark" aria-hidden="true">
              <LuShieldCheck />
            </span>
            <span className="brand__text">
              <span className="brand__name">ZeroTrace</span>
              <span className="brand__tag">Secure Erasure</span>
            </span>
          </a>
          <button type="button" className="sidebar__close" onClick={onClose} aria-label="Close navigation">
            <LuX aria-hidden="true" />
          </button>
        </div>

        <nav className="sidebar__nav">
          {NAV.map((group) => (
            <div className="nav-group" key={group.section}>
              <p className="nav-group__title">{group.section}</p>
              <ul>
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const active = activeId === item.id;
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        className={`nav-item${active ? ' is-active' : ''}`}
                        onClick={() => onNavigate(item.id)}
                        aria-current={active ? 'page' : undefined}
                      >
                        <span className="nav-item__icon" aria-hidden="true">
                          <Icon />
                        </span>
                        <span className="nav-item__text">
                          <span className="nav-item__label">{item.label}</span>
                          <span className="nav-item__hint">{item.hint}</span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        <div className="sidebar__foot">
          <div className="compliance-note">
            <span className="compliance-note__icon" aria-hidden="true">
              <LuBookLock />
            </span>
            <div>
              <p className="compliance-note__title">NIST 800-88 aligned</p>
              <p className="compliance-note__text">
                Every completed erasure issues a signed, tamper-evident certificate.
              </p>
            </div>
          </div>

          <div className={`backend-status backend-status--${backendStatus}`}>
            <StatusDot
              tone={
                backendStatus === 'online' ? 'success' : backendStatus === 'checking' ? 'warn' : 'danger'
              }
              pulse={backendStatus === 'online'}
            />
            <span className="backend-status__label">
              {backendStatus === 'online'
                ? 'Backend connected'
                : backendStatus === 'checking'
                ? 'Connecting…'
                : 'Backend unreachable'}
            </span>
            <span className="backend-status__version">v1.0.0</span>
          </div>
        </div>
      </aside>
    </>
  );
}
