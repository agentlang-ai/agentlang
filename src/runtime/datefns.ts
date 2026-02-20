import {
  addDays as _addDays,
  addWeeks as _addWeeks,
  addMonths as _addMonths,
  startOfWeek as _startOfWeek,
  endOfWeek as _endOfWeek,
  startOfMonth as _startOfMonth,
  endOfMonth as _endOfMonth,
  getISOWeek,
  format,
  parse,
  differenceInDays,
  differenceInWeeks,
} from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';

/**
 * Parse a date string as local midnight to avoid timezone day-shift issues.
 * date-fns operates in local time, so we must parse date-only strings
 * (YYYY-MM-DD) as local midnight rather than UTC midnight.
 */
function toDate(dateStr: string): Date {
  if (!dateStr.includes('T')) {
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  return new Date(dateStr);
}

function toDateStr(d: Date): string {
  return format(d, 'yyyy-MM-dd');
}

function addDays(dateStr: string, days: number): string {
  return toDateStr(_addDays(toDate(dateStr), days));
}

function addWeeks(dateStr: string, weeks: number): string {
  return toDateStr(_addWeeks(toDate(dateStr), weeks));
}

function addMonths(dateStr: string, months: number): string {
  return toDateStr(_addMonths(toDate(dateStr), months));
}

function startOfWeek(dateStr: string): string {
  return toDateStr(_startOfWeek(toDate(dateStr), { weekStartsOn: 1 }));
}

function endOfWeek(dateStr: string): string {
  return toDateStr(_endOfWeek(toDate(dateStr), { weekStartsOn: 1 }));
}

function startOfMonth(dateStr: string): string {
  return toDateStr(_startOfMonth(toDate(dateStr)));
}

function endOfMonth(dateStr: string): string {
  return toDateStr(_endOfMonth(toDate(dateStr)));
}

function getWeek(dateStr: string): number {
  return getISOWeek(toDate(dateStr));
}

function dayName(dateStr: string): string {
  return format(toDate(dateStr), 'EEEE');
}

function formatDate(dateStr: string, fmt: string): string {
  return format(toDate(dateStr), fmt);
}

function parseDate(str: string, fmt: string): string {
  return toDateStr(parse(str, fmt, new Date()));
}

function diffInDays(dateStr1: string, dateStr2: string): number {
  return differenceInDays(toDate(dateStr1), toDate(dateStr2));
}

function diffInWeeks(dateStr1: string, dateStr2: string): number {
  return differenceInWeeks(toDate(dateStr1), toDate(dateStr2));
}

function today(): string {
  return toDateStr(new Date());
}

function toTimezone(dateStr: string, tz: string): string {
  return formatInTimeZone(new Date(dateStr), tz, 'yyyy-MM-dd HH:mm:ssXXX');
}

export function initDateFns() {
  return {
    addDays,
    addWeeks,
    addMonths,
    startOfWeek,
    endOfWeek,
    startOfMonth,
    endOfMonth,
    getWeek,
    dayName,
    formatDate,
    parseDate,
    diffInDays,
    diffInWeeks,
    today,
    toTimezone,
  };
}
