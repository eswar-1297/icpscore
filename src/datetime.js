'use strict';

// ─── Eastern-Time date helpers ───────────────────────────────────────────────
// Leads are bucketed/filtered by the US Eastern calendar day (handles EST/EDT),
// so day boundaries match HubSpot rather than UTC or the server's local zone.

const ET = 'America/New_York';

// Offset (ms) that the timezone is ahead of UTC at the given instant (ET = negative).
function tzOffsetMs(date, timeZone) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p = dtf.formatToParts(date).reduce((a, x) => { a[x.type] = x.value; return a; }, {});
  const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return asUTC - date.getTime();
}

// YYYY-MM-DD calendar date in Eastern Time for a timestamp / ISO string / Date.
function toEtDate(input) {
  if (input == null || input === '') return null;
  const d = new Date(input);
  if (isNaN(d)) return null;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: ET, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);  // en-CA → "YYYY-MM-DD"
}

// 'YYYY-MM-DD' → the next calendar day, same format.
function nextDay(dateStr) {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

// UTC epoch ms at 00:00 Eastern Time on the given 'YYYY-MM-DD'.
function etMidnightMs(dateStr) {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  const utcMid = Date.UTC(y, m - 1, d, 0, 0, 0);
  const off = tzOffsetMs(new Date(utcMid), ET);  // ET offset on that day (DST-aware)
  return utcMid - off;
}

module.exports = { toEtDate, nextDay, etMidnightMs };
