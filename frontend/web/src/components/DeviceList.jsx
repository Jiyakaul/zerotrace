import React, { useCallback, useEffect, useState } from 'react';
import {
  LuHardDrive,
  LuRefreshCw,
  LuTriangleAlert,
  LuArrowRight,
  LuArrowLeft,
  LuZap,
  LuUsb,
  LuServer,
  LuCircleAlert,
  LuSearch,
  LuCheck,
} from 'react-icons/lu';
import { api } from '../lib/api';
import { formatBytes, getDeviceType } from '../lib/format';
import { Badge, Button, EmptyState, LoadingPanel, Alert } from './ui/Primitives';
import { useToast } from './ui/Toast';

const DEMO_DEVICE = {
  name: 'Primary Drive',
  path: 'demo://drive0',
  type: 'ssd',
  size: String(256 * 1024 * 1024 * 1024),
  model: 'Demo Device',
  serial: '',
  is_removable: false,
  demo: true,
};

function deviceIcon(type, removable) {
  if (removable) return LuUsb;
  switch (String(type).toLowerCase()) {
    case 'nvme':
      return LuZap;
    case 'usb':
      return LuUsb;
    case 'hdd':
      return LuServer;
    default:
      return LuHardDrive;
  }
}

/** Guard against unexpected shapes coming back from OS enumeration. */
function sanitize(device) {
  return {
    name: device?.name || device?.model || 'Unknown Device',
    path: device?.path || 'demo://drive0',
    type: typeof device?.type === 'string' && device.type ? device.type : 'unknown',
    size: device?.size ?? device?.size_bytes ?? '0',
    model: device?.model || '',
    serial: device?.serial || device?.serial_number || '',
    is_removable: Boolean(device?.is_removable),
    demo: Boolean(device?.demo),
  };
}

