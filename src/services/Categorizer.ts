import AsyncStorage from '@react-native-async-storage/async-storage';

import merchantsJson from '../assets/merchants.json';
import { normalizeMerchant } from './SMSParser';

const STORAGE_KEY = 'user_corrections';

/** Layer 1: exact merchant → category (loaded from merchants.json). */
const MERCHANT_DIRECTORY: Record<string, string> = merchantsJson as Record<string, string>;

/**
 * Layer 2: keyword → category. First match wins. Tested against normalized merchant (uppercase).
 */
const KEYWORD_RULES: { pattern: RegExp; category: string }[] = [
  { pattern: /RESTAURANT|CAFE|HOTEL|FOOD|KITCHEN|DHABA/, category: 'Food' },
  { pattern: /PETROL|FUEL|BPCL|HPCL|PUMP/, category: 'Transport' },
  { pattern: /PHARMACY|MEDICAL|HOSPITAL|CLINIC|HEALTH/, category: 'Health' },
  { pattern: /AMAZON|FLIPKART|MYNTRA|SHOP|STORE/, category: 'Shopping' },
  { pattern: /NETFLIX|SPOTIFY|PRIME|HOTSTAR|CINEMA/, category: 'Subscriptions' },
  { pattern: /ELECTRICITY|WATER|GAS|JIO|AIRTEL|BROADBAND/, category: 'Utilities' },
];

export const UNCATEGORIZED = 'Uncategorized';

export async function loadCorrections(): Promise<Record<string, string>> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, string>;
    }
    return {};
  } catch {
    return {};
  }
}

export async function saveCorrection(merchant: string, category: string): Promise<void> {
  const key = normalizeMerchant(merchant);
  if (!key) return;
  const current = await loadCorrections();
  const next = { ...current, [key]: category };
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}

/**
 * US-1.3: Layer 3 (user corrections) → Layer 1 (merchants.json) → Layer 2 (keywords) → Uncategorized.
 */
export async function categorize(merchant: string): Promise<string> {
  const key = normalizeMerchant(merchant);
  if (!key) return UNCATEGORIZED;

  const corrections = await loadCorrections();
  const corrected = corrections[key];
  if (corrected) return corrected;

  const exact = MERCHANT_DIRECTORY[key];
  if (exact) return exact;

  for (const { pattern, category } of KEYWORD_RULES) {
    if (pattern.test(key)) return category;
  }

  return UNCATEGORIZED;
}
