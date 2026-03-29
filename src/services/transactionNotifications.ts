import * as Notifications from 'expo-notifications';
import { Platform, PermissionsAndroid } from 'react-native';

import type { ParsedSMS } from '../types';

/** Android channel: low importance, no sound — “silent” heads-up / shade entry. */
export const AUTO_LOG_CHANNEL_ID = 'auto_logged_transaction';

let handlerRegistered = false;

/**
 * Required so scheduled/local notifications are shown while the app is in the foreground.
 * On Android, `shouldPlaySound: true` is needed for the shade entry to appear; the channel has no sound.
 */
export function ensureAutoLogNotificationHandler(): void {
  if (handlerRegistered) return;
  handlerRegistered = true;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
      priority: Notifications.AndroidNotificationPriority.MIN,
    }),
  });
}

export async function ensureSilentAutoLogChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(AUTO_LOG_CHANNEL_ID, {
    name: 'Auto-logged transactions',
    importance: Notifications.AndroidImportance.LOW,
    sound: null,
    enableVibrate: false,
    vibrationPattern: undefined,
    description: 'Quiet updates when a bank SMS is parsed and categorized.',
  });
}

/** Android 13+ runtime permission; iOS uses notification APIs. */
export async function ensureNotificationPermission(): Promise<boolean> {
  if (Platform.OS === 'android') {
    const api = typeof Platform.Version === 'number' ? Platform.Version : parseInt(String(Platform.Version), 10);
    if (api >= 33) {
      const check = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
      if (check) return true;
      const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS, {
        title: 'Notifications',
        message: 'Expenso can show a quiet confirmation when a transaction is auto-logged from SMS.',
        buttonPositive: 'Allow',
        buttonNegative: 'Deny',
      });
      return result === PermissionsAndroid.RESULTS.GRANTED;
    }
    return true;
  }

  const { status: existing } = await Notifications.getPermissionsAsync();
  if (existing === 'granted') return true;
  const { status } = await Notifications.requestPermissionsAsync();
  return status === 'granted';
}

function formatRupee(amount: number): string {
  try {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `₹${amount.toFixed(2)}`;
  }
}

/**
 * US-1.4: silent (no sound / low channel) confirmation after parse + categorize.
 */
export async function notifyAutoLoggedTransaction(
  parsed: ParsedSMS,
  category: string
): Promise<void> {
  const verb = parsed.type === 'debit' ? 'Debited' : 'Credited';
  const amount = formatRupee(parsed.amount);
  const title = 'Transaction auto-logged';
  const body = `${verb} ${amount} · ${parsed.merchant} · ${category}`;

  await Notifications.scheduleNotificationAsync({
    content: {
      title,
      body,
      sound: false,
      data: {
        kind: 'auto_logged_transaction',
        merchant: parsed.merchant,
        category,
        type: parsed.type,
        amount: parsed.amount,
      },
    },
    trigger:
      Platform.OS === 'android'
        ? { channelId: AUTO_LOG_CHANNEL_ID }
        : null,
  });
}
