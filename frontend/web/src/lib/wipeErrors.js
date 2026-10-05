/**
 * Turn a failed wipe result into something a user can act on.
 *
 * The previous UI printed "Device wipes need elevated privileges. On Windows,
 * run the backend from an Administrator terminal..." underneath *every*
 * failure - including a ctypes OverflowError on an already-elevated backend.
 * That advice is now shown only when the backend's real process token says
 * privileges are actually missing.
 */

const CATEGORIES = {
  admin_required: {
    title: 'Administrator privileges required',
    hint:
      'Grant them with Run as Administrator, or start the backend from an elevated terminal, then confirm the erasure again.',
  },
  device_open_failed: {
    title: 'Could not open the device',
    hint:
      'The drive may have been unplugged, or another program holds an exclusive handle on it. Reconnect it and rescan.',
  },
  volume_lock_failed: {
    title: 'Could not lock the volume',
    hint:
      'Something is using the drive. Close Explorer windows, media players, backup software and antivirus scans pointing at it, then retry.',
  },
  volume_dismount_failed: {
    title: 'Could not dismount the volume',
    hint: 'Windows refused to unmount the filesystem. Safely eject the drive, reconnect it and retry.',
  },
  drive_layout_failed: {
    title: 'Drive layout operation failed',
    hint: 'The partition table could not be updated. The drive may be write-protected.',
  },
  write_failed: {
    title: 'Write failed',
    hint:
      'The device stopped accepting data. This usually means failing flash, a write-protect switch, or a faulty cable or port.',
  },
  device_disconnected: {
    title: 'Device disconnected',
    hint:
      'The drive dropped off the bus mid-write. Try a rear-panel USB port, a different cable, and avoid a hub. Nothing was verified, so treat the drive as still containing data.',
  },
  flush_failed: {
    title: 'Flush failed',
    hint: 'The device did not confirm the data reached the media, so the erasure cannot be trusted.',
  },
  seek_failed: {
    title: 'Seek failed',
    hint: 'The device rejected a position change. It may have been removed mid-operation.',
  },
  read_failed: {
    title: 'Read-back failed',
    hint: 'The device could not be read back, so the erasure could not be verified.',
  },
  device_query_failed: {
    title: 'Could not query the device',
    hint: 'Windows would not report the disk geometry or size. Reconnect the drive and rescan.',
  },
  verification_failed: {
    title: 'Verification failed',
    hint:
      'The device was read back after the overwrite and still contained data. It has NOT been securely erased - do not treat it as sanitised.',
  },
  certificate_failed: {
    title: 'Certificate generation failed',
    hint: 'The erasure finished but the signed certificate could not be produced.',
  },
  internal_win32: {
    title: 'Internal Win32 error',
    hint:
      'A low-level Windows call failed inside ZeroTrace. This is a defect in the application, not a problem with your drive.',
  },
  invalid_target: {
    title: 'Invalid target device',
    hint: 'The selected device path could not be interpreted. Rescan and select the drive again.',
  },
  wipe_failed: {
    title: 'Erasure failed',
    hint: null,
  },
};

/**
 * @param payload the `result` object from POST /api/wipe (or an equivalent shape)
 * @param system  the backend's /api/system/status, used for the *real* token check
 */
export function describeWipeError(payload, system) {
  const message =
    (payload && (payload.error || payload.message)) || 'The erasure did not complete.';
  const category = (payload && payload.error_category) || 'wipe_failed';
  const meta = CATEGORIES[category] || CATEGORIES.wipe_failed;

  // Only the backend's real process token decides whether to mention elevation.
  const genuinelyNeedsAdmin =
    Boolean(payload && payload.requires_admin) ||
    (category === 'admin_required' && system && system.is_admin === false);

  const facts = [];
  if (payload?.error_operation) facts.push({ label: 'Operation', value: payload.error_operation });
  if (payload?.win32_error !== null && payload?.win32_error !== undefined) {
    facts.push({ label: 'Win32 error', value: String(payload.win32_error) });
  }
  if (payload?.error_offset !== null && payload?.error_offset !== undefined) {
    facts.push({ label: 'Failed at byte', value: Number(payload.error_offset).toLocaleString() });
  }

  return {
    category,
    title: genuinelyNeedsAdmin ? CATEGORIES.admin_required.title : meta.title,
    message,
    hint: genuinelyNeedsAdmin ? CATEGORIES.admin_required.hint : meta.hint,
    facts,
    requiresAdmin: genuinelyNeedsAdmin,
  };
}

export const WIPE_ERROR_CATEGORIES = CATEGORIES;
