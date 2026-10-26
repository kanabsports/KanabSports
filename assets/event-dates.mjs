export function kanabDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Denver', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(now);
}

// Date-only events last through their final day in Kanab. Explicit end times
// expire at that instant, including when the visitor is in another time zone.
export function eventExpired(end, now = new Date()) {
  if (!end) return false;
  if (/^\d{4}-\d{2}-\d{2}$/.test(end)) return end < kanabDate(now);
  const deadline = Date.parse(end);
  return Number.isFinite(deadline) && deadline <= now.getTime();
}
