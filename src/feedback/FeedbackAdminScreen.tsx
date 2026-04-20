import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
  Image,
  Linking,
} from 'react-native';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { FeedbackRow, FeedbackStatus } from './types';

interface Props {
  supabase: SupabaseClient;
  onBack: () => void;
}

function CategoryBadge({ category }: { category: FeedbackRow['category'] }) {
  const label = category === 'bug' ? 'Bug' : category === 'feature' ? 'Feature' : 'Other';
  const bg = category === 'bug' ? '#7f1d1d' : category === 'feature' ? '#1e3a5f' : '#374151';
  const color = category === 'bug' ? '#fca5a5' : category === 'feature' ? '#93c5fd' : '#d1d5db';
  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      <Text style={[styles.badgeText, { color }]}>{label}</Text>
    </View>
  );
}

function StatusBadge({ status }: { status: FeedbackStatus }) {
  const config: Record<FeedbackStatus, { label: string; bg: string; color: string }> = {
    new:         { label: 'New',         bg: '#431407', color: '#fb923c' },
    in_progress: { label: 'In Progress', bg: '#1e3a5f', color: '#93c5fd' },
    completed:   { label: 'Completed',   bg: '#052e16', color: '#4ade80' },
  };
  const { label, bg, color } = config[status] ?? config.new;
  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      <Text style={[styles.badgeText, { color }]}>{label}</Text>
    </View>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
}

const STATUS_OPTIONS: { value: FeedbackStatus; label: string }[] = [
  { value: 'new',         label: 'New' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'completed',   label: 'Completed' },
];

const STATUS_ORDER: Record<FeedbackStatus, number> = { new: 0, in_progress: 1, completed: 2 };

function sortItems(items: FeedbackRow[]): FeedbackRow[] {
  return [...items].sort((a, b) => {
    const statusDiff = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
    if (statusDiff !== 0) return statusDiff;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });
}

