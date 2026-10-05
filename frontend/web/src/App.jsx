import React, { useCallback, useEffect, useRef, useState } from 'react';
import { LuHardDrive, LuRefreshCw, LuCircleCheck, LuScrollText, LuArrowRight } from 'react-icons/lu';

import Sidebar from './components/layout/Sidebar';
import TopBar from './components/layout/TopBar';
import Dashboard from './components/Dashboard';
import DeviceList from './components/DeviceList';
import WipeOptions from './components/WipeOptions';
import WipeProgress from './components/WipeProgress';
import Reports from './components/Reports';
import CertificateViewer from './components/CertificateViewer';
import { Button } from './components/ui/Primitives';
import { useToast } from './components/ui/Toast';
import { api } from './lib/api';
import { getMethodName } from './lib/format';
import './App.css';

const THEME_KEY = 'zerotrace.theme';
const WORKFLOW_KEY = 'zerotrace.workflow';

/**
 * Selection state that must survive the backend restarting under elevation.
 *
 * The page itself is not reloaded during a UAC handover, so React state already
 * survives; this is the belt-and-braces path for a manual refresh. The typed
 * ERASE confirmation is deliberately NEVER persisted - it has to be re-entered
 * every single time.
 */
function loadWorkflow() {
  try {
    const raw = sessionStorage.getItem(WORKFLOW_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw);
    if (!Array.isArray(saved?.selectedDevices) || saved.selectedDevices.length === 0) return null;
    // Only resume on the two non-destructive steps. Never restore straight into
    // 'progress' or 'complete'.
    if (!['devices', 'options'].includes(saved.step)) return null;
    return saved;
  } catch {
    return null;
  }
}

function saveWorkflow(data) {
  try {
    sessionStorage.setItem(WORKFLOW_KEY, JSON.stringify(data));
  } catch {
    /* Persisting the selection is best-effort. */
  }
}

function readInitialTheme() {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {
    /* Storage can be unavailable in private windows - fall through. */
  }
  if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: light)').matches) {
    return 'light';
  }
  return 'dark';
}

/** Page chrome (title, description, breadcrumbs) for each step. */
function pageMeta(step, ctx) {
  switch (step) {
    case 'dashboard':
      return { title: 'Dashboard', description: 'Operational overview of drives, erasures and evidence.' };
    case 'devices':
      return {
        title: 'Select drives',
        description: 'Choose the storage devices you want to sanitise.',
        breadcrumb: [{ label: 'Erasure', onClick: ctx.goDevices }, { label: 'Select drives' }],
      };
    case 'options':
      return {
        title: 'Configure erasure',
        description: 'Choose a sanitisation standard and confirm the targets.',
        breadcrumb: [
          { label: 'Erasure', onClick: ctx.goDevices },
          { label: 'Select drives', onClick: ctx.goDevices },
          { label: 'Configure' },
        ],
      };
    case 'progress':
      return {
        title: 'Erasure in progress',
        description: 'Live status of the running sanitisation job.',
        breadcrumb: [{ label: 'Erasure', onClick: ctx.goDevices }, { label: 'Progress' }],
      };
    case 'complete':
      return {
        title: 'Erasure complete',
        description: 'The device was sanitised and a certificate issued.',
        breadcrumb: [{ label: 'Erasure', onClick: ctx.goDevices }, { label: 'Complete' }],
      };
    case 'reports':
      return { title: 'Certificates', description: 'Signed, tamper-evident proof of data destruction.' };
    case 'certificate':
      return {
        title: 'Certificate detail',
        description: 'Inspect and cryptographically verify this record.',
        breadcrumb: [{ label: 'Certificates', onClick: ctx.goReports }, { label: 'Detail' }],
      };
    default:
      return { title: 'ZeroTrace' };
  }
}

