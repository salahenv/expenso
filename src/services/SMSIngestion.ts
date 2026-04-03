import { requireNativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';

import { categorize } from './Categorizer';
import { parse } from './SMSParser';
import { saveSmsParsedTransaction } from './TransactionStore';
import { toIsoDateLocal } from './SummaryEngine';

type InboxSMS = {
  body: string;
  sender: string;
  dateMillis: number;
};

type SMSReceiverNative = {
  getRecentInboxSMS(limit: number): InboxSMS[];
};

function getNativeModule(): SMSReceiverNative | null {
  if (Platform.OS !== 'android') return null;
  try {
    return requireNativeModule<SMSReceiverNative>('SMSReceiver');
  } catch {
    return null;
  }
}

export async function ingestSingleSMS(body: string): Promise<boolean> {
  const parsed = parse(body);
  if (!parsed || parsed.type !== 'debit') return false;

  let category = await categorize(parsed.merchant);
  if (category === 'Uncategorized') category = 'Other';

  return saveSmsParsedTransaction({
    amount: parsed.amount,
    merchant: parsed.merchant,
    category,
    isoDate: toIsoDateLocal(parsed.date),
    rawSMS: body,
  });
}

export type CatchUpResult = {
  scanned: number;
  inserted: number;
};

export async function catchUpRecentSMS(limit: number = 200): Promise<CatchUpResult> {
  const native = getNativeModule();
  if (!native) return { scanned: 0, inserted: 0 };
  let messages: InboxSMS[] = [];
  try {
    messages = native.getRecentInboxSMS(limit) ?? [];
  } catch {
    return { scanned: 0, inserted: 0 };
  }
  let inserted = 0;
  for (const msg of messages) {
    const ok = await ingestSingleSMS(msg.body ?? '');
    if (ok) inserted += 1;
  }
  return { scanned: messages.length, inserted };
}

