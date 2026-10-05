/**
 * Shared formatting helpers and domain metadata.
 *
 * These were previously duplicated (and in one case missing entirely) across
 * components, which is how `formatSize is not defined` shipped. One source of
 * truth keeps every screen consistent.
 */

export function formatBytes(value) {
  if (value === null || value === undefined || value === '') return 'Unknown';
  const bytes = typeof value === 'number' ? value : parseInt(value, 10);
  if (Number.isNaN(bytes)) return String(value);
  if (bytes <= 0) return '0 B';

  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  let size = bytes;
  let i = 0;
  while (size >= 1024 && i < units.length - 1) {
    size /= 1024;
    i += 1;
  }
  const decimals = size < 10 && i > 0 ? 1 : 0;
  return `${size.toFixed(decimals)} ${units[i]}`;
}

export function formatDate(value) {
  if (!value) return 'N/A';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatRelative(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const diff = Date.now() - d.getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return formatDate(value);
}

export function formatDuration(seconds) {
  if (seconds === null || seconds === undefined || Number.isNaN(Number(seconds))) return 'N/A';
  const total = Math.max(0, Math.floor(Number(seconds)));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

/** Rich metadata for each wipe method the backend exposes. */
export const METHOD_META = {
  nist_800_88: {
    name: 'NIST 800-88',
    tagline: 'Clear, verify and purge',
    description:
      'The industry reference standard for media sanitisation. Overwrites, verifies the result, then purges residual data.',
    speed: 'Medium',
    strength: 4,
    recommended: true,
    tags: ['Balanced', 'Audit-ready'],
  },
  dod_5220_22_m: {
    name: 'DoD 5220.22-M',
    tagline: 'Three-pass military standard',
    description:
      'Writes zeros, then ones, then random data across the full device. Long-established defence-sector standard.',
    speed: 'Medium',
    strength: 4,
    recommended: true,
    tags: ['3-pass', 'Defence'],
  },
  gutmann: {
    name: 'Gutmann',
    tagline: 'Thirty-five pass overwrite',
    description:
      'Maximum-paranoia overwrite designed for legacy magnetic encodings. Very slow and unnecessary on modern drives.',
    speed: 'Very slow',
    strength: 5,
    recommended: false,
    tags: ['35-pass', 'Legacy media'],
  },
  crypto_erase: {
    name: 'Cryptographic Erase',
    tagline: 'Destroy the encryption keys',
    description:
      'Discards the drive encryption key so existing data becomes unrecoverable ciphertext. Fastest safe option for SSDs.',
    speed: 'Fast',
    strength: 5,
    recommended: true,
    tags: ['Best for SSD', 'Instant'],
  },
  ata_sanitize: {
    name: 'ATA Sanitize',
    tagline: 'Firmware-level secure erase',
    description:
      'Hands sanitisation to the drive controller itself, reaching over-provisioned blocks the OS cannot address.',
    speed: 'Fast',
    strength: 5,
    recommended: true,
    tags: ['Hardware', 'Full media'],
  },
  nvme_format: {
    name: 'NVMe Format',
    tagline: 'Controller crypto erase',
    description:
      'Issues an NVMe format with secure-erase settings, letting the controller invalidate all namespaces at once.',
    speed: 'Fast',
    strength: 5,
    recommended: true,
    tags: ['Best for NVMe', 'Hardware'],
  },
  single_pass: {
    name: 'Single Pass',
    tagline: 'One zero-fill pass',
    description:
      'Writes zeros across the device once. Quick, and sufficient against software-level recovery on modern drives.',
    speed: 'Fast',
    strength: 2,
    recommended: false,
    tags: ['Quick'],
  },
  three_pass: {
    name: 'Three Pass',
    tagline: 'Zeros, ones, random',
    description:
      'Three overwrite passes with alternating patterns. A middle ground between speed and thoroughness.',
    speed: 'Medium',
    strength: 3,
    recommended: false,
    tags: ['3-pass'],
  },
};

export function getMethodMeta(id) {
  return (
    METHOD_META[id] || {
      name: String(id || 'Unknown')
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (c) => c.toUpperCase()),
      tagline: 'Custom method',
      description: 'No additional detail is available for this method.',
      speed: 'Unknown',
      strength: 3,
      recommended: false,
      tags: [],
    }
  );
}

export function getMethodName(id) {
  return getMethodMeta(id).name;
}

/** Which methods accept a configurable pass count. */
export const MULTI_PASS_METHODS = ['dod_5220_22_m', 'three_pass', 'gutmann'];

/** Device type presentation. */
export const DEVICE_TYPES = {
  ssd: { label: 'SSD', tone: 'info' },
  nvme: { label: 'NVMe', tone: 'brand' },
  hdd: { label: 'HDD', tone: 'warn' },
  usb: { label: 'USB', tone: 'success' },
  unknown: { label: 'Unknown', tone: 'neutral' },
};

export function getDeviceType(type) {
  const key = String(type || 'unknown').toLowerCase();
  return DEVICE_TYPES[key] || DEVICE_TYPES.unknown;
}

/**
 * Whether sanitising this target needs an elevated backend.
 *
 * Mirrors `elevation.device_requires_elevation` so the UI can offer the UAC
 * flow before the user commits. The backend check is the authoritative one and
 * still runs server-side; this is purely for presentation.
 */
export function deviceRequiresElevation(devicePath) {
  if (!devicePath) return false;
  const target = String(devicePath).trim();
  if (target.startsWith('demo://')) return false;
  if (/physicaldrive\d+/i.test(target)) return true;
  if (/^[a-zA-Z]:\\?$/.test(target)) return true;
  return target.startsWith('/dev/');
}

/** Map a wipe session status to a badge tone. */
export function statusTone(status) {
  switch (status) {
    case 'completed':
      return 'success';
    case 'failed':
      return 'danger';
    case 'in_progress':
      return 'info';
    case 'cancelled':
      return 'warn';
    default:
      return 'neutral';
  }
}

export function statusLabel(status) {
  if (!status) return 'Unknown';
  return String(status).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
