// SQLite database open, migrations, and helpers.

import { openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';

import { getSchemaSql } from './schema';

let dbPromise: Promise<SQLiteDatabase> | null = null;
let initialized = false;

export async function getDB(): Promise<SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = openDatabaseAsync('expenso.db');
  }
  return dbPromise;
}

export async function initDB(): Promise<void> {
  if (initialized) return;
  const db = await getDB();

  await db.execAsync(getSchemaSql());
  initialized = true;
}
