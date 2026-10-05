import React, { useCallback, useEffect, useState } from 'react';
import {
  LuArrowLeft,
  LuDownload,
  LuShieldCheck,
  LuCircleCheck,
  LuCircleX,
  LuEye,
  LuCode,
  LuFileKey,
  LuTriangleAlert,
  LuExternalLink,
  LuFingerprint,
  LuHardDrive,
  LuScrollText,
  LuBadgeCheck,
  LuLoaderCircle,
} from 'react-icons/lu';
import { api, certificateUrls } from '../lib/api';
import { formatBytes, formatDate, getMethodName } from '../lib/format';
import {
  Alert,
  Badge,
  Button,
  CopyValue,
  EmptyState,
  IconButton,
  LoadingPanel,
  Segmented,
} from './ui/Primitives';
import { useToast } from './ui/Toast';

function Section({ icon: Icon, title, children }) {
  return (
    <section className="cert-section">
      <header className="cert-section__head">
        <span className="cert-section__icon" aria-hidden="true"><Icon /></span>
        <h3>{title}</h3>
      </header>
      <div className="cert-section__body">{children}</div>
    </section>
  );
}

function Row({ label, children, wide = false }) {
  return (
    <div className={`cert-row${wide ? ' cert-row--wide' : ''}`}>
      <dt className="cert-row__label">{label}</dt>
      <dd className="cert-row__value">{children}</dd>
    </div>
  );
}

