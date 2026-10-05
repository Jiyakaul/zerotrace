import React from 'react';
import {
  LuShieldAlert,
  LuShieldCheck,
  LuLoaderCircle,
  LuCircleX,
  LuTriangleAlert,
  LuInfo,
  LuRefreshCw,
  LuTerminal,
} from 'react-icons/lu';
import { Button } from './ui/Primitives';

/**
 * Administrator-privilege gate for physical-drive sanitisation.
 *
 * Renders the current elevation phase and, where the platform supports it,
 * offers the standard Windows UAC flow. It is deliberately explicit that
 * approving UAC grants *access* only - the typed-ERASE confirmation is still
 * required afterwards and is enforced separately.
 */
export default function AdminGate({ phase, message, supported, onElevate, onDismissError }) {
  // phase: 'required' | 'pending' | 'restarting' | 'granted' | 'denied' | 'failed' | 'unsupported'

  if (phase === 'granted') {
    return (
      <section className="admin-gate admin-gate--granted">
        <span className="admin-gate__icon" aria-hidden="true">
          <LuShieldCheck />
        </span>
        <div className="admin-gate__body">
          <h3 className="admin-gate__title">Administrator privileges active</h3>
          <p className="admin-gate__text">
            ZeroTrace can now access the drive directly. This permission alone does{' '}
            <strong>not</strong> start anything — you still have to confirm the erasure by typing{' '}
            <code>ERASE</code>.
          </p>
        </div>
      </section>
    );
  }

  if (phase === 'pending' || phase === 'restarting') {
    const restarting = phase === 'restarting';
    return (
      <section className="admin-gate admin-gate--busy" aria-live="polite">
        <span className="admin-gate__icon" aria-hidden="true">
          <LuLoaderCircle className="spinner" />
        </span>
        <div className="admin-gate__body">
          <h3 className="admin-gate__title">
            {restarting
              ? 'Restarting with administrator privileges…'
              : 'Waiting for Windows to confirm…'}
          </h3>
          <p className="admin-gate__text">
            {restarting
              ? 'The elevated ZeroTrace backend is starting and reclaiming this address. The page will reconnect automatically.'
              : 'Approve the User Account Control prompt that Windows has opened. If you do not see it, check the taskbar — it may be behind this window.'}
          </p>
          <ol className="admin-gate__steps">
            <li className={restarting ? 'is-done' : 'is-active'}>Windows consent prompt</li>
            <li className={restarting ? 'is-active' : ''}>Elevated backend starts</li>
            <li>Reconnect &amp; confirm with ERASE</li>
          </ol>
        </div>
      </section>
    );
  }

  if (phase === 'denied' || phase === 'failed') {
    const denied = phase === 'denied';
    return (
      <section className="admin-gate admin-gate--error" role="alert">
        <span className="admin-gate__icon" aria-hidden="true">
          {denied ? <LuCircleX /> : <LuTriangleAlert />}
        </span>
        <div className="admin-gate__body">
          <h3 className="admin-gate__title">
            {denied ? 'Administrator access was declined' : 'Could not obtain administrator access'}
          </h3>
          <p className="admin-gate__text">
            {message ||
              (denied
                ? 'The Windows prompt was dismissed, so ZeroTrace is still running without the access it needs.'
                : 'Windows could not start the elevated process.')}{' '}
            No sanitisation has been performed and nothing on the drive has changed.
          </p>
          <div className="admin-gate__actions">
            <Button variant="primary" icon={LuShieldAlert} onClick={onElevate}>
              Try again
            </Button>
            {onDismissError && (
              <Button variant="ghost" icon={LuRefreshCw} onClick={onDismissError}>
                Dismiss
              </Button>
            )}
          </div>
        </div>
      </section>
    );
  }

  if (phase === 'unsupported' || !supported) {
    return (
      <section className="admin-gate admin-gate--info">
        <span className="admin-gate__icon" aria-hidden="true">
          <LuTerminal />
        </span>
        <div className="admin-gate__body">
          <h3 className="admin-gate__title">Elevated privileges required</h3>
          <p className="admin-gate__text">
            This platform has no in-app elevation flow. Stop ZeroTrace and start the backend with
            root privileges instead:
          </p>
          <pre className="admin-gate__code mono">
            sudo python -m backend.server --host 127.0.0.1 --port 8000
          </pre>
        </div>
      </section>
    );
  }

  // phase === 'required'
  return (
    <section className="admin-gate admin-gate--required">
      <span className="admin-gate__icon" aria-hidden="true">
        <LuShieldAlert />
      </span>
      <div className="admin-gate__body">
        <h3 className="admin-gate__title">Administrator privileges required</h3>
        <p className="admin-gate__text">
          Sanitising a physical drive needs direct block-level access, which Windows only grants to
          an elevated process. ZeroTrace is currently running as a standard user.
        </p>

        <div className="admin-gate__note">
          <LuInfo aria-hidden="true" />
          <p>
            Approving the Windows prompt grants ZeroTrace <strong>permission to access the
            drive</strong>. It does <strong>not</strong> authorise or start an erasure — you will
            still have to confirm by typing <code>ERASE</code> afterwards.
          </p>
        </div>

        <div className="admin-gate__actions">
          <Button variant="primary" icon={LuShieldAlert} onClick={onElevate}>
            Run as Administrator
          </Button>
          <span className="admin-gate__hint">Opens the standard Windows UAC prompt</span>
        </div>
      </div>
    </section>
  );
}
