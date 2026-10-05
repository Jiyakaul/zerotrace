import React, { useEffect, useState } from 'react';
import {
  LuHardDrive,
  LuScrollText,
  LuCircleCheck,
  LuShieldCheck,
  LuArrowRight,
  LuTriangleAlert,
  LuActivity,
  LuZap,
  LuFileCheck,
  LuLockKeyhole,
  LuRefreshCw,
  LuHistory,
} from 'react-icons/lu';
import { api } from '../lib/api';
import { formatRelative, getMethodName, statusLabel, statusTone } from '../lib/format';
import { Badge, Button, Card, EmptyState, Skeleton, StatusDot } from './ui/Primitives';

const STANDARDS = [
  {
    icon: LuShieldCheck,
    title: 'NIST 800-88 Rev. 1',
    text: 'Clear, purge and verify workflow with documented outcomes for every device.',
  },
  {
    icon: LuLockKeyhole,
    title: 'Cryptographic erasure',
    text: 'Key destruction for self-encrypting SSDs and NVMe media — instant and irreversible.',
  },
  {
    icon: LuFileCheck,
    title: 'Signed certificates',
    text: 'RSA-2048 signatures over PDF and JSON evidence, verifiable offline at any time.',
  },
  {
    icon: LuActivity,
    title: 'Full audit trail',
    text: 'Every enumeration, wipe and failure is written to an immutable audit log.',
  },
];

function StatCard({ icon: Icon, label, value, sub, tone = 'brand', loading }) {
  return (
    <div className={`stat stat--${tone}`}>
      <span className="stat__icon" aria-hidden="true">
        <Icon />
      </span>
      <div className="stat__body">
        <p className="stat__label">{label}</p>
        {loading ? (
          <Skeleton w={64} h={30} r="var(--r-sm)" />
        ) : (
          <p className="stat__value">{value}</p>
        )}
        {sub && !loading && <p className="stat__sub">{sub}</p>}
      </div>
    </div>
  );
}

