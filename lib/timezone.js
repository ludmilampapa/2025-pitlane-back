// Shared Argentina timezone helpers (America/Argentina/Buenos_Aires, UTC-3, no DST)
const ARGENTINA_TZ = 'America/Argentina/Buenos_Aires';
const ARGENTINA_OFFSET = '-03:00';

const ymdFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: ARGENTINA_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/**
 * Strictly validates a YYYY-MM-DD calendar date (rejects e.g. 2026-02-31, 2026-13-01).
 */
function isValidYMD(value) {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return false;
  const [y, m, d] = trimmed.split('-').map(Number);
  if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}

/**
 * Strictly validates any date input (YYYY-MM-DD, ISO timestamp, or Date instance).
 * Returns true if valid, false otherwise.
 */
function isValidDateInput(value) {
  if (value === null || value === undefined || value === '') return false;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      return isValidYMD(trimmed);
    }
    const parsed = new Date(trimmed);
    return !Number.isNaN(parsed.getTime());
  }
  if (value instanceof Date) {
    return !Number.isNaN(value.getTime());
  }
  return false;
}

/**
 * Returns the YYYY-MM-DD calendar date in Argentina time (UTC-3).
 * Throws Error('INVALID_DATE') if strict=true and input is invalid.
 */
function getArgentinaYMD(value = new Date(), { strict = false } = {}) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    if (!isValidYMD(value)) {
      if (strict) throw new Error('INVALID_DATE');
      return ymdFormatter.format(new Date());
    }
    return value.trim();
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    if (strict) throw new Error('INVALID_DATE');
    return ymdFormatter.format(new Date());
  }
  return ymdFormatter.format(date);
}

/**
 * Returns UTC Date bounds covering 00:00:00.000 to 23:59:59.999 in Argentina time.
 */
function getArgentinaDayBounds(value = new Date(), { strict = false } = {}) {
  const ymd = getArgentinaYMD(value, { strict });
  return {
    ymd,
    startUtc: new Date(`${ymd}T00:00:00.000${ARGENTINA_OFFSET}`),
    endUtc: new Date(`${ymd}T23:59:59.999${ARGENTINA_OFFSET}`),
  };
}

/**
 * Normalizes a date input to UTC midnight (YYYY-MM-DDT00:00:00.000Z) for Prisma @db.Date columns.
 * - Preserves valid YYYY-MM-DD strings and existing Prisma @db.Date UTC-midnight Date objects.
 * - Converts live timestamps/ISO datetimes using Argentina's calendar date.
 * - Throws Error('INVALID_DATE') when an explicit invalid value is provided.
 */
function argentinaDateToUtcMidnight(value) {
  if (value === undefined || value === null || value === '') {
    return new Date(`${getArgentinaYMD(new Date())}T00:00:00.000Z`);
  }
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    if (!isValidYMD(value)) {
      throw new Error('INVALID_DATE');
    }
    return new Date(`${value.trim()}T00:00:00.000Z`);
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error('INVALID_DATE');
  }
  const isUtcMidnight =
    date.getUTCHours() === 0 &&
    date.getUTCMinutes() === 0 &&
    date.getUTCSeconds() === 0 &&
    date.getUTCMilliseconds() === 0;
  if (isUtcMidnight && (value instanceof Date || /T00:00:00(\.000)?Z$/i.test(String(value)))) {
    return new Date(`${date.toISOString().slice(0, 10)}T00:00:00.000Z`);
  }
  return new Date(`${getArgentinaYMD(date)}T00:00:00.000Z`);
}

/**
 * Parses a query filter date (startDate / endDate).
 * Plain YYYY-MM-DD strings are interpreted as Argentina day start/end boundaries.
 * Throws Error('INVALID_DATE') if invalid.
 */
function parseArgentinaFilterDate(value, boundary = 'start') {
  if (!isValidDateInput(value)) {
    throw new Error('INVALID_DATE');
  }
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    const { startUtc, endUtc } = getArgentinaDayBounds(value.trim(), { strict: true });
    return boundary === 'end' ? endUtc : startUtc;
  }
  return new Date(value);
}

/**
 * Formats a date string/Date in Argentina timezone.
 */
function formatArgentinaDate(value = new Date(), locale = 'en-US', options = {}) {
  const date = value instanceof Date ? value : new Date(value);
  return date.toLocaleDateString(locale, {
    timeZone: ARGENTINA_TZ,
    ...options,
  });
}

module.exports = {
  ARGENTINA_TZ,
  ARGENTINA_OFFSET,
  isValidYMD,
  isValidDateInput,
  getArgentinaYMD,
  getArgentinaDayBounds,
  argentinaDateToUtcMidnight,
  parseArgentinaFilterDate,
  formatArgentinaDate,
};
