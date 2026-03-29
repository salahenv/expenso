import type { ParsedSMS } from '../types';

const OTP_PROMO_PATTERNS: RegExp[] = [
  /\bOTP\b/i,
  /one[\s-]?time[\s-]?password/i,
  /do\s+not\s+share/i,
  /never\s+share/i,
  /\bOTP\s+is\b/i,
  /win\s+(up\s+to|a\s+prize|cash)/i,
  /congratulations[!.]?\s*you\s*(have\s*)?won/i,
  /limited\s+time\s+offer/i,
  /click\s+here\s+to\s+claim/i,
];

function isOtpOrPromo(body: string): boolean {
  const t = body.trim();
  if (t.length < 10) return true;
  return OTP_PROMO_PATTERNS.some((re) => re.test(t));
}

/** Uppercase, keep letters/digits/spaces, collapse whitespace. */
export function normalizeMerchant(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function twoDigitYear(y: number): number {
  if (y >= 100) return y;
  return y < 50 ? 2000 + y : 1900 + y;
}

/** dd-mm-yy or dd-mm-yyyy */
function parseDdMmYyyyDash(d: string, m: string, y: string): Date | null {
  const day = parseInt(d, 10);
  const month = parseInt(m, 10) - 1;
  let year = parseInt(y, 10);
  if (Number.isNaN(day) || Number.isNaN(month) || Number.isNaN(year)) return null;
  if (y.length <= 2) year = twoDigitYear(year);
  const dt = new Date(year, month, day);
  if (dt.getFullYear() !== year || dt.getMonth() !== month || dt.getDate() !== day) return null;
  return dt;
}

const MONTHS: Record<string, number> = {
  JAN: 0,
  FEB: 1,
  MAR: 2,
  APR: 3,
  MAY: 4,
  JUN: 5,
  JUL: 6,
  AUG: 7,
  SEP: 8,
  OCT: 9,
  NOV: 10,
  DEC: 11,
};

/** dd-MMM-yy */
function parseDdMmmYy(s: string): Date | null {
  const m = s.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2,4})$/);
  if (!m) return null;
  const day = parseInt(m[1], 10);
  const mon = MONTHS[m[2].toUpperCase()];
  if (mon === undefined) return null;
  let year = parseInt(m[3], 10);
  if (m[3].length <= 2) year = twoDigitYear(year);
  const dt = new Date(year, mon, day);
  if (dt.getDate() !== day) return null;
  return dt;
}

/** dd/mm/yyyy */
function parseDdMmYyyySlash(d: string, m: string, y: string): Date | null {
  return parseDdMmYyyyDash(d, m, y);
}

/** "Mar 14" — year defaults to reference year (usually current). */
function parseMmmDd(mon: string, dayStr: string, refYear: number): Date | null {
  const monIdx = MONTHS[mon.toUpperCase()];
  if (monIdx === undefined) return null;
  const day = parseInt(dayStr, 10);
  if (Number.isNaN(day)) return null;
  return new Date(refYear, monIdx, day);
}

function debit(): 'debit' {
  return 'debit';
}

type TryParse = (body: string, refNow: Date) => ParsedSMS | null;

