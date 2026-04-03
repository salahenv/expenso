import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  AppState,
  type AppStateStatus,
  Modal,
  PermissionsAndroid,
  Platform,
  Pressable,
  ScrollView,
  StatusBar as RNStatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';

import type { Transaction } from './types';
import { useSMSReceiver } from './hooks/useSMSReceiver';
import { catchUpRecentSMS, ingestSingleSMS } from './services/SMSIngestion';
import {
  DEFAULT_CATEGORIES,
  deleteTransaction,
  getCategoryTotals,
  getMonthTotal,
  getRecentTransactions,
  getWeekTotal,
  saveTransaction,
  updateTransaction,
} from './services/TransactionStore';
import { getCurrentMonthRange, getCurrentWeekRange, toIsoDateLocal } from './services/SummaryEngine';

function formatINR(amount: number): string {
  try {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `₹${amount.toFixed(0)}`;
  }
}

function addDays(date: Date, deltaDays: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + deltaDays);
  return d;
}

function parseIsoDateLocal(isoDate: string): Date {
  // Expect YYYY-MM-DD
  return new Date(`${isoDate}T00:00:00`);
}

function formatDayHeading(isoDate: string): string {
  const d = parseIsoDateLocal(isoDate);
  const weekday = d.toLocaleDateString('en-US', { weekday: 'short' });
  const day = d.getDate();
  const month = d.toLocaleDateString('en-US', { month: 'short' });
  return `${weekday} ${day} ${month}`;
}

type BreakdownRow = { category: string; total: number };

