// Dates are shown in the incident's time zone (the organisation's), not the viewer's, and always name that zone.
import { DateTime } from 'luxon';

/** "Asia/Manila" -> "Manila time"; "UTC" -> "UTC". */
export function zoneLabel(zone) {
  if (!zone || zone === 'UTC' || zone === 'Etc/UTC') return 'UTC';
  return `${zone.split('/').pop().replace(/_/g, ' ')} time`;
}

const at = (iso, zone) => DateTime.fromISO(iso, { setZone: true }).setZone(zone);

/** "Sun 1 Nov · 09:30" */
export const formatDue = (iso, zone) => at(iso, zone).toFormat('ccc d LLL · HH:mm');

/** "Thu 29 Oct, 09:30" */
export const formatWhen = (iso, zone) => at(iso, zone).toFormat('ccc d LLL, HH:mm');

/** "29 Oct, 15:02" for the audit trail. */
export const formatStamp = (iso, zone) => at(iso, zone).toFormat('d LLL, HH:mm');

/** Value for <input type="datetime-local"> showing the instant in the zone. */
export const toLocalInput = (iso, zone) => at(iso, zone).toFormat("yyyy-LL-dd'T'HH:mm");

/** The wall time typed in the zone, as ISO 8601 with that zone's offset. Null when invalid. */
export function fromLocalInput(value, zone) {
  const dt = DateTime.fromISO(value, { zone });
  return dt.isValid ? dt.toISO({ suppressMilliseconds: true }) : null;
}

export const nowIso = () => DateTime.now().toISO({ suppressMilliseconds: true });

export const viewerZone = () => DateTime.local().zoneName || 'UTC';

export function isValidZone(zone) {
  return Boolean(zone) && DateTime.local().setZone(zone).isValid;
}

/** Time left until the deadline, split for display. */
/** How early a notice was filed, as "2d 14h" or "5h 20m" (null when it was filed late or has no deadline). */
export function earlyBy(dueIso, filedIso) {
  if (!dueIso || !filedIso) return null;
  const ms = Date.parse(dueIso) - Date.parse(filedIso);
  if (!(ms > 0)) return null;
  const minutes = Math.floor(ms / 60_000);
  const d = Math.floor(minutes / 1440);
  const h = Math.floor((minutes % 1440) / 60);
  const m = minutes % 60;
  return d > 0 ? `${d}d ${h}h` : `${h}h ${m}m`;
}

export function remaining(dueIso, nowMs) {
  const diff = Date.parse(dueIso) - nowMs;
  const overdue = diff < 0;
  const total = Math.floor(Math.abs(diff) / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return { overdue, ms: diff, hm: `${h}:${String(m).padStart(2, '0')}`, s: String(s).padStart(2, '0'), h, m };
}

/** The length of a deadline for the preview: "24h", "72h", "5d", "1mo". */
export function span(fromIso, dueIso) {
  const hours = (Date.parse(dueIso) - Date.parse(fromIso)) / 3_600_000;
  if (hours <= 96) return `${Math.round(hours)}h`;
  const days = hours / 24;
  if (days < 28) return `${Math.round(days)}d`;
  if (days < 360) return `${Math.round(days / 30.4)}mo`;
  return `${Math.round(days)}d`;
}
