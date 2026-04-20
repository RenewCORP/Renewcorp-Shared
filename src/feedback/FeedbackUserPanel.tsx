import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Modal,
  Platform,
  Image,
  Alert,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { FeedbackStatus } from './types';

type Category = 'bug' | 'feature' | 'other';

interface MyFeedback {
  id: string;
  category: Category;
  title: string;
  body: string;
  status: FeedbackStatus;
  admin_reply: string | null;
  reply_seen: boolean;
  created_at: string;
}

interface Props {
  supabase: SupabaseClient;
}

export function FeedbackUserPanel({ supabase }: Props) {
  const [myFeedback, setMyFeedback] = useState<MyFeedback[]>([]);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const [showModal, setShowModal] = useState(false);
  const [category, setCategory] = useState<Category>('bug');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [attachmentUri, setAttachmentUri] = useState<string | null>(null);
  const attachmentFileRef = useRef<File | null>(null);

  const fetchMyFeedback = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data } = await supabase
      .from('feedback')
      .select('id, category, title, body, status, admin_reply, reply_seen, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });
    const items = (data ?? []) as MyFeedback[];
    setMyFeedback(items);
    items.filter(i => !i.reply_seen && i.admin_reply).forEach((i) => {
      supabase.rpc('mark_reply_seen', { p_feedback_id: i.id }).catch(() => {});
    });
  }, [supabase]);

  useEffect(() => { fetchMyFeedback(); }, [fetchMyFeedback]);

  const clearAttachment = useCallback(() => {
    if (Platform.OS === 'web' && attachmentUri) URL.revokeObjectURL(attachmentUri);
    attachmentFileRef.current = null;
    setAttachmentUri(null);
  }, [attachmentUri]);

  const resetForm = useCallback(() => {
    setCategory('bug');
    setTitle('');
    setDescription('');
    setEditingId(null);
    setError(null);
    setSuccess(false);
    clearAttachment();
  }, [clearAttachment]);

  const toggleExpanded = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const handlePickAttachment = useCallback(async () => {
    if (Platform.OS === 'web') {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.onchange = (e) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (!file) return;
        if (attachmentUri) URL.revokeObjectURL(attachmentUri);
        attachmentFileRef.current = file;
        setAttachmentUri(URL.createObjectURL(file));
      };
      input.click();
    } else {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission needed', 'Allow photo library access to attach a screenshot.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.7,
        allowsEditing: false,
      });
      if (!result.canceled && result.assets[0]) {
        setAttachmentUri(result.assets[0].uri);
      }
    }
  }, [attachmentUri]);

  const handleSubmit = useCallback(async () => {
    if (!title.trim() || !description.trim()) return;
    setSubmitting(true);
    setError(null);

    try {
      const { data: { user } } = await supabase.auth.getUser();

      if (editingId) {
        const { error: updateErr } = await supabase.from('feedback')
          .update({ category, title: title.trim(), body: description.trim() })
          .eq('id', editingId)
          .eq('user_id', user?.id ?? '')
          .eq('status', 'new');
        if (updateErr) throw updateErr;
        setSuccess(true);
        setTimeout(() => {
          setShowModal(false);
          resetForm();
          fetchMyFeedback();
        }, 1500);
        return;
      }

      let attachmentUrl: string | null = null;
      if (attachmentUri) {
        const path = `${user?.id ?? 'anon'}/${Date.now()}.jpg`;
        let uploadError: unknown = null;
        let uploadPath: string | null = null;

        if (Platform.OS === 'web' && attachmentFileRef.current) {
          const { data, error: err } = await supabase.storage
            .from('feedback-attachments')
            .upload(path, attachmentFileRef.current, { contentType: attachmentFileRef.current.type, upsert: false });
          uploadError = err;
          uploadPath = data?.path ?? null;
        } else {
          const response = await fetch(attachmentUri);
          const blob = await response.blob();
          const { data, error: err } = await supabase.storage
            .from('feedback-attachments')
            .upload(path, blob, { contentType: 'image/jpeg', upsert: false });
          uploadError = err;
          uploadPath = data?.path ?? null;
        }

        if (!uploadError && uploadPath) {
          const { data: { publicUrl } } = supabase.storage
            .from('feedback-attachments')
            .getPublicUrl(uploadPath);
          attachmentUrl = publicUrl;
        }
      }

      const { error: insertErr } = await supabase.from('feedback').insert({
        user_id: user?.id ?? null,
        category,
        title: title.trim(),
        body: description.trim(),
        attachment_url: attachmentUrl,
      });
      if (insertErr) throw insertErr;

      supabase.functions.invoke('send-feedback-email', {
        body: { category, title: title.trim(), body: description.trim() },
      }).catch(() => {});

      setSuccess(true);
      setTimeout(() => {
        setShowModal(false);
        resetForm();
        fetchMyFeedback();
      }, 1500);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to submit feedback.');
    } finally {
      setSubmitting(false);
    }
  }, [category, title, description, editingId, attachmentUri, supabase, resetForm, fetchMyFeedback]);

  const statusLabel = (s: FeedbackStatus) =>
    s === 'new' ? 'New' : s === 'in_progress' ? 'In Progress' : 'Completed';

  return (
    <>
      <TouchableOpacity
        style={styles.actionButton}
        onPress={() => { resetForm(); setShowModal(true); }}
        activeOpacity={0.8}
      >
        <Text style={styles.actionButtonEmoji}>💬</Text>
        <Text style={styles.actionButtonText}>Send Feedback</Text>
      </TouchableOpacity>

      {myFeedback.length > 0 && (
        <View style={styles.myFeedbackList}>
          <View style={styles.myFeedbackHeader}>
            <Text style={styles.myFeedbackLabel}>MY SUBMISSIONS</Text>
            {myFeedback.some(i => !i.reply_seen && i.admin_reply) && (
              <View style={styles.myFeedbackNotifDot} />
            )}
          </View>
          {myFeedback.map((item) => {
            const canEdit = item.status === 'new';
            const collapsed = item.status === 'completed' && !expandedIds.has(item.id);

            if (collapsed) {
              return (
                <TouchableOpacity
                  key={item.id}
                  style={styles.myFeedbackCollapsed}
                  onPress={() => toggleExpanded(item.id)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.myFeedbackChevron}>▶</Text>
                  <Text style={styles.myFeedbackCollapsedTitle} numberOfLines={1}>{item.title}</Text>
                  <Text style={styles.myFeedbackCollapsedStatus}>Completed</Text>
                </TouchableOpacity>
              );
            }

            return (
              <View key={item.id} style={styles.myFeedbackRow}>
                {item.status === 'completed' && (
                  <TouchableOpacity
                    onPress={() => toggleExpanded(item.id)}
                    style={styles.myFeedbackCollapseHeader}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.myFeedbackChevron}>▼</Text>
                    <Text style={styles.myFeedbackCollapseLabel}>Collapse</Text>
                  </TouchableOpacity>
                )}
                <View style={styles.myFeedbackInfo}>
                  <Text style={styles.myFeedbackTitle} numberOfLines={1}>{item.title}</Text>
                  <Text style={styles.myFeedbackStatus}>{statusLabel(item.status)}</Text>
                  {item.admin_reply ? (
                    <View style={styles.myFeedbackReplyBox}>
                      <Text style={styles.myFeedbackReplyLabel}>
                        {!item.reply_seen ? '🟢 Response received:' : 'Response:'}
                      </Text>
                      <Text style={styles.myFeedbackReplyText}>{item.admin_reply}</Text>
                    </View>
                  ) : null}
                </View>
                {canEdit && (
                  <TouchableOpacity
                    style={styles.myFeedbackEditBtn}
                    onPress={() => {
                      setEditingId(item.id);
                      setCategory(item.category);
                      setTitle(item.title);
                      setDescription(item.body);
                      setError(null);
                      setSuccess(false);
                      setShowModal(true);
                    }}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.myFeedbackEditText}>Edit</Text>
                  </TouchableOpacity>
                )}
              </View>
            );
          })}
        </View>
      )}

      <Modal
        visible={showModal}
        transparent
        animationType="slide"
        onRequestClose={() => { setShowModal(false); resetForm(); }}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{editingId ? 'Edit Feedback' : 'Send Feedback'}</Text>
            <Text style={styles.modalSubtitle}>
              {editingId ? 'Update your submission.' : 'Report a bug or suggest a feature.'}
            </Text>
            {success ? (
              <View style={styles.successBox}>
                <Text style={styles.successText}>Thanks! Feedback sent.</Text>
              </View>
            ) : (
              <>
                {error && (
                  <View style={styles.errorBox}>
                    <Text style={styles.errorText}>{error}</Text>
                  </View>
                )}
                <Text style={styles.inputLabel}>Category</Text>
                <View style={styles.segmentedControl}>
                  {(['bug', 'feature', 'other'] as const).map((cat) => (
                    <TouchableOpacity
                      key={cat}
                      style={[styles.segmentBtn, category === cat && styles.segmentBtnSelected]}
                      onPress={() => setCategory(cat)}
                      activeOpacity={0.8}
                    >
                      <Text style={[
                        styles.segmentBtnText,
                        category === cat && styles.segmentBtnTextSelected,
                      ]}>
                        {cat === 'feature' ? 'Feature Request' : cat.charAt(0).toUpperCase() + cat.slice(1)}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <Text style={styles.inputLabel}>Title</Text>
                <TextInput
                  style={styles.input}
                  value={title}
                  onChangeText={setTitle}
                  placeholder="Short title..."
                  placeholderTextColor="#9ca3af"
                  returnKeyType="next"
                />
                <Text style={styles.inputLabel}>Description</Text>
                <TextInput
                  style={[styles.input, styles.descriptionInput]}
                  value={description}
                  onChangeText={setDescription}
                  placeholder="Describe it..."
                  placeholderTextColor="#9ca3af"
                  multiline
                  textAlignVertical="top"
                />
                {!editingId && (
                  <TouchableOpacity
                    style={styles.attachBtn}
                    onPress={handlePickAttachment}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.attachBtnText}>
                      {attachmentUri ? '📎 Change Screenshot' : '📎 Attach Screenshot (optional)'}
                    </Text>
                  </TouchableOpacity>
                )}
                {!editingId && attachmentUri && (
                  <View style={styles.attachPreview}>
                    <Image source={{ uri: attachmentUri }} style={styles.attachThumb} resizeMode="cover" />
                    <TouchableOpacity style={styles.attachRemoveBtn} onPress={clearAttachment}>
                      <Text style={styles.attachRemoveText}>✕</Text>
                    </TouchableOpacity>
                  </View>
                )}
                <View style={styles.modalButtons}>
                  <TouchableOpacity
                    style={styles.cancelBtn}
                    onPress={() => { setShowModal(false); resetForm(); }}
                  >
                    <Text style={styles.cancelBtnText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.saveBtn,
                      (!title.trim() || !description.trim() || submitting) && styles.saveBtnDisabled,
                    ]}
                    onPress={handleSubmit}
                    disabled={!title.trim() || !description.trim() || submitting}
                  >
                    {submitting
                      ? <ActivityIndicator size="small" color="#fff" />
                      : <Text style={styles.saveBtnText}>{editingId ? 'Save Changes' : 'Submit'}</Text>
                    }
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1e293b',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 8,
    gap: 10,
  },
  actionButtonEmoji: { fontSize: 18 },
  actionButtonText: { color: '#fff', fontSize: 15, fontWeight: '600' },

  myFeedbackList: { marginTop: 12 },
  myFeedbackHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
  },
  myFeedbackLabel: {
    color: '#6b7280',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.5,
  },
  myFeedbackNotifDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#22c55e' },
  myFeedbackRow: {
    backgroundColor: '#111827',
    borderRadius: 8,
    padding: 10,
    marginBottom: 6,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  myFeedbackInfo: { flex: 1 },
  myFeedbackTitle: { color: '#e5e7eb', fontSize: 13, fontWeight: '600' },
  myFeedbackStatus: { color: '#9ca3af', fontSize: 11, marginTop: 2 },
  myFeedbackReplyBox: {
    backgroundColor: '#0d2a10',
    borderLeftWidth: 3,
    borderLeftColor: '#22c55e',
    padding: 8,
    marginTop: 8,
    borderRadius: 4,
  },
  myFeedbackReplyLabel: { color: '#4ade80', fontSize: 10, fontWeight: '700', marginBottom: 2 },
  myFeedbackReplyText: { color: '#d1fae5', fontSize: 12, lineHeight: 18 },
  myFeedbackEditBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: '#1e293b',
    borderWidth: 1,
    borderColor: '#334155',
  },
  myFeedbackEditText: { color: '#9ca3af', fontSize: 11, fontWeight: '600' },

  myFeedbackCollapsed: {
    backgroundColor: '#111827',
    borderRadius: 8,
    padding: 10,
    marginBottom: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderLeftWidth: 3,
    borderLeftColor: '#22c55e',
  },
  myFeedbackChevron: { color: '#4ade80', fontSize: 10, fontWeight: '700', width: 12 },
  myFeedbackCollapsedTitle: { flex: 1, color: '#9ca3af', fontSize: 12, fontWeight: '500' },
  myFeedbackCollapsedStatus: { color: '#4ade80', fontSize: 10, fontWeight: '700' },
  myFeedbackCollapseHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
  },
  myFeedbackCollapseLabel: { color: '#4ade80', fontSize: 10, fontWeight: '600' },

  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    padding: 20,
  },
  modalCard: {
    backgroundColor: '#1e293b',
    borderRadius: 14,
    padding: 18,
  },
  modalTitle: { color: '#fff', fontSize: 17, fontWeight: '700', marginBottom: 4 },
  modalSubtitle: { color: '#9ca3af', fontSize: 13, marginBottom: 14 },
  inputLabel: { color: '#9ca3af', fontSize: 11, fontWeight: '700', letterSpacing: 1, marginTop: 10, marginBottom: 6 },
  input: {
    backgroundColor: '#0f172a',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#334155',
    color: '#f1f5f9',
    fontSize: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  descriptionInput: { minHeight: 90 },
  segmentedControl: { flexDirection: 'row', gap: 6 },
  segmentBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
    backgroundColor: '#0f172a',
    borderWidth: 1,
    borderColor: '#334155',
  },
  segmentBtnSelected: { backgroundColor: '#1e3a5f', borderColor: '#60a5fa' },
  segmentBtnText: { color: '#9ca3af', fontSize: 12, fontWeight: '600' },
  segmentBtnTextSelected: { color: '#93c5fd' },
  attachBtn: {
    marginTop: 10,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
    backgroundColor: '#0f172a',
    borderWidth: 1,
    borderColor: '#334155',
    borderStyle: 'dashed',
  },
  attachBtnText: { color: '#9ca3af', fontSize: 12, fontWeight: '600' },
  attachPreview: {
    marginTop: 8,
    position: 'relative',
  },
  attachThumb: { width: '100%' as any, height: 140, borderRadius: 8 },
  attachRemoveBtn: {
    position: 'absolute',
    top: 6,
    right: 6,
    backgroundColor: 'rgba(0,0,0,0.7)',
    borderRadius: 12,
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  attachRemoveText: { color: '#fff', fontSize: 12, fontWeight: '700' },

  modalButtons: { flexDirection: 'row', gap: 8, marginTop: 14 },
  cancelBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
    backgroundColor: '#0f172a',
    borderWidth: 1,
    borderColor: '#334155',
  },
  cancelBtnText: { color: '#94a3b8', fontSize: 14, fontWeight: '600' },
  saveBtn: {
    flex: 2,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
    backgroundColor: '#f97316',
  },
  saveBtnDisabled: { opacity: 0.4 },
  saveBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },

  errorBox: {
    backgroundColor: '#7f1d1d',
    borderRadius: 6,
    padding: 8,
    marginBottom: 8,
  },
  errorText: { color: '#fca5a5', fontSize: 12 },
  successBox: {
    backgroundColor: '#052e16',
    borderRadius: 6,
    padding: 14,
    alignItems: 'center',
  },
  successText: { color: '#4ade80', fontSize: 14, fontWeight: '600' },
});