export default function HomeScreen() {
  const [loading, setLoading] = useState(true);
  const [smsEnabled, setSmsEnabled] = useState(false);
  const [smsSyncHint, setSmsSyncHint] = useState<string | null>(null);

  const [weekTotal, setWeekTotal] = useState(0);
  const [monthTotal, setMonthTotal] = useState(0);
  const [todayTotal, setTodayTotal] = useState(0);
  const [todayBreakdown, setTodayBreakdown] = useState<BreakdownRow[]>([]);
  const [weekBreakdown, setWeekBreakdown] = useState<BreakdownRow[]>([]);
  const [monthBreakdown, setMonthBreakdown] = useState<BreakdownRow[]>([]);
  const [recentTransactions, setRecentTransactions] = useState<Transaction[]>([]);

  const [addEditVisible, setAddEditVisible] = useState(false);
  const [addEditMode, setAddEditMode] = useState<'add' | 'edit'>('add');

  const [detailTx, setDetailTx] = useState<Transaction | null>(null);

  const [formAmount, setFormAmount] = useState('0');
  const [formCategory, setFormCategory] = useState<string>('Food');
  const [formMerchant, setFormMerchant] = useState('');
  const [formNote, setFormNote] = useState('');
  const [formDate, setFormDate] = useState(toIsoDateLocal(new Date()));

  const nowKey = useMemo(() => Date.now(), []);
  const weekRange = useMemo(() => getCurrentWeekRange(new Date(nowKey)), [nowKey]);
  const monthRange = useMemo(() => getCurrentMonthRange(new Date(nowKey)), [nowKey]);

  const refreshAll = useCallback(async () => {
    setLoading(true);
    try {
      const now = new Date();
      const week = getCurrentWeekRange(now);
      const month = getCurrentMonthRange(now);
      const todayIso = toIsoDateLocal(now);

      const [wTotal, mTotal, tBreak, wBreak, mBreak, recent] = await Promise.all([
        getWeekTotal(now),
        getMonthTotal(now),
        getCategoryTotals(todayIso, todayIso),
        getCategoryTotals(week.fromIsoDate, week.toIsoDate),
        getCategoryTotals(month.fromIsoDate, month.toIsoDate),
        getRecentTransactions(50),
      ]);

      const tTotal = tBreak.reduce((sum, row) => sum + row.total, 0);
      setTodayTotal(tTotal);
      setTodayBreakdown(tBreak);
      setWeekTotal(wTotal);
      setMonthTotal(mTotal);
      setWeekBreakdown(wBreak);
      setMonthBreakdown(mBreak);
      setRecentTransactions(recent);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  const syncSmsPermission = useCallback(async () => {
    if (Platform.OS !== 'android') {
      setSmsEnabled(false);
      return false;
    }
    const receive = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.RECEIVE_SMS);
    const read = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.READ_SMS);
    const ok = receive && read;
    setSmsEnabled(ok);
    return ok;
  }, []);

  const requestSmsPermissionIfNeeded = useCallback(async () => {
    if (Platform.OS !== 'android') return false;
    const already = await syncSmsPermission();
    if (already) return true;
    const r1 = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECEIVE_SMS);
    const r2 = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.READ_SMS);
    const ok =
      r1 === PermissionsAndroid.RESULTS.GRANTED &&
      r2 === PermissionsAndroid.RESULTS.GRANTED;
    setSmsEnabled(ok);
    return ok;
  }, [syncSmsPermission]);

  useEffect(() => {
    void (async () => {
      const ok = await requestSmsPermissionIfNeeded();
      if (!ok) {
        setSmsSyncHint('SMS permission needed — enable SMS in Settings to import bank SMS.');
        return;
      }
      const { scanned, inserted } = await catchUpRecentSMS(250);
      setSmsSyncHint(
        scanned === 0
          ? 'No inbox messages returned (rebuild app after native SMS sync change, or grant READ_SMS).'
          : `SMS: ${scanned} scanned, ${inserted} new debit(s) saved. Unmatched formats stay out of totals.`
      );
      await refreshAll();
    })();
  }, [refreshAll, requestSmsPermissionIfNeeded]);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'active') {
        void (async () => {
          const ok = await syncSmsPermission();
          if (!ok) return;
          const { scanned, inserted } = await catchUpRecentSMS(120);
          setSmsSyncHint(
            scanned === 0
              ? 'No inbox messages returned.'
              : `SMS: ${scanned} scanned, ${inserted} new debit(s) saved.`
          );
          await refreshAll();
        })();
      }
    });
    return () => sub.remove();
  }, [refreshAll, syncSmsPermission]);

  useSMSReceiver({
    enabled: Platform.OS === 'android' && smsEnabled,
    onSMS: (body) => {
      void (async () => {
        const inserted = await ingestSingleSMS(body);
        if (inserted) await refreshAll();
      })();
    },
  });

  const hasAnyTransactions = recentTransactions.length > 0;

  const groupedRecent = useMemo(() => {
    const todayIso = toIsoDateLocal(new Date());
    const yesterdayIso = toIsoDateLocal(addDays(new Date(), -1));
    const groups: Record<string, Transaction[]> = {};
    for (const tx of recentTransactions) {
      groups[tx.date] = groups[tx.date] ?? [];
      groups[tx.date].push(tx);
    }

    const entries = Object.entries(groups).sort((a, b) => (a[0] < b[0] ? 1 : -1));
    return entries.map(([iso, txs]) => {
      const sortedTxs = [...txs].sort((a, b) => {
        const ca = a.createdAt ?? '';
        const cb = b.createdAt ?? '';
        return cb.localeCompare(ca);
      });
      let label = formatDayHeading(iso);
      if (iso === todayIso) label = 'Today';
      if (iso === yesterdayIso) label = 'Yesterday';
      return { label, isoDate: iso, txs: sortedTxs };
    });
  }, [recentTransactions]);

  const openAdd = useCallback(() => {
    setAddEditMode('add');
    setFormAmount('0');
    setFormCategory('Food');
    setFormMerchant('');
    setFormNote('');
    setFormDate(toIsoDateLocal(new Date()));
    setAddEditVisible(true);
  }, []);

  const openEdit = useCallback((tx: Transaction) => {
    setAddEditMode('edit');
    setFormAmount(String(tx.amount));
    setFormCategory(tx.category);
    setFormMerchant(tx.merchant);
    setFormNote(tx.note ?? '');
    setFormDate(tx.date);
    setAddEditVisible(true);
  }, []);

  const closeAddEdit = useCallback(() => {
    setAddEditVisible(false);
  }, []);

  const onSaveAddEdit = useCallback(async () => {
    const amount = parseFloat(formAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      Alert.alert('Invalid amount', 'Enter a positive amount.');
      return;
    }
    const merchant = formMerchant.trim();
    if (!merchant) {
      Alert.alert('Merchant required', 'Enter a merchant name (example: SWIGGY).');
      return;
    }

    if (!formDate) {
      Alert.alert('Date required', 'Enter a date in YYYY-MM-DD format.');
      return;
    }

    if (addEditMode === 'add') {
      await saveTransaction({
        amount,
        category: formCategory,
        merchant,
        date: formDate,
        source: 'manual',
        note: formNote.trim() ? formNote.trim() : undefined,
      });
    } else {
      if (!detailTx) {
        Alert.alert('Edit error', 'No transaction selected.');
        return;
      }
      await updateTransaction(detailTx.id, {
        amount,
        category: formCategory,
        merchant,
        date: formDate,
        note: formNote.trim() ? formNote.trim() : undefined,
        source: 'manual',
      });
    }

    setAddEditVisible(false);
    setDetailTx(null);
    void refreshAll();
  }, [addEditMode, detailTx, formAmount, formCategory, formDate, formMerchant, formNote, refreshAll]);

  const requestDelete = useCallback(
    (tx: Transaction) => {
      Alert.alert('Delete transaction', `Delete ${tx.merchant} (${tx.category})?`, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            await deleteTransaction(tx.id);
            setDetailTx(null);
            void refreshAll();
          },
        },
      ]);
    },
    [refreshAll]
  );

  const renderBreakdown = useCallback((rows: BreakdownRow[]) => {
    if (rows.length === 0) return <Text style={styles.emptyBreakdown}>No categories yet.</Text>;
    return (
      <View style={styles.breakdownWrap}>
        {rows.map((r) => (
          <View key={r.category} style={styles.breakdownItem}>
            <Text style={[styles.breakdownCategory]}>{r.category}</Text>
            <Text style={styles.breakdownTotal}>{formatINR(r.total)}</Text>
          </View>
        ))}
      </View>
    );
  }, []);

  const headerTopPad =
    Platform.OS === 'android' ? (RNStatusBar.currentHeight ?? 0) + 10 : 52;

  return (
    <View style={styles.root}>
      <StatusBar style="dark" />
      <View style={[styles.header, { paddingTop: headerTopPad }]}>
        <Text style={styles.headerTitle}>Expenso</Text>
      </View>

      <ScrollView contentContainerStyle={styles.container} style={styles.scroll}>
        {smsSyncHint ? (
          <Text style={styles.smsHint}>{smsSyncHint}</Text>
        ) : null}

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Today</Text>
          <Text style={styles.cardSubtitle}>{toIsoDateLocal(new Date())}</Text>
          <Text style={styles.bigTotal}>{loading ? '₹0' : formatINR(todayTotal)}</Text>
          {renderBreakdown(todayBreakdown)}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>This week</Text>
          <Text style={styles.cardSubtitle}>{weekRange.label}</Text>
          <Text style={styles.bigTotal}>{loading ? '₹0' : formatINR(weekTotal)}</Text>
          {renderBreakdown(weekBreakdown)}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>This month</Text>
          <Text style={styles.cardSubtitle}>{monthRange.label}</Text>
          <Text style={styles.bigTotal}>{loading ? '₹0' : formatINR(monthTotal)}</Text>
          {renderBreakdown(monthBreakdown)}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Recent transactions</Text>
          <Text style={styles.sectionSubtitle}>By spend date, newest first</Text>

          {!hasAnyTransactions ? (
            <Text style={styles.emptyState}>No transactions yet. Tap + to add one.</Text>
          ) : (
            groupedRecent.map((g) => (
              <View key={g.isoDate} style={styles.dayGroup}>
                <Text style={styles.dayHeading}>{g.label}</Text>
                {g.txs.map((tx) => (
                  <Pressable key={tx.id} style={styles.txRow} onPress={() => setDetailTx(tx)}>
                    <View style={styles.txRowLeft}>
                      <Text style={styles.txMerchant}>{tx.merchant}</Text>
                      <Text style={styles.txCategory}>{tx.category}</Text>
                    </View>
                    <Text style={styles.txAmount}>{formatINR(tx.amount)}</Text>
                  </Pressable>
                ))}
              </View>
            ))
          )}
        </View>
      </ScrollView>

      <Pressable accessibilityRole="button" style={styles.fab} onPress={openAdd}>
        <Text style={styles.fabText}>+</Text>
      </Pressable>

      <Modal visible={addEditVisible} transparent animationType="slide" onRequestClose={closeAddEdit}>
        <View style={styles.modalOverlay}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>{addEditMode === 'add' ? 'Add Transaction' : 'Edit Transaction'}</Text>

            <Text style={styles.fieldLabel}>Amount</Text>
            <TextInput
              style={styles.input}
              keyboardType="numeric"
              value={formAmount}
              onChangeText={(t) => setFormAmount(t)}
              placeholder="0"
            />

            <Text style={styles.fieldLabel}>Category</Text>
            <View style={styles.pills}>
              {DEFAULT_CATEGORIES.map((c) => (
                <Pressable
                  key={c}
                  style={[styles.pill, formCategory === c ? styles.pillActive : null]}
                  onPress={() => setFormCategory(c)}
                >
                  <Text style={[styles.pillText, formCategory === c ? styles.pillTextActive : null]}>{c}</Text>
                </Pressable>
              ))}
            </View>

            <Text style={styles.fieldLabel}>Merchant / note</Text>
            <TextInput
              style={styles.input}
              value={formMerchant}
              onChangeText={(t) => setFormMerchant(t)}
              placeholder="e.g. SWIGGY"
            />
            <TextInput
              style={styles.input}
              value={formNote}
              onChangeText={(t) => setFormNote(t)}
              placeholder="Optional note"
            />

            <Text style={styles.fieldLabel}>Date (YYYY-MM-DD)</Text>
            <TextInput
              style={styles.input}
              value={formDate}
              onChangeText={(t) => setFormDate(t)}
              placeholder={toIsoDateLocal(new Date())}
            />

            <View style={styles.sheetActions}>
              <Pressable style={styles.sheetButtonSecondary} onPress={closeAddEdit}>
                <Text style={styles.sheetButtonTextDark}>Cancel</Text>
              </Pressable>
              <Pressable style={styles.sheetButton} onPress={onSaveAddEdit}>
                <Text style={styles.sheetButtonText}>Save</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={detailTx != null} transparent animationType="fade" onRequestClose={() => setDetailTx(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.detailCard}>
            {detailTx ? (
              <>
                <Text style={styles.detailTitle}>{detailTx.merchant}</Text>
                <Text style={styles.detailSub}>
                  {detailTx.category} · {formatINR(detailTx.amount)}
                </Text>
                <Text style={styles.detailLine}>Date: {detailTx.date}</Text>
                <Text style={styles.detailLine}>Source: {detailTx.source}</Text>
                {detailTx.rawSMS ? <Text style={styles.detailRaw}>SMS: {detailTx.rawSMS}</Text> : null}
                {detailTx.note ? <Text style={styles.detailRaw}>Note: {detailTx.note}</Text> : null}

                <View style={styles.detailActions}>
                  <Pressable
                    style={styles.sheetButtonSecondary}
                    onPress={() => {
                      openEdit(detailTx);
                      setDetailTx(detailTx);
                    }}
                  >
                    <Text style={styles.sheetButtonTextDark}>Edit</Text>
                  </Pressable>
                  <Pressable style={styles.sheetButtonDanger} onPress={() => requestDelete(detailTx)}>
                    <Text style={styles.sheetButtonText}>Delete</Text>
                  </Pressable>
                </View>

                <Pressable style={styles.sheetButtonSecondary} onPress={() => setDetailTx(null)}>
                  <Text style={styles.sheetButtonTextDark}>Close</Text>
                </Pressable>
              </>
            ) : null}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#fff',
  },
  header: {
    paddingHorizontal: 16,
    paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e2e8f0',
    backgroundColor: '#fff',
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#0f172a',
    letterSpacing: -0.3,
  },
  headerSubtitle: {
    marginTop: 4,
    fontSize: 13,
    fontWeight: '500',
    color: '#64748b',
  },
  scroll: {
    flex: 1,
  },
  container: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 110,
    gap: 12,
  },
  smsHint: {
    fontSize: 12,
    lineHeight: 17,
    color: '#475569',
    marginBottom: 4,
  },
  card: {
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 12,
    padding: 14,
    backgroundColor: '#f8fafc',
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0f172a',
  },
  cardSubtitle: {
    marginTop: 4,
    fontSize: 12,
    color: '#64748b',
  },
  bigTotal: {
    marginTop: 8,
    fontSize: 28,
    fontWeight: '800',
    color: '#0f172a',
  },
  breakdownWrap: {
    marginTop: 10,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  breakdownItem: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'baseline',
  },
  breakdownCategory: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0f172a',
  },
  breakdownTotal: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0f172a',
  },
  emptyBreakdown: {
    marginTop: 10,
    color: '#64748b',
    fontSize: 12,
  },
  section: {
    marginTop: 12,
    gap: 8,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0f172a',
  },
  sectionSubtitle: {
    fontSize: 12,
    color: '#94a3b8',
    marginTop: 2,
    marginBottom: 4,
  },
  emptyState: {
    marginTop: 10,
    color: '#64748b',
    fontSize: 13,
  },
  dayGroup: {
    marginTop: 8,
    gap: 6,
  },
  dayHeading: {
    fontSize: 12,
    fontWeight: '800',
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  txRow: {
    borderWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  txRowLeft: {
    gap: 2,
  },
  txMerchant: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0f172a',
  },
  txCategory: {
    fontSize: 12,
    color: '#64748b',
    fontWeight: '600',
  },
  txAmount: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0f172a',
  },
  fab: {
    position: 'absolute',
    right: 18,
    bottom: 18,
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#0f172a',
    justifyContent: 'center',
    alignItems: 'center',
  },
  fabText: {
    color: '#fff',
    fontSize: 26,
    fontWeight: '900',
    lineHeight: 26,
  },

  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'flex-end',
    padding: 16,
  },
  sheet: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 14,
    paddingBottom: 18,
    gap: 10,
  },
  sheetTitle: {
    fontSize: 16,
    fontWeight: '900',
    color: '#0f172a',
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: '800',
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  input: {
    borderWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: '#fff',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#0f172a',
    fontSize: 14,
  },
  pills: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  pill: {
    borderWidth: 1,
    borderColor: '#cbd5e1',
    backgroundColor: '#fff',
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  pillActive: {
    backgroundColor: '#0f172a',
    borderColor: '#0f172a',
  },
  pillText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#334155',
  },
  pillTextActive: {
    color: '#fff',
  },
  sheetActions: {
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'flex-end',
    marginTop: 6,
  },
  sheetButton: {
    backgroundColor: '#0f172a',
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  sheetButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '900',
  },
  sheetButtonSecondary: {
    backgroundColor: '#e2e8f0',
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  sheetButtonTextDark: {
    color: '#0f172a',
    fontSize: 14,
    fontWeight: '900',
  },
  sheetButtonDanger: {
    backgroundColor: '#dc2626',
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },

  detailCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 14,
    gap: 10,
    alignSelf: 'center',
    width: '100%',
    maxWidth: 420,
  },
  detailTitle: {
    fontSize: 18,
    fontWeight: '900',
    color: '#0f172a',
  },
  detailSub: {
    fontSize: 13,
    fontWeight: '800',
    color: '#64748b',
  },
  detailLine: {
    fontSize: 13,
    color: '#334155',
    fontWeight: '700',
  },
  detailRaw: {
    fontSize: 12,
    color: '#334155',
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 10,
    padding: 10,
  },
  detailActions: {
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'space-between',
  },
});

