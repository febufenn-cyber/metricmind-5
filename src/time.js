import { MetricmindError } from './errors.js';

const DAY_MS = 86_400_000;

function dateKey(date, timezone) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(date);
}

function zonedMidnight(dateString, timezone) {
  const [year, month, day] = dateString.split('-').map(Number);
  let candidate = new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23'
  });
  const parts = Object.fromEntries(formatter.formatToParts(candidate)
    .filter((part) => part.type !== 'literal')
    .map((part) => [part.type, Number(part.value)]));
  const representedAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  candidate = new Date(candidate.getTime() - (representedAsUtc - candidate.getTime()));
  return candidate;
}

function addDays(dateString, days) {
  const [year, month, day] = dateString.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function startOfWeek(dateString) {
  const date = new Date(`${dateString}T00:00:00Z`);
  const day = date.getUTCDay();
  const distanceToMonday = day === 0 ? -6 : 1 - day;
  return addDays(dateString, distanceToMonday);
}

function startOfMonth(dateString) {
  return `${dateString.slice(0, 7)}-01`;
}

function previousMonthStart(dateString) {
  const [year, month] = dateString.split('-').map(Number);
  return new Date(Date.UTC(year, month - 2, 1)).toISOString().slice(0, 10);
}

export function resolvePeriod(kind, timezone, now = new Date()) {
  const today = dateKey(now, timezone);
  const todayStart = zonedMidnight(today, timezone);

  switch (kind) {
    case 'yesterday': {
      const startKey = addDays(today, -1);
      return range(startKey, today, timezone, 'Yesterday');
    }
    case 'last_7_complete_days': {
      return range(addDays(today, -7), today, timezone, 'Last 7 complete days');
    }
    case 'last_30_complete_days': {
      return range(addDays(today, -30), today, timezone, 'Last 30 complete days');
    }
    case 'previous_calendar_week': {
      const thisWeek = startOfWeek(today);
      return range(addDays(thisWeek, -7), thisWeek, timezone, 'Previous calendar week');
    }
    case 'current_month_to_date': {
      return {
        start: zonedMidnight(startOfMonth(today), timezone),
        end: todayStart,
        label: 'Current month through the last complete day'
      };
    }
    case 'previous_calendar_month': {
      const currentStart = startOfMonth(today);
      return range(previousMonthStart(today), currentStart, timezone, 'Previous calendar month');
    }
    default:
      throw new MetricmindError('UNSUPPORTED_PERIOD', `Unsupported time period: ${kind}`);
  }
}

export function precedingEqualPeriod(period) {
  const duration = period.end.getTime() - period.start.getTime();
  return {
    start: new Date(period.start.getTime() - duration),
    end: new Date(period.end.getTime() - duration),
    label: `Preceding ${Math.round(duration / DAY_MS)}-day period`
  };
}

export function assertRangeWithinLimit(period, maximumRangeDays) {
  const days = (period.end.getTime() - period.start.getTime()) / DAY_MS;
  if (days <= 0 || days > maximumRangeDays) {
    throw new MetricmindError('UNSAFE_DATE_RANGE', `Requested range must be between 1 and ${maximumRangeDays} days.`);
  }
}

function range(startKey, endKey, timezone, label) {
  return {
    start: zonedMidnight(startKey, timezone),
    end: zonedMidnight(endKey, timezone),
    label
  };
}
