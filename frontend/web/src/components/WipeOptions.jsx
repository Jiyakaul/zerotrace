import React, { useEffect, useMemo, useState } from 'react';
import {
  LuArrowLeft,
  LuTriangleAlert,
  LuInfo,
  LuSparkles,
  LuClock,
  LuHardDrive,
  LuFlame,
  LuShieldCheck,
  LuShieldAlert,
} from 'react-icons/lu';
import {
  deviceRequiresElevation,
  formatBytes,
  getDeviceType,
  getMethodMeta,
  MULTI_PASS_METHODS,
} from '../lib/format';
import AdminGate from './AdminGate';
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Field,
  Modal,
  Select,
  TextInput,
} from './ui/Primitives';
import { useToast } from './ui/Toast';

const CONFIRM_PHRASE = 'ERASE';

function StrengthMeter({ level }) {
  return (
    <span className="strength" title={`Strength ${level} of 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} className={`strength__bar${i <= level ? ' is-on' : ''}`} />
      ))}
    </span>
  );
}

export default function WipeOptions({
  selectedDevices,
  availableMethods,
  onStart,
  onBack,
  isLoading,
  system = {},
  elevationPhase = 'idle',
  elevationMessage = '',
  onElevate,
  onDismissElevationError,
}) {
  const [method, setMethod] = useState('');
  const [passes, setPasses] = useState(1);
  const [acknowledged, setAcknowledged] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const toast = useToast();

  // Does any selected target need raw device access?
  const needsAdmin = useMemo(
    () => selectedDevices.some((d) => deviceRequiresElevation(d.path)),
    [selectedDevices]
  );
  const isAdmin = Boolean(system.is_admin);
  const elevationBlocking = needsAdmin && !isAdmin;

  // Resolve the phase the gate should render.
  const gatePhase = !needsAdmin
    ? null
    : isAdmin
    ? 'granted'
    : ['pending', 'restarting', 'denied', 'failed', 'unsupported'].includes(elevationPhase)
    ? elevationPhase
    : system.elevation_supported === false
    ? 'unsupported'
    : 'required';

  const elevating = gatePhase === 'pending' || gatePhase === 'restarting';

  // Recommend crypto erase for solid-state media, NIST otherwise.
  const recommended = useMemo(() => {
    const solidState = selectedDevices.some((d) => d.type === 'ssd' || d.type === 'nvme');
    return solidState ? 'crypto_erase' : 'nist_800_88';
  }, [selectedDevices]);

  useEffect(() => {
    if (availableMethods.length > 0 && !method) setMethod(recommended);
  }, [availableMethods, method, recommended]);

  const meta = method ? getMethodMeta(method) : null;
  const supportsPasses = MULTI_PASS_METHODS.includes(method);

  const totalBytes = selectedDevices.reduce((sum, d) => {
    const n = parseInt(d.size, 10);
    return sum + (Number.isNaN(n) ? 0 : n);
  }, 0);

  const openConfirm = () => {
    if (!method) {
      toast.warn('Select a method', 'Choose how the drive should be sanitised.');
      return;
    }
    if (elevationBlocking) {
      toast.warn(
        'Administrator privileges required',
        'Grant them with Run as Administrator, then confirm the erasure.'
      );
      return;
    }
    if (!acknowledged) {
      toast.warn('Acknowledgement required', 'Confirm you understand the data will be destroyed.');
      return;
    }
    setConfirmText('');
    setConfirmOpen(true);
  };

  const confirmValid = confirmText.trim().toUpperCase() === CONFIRM_PHRASE;

  const doStart = () => {
    if (!confirmValid) return;
    setConfirmOpen(false);
    onStart(method, passes);
  };

  return (
    <div className="page page--options">
      {gatePhase && (
        <AdminGate
          phase={gatePhase}
          message={elevationMessage}
          supported={system.elevation_supported !== false}
          onElevate={onElevate}
          onDismissError={onDismissElevationError}
        />
      )}

      <div className="options-layout">
        {/* Method selection -------------------------------------------------*/}
        <section className="card card--flush">
          <header className="card__header">
            <span className="card__header-icon" aria-hidden="true"><LuShieldCheck /></span>
            <div className="card__header-text">
              <h3 className="card__title">Sanitisation method</h3>
              <p className="card__desc">Pick the standard that matches your compliance requirement</p>
            </div>
          </header>

          <div className="card__content">
            <div className="method-list" role="radiogroup" aria-label="Sanitisation method">
              {availableMethods.map((m) => {
                const info = getMethodMeta(m.id);
                const active = method === m.id;
                const isRecommended = m.id === recommended;
                return (
                  <button
                    key={m.id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    className={`method${active ? ' is-active' : ''}`}
                    onClick={() => setMethod(m.id)}
                  >
                    <span className="method__radio" aria-hidden="true" />
                    <span className="method__body">
                      <span className="method__top">
                        <span className="method__name">{info.name}</span>
                        {isRecommended && (
                          <Badge tone="brand" size="sm" icon={LuSparkles}>Recommended</Badge>
                        )}
                        {info.tags.map((t) => (
                          <Badge key={t} tone="neutral" size="sm">{t}</Badge>
                        ))}
                      </span>
                      <span className="method__desc">{info.description}</span>
                      <span className="method__foot">
                        <span className="method__stat">
                          <LuClock aria-hidden="true" /> {info.speed}
                        </span>
                        <span className="method__stat">
                          <LuFlame aria-hidden="true" /> Strength
                          <StrengthMeter level={info.strength} />
                        </span>
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </section>

        {/* Summary sidebar --------------------------------------------------*/}
        <aside className="options-side">
          <section className="card card--flush">
            <header className="card__header">
              <span className="card__header-icon" aria-hidden="true"><LuHardDrive /></span>
              <div className="card__header-text">
                <h3 className="card__title">Target{selectedDevices.length === 1 ? '' : 's'}</h3>
                <p className="card__desc">{formatBytes(totalBytes)} total capacity</p>
              </div>
            </header>
            <div className="card__content">
              <ul className="target-list">
                {selectedDevices.map((d, i) => {
                  const t = getDeviceType(d.type);
                  return (
                    <li className="target" key={d.path || i}>
                      <span className={`target__dot target__dot--${t.tone}`} aria-hidden="true" />
                      <span className="target__body">
                        <span className="target__name zt-truncate">{d.name || d.model || 'Unknown'}</span>
                        <span className="target__path mono zt-truncate">{d.path}</span>
                      </span>
                      <Badge tone={t.tone} size="sm">{t.label}</Badge>
                    </li>
                  );
                })}
              </ul>
            </div>
          </section>

          {meta && (
            <section className="card card--flush">
              <header className="card__header">
                <span className="card__header-icon" aria-hidden="true"><LuInfo /></span>
                <div className="card__header-text">
                  <h3 className="card__title">Configuration</h3>
                  <p className="card__desc">{meta.tagline}</p>
                </div>
              </header>
              <div className="card__content options-config">
                {supportsPasses ? (
                  <Field
                    label="Overwrite passes"
                    htmlFor="passes"
                    hint="More passes take longer with diminishing returns on modern drives."
                  >
                    <Select
                      id="passes"
                      value={passes}
                      onChange={(e) => setPasses(parseInt(e.target.value, 10))}
                    >
                      <option value={1}>1 pass</option>
                      <option value={3}>3 passes</option>
                      {method === 'gutmann' && <option value={35}>35 passes (full Gutmann)</option>}
                    </Select>
                  </Field>
                ) : (
                  <div className="config-note">
                    <LuInfo aria-hidden="true" />
                    <p>
                      {meta.name} runs a fixed procedure — no pass count to configure.
                    </p>
                  </div>
                )}

                {method === 'crypto_erase' && (
                  <Alert tone="info" icon={LuSparkles} title="Fastest option for SSDs">
                    Cryptographic erasure discards the drive encryption key, rendering every block
                    unreadable in seconds without wearing the flash cells.
                  </Alert>
                )}
                {method === 'gutmann' && (
                  <Alert tone="warn" icon={LuClock} title="This will take a very long time">
                    35 passes was designed for 1990s magnetic encodings. On modern media a single
                    pass or a hardware erase is equally effective.
                  </Alert>
                )}
              </div>
            </section>
          )}

          <section className="card card--danger card--flush">
            <header className="card__header">
              <span className="card__header-icon card__header-icon--danger" aria-hidden="true">
                <LuTriangleAlert />
              </span>
              <div className="card__header-text">
                <h3 className="card__title">Point of no return</h3>
                <p className="card__desc">Read before continuing</p>
              </div>
            </header>
            <div className="card__content">
              <ul className="danger-list">
                <li>All data on the selected drives is destroyed permanently.</li>
                <li>Recovery is impossible — including by forensic laboratories.</li>
                <li>Back up anything you need before you start.</li>
                <li>Confirm the drive path matches the device you intend to erase.</li>
              </ul>

              <Checkbox
                id="ack"
                tone="danger"
                checked={acknowledged}
                onChange={(e) => setAcknowledged(e.target.checked)}
                label="I understand this permanently destroys all data"
                description="I have backed up anything important and verified the target drives."
              />
            </div>
          </section>

          {elevationBlocking && (
            <p className="options-blocked" role="status">
              <LuShieldAlert aria-hidden="true" />
              Administrator privileges are needed before this drive can be erased.
            </p>
          )}

          <div className="options-actions">
            <Button variant="ghost" icon={LuArrowLeft} onClick={onBack} disabled={isLoading} full>
              Back
            </Button>
            <Button
              variant="danger"
              icon={LuFlame}
              onClick={openConfirm}
              disabled={!method || !acknowledged || isLoading || elevationBlocking || elevating}
              loading={isLoading}
              title={
                elevationBlocking
                  ? 'Administrator privileges are required before this drive can be erased'
                  : undefined
              }
              full
            >
              Start secure erasure
            </Button>
          </div>
        </aside>
      </div>

      {/* Type-to-confirm dialog --------------------------------------------*/}
      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        tone="danger"
        icon={LuTriangleAlert}
        title="Confirm permanent erasure"
        description="This action cannot be undone or interrupted safely."
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmOpen(false)}>Cancel</Button>
            <Button variant="danger" icon={LuFlame} onClick={doStart} disabled={!confirmValid}>
              Erase {selectedDevices.length} drive{selectedDevices.length === 1 ? '' : 's'}
            </Button>
          </>
        }
      >
        <ul className="confirm-summary">
          <li>
            <span>Method</span>
            <strong>{meta?.name}</strong>
          </li>
          <li>
            <span>Passes</span>
            <strong>{supportsPasses ? passes : 'Fixed'}</strong>
          </li>
          <li>
            <span>Capacity</span>
            <strong>{formatBytes(totalBytes)}</strong>
          </li>
        </ul>

        <ul className="confirm-targets">
          {selectedDevices.map((d, i) => (
            <li key={d.path || i}>
              <LuHardDrive aria-hidden="true" />
              <span className="mono zt-truncate">{d.path}</span>
            </li>
          ))}
        </ul>

        <Field
          label={`Type ${CONFIRM_PHRASE} to confirm`}
          htmlFor="confirm-phrase"
          hint="This safeguard prevents accidental destruction of the wrong drive."
        >
          <TextInput
            id="confirm-phrase"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && confirmValid) doStart();
            }}
            placeholder={CONFIRM_PHRASE}
            autoComplete="off"
            spellCheck="false"
            aria-invalid={confirmText.length > 0 && !confirmValid}
          />
        </Field>
      </Modal>
    </div>
  );
}