export default function DeviceList({ onNext, onBack, initialSelection = [] }) {
  const [devices, setDevices] = useState([]);
  const [selected, setSelected] = useState(initialSelection);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const toast = useToast();

  const loadDevices = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api.listDrives();
      const list = Array.isArray(data?.drives) ? data.drives : [];
      // Preserve the original behaviour of falling back to a demo device so the
      // workflow stays explorable when enumeration returns nothing.
      setDevices(list.length > 0 ? list.map(sanitize) : [sanitize(DEMO_DEVICE)]);
    } catch (err) {
      setError(err.message || 'Failed to load devices');
      setDevices([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDevices();
  }, [loadDevices]);

  const toggle = (device) => {
    setSelected((prev) =>
      prev.find((d) => d.path === device.path)
        ? prev.filter((d) => d.path !== device.path)
        : [...prev, device]
    );
  };

  const handleNext = () => {
    if (selected.length === 0) {
      toast.warn('Select a drive', 'Choose at least one device before continuing.');
      return;
    }
    onNext(selected);
  };

  const filtered = devices.filter((d) => {
    if (!query.trim()) return true;
    const q = query.toLowerCase();
    return (
      d.name.toLowerCase().includes(q) ||
      d.path.toLowerCase().includes(q) ||
      d.type.toLowerCase().includes(q) ||
      String(d.serial).toLowerCase().includes(q)
    );
  });

  const totalBytes = selected.reduce((sum, d) => {
    const n = parseInt(d.size, 10);
    return sum + (Number.isNaN(n) ? 0 : n);
  }, 0);

  return (
    <div className="page page--devices">
      <Alert tone="danger" icon={LuTriangleAlert} title="Destructive operation">
        Selecting a drive here prepares it for permanent erasure. Data on a wiped device cannot be
        recovered by any means — verify the target carefully.
      </Alert>

      <section className="card card--flush">
        <header className="card__header">
          <span className="card__header-icon" aria-hidden="true"><LuHardDrive /></span>
          <div className="card__header-text">
            <h3 className="card__title">Detected drives</h3>
            <p className="card__desc">
              {loading
                ? 'Scanning connected storage…'
                : `${devices.length} device${devices.length === 1 ? '' : 's'} found`}
            </p>
          </div>
          <div className="card__header-actions">
            {devices.length > 3 && (
              <div className="search">
                <LuSearch className="search__icon" aria-hidden="true" />
                <input
                  className="search__input"
                  type="search"
                  placeholder="Filter drives"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  aria-label="Filter drives"
                />
              </div>
            )}
            <Button size="sm" variant="outline" icon={LuRefreshCw} onClick={loadDevices} loading={loading}>
              Rescan
            </Button>
          </div>
        </header>

        <div className="card__content">
          {loading ? (
            <LoadingPanel label="Loading devices" rows={3} />
          ) : error ? (
            <EmptyState
              icon={LuCircleAlert}
              tone="danger"
              title="Could not reach the backend"
              description={error}
              action={
                <Button variant="primary" icon={LuRefreshCw} onClick={loadDevices}>
                  Try again
                </Button>
              }
            />
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={LuSearch}
              title={query ? 'No matching drives' : 'No drives detected'}
              description={
                query
                  ? 'No device matches your filter. Try a different search term.'
                  : 'Enumeration returned no devices. On Windows this usually means the backend needs to run as Administrator.'
              }
              action={
                query ? (
                  <Button variant="outline" onClick={() => setQuery('')}>Clear filter</Button>
                ) : (
                  <Button variant="primary" icon={LuRefreshCw} onClick={loadDevices}>Rescan</Button>
                )
              }
            />
          ) : (
            <ul className="drive-grid">
              {filtered.map((device) => {
                const Icon = deviceIcon(device.type, device.is_removable);
                const meta = getDeviceType(device.type);
                const isSelected = Boolean(selected.find((d) => d.path === device.path));
                return (
                  <li key={device.path}>
                    <button
                      type="button"
                      className={`drive${isSelected ? ' is-selected' : ''}`}
                      onClick={() => toggle(device)}
                      aria-pressed={isSelected}
                    >
                      <span className={`drive__icon drive__icon--${meta.tone}`} aria-hidden="true">
                        <Icon />
                      </span>

                      <span className="drive__main">
                        <span className="drive__name zt-truncate" title={device.name}>{device.name}</span>
                        <span className="drive__path mono zt-truncate" title={device.path}>{device.path}</span>
                        <span className="drive__badges">
                          <Badge tone={meta.tone} size="sm">{meta.label}</Badge>
                          <Badge tone="neutral" size="sm">{formatBytes(device.size)}</Badge>
                          {device.is_removable && <Badge tone="success" size="sm">Removable</Badge>}
                          {device.demo && <Badge tone="warn" size="sm">Demo</Badge>}
                        </span>
                        {device.serial && (
                          <span className="drive__serial mono zt-truncate" title={device.serial}>
                            SN {device.serial}
                          </span>
                        )}
                      </span>

                      <span className={`drive__check${isSelected ? ' is-on' : ''}`} aria-hidden="true">
                        <LuCheck />
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>

      {/* Sticky action bar ------------------------------------------------- */}
      <div className={`actionbar${selected.length > 0 ? ' is-active' : ''}`}>
        <div className="actionbar__info">
          {selected.length > 0 ? (
            <>
              <span className="actionbar__count">{selected.length}</span>
              <div>
                <p className="actionbar__title">
                  {selected.length === 1 ? '1 drive selected' : `${selected.length} drives selected`}
                </p>
                <p className="actionbar__meta">
                  {formatBytes(totalBytes)} of capacity will be destroyed
                </p>
              </div>
            </>
          ) : (
            <p className="actionbar__meta">Select one or more drives to continue.</p>
          )}
        </div>
        <div className="actionbar__buttons">
          <Button variant="ghost" icon={LuArrowLeft} onClick={onBack}>
            Back
          </Button>
          <Button
            variant="primary"
            iconRight={LuArrowRight}
            onClick={handleNext}
            disabled={selected.length === 0}
          >
            Choose method
          </Button>
        </div>
      </div>
    </div>
  );
}