const tryParsers: { bank: string; parse: TryParse }[] = [
  {
    bank: 'HDFC',
    parse: (body, refNow) => {
      const m = body.match(
        /Rs\.?\s*(\d+(?:\.\d+)?)\s+debited[\s\S]*?on\s+(\d{1,2})-(\d{1,2})-(\d{2,4})\s+for\s+(\S+)/i
      );
      if (!m) return null;
      const amount = parseFloat(m[1]);
      const date = parseDdMmYyyyDash(m[2], m[3], m[4]);
      if (!date || amount <= 0) return null;
      const merchant = normalizeMerchant(m[5]);
      if (!merchant) return null;
      return { amount, merchant, date, type: debit(), bank: 'HDFC' };
    },
  },
  {
    bank: 'ICICI',
    parse: (body, refNow) => {
      const m = body.match(
        /ICICI Bank:\s*INR\s*(\d+(?:\.\d+)?)\s+debited[\s\S]*?Info:\s*(.+?)(?:\.?\s*)$/im
      );
      if (!m) return null;
      const amount = parseFloat(m[1]);
      if (amount <= 0) return null;
      const merchant = normalizeMerchant(m[2].replace(/\.$/, ''));
      if (!merchant) return null;
      return { amount, merchant, date: new Date(refNow), type: debit(), bank: 'ICICI' };
    },
  },
  {
    bank: 'SBI',
    parse: (body, refNow) => {
      const m = body.match(
        /debited\s+by\s+Rs\.?\s*(\d+(?:\.\d+)?)\s+on\s+(\d{1,2})-(\d{1,2})-(\d{2,4})\s+trf\s+to\s+(.+?)(?:\.|$)/i
      );
      if (!m) return null;
      const amount = parseFloat(m[1]);
      const date = parseDdMmYyyyDash(m[2], m[3], m[4]);
      if (!date || amount <= 0) return null;
      const merchant = normalizeMerchant(m[5]);
      if (!merchant) return null;
      return { amount, merchant, date, type: debit(), bank: 'SBI' };
    },
  },
  {
    bank: 'Axis',
    parse: (body, refNow) => {
      const m = body.match(
        /INR\s*(\d+(?:\.\d+)?)\s+debited\s+from\s+Axis Bank[\s\S]*?on\s+(\d{1,2}-[A-Za-z]{3}-\d{2,4})\.?\s*(.+?)(?:\.|$)/i
      );
      if (!m) return null;
      const amount = parseFloat(m[1]);
      const date = parseDdMmmYy(m[2]);
      if (!date || amount <= 0) return null;
      const merchant = normalizeMerchant(m[3]);
      if (!merchant) return null;
      return { amount, merchant, date, type: debit(), bank: 'Axis' };
    },
  },
  {
    bank: 'Kotak',
    parse: (body, refNow) => {
      const m = body.match(
        /Rs\.?\s*(\d+(?:\.\d+)?)\s+debited\s+from\s+Kotak Bank[^.]*\.\s*(.+)/i
      );
      if (!m) return null;
      const amount = parseFloat(m[1]);
      if (amount <= 0) return null;
      const merchant = normalizeMerchant(m[2]);
      if (!merchant) return null;
      return { amount, merchant, date: new Date(refNow), type: debit(), bank: 'Kotak' };
    },
  },
  {
    bank: 'Paytm',
    parse: (body, refNow) => {
      const m = body.match(
        /Rs\.?\s*(\d+(?:\.\d+)?)\s+paid\s+to\s+(.+?)\s+via\s+Paytm\s+on\s+(\d{1,2})\/(\d{1,2})\/(\d{4})/i
      );
      if (!m) return null;
      const amount = parseFloat(m[1]);
      const date = parseDdMmYyyySlash(m[3], m[4], m[5]);
      if (!date || amount <= 0) return null;
      const merchant = normalizeMerchant(m[2]);
      if (!merchant) return null;
      return { amount, merchant, date, type: debit(), bank: 'Paytm' };
    },
  },
  {
    bank: 'PhonePe',
    parse: (body, refNow) => {
      const m = body.match(
        /Rs\.?\s*(\d+(?:\.\d+)?)\s+debited\s+from\s+[^t]+\s+to\s+(.+?)\s+via\s+PhonePe/i
      );
      if (!m) return null;
      const amount = parseFloat(m[1]);
      if (amount <= 0) return null;
      const merchant = normalizeMerchant(m[2]);
      if (!merchant) return null;
      return { amount, merchant, date: new Date(refNow), type: debit(), bank: 'PhonePe' };
    },
  },
  {
    bank: 'GPay',
    parse: (body, refNow) => {
      const m = body.match(
        /You\s+paid\s+Rs\.?\s*(\d+(?:\.\d+)?)\s+to\s+(.+?)\s+on\s+([A-Za-z]{3})\s+(\d{1,2})\s+via\s+Google Pay/i
      );
      if (!m) return null;
      const amount = parseFloat(m[1]);
      if (amount <= 0) return null;
      const merchant = normalizeMerchant(m[2]);
      if (!merchant) return null;
      const year = refNow.getFullYear();
      const date = parseMmmDd(m[3], m[4], year);
      if (!date) return null;
      return { amount, merchant, date, type: debit(), bank: 'GPay' };
    },
  },
];

/**
 * Parse a single SMS body into structured transaction fields, or `null` if not a supported bank alert.
 * OTP / promo / junk → `null`. Uses regex + rules only (US-1.2).
 */
export function parse(body: string, refNow: Date = new Date()): ParsedSMS | null {
  const trimmed = body?.trim();
  if (!trimmed) return null;
  if (isOtpOrPromo(trimmed)) return null;

  for (const { parse: tryOne } of tryParsers) {
    const result = tryOne(trimmed, refNow);
    if (result) return result;
  }
  return null;
}
