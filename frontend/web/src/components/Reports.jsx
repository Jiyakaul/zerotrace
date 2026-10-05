import React, { useCallback, useEffect, useState } from 'react';
import {
  LuScrollText,
  LuDownload,
  LuHistory,
  LuRefreshCw,
  LuTriangleAlert,
  LuFileJson,
  LuEye,
  LuHardDrive,
  LuCircleCheck,
  LuActivity,
  LuFileKey,
  LuSearch,
} from 'react-icons/lu';
import { api, sessionUrls, certificateUrls } from '../lib/api';
import {
  formatBytes,
  formatDate,
  formatDuration,
  formatRelative,
  getMethodName,
  statusLabel,
  statusTone,
} from '../lib/format';
import { Badge, Button, EmptyState, IconButton, LoadingPanel, Segmented } from './ui/Primitives';
import { useToast } from './ui/Toast';

export default function Reports({ onViewCertificate, onNavigate }) {
  const [sessions, setSessions] = useState([]);
  const [certificates, setCertificates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('certificates');
  const [query, setQuery] = useState('');
  const toast = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    const [sessionsRes, certsRes] = await Promise.allSettled([
      api.listSessions(50),
      api.listCertificates(),
    ]);

    if (sessionsRes.status === 'fulfilled' && Array.isArray(sessionsRes.value)) {
      setSessions(sessionsRes.value);
    } else if (sessionsRes.status === 'rejected') {
      setError(sessionsRes.reason?.message || 'Failed to load wipe sessions');
    }

    if (certsRes.status === 'fulfilled' && Array.isArray(certsRes.value?.certificates)) {
      setCertificates(certsRes.value.certificates);
    }

    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const openFile = (url, label) => {
    const win = window.open(url, '_blank', 'noopener');
    if (!win) toast.info('Popup blocked', `Allow popups to open the ${label}.`);
  };

  const filteredCerts = certificates.filter((c) =>
    query.trim() ? c.filename.toLowerCase().includes(query.trim().toLowerCase()) : true
  );

  return (
    <div className="page page--reports">
      <section className="card card--flush">
        <header className="card__header card__header--tabs">
          <Segmented
            ariaLabel="Report view"
            value={tab}
            onChange={setTab}
            options={[
              { value: 'certificates', label: 'Certificates', icon: LuScrollText, count: certificates.length },
              { value: 'sessions', label: 'Wipe sessions', icon: LuHistory, count: sessions.length },
            ]}
          />
          <div className="card__header-actions">
            {tab === 'certificates' && certificates.length > 4 && (
              <div className="search">
                <LuSearch className="search__icon" aria-hidden="true" />
                <input
                  className="search__input"
                  type="search"
                  placeholder="Filter certificates"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  aria-label="Filter certificates"
                />
              </div>
            )}
            <Button size="sm" variant="outline" icon={LuRefreshCw} onClick={load} loading={loading}>
              Refresh
            </Button>
          </div>
        </header>

        <div className="card__content">
          {loading ? (
            <LoadingPanel label="Loading reports" rows={4} />
          ) : tab === 'certificates' ? (
            filteredCerts.length === 0 ? (
              <EmptyState
                icon={LuScrollText}
                title={query ? 'No matching certificates' : 'No certificates yet'}
                description={
                  query
                    ? 'No certificate filename matches your search.'
                    : 'Certificates are issued automatically when an erasure completes. Run a wipe to generate your first one.'
                }
                action={
                  query ? (
                    <Button variant="outline" onClick={() => setQuery('')}>Clear filter</Button>
                  ) : (
                    <Button variant="primary" icon={LuHardDrive} onClick={() => onNavigate('devices')}>
                      Start an erasure
                    </Button>
                  )
                }
              />
            ) : (
              <ul className="cert-grid">
                {filteredCerts.map((cert) => {
                  const isPdf = cert.type === 'PDF';
                  return (
                    <li className="cert" key={cert.filename}>
                      <div className="cert__top">
                        <span
                          className={`cert__icon cert__icon--${isPdf ? 'danger' : 'info'}`}
                          aria-hidden="true"
                        >
                          {isPdf ? <LuScrollText /> : <LuFileJson />}
                        </span>
                        <div className="cert__ident">
                          <p className="cert__name zt-truncate" title={cert.filename}>
                            {cert.filename}
                          </p>
                          <p className="cert__sub">
                            <Badge tone={isPdf ? 'danger' : 'info'} size="sm">{cert.type}</Badge>
                            <span>{formatBytes(cert.size)}</span>
                          </p>
                        </div>
                      </div>

                      <dl className="cert__meta">
                        <div>
                          <dt>Issued</dt>
                          <dd>{formatDate(cert.created)}</dd>
                        </div>
                        <div>
                          <dt>Age</dt>
                          <dd>{formatRelative(cert.created)}</dd>
                        </div>
                      </dl>

                      <div className="cert__actions">
                        <Button size="sm" variant="secondary" icon={LuEye} onClick={() => onViewCertificate(cert)}>
                          Inspect
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          icon={LuDownload}
                          onClick={() => openFile(certificateUrls.file(cert.filename), 'certificate')}
                        >
                          Download
                        </Button>
                        <IconButton
                          icon={LuFileKey}
                          label="Download detached signature"
                          variant="outline"
                          onClick={() => openFile(certificateUrls.signature(cert.filename), 'signature')}
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )
          ) : error ? (
            <EmptyState
              icon={LuTriangleAlert}
              tone="danger"
              title="Could not load sessions"
              description={error}
              action={<Button variant="primary" icon={LuRefreshCw} onClick={load}>Try again</Button>}
            />
          ) : sessions.length === 0 ? (
            <EmptyState
              icon={LuHistory}
              title="No wipe sessions recorded"
              description="Device erasures are logged here with their method, duration and outcome. File-level wipes issue certificates without creating a session."
              action={
                <Button variant="primary" icon={LuHardDrive} onClick={() => onNavigate('devices')}>
                  Start an erasure
                </Button>
              }
            />
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Session</th>
                    <th scope="col">Method</th>
                    <th scope="col">Passes</th>
                    <th scope="col">Status</th>
                    <th scope="col">Started</th>
                    <th scope="col">Duration</th>
                    <th scope="col" className="table__right">Evidence</th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.map((s) => (
                    <tr key={s.id}>
                      <td><span className="mono table__id">#{s.id}</span></td>
                      <td><span className="table__strong">{getMethodName(s.method)}</span></td>
                      <td>{s.passes}</td>
                      <td>
                        <Badge
                          tone={statusTone(s.status)}
                          size="sm"
                          icon={
                            s.status === 'completed'
                              ? LuCircleCheck
                              : s.status === 'failed'
                              ? LuTriangleAlert
                              : LuActivity
                          }
                        >
                          {statusLabel(s.status)}
                        </Badge>
                      </td>
                      <td className="table__muted">{formatDate(s.started_at)}</td>
                      <td className="table__muted">{formatDuration(s.duration_seconds)}</td>
                      <td className="table__right">
                        {s.status === 'completed' && s.report_path ? (
                          <div className="table__actions">
                            <IconButton
                              icon={LuScrollText}
                              label={`Download PDF report for session ${s.id}`}
                              variant="outline"
                              onClick={() => openFile(sessionUrls.pdf(s.id), 'PDF report')}
                            />
                            <IconButton
                              icon={LuFileJson}
                              label={`Download JSON certificate for session ${s.id}`}
                              variant="outline"
                              onClick={() => openFile(sessionUrls.json(s.id), 'JSON certificate')}
                            />
                            {s.signature_path && (
                              <IconButton
                                icon={LuFileKey}
                                label={`Download signature for session ${s.id}`}
                                variant="outline"
                                onClick={() => openFile(sessionUrls.signature(s.id), 'signature')}
                              />
                            )}
                          </div>
                        ) : s.status === 'failed' ? (
                          <span className="table__error zt-truncate" title={s.error_message || 'Unknown error'}>
                            {s.error_message || 'Unknown error'}
                          </span>
                        ) : (
                          <span className="table__muted">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      <section className="info-strip">
        <div className="info-strip__item">
          <span className="info-strip__icon" aria-hidden="true"><LuScrollText /></span>
          <div>
            <h4>PDF certificates</h4>
            <p>Human-readable evidence with device details, hashes and an embedded verification QR code.</p>
          </div>
        </div>
        <div className="info-strip__item">
          <span className="info-strip__icon" aria-hidden="true"><LuFileKey /></span>
          <div>
            <h4>Detached signatures</h4>
            <p>PKCS#7 (.p7s) for PDFs and RSA-PSS (.sig) for JSON, verifiable without ZeroTrace.</p>
          </div>
        </div>
        <div className="info-strip__item">
          <span className="info-strip__icon" aria-hidden="true"><LuCircleCheck /></span>
          <div>
            <h4>Audit ready</h4>
            <p>Records align with NIST 800-88 and DoD 5220.22-M reporting expectations.</p>
          </div>
        </div>
      </section>
    </div>
  );
}
