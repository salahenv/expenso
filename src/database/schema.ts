// SQLite table definitions and migrations.

import type { Category } from '../types';

const CATEGORIES: Category[] = [
  { id: 'Food', name: 'Food', color: '#22c55e', icon: 'food' },
  { id: 'Transport', name: 'Transport', color: '#3b82f6', icon: 'transport' },
  { id: 'Shopping', name: 'Shopping', color: '#f59e0b', icon: 'shopping' },
  { id: 'Health', name: 'Health', color: '#ef4444', icon: 'health' },
  { id: 'Subscriptions', name: 'Subscriptions', color: '#8b5cf6', icon: 'subscriptions' },
  { id: 'Utilities', name: 'Utilities', color: '#06b6d4', icon: 'utilities' },
  { id: 'Entertainment', name: 'Entertainment', color: '#ec4899', icon: 'entertainment' },
  { id: 'Other', name: 'Other', color: '#64748b', icon: 'other' },
];

export function getSchemaSql(): string {
  const categorySeedValues = CATEGORIES.map((c) => {
    // Keep icons as simple strings; they are optional for v1 logic.
    return `('${c.id}', '${c.name.replace(/'/g, "''")}', '${c.color}', '${c.icon.replace(/'/g, "''")}')`;
  }).join(', ');

  return `
    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY NOT NULL,
      amount REAL NOT NULL,
      merchant TEXT NOT NULL,
      category TEXT NOT NULL,
      date TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'manual',
      raw_sms TEXT,
      note TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_transactions_date
      ON transactions(date);
    CREATE INDEX IF NOT EXISTS idx_transactions_category
      ON transactions(category);
    CREATE INDEX IF NOT EXISTS idx_transactions_created_at
      ON transactions(created_at);

    DELETE FROM transactions
    WHERE source = 'sms'
      AND raw_sms IS NOT NULL
      AND rowid NOT IN (
        SELECT MIN(rowid)
        FROM transactions
        WHERE source = 'sms' AND raw_sms IS NOT NULL
        GROUP BY raw_sms, amount, date
      );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_sms_dedupe
      ON transactions(raw_sms, amount, date)
      WHERE source = 'sms' AND raw_sms IS NOT NULL;

    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      color TEXT NOT NULL,
      icon TEXT NOT NULL
    );

    INSERT OR IGNORE INTO categories (id, name, color, icon)
    VALUES ${categorySeedValues};
  `;
}

export const FIXED_CATEGORIES = CATEGORIES;

