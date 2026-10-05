import React, { useEffect, useMemo, useState } from 'react';
import {
  LuTriangleAlert,
  LuCircleCheck,
  LuArrowLeft,
  LuHardDrive,
  LuClock,
  LuGauge,
  LuScrollText,
  LuCircleAlert,
} from 'react-icons/lu';
import { formatBytes, formatDuration, getMethodMeta } from '../lib/format';
import { Alert, Badge, Button, ProgressRing, StatusDot } from './ui/Primitives';
import { describeWipeError } from '../lib/wipeErrors';

const STAGES = [
  { id: 'prepare', label: 'Preparing device', at: 0 },
  { id: 'overwrite', label: 'Overwriting media', at: 5 },
  { id: 'verify', label: 'Verifying erasure', at: 75 },
  { id: 'certify', label: 'Issuing certificate', at: 96 },
];

export default function WipeProgress({
  selectedDevices, method, passes, progress, status, error, errorPayload, system, onBack,
}) {
  const [startTime] = useState(() => Date.now());
  const [elapsed, setElapsed] = useState(0);

  const done = progress >= 100 && !error;
  const failed = Boolean(error);

  // Categorised description of the real failure. Falls back to the plain
  // message when the backend did not send structured fields.
  const errorInfo = useMemo(
    () => describeWipeError(errorPayload || { error }, system),
    [errorPayload, error, system]
  );
  const running = !done && !failed;

  useEffect(() => {
    if (!running) return undefined;
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - startTime) / 1000)), 1000);
    return () => clearInterval(id);
  }, [running, startTime]);

  const meta = getMethodMeta(method);
  const device = selectedDevices[0] || {};

  const remaining = useMemo(() => {
    if (!running || progress <= 0 || elapsed <= 0) return null;
    return Math.floor((elapsed / progress) * (100 - progress));
  }, [running, progress, elapsed]);

  const tone = failed ? 'danger' : done ? 'success' : 'brand';
  const activeStage = STAGES.reduce(
    (acc, s) => (progress >= s.at ? s.id : acc),
    STAGES[0].id
  );

  return (
    <div className="page page--progress">
      <div className="progress-layout">
        {/* Ring ------------------------------------------------------------ */}
        <section className={`card progress-hero progress-hero--${tone}`}>
          <ProgressRing value={failed ? 100 : progress} tone={tone} size={216} stroke={14}>
            {failed ? (
              <>
                <LuCircleAlert className="progress-hero__glyph" aria-hidden="true" />
                <span className="progress-hero__state">Failed</span>
              </>
            ) : done ? (
              <>
                <LuCircleCheck className="progress-hero__glyph" aria-hidden="true" />
                <span className="progress-hero__state">Complete</span>
              </>
            ) : (
              <>
                <span className="progress-hero__pct">{Math.round(progress)}</span>
                <span className="progress-hero__unit">percent</span>
              </>
            )}
          </ProgressRing>

          <div className="progress-hero__meta">
            <div className="progress-hero__status">
              <StatusDot tone={failed ? 'danger' : done ? 'success' : 'info'} pulse={running} />
              <span>{status || (running ? 'Working…' : done ? 'Finished' : 'Stopped')}</span>
            </div>
            <p className="progress-hero__note">
              {running
                ? 'Keep this window open and the device connected until the operation finishes.'
                : done
                ? 'The device was sanitised successfully and a certificate has been issued.'
                : 'The operation stopped before completing.'}
            </p>
          </div>
        </section>

        {/* Details --------------------------------------------------------- */}
        <div className="progress-side">
          <section className="card card--flush">
            <header className="card__header">
              <span className="card__header-icon" aria-hidden="true"><LuHardDrive /></span>
              <div className="card__header-text">
                <h3 className="card__title">Operation</h3>
                <p className="card__desc">{meta.name}</p>
              </div>
            </header>
            <div className="card__content">
              <dl className="datalist datalist--1">
                <div className="datalist__item">
                  <dt className="datalist__label">Device</dt>
                  <dd className="datalist__value zt-truncate">{device.name || device.model || 'Unknown'}</dd>
                </div>
                <div className="datalist__item">
                  <dt className="datalist__label">Path</dt>
                  <dd className="datalist__value mono zt-truncate">{device.path || 'N/A'}</dd>
                </div>
                <div className="datalist__item">
                  <dt className="datalist__label">Capacity</dt>
                  <dd className="datalist__value">{formatBytes(device.size)}</dd>
                </div>
                <div className="datalist__item">
                  <dt className="datalist__label">Passes</dt>
                  <dd className="datalist__value">{passes || 1}</dd>
                </div>
              </dl>
            </div>
          </section>

          <section className="card card--flush">
            <header className="card__header">
              <span className="card__header-icon" aria-hidden="true"><LuGauge /></span>
              <div className="card__header-text">
                <h3 className="card__title">Timing</h3>
                <p className="card__desc">Live measurements</p>
              </div>
            </header>
            <div className="card__content">
              <div className="metric-row">
                <div className="metric">
                  <span className="metric__label"><LuClock aria-hidden="true" /> Elapsed</span>
                  <span className="metric__value">{formatDuration(elapsed)}</span>
                </div>
                <div className="metric">
                  <span className="metric__label"><LuGauge aria-hidden="true" /> Remaining</span>
                  <span className="metric__value">
                    {failed ? '—' : done ? '0s' : remaining === null ? 'Estimating…' : formatDuration(remaining)}
                  </span>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>

      {/* Stage timeline ----------------------------------------------------- */}
      <section className="card card--flush">
        <header className="card__header">
          <span className="card__header-icon" aria-hidden="true"><LuScrollText /></span>
          <div className="card__header-text">
            <h3 className="card__title">Stages</h3>
            <p className="card__desc">Sanitisation pipeline</p>
          </div>
        </header>
        <div className="card__content">
          <ol className="timeline">
            {STAGES.map((s) => {
              const complete = !failed && progress > s.at && (progress >= 100 || activeStage !== s.id);
              const current = !failed && activeStage === s.id && progress < 100;
              const state = failed && current ? 'failed' : complete ? 'done' : current ? 'active' : 'idle';
              return (
                <li className={`timeline__step timeline__step--${state}`} key={s.id}>
                  <span className="timeline__marker" aria-hidden="true">
                    {state === 'done' ? <LuCircleCheck /> : state === 'failed' ? <LuCircleAlert /> : <span className="timeline__pip" />}
                  </span>
                  <span className="timeline__label">{s.label}</span>
                  {current && <Badge tone="info" size="sm">In progress</Badge>}
                  {state === 'done' && <Badge tone="success" size="sm">Done</Badge>}
                </li>
              );
            })}
          </ol>
        </div>
      </section>

      {failed && (
        <Alert tone="danger" icon={LuTriangleAlert} title={errorInfo.title}>
          <p className="alert__mono mono">{errorInfo.message}</p>

          {errorInfo.facts.length > 0 && (
            <ul className="fault-facts">
              {errorInfo.facts.map((f) => (
                <li key={f.label}>
                  <span>{f.label}</span>
                  <strong className="mono">{f.value}</strong>
                </li>
              ))}
            </ul>
          )}

          {/* Shown only when the backend's real process token says privileges
              are missing - never as a blanket explanation for any failure. */}
          {errorInfo.hint && <p>{errorInfo.hint}</p>}
        </Alert>
      )}

      {done && (
        <Alert tone="success" icon={LuCircleCheck} title="Sanitisation complete">
          The device was erased using {meta.name} in {formatDuration(elapsed)}. A signed certificate
          of destruction has been generated.
        </Alert>
      )}

      {running && (
        <Alert tone="warn" icon={LuTriangleAlert} title="Do not interrupt">
          Disconnecting the device or closing the application now can leave the media in a partially
          sanitised state.
        </Alert>
      )}

      <div className="page__footer">
        <Button
          variant={running ? 'ghost' : 'primary'}
          icon={LuArrowLeft}
          onClick={onBack}
          disabled={running}
        >
          {running ? 'Back (locked during erasure)' : 'Back'}
        </Button>
      </div>
    </div>
  );
}
