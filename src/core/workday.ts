// The "workday" is the reporting day. It starts at a configurable time
// (default 12:00 AM) in the store's timezone, so a 1:30 AM sale with a 4:00 AM
// workday start belongs to the previous day's reports.

/** Returns the workday as yyyy-mm-dd for a moment in time. */
export function workdayFor(when: Date, timeZone: string, startHHMM: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(when);
  const get = (t: string) => parseInt(parts.find((p) => p.type === t)!.value, 10);
  const y = get('year');
  const m = get('month');
  const d = get('day');
  const minutes = get('hour') * 60 + get('minute');
  const [sh = '0', sm = '0'] = startHHMM.split(':');
  const startMinutes = parseInt(sh, 10) * 60 + parseInt(sm, 10);
  const day = new Date(Date.UTC(y, m - 1, d));
  if (minutes < startMinutes) day.setUTCDate(day.getUTCDate() - 1);
  return day.toISOString().slice(0, 10);
}