export function FeedbackAdminScreen({ supabase, onBack }: Props) {
  const [items, setItems] = useState<FeedbackRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [completingId, setCompletingId] = useState<string | null>(null);
  const [completionReply, setCompletionReply] = useState('');
  const [savingCompletionId, setSavingCompletionId] = useState<string | null>(null);
  const [completionError, setCompletionError] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { onBack(); return; }

      const { data: profileData } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single();

      if (cancelled) return;

      if (profileData?.role !== 'admin') {
        setIsAdmin(false);
        setLoading(false);
        return;
      }
      setIsAdmin(true);

      const { data, error: rpcError } = await supabase.rpc('get_all_feedback');
      if (cancelled) return;

      if (rpcError) {
        setError(rpcError.message);
        setLoading(false);
        return;
      }

      setItems(sortItems((data as FeedbackRow[]) ?? []));
      setLoading(false);

      supabase
        .from('feedback')
        .update({ is_read: true })
        .eq('is_read', false)
        .then(() => {
          if (!cancelled) {
            setItems((prev) => prev.map((item) => ({ ...item, is_read: true })));
          }
        });
    }

    load();
    return () => { cancelled = true; };
  }, []);

  const handleComplete = useCallback(async (id: string, reply: string) => {
    if (!reply.trim()) return;
    setSavingCompletionId(id);
    setCompletionError(null);
    const { error } = await supabase
      .from('feedback')
      .update({ status: 'completed', admin_reply: reply.trim(), is_read: true })
      .eq('id', id);
    if (error) {
      setCompletionError(error.message);
    } else {
      setItems((prev) =>
        sortItems(prev.map((item) =>
          item.id === id
            ? { ...item, status: 'completed' as FeedbackStatus, admin_reply: reply.trim(), is_read: true }
            : item
        ))
      );
      setCompletingId(null);
      setCompletionReply('');
    }
    setSavingCompletionId(null);
  }, [supabase]);

  const toggleExpanded = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) { next.delete(id); } else { next.add(id); }
      return next;
    });
  }, []);

  const handleStatusChange = useCallback(async (id: string, status: FeedbackStatus) => {
    setUpdatingId(id);
    const { error } = await supabase
      .from('feedback')
      .update({ status, is_read: true })
      .eq('id', id);
    if (!error) {
      setItems((prev) =>
        sortItems(prev.map((item) => item.id === id ? { ...item, status, is_read: true } : item))
      );
    }
    setUpdatingId(null);
  }, [supabase]);

  const firstCompletedIdx = items.findIndex((i) => i.status === 'completed');

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={onBack}
          activeOpacity={0.7}
        >
          <Text style={styles.backIcon}>{'←'}</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Feedback</Text>
        <View style={styles.backButtonPlaceholder} />
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#f97316" />
        </View>
      ) : isAdmin === false ? (
        <View style={styles.centered}>
          <Text style={styles.errorText}>Access denied.</Text>
        </View>
      ) : error ? (
        <View style={styles.centered}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : items.length === 0 ? (
        <View style={styles.centered}>
          <Text style={styles.emptyText}>No feedback yet.</Text>
        </View>
      ) : (
        <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
          {items.map((item, idx) => {
            const isCompleting = completingId === item.id;
            return (
              <React.Fragment key={item.id}>
                {idx === firstCompletedIdx && firstCompletedIdx > 0 && (
                  <View style={styles.archiveDivider}>
                    <Text style={styles.archiveDividerText}>COMPLETED</Text>
                  </View>
                )}
                {item.status === 'completed' && !expandedIds.has(item.id) ? (
                  <TouchableOpacity
                    style={styles.cardCollapsed}
                    onPress={() => toggleExpanded(item.id)}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.cardCollapsedChevron}>▶</Text>
                    <CategoryBadge category={item.category} />
                    <StatusBadge status={item.status} />
                    <Text style={styles.cardCollapsedTitle} numberOfLines={1}>{item.title}</Text>
                    <Text style={styles.cardCollapsedDate}>{formatDate(item.created_at)}</Text>
                  </TouchableOpacity>
                ) : (
                  <View style={[styles.card, !item.is_read && styles.cardUnread]}>
                    {item.status === 'completed' && (
                      <TouchableOpacity
                        style={styles.cardExpandHeader}
                        onPress={() => toggleExpanded(item.id)}
                        activeOpacity={0.7}
                      >
                        <Text style={styles.cardCollapsedChevron}>▼</Text>
                        <Text style={styles.cardExpandLabel}>Collapse</Text>
                      </TouchableOpacity>
                    )}
                    <View style={styles.cardHeader}>
                      <CategoryBadge category={item.category} />
                      <StatusBadge status={item.status} />
                      {!item.is_read && <View style={styles.unreadDot} />}
                    </View>
                    <Text style={styles.cardTitle}>{item.title}</Text>
                    <Text style={styles.cardBody}>{item.body}</Text>
                    {item.attachment_url && (
                      <TouchableOpacity
                        onPress={() => Linking.openURL(item.attachment_url!)}
                        activeOpacity={0.85}
                        style={styles.attachContainer}
                      >
                        <Image
                          source={{ uri: item.attachment_url }}
                          style={styles.attachImage}
                          resizeMode="cover"
                        />
                      </TouchableOpacity>
                    )}
                    {item.admin_reply && (
                      <View style={styles.replyBox}>
                        <Text style={styles.replyLabel}>Reply sent to user:</Text>
                        <Text style={styles.replyText}>{item.admin_reply}</Text>
                      </View>
                    )}
                    <View style={styles.cardFooter}>
                      <Text style={styles.cardUsername}>{item.username}</Text>
                      <Text style={styles.cardDate}>{formatDate(item.created_at)}</Text>
                    </View>
                    {isCompleting ? (
                      <View style={styles.completionForm}>
                        <Text style={styles.completionLabel}>Resolution — required to mark completed</Text>
                        <TextInput
                          style={styles.completionInput}
                          value={completionReply}
                          onChangeText={setCompletionReply}
                          placeholder="Describe what was done, fixed, or implemented…"
                          placeholderTextColor="#475569"
                          multiline
                          numberOfLines={3}
                          textAlignVertical="top"
                          autoFocus
                        />
                        {completionError && (
                          <Text style={styles.completionError}>{completionError}</Text>
                        )}
                        <View style={styles.completionButtons}>
                          <TouchableOpacity
                            style={styles.completionCancelBtn}
                            onPress={() => { setCompletingId(null); setCompletionReply(''); setCompletionError(null); }}
                            activeOpacity={0.7}
                          >
                            <Text style={styles.completionCancelText}>Cancel</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={[
                              styles.completionSaveBtn,
                              (!completionReply.trim() || savingCompletionId === item.id) && styles.completionSaveBtnDisabled,
                            ]}
                            onPress={() => handleComplete(item.id, completionReply)}
                            disabled={!completionReply.trim() || savingCompletionId === item.id}
                            activeOpacity={0.8}
                          >
                            {savingCompletionId === item.id
                              ? <ActivityIndicator size="small" color="#fff" />
                              : <Text style={styles.completionSaveText}>Save & Complete</Text>
                            }
                          </TouchableOpacity>
                        </View>
                      </View>
                    ) : (
                      <View style={styles.statusRow}>
                        {STATUS_OPTIONS.map((opt) => (
                          <TouchableOpacity
                            key={opt.value}
                            style={[
                              styles.statusBtn,
                              item.status === opt.value && styles.statusBtnActive,
                            ]}
                            onPress={() => {
                              if (opt.value === 'completed' && item.status !== 'completed') {
                                setCompletingId(item.id);
                                setCompletionReply(item.admin_reply ?? '');
                              } else if (item.status !== opt.value) {
                                handleStatusChange(item.id, opt.value);
                              }
                            }}
                            disabled={updatingId === item.id || savingCompletionId === item.id}
                            activeOpacity={0.7}
                          >
                            {(updatingId === item.id || savingCompletionId === item.id) && item.status !== opt.value ? (
                              <ActivityIndicator size="small" color="#9ca3af" />
                            ) : (
                              <Text style={[
                                styles.statusBtnText,
                                item.status === opt.value && styles.statusBtnTextActive,
                              ]}>
                                {opt.label}
                              </Text>
                            )}
                          </TouchableOpacity>
                        ))}
                      </View>
                    )}
                  </View>
                )}
              </React.Fragment>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'ios' ? 60 : 16,
    paddingBottom: 12,
    backgroundColor: '#0f172a',
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b',
  },
  backButton: {
    padding: 8,
    borderRadius: 8,
    backgroundColor: '#1e293b',
    minWidth: 40,
    alignItems: 'center',
  },
  backButtonPlaceholder: { minWidth: 40 },
  backIcon: { color: '#f97316', fontSize: 18, fontWeight: '700' },
  headerTitle: { color: '#fff', fontSize: 18, fontWeight: '800' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  errorText: { color: '#f87171', fontSize: 14, textAlign: 'center' },
  emptyText: { color: '#9ca3af', fontSize: 15, textAlign: 'center' },
  list: { flex: 1 },
  listContent: { padding: 16, gap: 12 },
  card: {
    backgroundColor: '#1e293b',
    borderRadius: 12,
    padding: 14,
    borderLeftWidth: 3,
    borderLeftColor: 'transparent',
  },
  cardUnread: { backgroundColor: '#1e3a5f', borderLeftColor: '#f97316' },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  badgeText: { fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#f97316',
    marginLeft: 'auto' as any,
  },
  cardTitle: { color: '#fff', fontSize: 15, fontWeight: '700', marginBottom: 6 },
  cardBody: { color: '#cbd5e1', fontSize: 14, lineHeight: 20, marginBottom: 10 },
  attachContainer: { borderRadius: 8, overflow: 'hidden', marginBottom: 12 },
  attachImage: { width: '100%' as any, height: 180, borderRadius: 8 },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: '#334155',
    paddingTop: 8,
    marginBottom: 10,
  },
  cardUsername: { color: '#94a3b8', fontSize: 12, fontWeight: '600' },
  cardDate: { color: '#64748b', fontSize: 12 },
  statusRow: { flexDirection: 'row', gap: 6 },
  statusBtn: {
    flex: 1,
    paddingVertical: 6,
    borderRadius: 8,
    alignItems: 'center',
    backgroundColor: '#0f172a',
    borderWidth: 1,
    borderColor: '#334155',
    minHeight: 30,
    justifyContent: 'center',
  },
  statusBtnActive: { backgroundColor: '#1e3a5f', borderColor: '#60a5fa' },
  statusBtnText: { color: '#64748b', fontSize: 12, fontWeight: '600' },
  statusBtnTextActive: { color: '#93c5fd' },
  archiveDivider: { flexDirection: 'row', alignItems: 'center', marginVertical: 8, gap: 8 },
  archiveDividerText: { color: '#4ade80', fontSize: 10, fontWeight: '800', letterSpacing: 1.5 },
  replyBox: {
    backgroundColor: '#0d2a10',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#22c55e',
    padding: 10,
    marginBottom: 10,
  },
  replyLabel: { color: '#4ade80', fontSize: 10, fontWeight: '700', marginBottom: 4, letterSpacing: 0.5 },
  replyText: { color: '#d1fae5', fontSize: 13, lineHeight: 19 },
  completionForm: { borderTopWidth: 1, borderTopColor: '#334155', paddingTop: 10, marginTop: 4 },
  completionLabel: { color: '#f59e0b', fontSize: 11, fontWeight: '700', letterSpacing: 0.5, marginBottom: 8 },
  completionInput: {
    backgroundColor: '#0f172a',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#475569',
    color: '#f1f5f9',
    fontSize: 13,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 80,
    marginBottom: 10,
  },
  completionButtons: { flexDirection: 'row', gap: 8 },
  completionCancelBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
    backgroundColor: '#0f172a',
    borderWidth: 1,
    borderColor: '#334155',
  },
  completionCancelText: { color: '#94a3b8', fontSize: 13, fontWeight: '600' },
  completionSaveBtn: {
    flex: 2,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
    backgroundColor: '#4ade80',
    minHeight: 36,
    justifyContent: 'center',
  },
  completionSaveBtnDisabled: { opacity: 0.4 },
  completionSaveText: { color: '#052e16', fontSize: 13, fontWeight: '800' },
  completionError: { color: '#f87171', fontSize: 12, marginBottom: 8 },
  cardCollapsed: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1e293b',
    borderRadius: 10,
    padding: 10,
    gap: 8,
    borderLeftWidth: 3,
    borderLeftColor: '#22c55e',
  },
  cardCollapsedChevron: { color: '#4ade80', fontSize: 10, fontWeight: '700', width: 12 },
  cardCollapsedTitle: { flex: 1, color: '#94a3b8', fontSize: 13, fontWeight: '600' },
  cardCollapsedDate: { color: '#4b5563', fontSize: 11 },
  cardExpandHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  cardExpandLabel: { color: '#4ade80', fontSize: 11, fontWeight: '600' },
});