export default function CertificateViewer({ certificate, onBack }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [view, setView] = useState('formatted');
  const [verifying, setVerifying] = useState(false);
  const [verification, setVerification] = useState(null);
  const toast = useToast();

  const isJson = certificate?.type === 'JSON';
  const fileUrl = certificate ? certificateUrls.file(certificate.filename) : '';
  const sigUrl = certificate ? certificateUrls.signature(certificate.filename) : '';

  const load = useCallback(async () => {
    if (!certificate) return;
    if (!isJson) {
      // PDFs are rendered by the browser rather than parsed here.
      setData(null);
      return;
    }

    setLoading(true);
    setError('');
    try {
      // The certificates listing exposes filenames, not database session ids -
      // read the artefact straight from the static /reports mount.
      const res = await fetch(certificateUrls.file(certificate.filename));
      if (!res.ok) throw new Error(`Could not read certificate (HTTP ${res.status})`);
      setData(await res.json());
    } catch (err) {
      setError(err.message || 'Failed to load certificate data');
    } finally {
      setLoading(false);
    }
  }, [certificate, isJson]);

  useEffect(() => {
    load();
  }, [load]);

  const verify = async () => {
    if (!certificate?.path) return;
    setVerifying(true);
    setVerification(null);
    try {
      const result = await api.verifyCertificate(certificate.path, !isJson);
      setVerification(result);
      if (result?.valid) toast.success('Signature valid', 'This certificate is authentic and untampered.');
      else toast.error('Verification failed', result?.error || 'The signature could not be validated.');
    } catch (err) {
      const result = { valid: false, error: err.message || 'Verification request failed' };
      setVerification(result);
      toast.error('Verification failed', result.error);
    } finally {
      setVerifying(false);
    }
  };

  const open = (url, label) => {
    const win = window.open(url, '_blank', 'noopener');
    if (!win) toast.info('Popup blocked', `Allow popups to open the ${label}.`);
  };

  if (!certificate) {
    return (
      <div className="page">
        <EmptyState
          icon={LuScrollText}
          title="No certificate selected"
          description="Pick a certificate from the certificates list to inspect it."
          action={<Button variant="primary" icon={LuArrowLeft} onClick={onBack}>Back to certificates</Button>}
        />
      </div>
    );
  }

  const cert = data?.certificate;
  const device = data?.device;
  const op = data?.wipe_operation;
  const ver = data?.verification;
  const sig = data?.digital_signature;
  const compliance = data?.compliance;

  return (
    <div className="page page--certificate">
      {/* Toolbar ---------------------------------------------------------- */}
      <div className="cert-toolbar">
        <div className="cert-toolbar__ident">
          <span className={`cert-toolbar__icon cert-toolbar__icon--${isJson ? 'info' : 'danger'}`} aria-hidden="true">
            <LuScrollText />
          </span>
          <div>
            <p className="cert-toolbar__name zt-truncate" title={certificate.filename}>{certificate.filename}</p>
            <p className="cert-toolbar__meta">
              <Badge tone={isJson ? 'info' : 'danger'} size="sm">{certificate.type}</Badge>
              <span>{formatBytes(certificate.size)}</span>
              <span>·</span>
              <span>{formatDate(certificate.created)}</span>
            </p>
          </div>
        </div>

        <div className="cert-toolbar__actions">
          {isJson && (
            <Segmented
              ariaLabel="Certificate view mode"
              size="sm"
              value={view}
              onChange={setView}
              options={[
                { value: 'formatted', label: 'Formatted', icon: LuEye },
                { value: 'raw', label: 'Raw JSON', icon: LuCode },
              ]}
            />
          )}
          <Button variant="secondary" icon={LuShieldCheck} onClick={verify} loading={verifying}>
            Verify signature
          </Button>
          <Button variant="primary" icon={LuDownload} onClick={() => open(fileUrl, 'certificate')}>
            Download
          </Button>
          <IconButton
            icon={LuFileKey}
            label="Download detached signature"
            variant="outline"
            onClick={() => open(sigUrl, 'signature')}
          />
        </div>
      </div>

      {/* Verification banner ----------------------------------------------- */}
      {verifying && (
        <div className="verify-banner verify-banner--pending">
          <LuLoaderCircle className="spinner" aria-hidden="true" />
          <div>
            <p className="verify-banner__title">Checking cryptographic signature…</p>
            <p className="verify-banner__text">Comparing the stored signature against the certificate contents.</p>
          </div>
        </div>
      )}

      {!verifying && verification && (
        <div className={`verify-banner verify-banner--${verification.valid ? 'valid' : 'invalid'}`}>
          <span className="verify-banner__icon" aria-hidden="true">
            {verification.valid ? <LuBadgeCheck /> : <LuCircleX />}
          </span>
          <div>
            <p className="verify-banner__title">
              {verification.valid ? 'Signature verified' : 'Signature verification failed'}
            </p>
            <p className="verify-banner__text">
              {verification.valid
                ? verification.message || 'This certificate is authentic and has not been modified.'
                : verification.error || 'The certificate could not be validated.'}
            </p>
          </div>
        </div>
      )}

      {/* Body -------------------------------------------------------------- */}
      {loading ? (
        <div className="card"><div className="card__content"><LoadingPanel label="Loading certificate" rows={3} /></div></div>
      ) : error ? (
        <div className="card">
          <div className="card__content">
            <EmptyState
              icon={LuTriangleAlert}
              tone="danger"
              title="Could not read this certificate"
              description={error}
              action={<Button variant="primary" onClick={load}>Try again</Button>}
            />
          </div>
        </div>
      ) : !isJson ? (
        <section className="card card--flush">
          <header className="card__header">
            <span className="card__header-icon" aria-hidden="true"><LuScrollText /></span>
            <div className="card__header-text">
              <h3 className="card__title">Document preview</h3>
              <p className="card__desc">Rendered directly from the signed PDF</p>
            </div>
            <div className="card__header-actions">
              <Button size="sm" variant="ghost" icon={LuExternalLink} onClick={() => open(fileUrl, 'PDF')}>
                Open in new tab
              </Button>
            </div>
          </header>
          <div className="pdf-frame">
            <iframe src={fileUrl} title={`Preview of ${certificate.filename}`} />
          </div>
        </section>
      ) : view === 'raw' ? (
        <section className="card card--flush">
          <header className="card__header">
            <span className="card__header-icon" aria-hidden="true"><LuCode /></span>
            <div className="card__header-text">
              <h3 className="card__title">Raw certificate</h3>
              <p className="card__desc">Exactly as signed</p>
            </div>
          </header>
          <pre className="code-block"><code>{JSON.stringify(data, null, 2)}</code></pre>
        </section>
      ) : (
        <div className="cert-sections">
          <Section icon={LuScrollText} title="Certificate">
            <dl className="cert-rows">
              <Row label="Certificate ID"><CopyValue value={cert?.id} label="certificate ID" /></Row>
              <Row label="Type">{cert?.type || 'N/A'}</Row>
              <Row label="Issued">{formatDate(cert?.issued_at)}</Row>
              <Row label="Issuer">{cert?.issuer || 'N/A'}</Row>
              <Row label="Status">
                <Badge tone={cert?.status === 'valid' ? 'success' : 'neutral'} size="sm">
                  {cert?.status ? String(cert.status).toUpperCase() : 'N/A'}
                </Badge>
              </Row>
              <Row label="Version">{cert?.version || 'N/A'}</Row>
            </dl>
          </Section>

          <Section icon={LuHardDrive} title="Device">
            <dl className="cert-rows">
              <Row label="Path" wide><CopyValue value={device?.path} label="device path" truncate /></Row>
              <Row label="Type">{device?.type ? String(device.type).toUpperCase() : 'N/A'}</Row>
              <Row label="Model">{device?.model || 'N/A'}</Row>
              <Row label="Serial">{device?.serial || 'N/A'}</Row>
              <Row label="Capacity">{device?.size_formatted || formatBytes(device?.size_bytes)}</Row>
            </dl>
          </Section>

          <Section icon={LuShieldCheck} title="Erasure operation">
            <dl className="cert-rows">
              <Row label="Method">{op?.method_display || getMethodName(op?.method)}</Row>
              <Row label="Passes">{op?.passes ?? 'N/A'}</Row>
              <Row label="Started">{formatDate(op?.started_at)}</Row>
              <Row label="Completed">{formatDate(op?.completed_at)}</Row>
              <Row label="Duration">{op?.duration_formatted || 'N/A'}</Row>
              <Row label="Outcome">
                <Badge tone={op?.success ? 'success' : 'danger'} size="sm" icon={op?.success ? LuCircleCheck : LuCircleX}>
                  {op?.status ? String(op.status).toUpperCase() : 'N/A'}
                </Badge>
              </Row>
            </dl>
          </Section>

          {ver && (
            <Section icon={LuFingerprint} title="Verification hashes">
              <dl className="cert-rows">
                <Row label="SHA-256 before" wide>
                  <CopyValue value={ver.sha256_before} label="pre-wipe hash" truncate />
                </Row>
                <Row label="SHA-256 after" wide>
                  <CopyValue value={ver.sha256_after} label="post-wipe hash" truncate />
                </Row>
                <Row label="Data destroyed">
                  <Badge tone={ver.data_destroyed ? 'success' : 'danger'} size="sm" icon={ver.data_destroyed ? LuCircleCheck : LuCircleX}>
                    {ver.data_destroyed ? 'Confirmed' : 'Not confirmed'}
                  </Badge>
                </Row>
                <Row label="Checked">{formatDate(ver.verification_timestamp)}</Row>
              </dl>
            </Section>
          )}

          {sig && (
            <Section icon={LuFileKey} title="Digital signature">
              <dl className="cert-rows">
                <Row label="Algorithm">{sig.algorithm || 'N/A'}</Row>
                <Row label="Signed at">{formatDate(sig.signature_timestamp)}</Row>
                <Row label="Signature hash" wide>
                  <CopyValue value={sig.signature_hash} label="signature hash" truncate />
                </Row>
                <Row label="Key fingerprint" wide>
                  <CopyValue value={sig.public_key_fingerprint} label="key fingerprint" truncate />
                </Row>
                <Row label="Tamper evident">
                  <Badge tone={sig.tamper_proof ? 'success' : 'warn'} size="sm">
                    {sig.tamper_proof ? 'Yes' : 'No'}
                  </Badge>
                </Row>
              </dl>
            </Section>
          )}

          {compliance && (
            <Section icon={LuBadgeCheck} title="Compliance">
              <div className="compliance-badges">
                {(compliance.standards_met || []).length > 0 ? (
                  compliance.standards_met.map((s) => (
                    <Badge key={s} tone="brand" icon={LuBadgeCheck}>{s}</Badge>
                  ))
                ) : (
                  <span className="table__muted">No standards recorded</span>
                )}
              </div>
            </Section>
          )}
        </div>
      )}

      <div className="page__footer">
        <Button variant="ghost" icon={LuArrowLeft} onClick={onBack}>
          Back to certificates
        </Button>
        <p className="page__footer-note">
          Generated by ZeroTrace v1.0.0 · Tamper-evident certificate
        </p>
      </div>
    </div>
  );
}
