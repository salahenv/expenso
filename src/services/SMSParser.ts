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

/** Parse Rs / INR amounts that may include thousands separators (e.g. 1,234.50). */
function parseRsInrAmountNear(text: string, fromIndex: number = 0): number | null {
  const slice = text.slice(fromIndex);
  const m = slice.match(/(?:Rs\.?|INR)\s*([\d,]+(?:\.\d{1,2})?)/i);
  if (!m) return null;
  const n = parseFloat(m[1].replace(/,/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Prefer the amount that belongs to the debit line, not an earlier balance / Avl Bal / min due.
 * Many SMS show "Avl Bal Rs 107..." before "INR 1000 debited".
 */
function parseDebitAmountFromBody(body: string): number | null {
  const t = body.replace(/\s+/g, ' ').trim();

  const tiedPatterns = [
    /\bdebited\s+by\s+([\d,]+(?:\.\d{1,2})?)\b/i,
    /(?:Rs\.?|INR)\s*([\d,]+(?:\.\d{1,2})?)\s*(?:has been\s+)?debited\b/i,
    /\bdebited\b[^0-9]{0,60}?(?:Rs\.?|INR)\s*([\d,]+(?:\.\d{1,2})?)/i,
    /\bdebited\s+by\s+(?:Rs\.?|INR)\s*([\d,]+(?:\.\d{1,2})?)/i,
    /\bdebited\s+with\s+(?:Rs\.?|INR)\s*([\d,]+(?:\.\d{1,2})?)/i,
  ];
  for (const re of tiedPatterns) {
    const m = t.match(re);
    if (m?.[1]) {
      const n = parseFloat(m[1].replace(/,/g, ''));
      if (Number.isFinite(n) && n > 0) return n;
    }
  }

  const debitedExec = /\bdebited\b/i.exec(t);
  if (!debitedExec) {
    return parseRsInrAmountNear(t, 0);
  }
  const debitedAt = debitedExec.index;
  const debitedLen = debitedExec[0].length;

  let best: { value: number; dist: number } | null = null;
  const reAmt = /(?:Rs\.?|INR)\s*([\d,]+(?:\.\d{1,2})?)|\bdebited\s+by\s+([\d,]+(?:\.\d{1,2})?)/gi;
  let mm: RegExpExecArray | null;
  while ((mm = reAmt.exec(t)) !== null) {
    const raw = (mm[1] ?? mm[2]) as string;
    const value = parseFloat(raw.replace(/,/g, ''));
    if (!Number.isFinite(value) || value <= 0) continue;
    const start = mm.index;
    const end = start + mm[0].length;
    const debitCenter = debitedAt + debitedLen / 2;
    const amtCenter = (start + end) / 2;
    const dist = Math.abs(amtCenter - debitCenter);
    if (!best || dist < best.dist) {
      best = { value, dist };
    }
  }
  return best?.value ?? null;
}

function extractDebitDate(body: string, refNow: Date): Date {
  /** SBI UPI style: "on date 03Apr26" */
  const m0 = body.match(/on\s+date\s+(\d{1,2})([A-Za-z]{3})(\d{2,4})/i);
  if (m0) {
    const day = parseInt(m0[1], 10);
    const monKey = m0[2].slice(0, 3).toUpperCase();
    const mon = MONTHS[monKey];
    if (mon !== undefined) {
      let year = parseInt(m0[3], 10);
      if (m0[3].length <= 2) year = twoDigitYear(year);
      const dt = new Date(year, mon, day);
      if (dt.getFullYear() === year && dt.getMonth() === mon && dt.getDate() === day) return dt;
    }
  }

  const m1 = body.match(/(\d{1,2})-([A-Za-z]{3})-(\d{2,4})/);
  if (m1) {
    const d = parseDdMmmYy(`${m1[1]}-${m1[2]}-${m1[3]}`);
    if (d) return d;
  }
  const m2 = body.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m2) {
    const d = parseDdMmYyyySlash(m2[1], m2[2], m2[3]);
    if (d) return d;
  }
  const m3 = body.match(/(\d{1,2})-(\d{1,2})-(\d{2,4})/);
  if (m3) {
    const d = parseDdMmYyyyDash(m3[1], m3[2], m3[3]);
    if (d) return d;
  }
  return new Date(refNow);
}

function extractMerchantLoose(body: string): string | null {
  const tries: RegExp[] = [
    /(?:Info|INFO)\s*:\s*(.+?)(?:\.|$|\n)/i,
    /(?:Payee|payee)\s*[:\s]+\s*(.+?)(?:\.|,|\n|$)/i,
    /(?:trf\s+to|transfer\s+to|paid\s+to|debited\s+to|towards)\s+(.+?)(?:\s+on|\s+UPI|\.|,|\n|$)/i,
    /\bto\s+([A-Za-z0-9][A-Za-z0-9\s\.\-]{2,48}?)(?:\s+on|\s+UPI|\.|,|\n|Ref)/i,
    /\bfor\s+([A-Za-z0-9][A-Za-z0-9\s\.\-]{2,40}?)(?:\s+on|\s+UPI|\.|,)/i,
  ];
  for (const re of tries) {
    const m = body.match(re);
    if (m?.[1]) {
      const raw = m[1].trim().replace(/\.$/, '');
      const mer = normalizeMerchant(raw);
      if (mer.length >= 2) return mer;
    }
  }
  return null;
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
        /ICICI Bank:\s*INR\s*([\d,]+(?:\.\d+)?)\s+debited[\s\S]*?Info:\s*(.+?)(?:\.?\s*)$/im
      );
      if (!m) return null;
      const amount = parseFloat(m[1].replace(/,/g, ''));
      if (amount <= 0) return null;
      const merchant = normalizeMerchant(m[2].replace(/\.$/, ''));
      if (!merchant) return null;
      return { amount, merchant, date: new Date(refNow), type: debit(), bank: 'ICICI' };
    },
  },
  {
    bank: 'ICICI',
    parse: (body, refNow) => {
      if (!/ICICI/i.test(body)) return null;
      const m = body.match(/INR\s*([\d,]+(?:\.\d+)?)\s+debited/i);
      if (!m) return null;
      const amount = parseFloat(m[1].replace(/,/g, ''));
      if (amount <= 0) return null;
      const merchantRaw =
        body.match(/Info\s*:\s*(.+?)(?:\.|$|\n)/i)?.[1] ??
        body.match(/(?:Payee|payee)\s*[:\s]+\s*(.+?)(?:\.|,|\n|$)/i)?.[1] ??
        body.match(
          /debited[\s\S]{0,180}?(?:to|towards|for)\s+([A-Za-z0-9][A-Za-z0-9\s\.\-]{2,45}?)(?:\s+on|\s+UPI|\.|,|\n|Ref)/i
        )?.[1];
      if (!merchantRaw) return null;
      const merchant = normalizeMerchant(merchantRaw);
      if (!merchant) return null;
      const date = extractDebitDate(body, refNow);
      return { amount, merchant, date, type: debit(), bank: 'ICICI' };
    },
  },
  {
    bank: 'SBI',
    parse: (body, refNow) => {
      if (!/\bdebited\s+by\b/i.test(body) || !/\btrf\s+to\b/i.test(body)) return null;
      const am = body.match(/\bdebited\s+by\s+([\d,]+(?:\.\d{1,2})?)/i);
      if (!am) return null;
      const amount = parseFloat(am[1].replace(/,/g, ''));
      if (amount <= 0) return null;

      const dm = body.match(/on\s+date\s+(\d{1,2})([A-Za-z]{3})(\d{2,4})/i);
      let date: Date;
      if (dm) {
        const day = parseInt(dm[1], 10);
        const monKey = dm[2].slice(0, 3).toUpperCase();
        const mon = MONTHS[monKey];
        if (mon === undefined) return null;
        let y = parseInt(dm[3], 10);
        if (dm[3].length <= 2) y = twoDigitYear(y);
        date = new Date(y, mon, day);
        if (date.getDate() !== day || date.getMonth() !== mon || date.getFullYear() !== y) return null;
      } else {
        date = new Date(refNow);
      }

      const payee = body.match(/\btrf\s+to\s+(.+?)(?:\s+Refno|\s+Ref\b|\.|,|If not)/i);
      if (!payee?.[1]) return null;
      const merchant = normalizeMerchant(payee[1]);
      if (!merchant) return null;
      return { amount, merchant, date, type: debit(), bank: 'SBI' };
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
  /**
   * Last resort: real bank SMS often use "debited" + Rs/INR + a payee somewhere in the text.
   * Keeps false positives low by requiring the word "debited" and a parsable amount.
   */
  {
    bank: 'Generic',
    parse: (body, refNow) => {
      if (!/\bdebited\b/i.test(body)) return null;

      const amount = parseDebitAmountFromBody(body);
      if (amount == null) return null;

      const merchant = extractMerchantLoose(body) ?? normalizeMerchant('UNKNOWN');
      if (!merchant) return null;

      const date = extractDebitDate(body, refNow);
      return { amount, merchant, date, type: debit(), bank: 'Generic' };
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
