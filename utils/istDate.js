// Date helpers pinned to India Standard Time, independent of the server's timezone.
// Delivery dates are stored as 'YYYY-MM-DD' strings (IST calendar days).

const IST_TIMEZONE = 'Asia/Kolkata';

const partsFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: IST_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23'
});

export const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
export const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

// { date: 'YYYY-MM-DD', minutes: minutes since IST midnight, time: 'HH:mm' }
export const istNow = (now = new Date()) => {
  const p = Object.fromEntries(partsFormatter.formatToParts(now).map(x => [x.type, x.value]));
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    minutes: parseInt(p.hour) * 60 + parseInt(p.minute),
    time: `${p.hour}:${p.minute}`
  };
};

export const isValidDateString = (value) => {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !isNaN(d) && d.toISOString().slice(0, 10) === value;
};

export const addDays = (dateStr, days) => {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

export const diffDays = (fromDate, toDate) =>
  Math.round((new Date(`${toDate}T00:00:00Z`) - new Date(`${fromDate}T00:00:00Z`)) / 86400000);

export const timeToMinutes = (time) => {
  const [h, m] = String(time).split(':').map(Number);
  return h * 60 + m;
};

// '17:00' -> '5:00 PM'
export const formatTime12h = (time) => {
  const minutes = timeToMinutes(time);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
};

// '2026-10-12' -> 'Mon, 12 Oct'
export const formatDateShort = (dateStr) =>
  new Date(`${dateStr}T00:00:00Z`).toLocaleDateString('en-IN', {
    weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC'
  });

// UTC Date range covering one IST calendar day (for createdAt queries)
export const istDayRange = (dateStr) => {
  const start = new Date(`${dateStr}T00:00:00+05:30`);
  const end = new Date(start.getTime() + 86400000 - 1);
  return { start, end };
};