export default function Dashboard({ onNavigate, onViewCertificate }) {
  const [stats, setStats] = useState({ drives: 0, sessions: [], certificates: [] });
  const [loading, setLoading] = useState(true);
  const [driveError, setDriveError] = useState('');

  const load = async () => {
    setLoading(true);
    setDriveError('');

    // Each panel degrades independently: a slow drive probe must not blank the
    // certificate counts, so failures are captured per request.
    const [drivesRes, sessionsRes, certsRes] = await Promise.allSettled([
      api.listDrives(),
      api.listSessions(10),
      api.listCertificates(),
    ]);

    const drives =
      drivesRes.status === 'fulfilled' && Array.isArray(drivesRes.value?.drives)
        ? drivesRes.value.drives
        : [];
    if (drivesRes.status === 'rejected') {
      setDriveError(drivesRes.reason?.message || 'Drive enumeration failed.');
    }

    setStats({
      drives: drives.length,
      sessions: sessionsRes.status === 'fulfilled' && Array.isArray(sessionsRes.value) ? sessionsRes.value : [],
      certificates:
        certsRes.status === 'fulfilled' && Array.isArray(certsRes.value?.certificates)
          ? certsRes.value.certificates
          : [],
    });
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const completed = stats.sessions.filter((s) => s.status === 'completed').length;
  const recent = stats.sessions.slice(0, 5);
  const recentCerts = stats.certificates.slice(0, 4);

  return (
    <div className="page page--dashboard">
      {/* Hero -------------------------------------------------------------- */}
      <section className="hero">
        <div className="hero__glow" aria-hidden="true" />
        <div className="hero__content">
          <Badge tone="brand" icon={LuShieldCheck}>
            NIST 800-88 compliant
          </Badge>
          <h2 className="hero__title">
            Erase with certainty.
            <br />
            Prove it with evidence.
          </h2>
          <p className="hero__text">
            ZeroTrace sanitises drives to recognised government and defence standards, then issues a
            cryptographically signed certificate that stands up to audit.
          </p>
          <div className="hero__actions">
            <Button variant="primary" size="lg" icon={LuHardDrive} iconRight={LuArrowRight} onClick={() => onNavigate('devices')}>
              Start secure erasure
            </Button>
            <Button variant="ghost" size="lg" icon={LuScrollText} onClick={() => onNavigate('reports')}>
              View certificates
            </Button>
          </div>
        </div>
        <div className="hero__panel" aria-hidden="true">
          <div className="hero__panel-head">
            <StatusDot tone="success" pulse />
            <span>Sanitisation engine</span>
          </div>
          <ul className="hero__checks">
            <li><LuCircleCheck /> Device detection</li>
            <li><LuCircleCheck /> Overwrite &amp; verify</li>
            <li><LuCircleCheck /> Certificate signing</li>
            <li><LuCircleCheck /> Audit logging</li>
          </ul>
          <div className="hero__meter">
            <span className="hero__meter-label">Integrity</span>
            <span className="hero__meter-bar"><i style={{ width: '100%' }} /></span>
            <span className="hero__meter-value">100%</span>
          </div>
        </div>
      </section>

      {/* Stats ------------------------------------------------------------- */}
      <section className="stat-grid">
        <StatCard
          icon={LuHardDrive}
          label="Drives detected"
          value={stats.drives}
          sub={stats.drives === 1 ? '1 device available' : `${stats.drives} devices available`}
          tone="brand"
          loading={loading}
        />
        <StatCard
          icon={LuCircleCheck}
          label="Wipes completed"
          value={completed}
          sub={`${stats.sessions.length} total session${stats.sessions.length === 1 ? '' : 's'}`}
          tone="success"
          loading={loading}
        />
        <StatCard
          icon={LuScrollText}
          label="Certificates issued"
          value={stats.certificates.length}
          sub="PDF and JSON evidence"
          tone="info"
          loading={loading}
        />
        <StatCard
          icon={LuZap}
          label="Methods available"
          value={8}
          sub="Software and hardware"
          tone="warn"
          loading={loading}
        />
      </section>

      {driveError && (
        <div className="alert alert--warn">
          <span className="alert__icon" aria-hidden="true"><LuTriangleAlert /></span>
          <div className="alert__body">
            <p className="alert__title">Drive enumeration had trouble</p>
            <div className="alert__text">{driveError}</div>
            <div className="alert__actions">
              <Button size="sm" variant="outline" icon={LuRefreshCw} onClick={load}>Retry</Button>
            </div>
          </div>
        </div>
      )}

      {/* Two-column ---------------------------------------------------------*/}
      <div className="dash-grid">
        <Card className="card--flush">
          <header className="card__header">
            <span className="card__header-icon" aria-hidden="true"><LuHistory /></span>
            <div className="card__header-text">
              <h3 className="card__title">Recent activity</h3>
              <p className="card__desc">Latest sanitisation sessions</p>
            </div>
            <div className="card__header-actions">
              <Button size="sm" variant="ghost" icon={LuRefreshCw} onClick={load} loading={loading}>
                Refresh
              </Button>
            </div>
          </header>

          <div className="card__content">
            {loading ? (
              <ul className="activity">
                {[0, 1, 2].map((i) => (
                  <li className="activity__row" key={i}>
                    <Skeleton w={34} h={34} r="var(--r-md)" />
                    <div style={{ flex: 1, display: 'grid', gap: 6 }}>
                      <Skeleton w="46%" h={13} />
                      <Skeleton w="26%" h={11} />
                    </div>
                  </li>
                ))}
              </ul>
            ) : recent.length === 0 ? (
              <EmptyState
                icon={LuHistory}
                title="No sessions yet"
                description="Once you run a device erasure it will appear here with its status and certificate."
                action={
                  <Button variant="primary" size="sm" icon={LuHardDrive} onClick={() => onNavigate('devices')}>
                    Select a drive
                  </Button>
                }
              />
            ) : (
              <ul className="activity">
                {recent.map((s) => (
                  <li className="activity__row" key={s.id}>
                    <span className={`activity__icon activity__icon--${statusTone(s.status)}`} aria-hidden="true">
                      {s.status === 'completed' ? <LuCircleCheck /> : s.status === 'failed' ? <LuTriangleAlert /> : <LuActivity />}
                    </span>
                    <div className="activity__body">
                      <p className="activity__title">
                        {getMethodName(s.method)}
                        <span className="activity__id">#{s.id}</span>
                      </p>
                      <p className="activity__meta">
                        {s.passes} pass{s.passes === 1 ? '' : 'es'}
                        {s.started_at && ` · ${formatRelative(s.started_at)}`}
                      </p>
                    </div>
                    <Badge tone={statusTone(s.status)} size="sm">{statusLabel(s.status)}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>

        <Card className="card--flush">
          <header className="card__header">
            <span className="card__header-icon" aria-hidden="true"><LuScrollText /></span>
            <div className="card__header-text">
              <h3 className="card__title">Latest certificates</h3>
              <p className="card__desc">Signed proof of destruction</p>
            </div>
            <div className="card__header-actions">
              <Button size="sm" variant="ghost" iconRight={LuArrowRight} onClick={() => onNavigate('reports')}>
                View all
              </Button>
            </div>
          </header>

          <div className="card__content">
            {loading ? (
              <ul className="activity">
                {[0, 1, 2].map((i) => (
                  <li className="activity__row" key={i}>
                    <Skeleton w={34} h={34} r="var(--r-md)" />
                    <div style={{ flex: 1, display: 'grid', gap: 6 }}>
                      <Skeleton w="58%" h={13} />
                      <Skeleton w="30%" h={11} />
                    </div>
                  </li>
                ))}
              </ul>
            ) : recentCerts.length === 0 ? (
              <EmptyState
                icon={LuScrollText}
                title="No certificates yet"
                description="Completing an erasure automatically issues a signed PDF and JSON certificate."
              />
            ) : (
              <ul className="activity">
                {recentCerts.map((c) => (
                  <li className="activity__row activity__row--button" key={c.filename}>
                    <button type="button" className="activity__hit" onClick={() => onViewCertificate(c)}>
                      <span className={`activity__icon activity__icon--${c.type === 'PDF' ? 'danger' : 'info'}`} aria-hidden="true">
                        <LuScrollText />
                      </span>
                      <span className="activity__body">
                        <span className="activity__title zt-truncate">{c.filename}</span>
                        <span className="activity__meta">
                          {c.type} · {formatRelative(c.created)}
                        </span>
                      </span>
                      <LuArrowRight className="activity__chevron" aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>
      </div>

      {/* Standards --------------------------------------------------------- */}
      <section className="standards">
        <div className="standards__head">
          <h3>Built for compliance</h3>
          <p>Every capability maps to a recognised sanitisation standard.</p>
        </div>
        <div className="standards__grid">
          {STANDARDS.map((s) => {
            const Icon = s.icon;
            return (
              <article className="standard" key={s.title}>
                <span className="standard__icon" aria-hidden="true"><Icon /></span>
                <h4 className="standard__title">{s.title}</h4>
                <p className="standard__text">{s.text}</p>
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}