export default function App() {
  const restored = useRef(loadWorkflow()).current;

  const [step, setStep] = useState(restored?.step || 'dashboard');
  const [theme, setTheme] = useState(readInitialTheme);
  const [navOpen, setNavOpen] = useState(false);
  const [backendStatus, setBackendStatus] = useState('checking');

  // Privilege state, read from the backend's real process token.
  const [system, setSystem] = useState({
    is_admin: false,
    elevation_supported: false,
    platform: '',
    loaded: false,
  });
  const [elevationPhase, setElevationPhase] = useState('idle');
  const [elevationMessage, setElevationMessage] = useState('');
  const elevationPollRef = useRef(null);

  const [selectedDevices, setSelectedDevices] = useState(restored?.selectedDevices || []);
  const [availableMethods, setAvailableMethods] = useState([]);
  const [wipeMethod, setWipeMethod] = useState(restored?.wipeMethod || '');
  const [wipePasses, setWipePasses] = useState(restored?.wipePasses || 1);
  const [wipeProgress, setWipeProgress] = useState(0);
  const [wipeStatus, setWipeStatus] = useState('');
  const [wipeError, setWipeError] = useState('');
  // Structured failure from the backend (category, Win32 error, operation),
  // so the UI can name the real cause instead of guessing.
  const [wipeErrorPayload, setWipeErrorPayload] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedCertificate, setSelectedCertificate] = useState(null);

  const pollRef = useRef(null);
  const toast = useToast();

  /* --- theme ---------------------------------------------------------- */
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* Persisting the preference is best-effort. */
    }
  }, [theme]);

  /* --- persist the workflow selection ---------------------------------- */
  useEffect(() => {
    saveWorkflow({ step, selectedDevices, wipeMethod, wipePasses });
  }, [step, selectedDevices, wipeMethod, wipePasses]);

  /* --- backend health + methods + privilege level ---------------------- */
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        await api.health();
        if (!cancelled) setBackendStatus('online');
      } catch {
        if (!cancelled) setBackendStatus('offline');
      }

      try {
        const sys = await api.systemStatus();
        if (!cancelled) {
          setSystem({ ...sys, loaded: true });
          if (sys.is_admin) setElevationPhase('granted');
        }
      } catch (err) {
        if (!cancelled) {
          console.error('Failed to read system status:', err);
          setSystem((s) => ({ ...s, loaded: true }));
        }
      }

      try {
        const data = await api.listMethods();
        if (!cancelled && Array.isArray(data?.methods)) setAvailableMethods(data.methods);
      } catch (err) {
        if (!cancelled) {
          console.error('Failed to load wipe methods:', err);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  /* --- clean up polling on unmount ------------------------------------- */
  useEffect(
    () => () => {
      clearInterval(pollRef.current);
      clearInterval(elevationPollRef.current);
    },
    []
  );

  /** Re-read the privilege level from the backend and settle the gate. */
  const refreshSystem = useCallback(async () => {
    try {
      const sys = await api.systemStatus();
      setSystem({ ...sys, loaded: true });
      setBackendStatus('online');
      if (sys.is_admin) {
        clearInterval(elevationPollRef.current);
        setElevationPhase('granted');
        setElevationMessage('');
      }
      return sys;
    } catch {
      setBackendStatus('offline');
      return null;
    }
  }, []);

  /**
   * Re-check as soon as the window is looked at again.
   *
   * The UAC consent dialog runs on Windows' secure desktop, so the browser
   * loses focus for the whole prompt - and browsers throttle timers in
   * backgrounded tabs to roughly one tick a minute. Without this the poll below
   * can stall exactly when the answer arrives.
   */
  useEffect(() => {
    const recheck = () => {
      if (document.visibilityState === 'visible') refreshSystem();
    };
    document.addEventListener('visibilitychange', recheck);
    window.addEventListener('focus', refreshSystem);
    return () => {
      document.removeEventListener('visibilitychange', recheck);
      window.removeEventListener('focus', refreshSystem);
    };
  }, [refreshSystem]);

  /**
   * Drive the UAC flow.
   *
   * The consent dialog is user-driven and the approved path restarts the
   * backend, so the outcome is discovered by polling rather than returned from
   * the request. Connection failures during the window where the unprivileged
   * process has exited and the elevated one has not yet bound are expected, and
   * are treated as "restarting" rather than an error.
   *
   * This only ever obtains privileges. It never starts, resumes or authorises a
   * wipe - the ERASE confirmation still has to happen afterwards.
   */
  const requestElevation = useCallback(async () => {
    clearInterval(elevationPollRef.current);
    setElevationMessage('');
    setElevationPhase('pending');

    try {
      await api.requestElevation();
    } catch (err) {
      // A dropped connection here means the handover already began.
      if (err.status && err.status !== 0) {
        setElevationPhase('failed');
        setElevationMessage(err.message || 'Could not start the elevation request.');
        toast.error('Elevation failed', err.message || 'Could not start the elevation request.');
        return;
      }
    }

    const startedAt = Date.now();
    const TIMEOUT_MS = 150000; // UAC prompts can sit unanswered for a while.
    let sawDisconnect = false;

    elevationPollRef.current = setInterval(async () => {
      if (Date.now() - startedAt > TIMEOUT_MS) {
        clearInterval(elevationPollRef.current);
        setElevationPhase('failed');
        setElevationMessage('Timed out waiting for the elevation to complete.');
        return;
      }

      try {
        const sys = await api.systemStatus();
        setSystem({ ...sys, loaded: true });
        setBackendStatus('online');

        if (sys.is_admin) {
          clearInterval(elevationPollRef.current);
          setElevationPhase('granted');
          setElevationMessage('');
          toast.success(
            'Administrator privileges active',
            'Confirm the erasure by typing ERASE to proceed.'
          );
          return;
        }

        const state = sys.elevation?.state;

        // We reconnected to a backend that came up after the handover, but it
        // is not elevated and has no record of the request - so the relaunch
        // did not deliver privileges. Report it now instead of polling on.
        if (sawDisconnect && !sys.is_admin && (!state || state === 'idle')) {
          clearInterval(elevationPollRef.current);
          setElevationPhase('failed');
          setElevationMessage(
            'ZeroTrace restarted but is still running without administrator privileges.'
          );
          toast.error(
            'Elevation did not take effect',
            'The backend restarted without administrator privileges. No drive was modified.'
          );
          return;
        }

        if (state === 'denied' || state === 'failed' || state === 'unsupported') {
          clearInterval(elevationPollRef.current);
          setElevationPhase(state);
          setElevationMessage(sys.elevation?.message || '');
          toast.error(
            state === 'denied' ? 'Administrator access declined' : 'Elevation failed',
            sys.elevation?.message || 'No changes were made to any drive.'
          );
          return;
        }

        // Approved but this (unprivileged) process is still answering: it is
        // about to exit and hand the port over.
        if (state === 'approved') setElevationPhase('restarting');
      } catch {
        // Backend unreachable: the handover is in progress.
        sawDisconnect = true;
        setElevationPhase('restarting');
        setBackendStatus('checking');
      }
    }, 1000);
  }, [toast]);

  const dismissElevationError = useCallback(() => {
    setElevationPhase(system.is_admin ? 'granted' : 'required');
    setElevationMessage('');
  }, [system.is_admin]);

  const navigate = useCallback((next) => {
    setStep(next);
    setNavOpen(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const goDevices = useCallback(() => navigate('devices'), [navigate]);
  const goReports = useCallback(() => navigate('reports'), [navigate]);

  const pollProgress = useCallback((sessionId) => {
    clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const p = await api.getProgress(sessionId);
        setWipeProgress(p.progress_percentage ?? 0);
        setWipeStatus(p.status_message || '');

        if ((p.progress_percentage ?? 0) >= 100) {
          clearInterval(pollRef.current);
          setWipeStatus('Erasure completed successfully');
          setTimeout(() => navigate('complete'), 1400);
        }
      } catch (err) {
        // A 404 simply means no progress row exists yet; keep waiting.
        if (err.status && err.status !== 404) {
          clearInterval(pollRef.current);
          setWipeError('Lost contact with the progress stream.');
          setWipeStatus('Error');
        }
      }
    }, 1000);
  }, [navigate]);

  const handleDeviceSelection = (devices) => {
    setSelectedDevices(devices);
    navigate('options');
  };

  const handleWipeStart = async (method, passes) => {
    if (selectedDevices.length === 0) {
      toast.warn('No drive selected', 'Choose a device before starting an erasure.');
      return;
    }

    setIsLoading(true);
    setWipeMethod(method);
    setWipePasses(passes);
    setWipeProgress(0);
    setWipeStatus('Starting erasure…');
    setWipeError('');
    setWipeErrorPayload(null);
    navigate('progress');

    try {
      const device = selectedDevices[0];
      const result = await api.startWipe({ device: device.path, method, passes, force: true });
      const payload = result?.result || null;

      if (payload?.success) {
        if (payload.session_id) pollProgress(payload.session_id);
        setWipeProgress(100);
        setWipeStatus('Erasure completed successfully');
        toast.success('Erasure complete', `${getMethodName(method)} finished on ${device.path}.`);
        setTimeout(() => navigate('complete'), 1400);
      } else if (payload?.requires_admin) {
        // The backend refused before touching the drive because it lacks the
        // privileges. Send the user back to configure and surface the UAC flow;
        // the ERASE confirmation will still be required afterwards.
        const message = payload.error || 'Administrator privileges are required.';
        setWipeError('');
        setWipeErrorPayload(null);
        setWipeStatus('');
        setElevationPhase('required');
        setElevationMessage(message);
        navigate('options');
        toast.warn('Administrator privileges required', message);
      } else {
        const message = payload?.error || 'The erasure did not complete.';
        setWipeError(message);
        setWipeErrorPayload(payload || { error: message });
        setWipeStatus('Failed');
        toast.error('Erasure failed', message);
      }
    } catch (err) {
      const message = err.message || 'Request failed';
      setWipeError(message);
      setWipeErrorPayload({ error: message, error_category: 'wipe_failed' });
      setWipeStatus('Failed');
      toast.error('Erasure failed', message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleBack = () => {
    if (step === 'options') navigate('devices');
    else if (step === 'progress') navigate('options');
    else if (step === 'complete') navigate('devices');
    else if (step === 'certificate') navigate('reports');
    else navigate('dashboard');
  };

  const handleViewCertificate = (certificate) => {
    setSelectedCertificate(certificate);
    navigate('certificate');
  };

  const startOver = () => {
    setSelectedDevices([]);
    setWipeProgress(0);
    setWipeStatus('');
    setWipeError('');
    setWipeErrorPayload(null);
    navigate('devices');
  };

  const meta = pageMeta(step, { goDevices, goReports });

  const topActions =
    step === 'dashboard' ? (
      <Button variant="primary" size="sm" icon={LuHardDrive} onClick={goDevices}>
        New erasure
      </Button>
    ) : null;

  return (
    <div className="app">
      <Sidebar
        step={step}
        onNavigate={navigate}
        backendStatus={backendStatus}
        open={navOpen}
        onClose={() => setNavOpen(false)}
      />

      <div className="app__main">
        <TopBar
          title={meta.title}
          description={meta.description}
          breadcrumb={meta.breadcrumb}
          actions={topActions}
          theme={theme}
          onToggleTheme={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
          onOpenNav={() => setNavOpen(true)}
        />

        <main className="app__content" key={step}>
          {backendStatus === 'offline' && (
            <div className="offline-banner" role="alert">
              <span className="offline-banner__dot" aria-hidden="true" />
              <div>
                <p className="offline-banner__title">Backend unreachable</p>
                <p className="offline-banner__text">
                  Start the API with <code>uvicorn backend.main:app --host 127.0.0.1 --port 8000</code>{' '}
                  then reload this page.
                </p>
              </div>
              <Button size="sm" variant="outline" icon={LuRefreshCw} onClick={() => window.location.reload()}>
                Reload
              </Button>
            </div>
          )}

          {step === 'dashboard' && (
            <Dashboard onNavigate={navigate} onViewCertificate={handleViewCertificate} />
          )}

          {step === 'devices' && (
            <DeviceList
              onNext={handleDeviceSelection}
              onBack={() => navigate('dashboard')}
              initialSelection={selectedDevices}
            />
          )}

          {step === 'options' && (
            <WipeOptions
              selectedDevices={selectedDevices}
              availableMethods={availableMethods}
              onStart={handleWipeStart}
              onBack={handleBack}
              isLoading={isLoading}
              system={system}
              elevationPhase={elevationPhase}
              elevationMessage={elevationMessage}
              onElevate={requestElevation}
              onDismissElevationError={dismissElevationError}
            />
          )}

          {step === 'progress' && (
            <WipeProgress
              selectedDevices={selectedDevices}
              method={wipeMethod}
              passes={wipePasses}
              progress={wipeProgress}
              status={wipeStatus}
              error={wipeError}
              errorPayload={wipeErrorPayload}
              system={system}
              onBack={handleBack}
            />
          )}

          {step === 'complete' && (
            <div className="page">
              <section className="complete">
                <span className="complete__badge" aria-hidden="true">
                  <LuCircleCheck />
                </span>
                <h2 className="complete__title">Erasure complete</h2>
                <p className="complete__text">
                  {selectedDevices[0]?.name || 'The device'} was sanitised using{' '}
                  <strong>{getMethodName(wipeMethod)}</strong>. A signed certificate of destruction
                  has been issued and is ready to download.
                </p>
                <div className="complete__actions">
                  <Button variant="primary" icon={LuScrollText} iconRight={LuArrowRight} onClick={goReports}>
                    View certificate
                  </Button>
                  <Button variant="secondary" icon={LuHardDrive} onClick={startOver}>
                    Erase another drive
                  </Button>
                </div>
              </section>
            </div>
          )}

          {step === 'reports' && (
            <Reports onViewCertificate={handleViewCertificate} onNavigate={navigate} />
          )}

          {step === 'certificate' && (
            <CertificateViewer certificate={selectedCertificate} onBack={goReports} />
          )}
        </main>
      </div>
    </div>
  );
}
