/**
 * Thin wrapper over the ZeroTrace backend API.
 *
 * Endpoints and payload shapes are unchanged from the original UI - this only
 * centralises fetching, timeouts and error handling so every screen behaves
 * consistently.
 */

export const API_BASE = '/api';

/** Static mount that serves generated certificates straight from disk. */
export const REPORTS_BASE = '/reports';

class ApiError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

async function request(path, { timeout = 15000, ...options } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(`${API_BASE}${path}`, {
      ...options,
      signal: controller.signal,
    });

    let body = null;
    const text = await response.text();
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    }

    if (!response.ok) {
      const detail =
        (body && typeof body === 'object' && (body.detail || body.error)) ||
        `Request failed with status ${response.status}`;
      throw new ApiError(String(detail), response.status, body);
    }

    return body;
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new ApiError('The request timed out. Is the backend still running?', 0, null);
    }
    if (err instanceof ApiError) throw err;
    // fetch() rejects with a bare TypeError ("Failed to fetch") when the server
    // is unreachable; surface something a user can act on instead.
    if (err instanceof TypeError) {
      throw new ApiError(
        'Could not reach the ZeroTrace backend. Check that the API is running on port 8000.',
        0,
        null
      );
    }
    throw new ApiError(err.message || 'Could not reach the ZeroTrace backend.', 0, null);
  } finally {
    clearTimeout(timer);
  }
}

function postJson(path, payload, options = {}) {
  return request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    ...options,
  });
}

/**
 * Host/port the elevated backend must rebind to.
 *
 * Derived from the page's own origin so the relaunched process keeps serving
 * this exact origin - otherwise the already-loaded frontend would be talking to
 * a dead port after the handover.
 */
export function currentOrigin() {
  const { hostname, port, protocol } = window.location;
  return {
    host: hostname || '127.0.0.1',
    port: Number(port) || (protocol === 'https:' ? 443 : 80),
  };
}

export const api = {
  health: () => request('/health', { timeout: 5000 }),

  /** Privilege level and elevation state. Short timeout: it is polled. */
  systemStatus: () => {
    const { host, port } = currentOrigin();
    return request(`/system/status?host=${encodeURIComponent(host)}&port=${port}`, { timeout: 6000 });
  },

  /**
   * Ask the backend to request administrator rights via the Windows UAC prompt.
   * Returns as soon as the prompt is raised - the outcome arrives via polling
   * systemStatus(), because the dialog is user-driven.
   */
  requestElevation: () => postJson('/system/elevate', currentOrigin(), { timeout: 15000 }),

  /** Drive enumeration shells out to the OS, so it gets a longer leash. */
  listDrives: () => request('/drives', { timeout: 20000 }),

  listMethods: () => request('/wipe/methods'),

  listSessions: (limit = 50) => request(`/wipe/sessions?limit=${limit}`),

  listCertificates: () => request('/certificates'),

  getProgress: (sessionId) => request(`/wipe/${sessionId}/progress`, { timeout: 8000 }),

  /** A device wipe is synchronous server-side and can run for a long time. */
  startWipe: ({ device, method, passes, force = true }) =>
    postJson('/wipe', { device, method, passes, force }, { timeout: 3600000 }),

  verifyCertificate: (filePath, embeddedPdf = false) =>
    postJson('/reports/verify', { file_path: filePath, embedded_pdf: embeddedPdf }, { timeout: 30000 }),
};

/** Download URLs for a completed session's artefacts. */
export const sessionUrls = {
  pdf: (id) => `${API_BASE}/reports/${id}`,
  json: (id) => `${API_BASE}/reports/${id}/json`,
  signature: (id) => `${API_BASE}/reports/${id}/signature`,
};

/**
 * Direct URLs for a certificate file on disk.
 *
 * The certificates listing returns filenames, not session ids - the old viewer
 * assumed a `sessionId` that is never present and requested
 * `/api/reports/undefined/json`. Serving from the static mount by filename is
 * both correct and works for certificates with no database session at all
 * (for example those produced by the file-wipe endpoint).
 */
export const certificateUrls = {
  file: (filename) => `${REPORTS_BASE}/${encodeURIComponent(filename)}`,
  signature: (filename) => {
    const suffix = filename.toLowerCase().endsWith('.pdf') ? '.p7s' : '.sig';
    return `${REPORTS_BASE}/${encodeURIComponent(filename)}${suffix}`;
  },
};

export { ApiError };
