import Constants, { ExecutionEnvironment } from 'expo-constants';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  AppState,
  type AppStateStatus,
  Linking,
  Platform,
  PermissionsAndroid,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { useSMSReceiver } from './src/hooks/useSMSReceiver';
import { categorize } from './src/services/Categorizer';
import { parse } from './src/services/SMSParser';
import {
  ensureAutoLogNotificationHandler,
  ensureNotificationPermission,
  ensureSilentAutoLogChannel,
  notifyAutoLoggedTransaction,
} from './src/services/transactionNotifications';

ensureAutoLogNotificationHandler();

type PermissionState = 'unknown' | 'granted' | 'denied';

async function checkSmsPermissions(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  const receive = await PermissionsAndroid.check(
    PermissionsAndroid.PERMISSIONS.RECEIVE_SMS
  );
  const read = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.READ_SMS);
  return receive && read;
}

export default function App() {
  const [permission, setPermission] = useState<PermissionState>(
    Platform.OS === 'android' ? 'unknown' : 'granted'
  );
  const [lastBody, setLastBody] = useState<string | null>(null);
  const [lastSender, setLastSender] = useState<string | null>(null);
  const [receivedCount, setReceivedCount] = useState(0);
  const [lastCategory, setLastCategory] = useState<string | null>(null);

  const syncPermissionFromSystem = useCallback(async () => {
    if (Platform.OS !== 'android') {
      setPermission('granted');
      return;
    }
    const ok = await checkSmsPermissions();
    setPermission(ok ? 'granted' : 'denied');
  }, []);

  const requestSmsPermissions = useCallback(async () => {
    if (Platform.OS !== 'android') {
      setPermission('granted');
      return;
    }
    try {
      // Some OEMs handle sequential requests more reliably than requestMultiple.
      const r1 = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.RECEIVE_SMS,
        {
          title: 'Receive SMS',
          message:
            'Expenso needs this to detect new bank SMS as they arrive.',
          buttonPositive: 'Allow',
          buttonNegative: 'Deny',
        }
      );
      const r2 = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.READ_SMS, {
        title: 'Read SMS',
        message: 'Expenso needs this to read the SMS text for parsing.',
        buttonPositive: 'Allow',
        buttonNegative: 'Deny',
      });

      const receiveOk = r1 === PermissionsAndroid.RESULTS.GRANTED;
      const readOk = r2 === PermissionsAndroid.RESULTS.GRANTED;

      if (receiveOk && readOk) {
        setPermission('granted');
        return;
      }

      setPermission('denied');

      const blocked =
        r1 === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN ||
        r2 === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN;

      Alert.alert(
        blocked ? 'SMS access blocked' : 'SMS permission denied',
        blocked
          ? 'Android will not show the permission popup again. Tap "Open app settings" below, then enable SMS (and Messages if split into two toggles). If the switches are greyed out, see the note at the bottom.'
          : 'You can enable SMS under Settings → Apps → Expenso → Permissions.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Open app settings',
            onPress: () => void Linking.openSettings(),
          },
        ]
      );
    } catch {
      setPermission('denied');
    }
  }, []);

  useEffect(() => {
    void syncPermissionFromSystem();
  }, [syncPermissionFromSystem]);

  useEffect(() => {
    if (Platform.OS !== 'android' || permission !== 'granted') return;
    void (async () => {
      await ensureSilentAutoLogChannel();
      await ensureNotificationPermission();
    })();
  }, [permission]);

  useEffect(() => {
    if (Platform.OS !== 'android') return;

    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'active') {
        void syncPermissionFromSystem();
      }
    });
    return () => sub.remove();
  }, [syncPermissionFromSystem]);

  useSMSReceiver({
    enabled: Platform.OS === 'android' && permission === 'granted',
    onSMS: (body, sender) => {
      setLastBody(body);
      setLastSender(sender);
      setReceivedCount((c) => c + 1);

      void (async () => {
        const parsed = parse(body);
        if (!parsed) {
          setLastCategory(null);
          return;
        }
        const category = await categorize(parsed.merchant);
        setLastCategory(category);
        try {
          await notifyAutoLoggedTransaction(parsed, category);
        } catch {
          /* non-fatal: notification plumbing may be denied or unavailable */
        }
      })();
    },
  });

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.title}>Expenso — SMS debug</Text>
        <Text style={styles.buildStamp} testID="bundle-stamp">
          Bundle US-1.4 · app v{Constants.expoConfig?.version ?? '—'} ·{' '}
          {Constants.executionEnvironment === ExecutionEnvironment.StoreClient
            ? 'dev client'
            : Constants.executionEnvironment}
          {Constants.debugMode ? ' · debug' : ''}
        </Text>

        {Platform.OS !== 'android' ? (
          <Text style={styles.muted}>SMS listening runs on Android only.</Text>
        ) : (
          <>
            <Text style={styles.label}>Permission</Text>
            <Text style={styles.value}>{permission}</Text>
            {permission !== 'granted' ? (
              <View style={styles.row}>
                <Pressable style={styles.button} onPress={requestSmsPermissions}>
                  <Text style={styles.buttonText}>Ask again (system dialog)</Text>
                </Pressable>
                <Pressable
                  style={[styles.button, styles.buttonSecondary]}
                  onPress={() => void Linking.openSettings()}
                >
                  <Text style={styles.buttonTextDark}>Open app settings</Text>
                </Pressable>
              </View>
            ) : null}

            <Text style={[styles.label, styles.gap]}>Last SMS (via native module)</Text>
            <Text style={styles.value}>Count: {receivedCount}</Text>
            <Text style={styles.value}>From: {lastSender ?? '—'}</Text>
            <Text style={styles.value}>Category (if parsed): {lastCategory ?? '—'}</Text>
            <Text style={styles.bodyPreview}>{lastBody ?? 'No SMS received yet — send one to this phone.'}</Text>

            {permission !== 'granted' ? (
              <Text style={styles.help}>
                If SMS toggles are greyed out in Settings: try another phone profile (no work
                profile), disable parental / device admin restrictions, or grant via USB debugging:{' '}
                <Text style={styles.mono}>
                  adb shell pm grant com.anonymous.expenso android.permission.RECEIVE_SMS{'\n'}
                  adb shell pm grant com.anonymous.expenso android.permission.READ_SMS
                </Text>
              </Text>
            ) : null}
          </>
        )}
      </ScrollView>
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#fff',
    paddingTop: 48,
  },
  scroll: {
    paddingHorizontal: 20,
    paddingBottom: 32,
  },
  title: {
    fontSize: 20,
    fontWeight: '600',
    marginBottom: 8,
  },
  buildStamp: {
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 16,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: '#e0f2fe',
    color: '#0c4a6e',
    overflow: 'hidden',
  },
  muted: {
    color: '#64748b',
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  gap: {
    marginTop: 24,
  },
  value: {
    fontSize: 16,
    marginTop: 6,
    color: '#0f172a',
  },
  bodyPreview: {
    fontSize: 14,
    marginTop: 10,
    lineHeight: 20,
    color: '#334155',
  },
  row: {
    marginTop: 12,
    gap: 10,
  },
  button: {
    alignSelf: 'stretch',
    backgroundColor: '#0f172a',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  buttonSecondary: {
    backgroundColor: '#e2e8f0',
  },
  buttonText: {
    color: '#fff',
    fontWeight: '600',
    textAlign: 'center',
  },
  buttonTextDark: {
    color: '#0f172a',
    fontWeight: '600',
    textAlign: 'center',
  },
  help: {
    marginTop: 24,
    fontSize: 12,
    lineHeight: 18,
    color: '#64748b',
  },
  mono: {
    fontFamily: 'monospace',
    fontSize: 11,
    color: '#475569',
  },
});
