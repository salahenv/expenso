// Persists and queries transactions (SQLite).

import type { Transaction } from '../types';
import { initDB, getDB } from '../database/db';

type TotalsRow = { category: string; total: number };

function nowIso(): string {
  return new Date().toISOString();
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function toIsoDateLocal(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function makeId(): string {
  return `tx-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function isoRangeInclusive(fromIsoDate: string, toIsoDate: string) {
  return { fromIsoDate, toIsoDate };
}

export type TransactionDraft = Omit<Transaction, 'id' | 'createdAt'>;

export const DEFAULT_CATEGORIES = [
  'Food',
  'Transport',
  'Shopping',
  'Health',
  'Subscriptions',
  'Utilities',
  'Entertainment',
  'Other',
];

export async function saveTransaction(t: TransactionDraft & { id?: string; createdAt?: string }): Promise<void> {
  await initDB();
  const db = await getDB();

  const id = t.id ?? makeId();
  const createdAt = t.createdAt ?? nowIso();

  await db.runAsync(
    `INSERT INTO transactions (id, amount, merchant, category, date, source, raw_sms, note, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    t.amount,
    t.merchant,
    t.category,
    t.date,
    t.source,
    t.rawSMS ?? null,
    t.note ?? null,
    createdAt
  );
}

export async function saveSmsParsedTransaction(input: {
  amount: number;
  merchant: string;
  category: string;
  isoDate: string;
  rawSMS: string;
}): Promise<boolean> {
  await initDB();
  const db = await getDB();
  const id = makeId();
  const createdAt = nowIso();

  const result = await db.runAsync(
    `INSERT OR IGNORE INTO transactions (id, amount, merchant, category, date, source, raw_sms, note, created_at)
     VALUES (?, ?, ?, ?, ?, 'sms', ?, NULL, ?)`,
    id,
    input.amount,
    input.merchant,
    input.category,
    input.isoDate,
    input.rawSMS,
    createdAt
  );
  return (result.changes ?? 0) > 0;
}

export async function updateTransaction(
  id: string,
  updates: Partial<Pick<Transaction, 'amount' | 'merchant' | 'category' | 'date' | 'source' | 'rawSMS' | 'note'>>
): Promise<void> {
  await initDB();
  const db = await getDB();

  // Build a small dynamic update safely.
  const fields: string[] = [];
  const params: any[] = [];

  if (updates.amount !== undefined) {
    fields.push('amount = ?');
    params.push(updates.amount);
  }
  if (updates.merchant !== undefined) {
    fields.push('merchant = ?');
    params.push(updates.merchant);
  }
  if (updates.category !== undefined) {
    fields.push('category = ?');
    params.push(updates.category);
  }
  if (updates.date !== undefined) {
    fields.push('date = ?');
    params.push(updates.date);
  }
  if (updates.source !== undefined) {
    fields.push('source = ?');
    params.push(updates.source);
  }
  if (updates.rawSMS !== undefined) {
    fields.push('raw_sms = ?');
    params.push(updates.rawSMS);
  }
  if (updates.note !== undefined) {
    fields.push('note = ?');
    params.push(updates.note);
  }

  if (fields.length === 0) return;

  await db.runAsync(
    `UPDATE transactions SET ${fields.join(', ')} WHERE id = ?`,
    ...params,
    id
  );
}

export async function deleteTransaction(id: string): Promise<void> {
  await initDB();
  const db = await getDB();
  await db.runAsync(`DELETE FROM transactions WHERE id = ?`, id);
}

function currentWeekRangeLocal(now: Date) {
  // Week = Monday 00:00 to Sunday 23:59.
  const day = now.getDay(); // 0=Sun..6=Sat
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(now);
  monday.setDate(now.getDate() + diffToMonday);
  monday.setHours(0, 0, 0, 0);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);

  // Store/comparison uses date-only ISO strings (YYYY-MM-DD).
  return isoRangeInclusive(toIsoDateLocal(monday), toIsoDateLocal(sunday));
}

function currentMonthRangeLocal(now: Date) {
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  const to = now;
  return isoRangeInclusive(toIsoDateLocal(from), toIsoDateLocal(to));
}

export async function getWeekTransactions(now: Date = new Date()): Promise<Transaction[]> {
  await initDB();
  const db = await getDB();
  const { fromIsoDate, toIsoDate } = currentWeekRangeLocal(now);
  return db.getAllAsync<Transaction>(
    `SELECT id, amount, merchant, category, date, source, raw_sms as rawSMS, note, created_at as createdAt
     FROM transactions
     WHERE date >= ? AND date <= ?
     ORDER BY date DESC, created_at DESC`,
    fromIsoDate,
    toIsoDate
  );
}

export async function getMonthTransactions(now: Date = new Date()): Promise<Transaction[]> {
  await initDB();
  const db = await getDB();
  const { fromIsoDate, toIsoDate } = currentMonthRangeLocal(now);
  return db.getAllAsync<Transaction>(
    `SELECT id, amount, merchant, category, date, source, raw_sms as rawSMS, note, created_at as createdAt
     FROM transactions
     WHERE date >= ? AND date <= ?
     ORDER BY date DESC, created_at DESC`,
    fromIsoDate,
    toIsoDate
  );
}

export async function getWeekTotal(now: Date = new Date()): Promise<number> {
  const { fromIsoDate, toIsoDate } = currentWeekRangeLocal(now);
  await initDB();
  const db = await getDB();
  const row = await db.getFirstAsync<{ total: number }>(
    `SELECT COALESCE(ROUND(SUM(amount), 2), 0) AS total
     FROM transactions
     WHERE date >= ? AND date <= ?`,
    fromIsoDate,
    toIsoDate
  );
  return Number(row?.total ?? 0);
}

export async function getMonthTotal(now: Date = new Date()): Promise<number> {
  const { fromIsoDate, toIsoDate } = currentMonthRangeLocal(now);
  await initDB();
  const db = await getDB();
  const row = await db.getFirstAsync<{ total: number }>(
    `SELECT COALESCE(ROUND(SUM(amount), 2), 0) AS total
     FROM transactions
     WHERE date >= ? AND date <= ?`,
    fromIsoDate,
    toIsoDate
  );
  return Number(row?.total ?? 0);
}

export async function getCategoryTotals(fromIsoDate: string, toIsoDate: string): Promise<TotalsRow[]> {
  await initDB();
  const db = await getDB();
  return db.getAllAsync<TotalsRow>(
    `SELECT category, COALESCE(ROUND(SUM(amount), 2), 0) AS total
     FROM transactions
     WHERE date >= ? AND date <= ?
     GROUP BY category
     ORDER BY total DESC`,
    fromIsoDate,
    toIsoDate
  );
}

export async function getRecentTransactions(limit: number = 50): Promise<Transaction[]> {
  await initDB();
  const db = await getDB();
  /** Spend date (`date`) first — inbox backfill sets `created_at` to sync time, which made old SMS look "newest". */
  return db.getAllAsync<Transaction>(
    `SELECT id, amount, merchant, category, date, source, raw_sms as rawSMS, note, created_at as createdAt
     FROM transactions
     ORDER BY date DESC, created_at DESC
     LIMIT ?`,
    limit
  );
}

export async function getCurrentWeekRangeIso(now: Date = new Date()): Promise<{ from: string; to: string }> {
  const { fromIsoDate, toIsoDate } = currentWeekRangeLocal(now);
  return { from: fromIsoDate, to: toIsoDate };
}

export async function getCurrentMonthRangeIso(now: Date = new Date()): Promise<{ from: string; to: string }> {
  const { fromIsoDate, toIsoDate } = currentMonthRangeLocal(now);
  return { from: fromIsoDate, to: toIsoDate };
}

