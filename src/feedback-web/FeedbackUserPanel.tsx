import { useEffect, useState, useCallback, useRef } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { FeedbackStatus } from '../feedback/types';

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
      supabase.rpc('mark_reply_seen', { p_feedback_id: i.id }).then(() => {}, () => {});
    });
  }, [supabase]);

  useEffect(() => { fetchMyFeedback(); }, [fetchMyFeedback]);

  const clearAttachment = useCallback(() => {
    if (attachmentUri) URL.revokeObjectURL(attachmentUri);
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

  const handlePickAttachment = useCallback(() => {
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
      if (attachmentUri && attachmentFileRef.current) {
        const file = attachmentFileRef.current;
        const path = `${user?.id ?? 'anon'}/${Date.now()}.jpg`;
        const { data, error: err } = await supabase.storage
          .from('feedback-attachments')
          .upload(path, file, { contentType: file.type, upsert: false });
        if (!err && data?.path) {
          const { data: { publicUrl } } = supabase.storage
            .from('feedback-attachments')
            .getPublicUrl(data.path);
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

  const statusClass = (s: FeedbackStatus) =>
    s === 'new' ? 'bg-orange-100 text-er-orange dark:bg-orange-950/30 dark:text-orange-300'
    : s === 'in_progress' ? 'bg-blue-100 text-er-blue dark:bg-blue-950/30 dark:text-blue-300'
    : 'bg-green-100 text-green-700 dark:bg-green-950/30 dark:text-green-300';

  return (
    <>
      <button
        onClick={() => { resetForm(); setShowModal(true); }}
        className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-er-orange text-white text-sm font-semibold hover:opacity-90"
      >
        <span>💬</span> Send Feedback
      </button>

      {myFeedback.length > 0 && (
        <div className="mt-6">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[10px] font-semibold tracking-widest text-gray-500 dark:text-gray-400">MY SUBMISSIONS</span>
            {myFeedback.some(i => !i.reply_seen && i.admin_reply) && (
              <span className="w-2 h-2 rounded-full bg-green-500" />
            )}
          </div>
          <div className="space-y-2">
            {myFeedback.map((item) => {
              const canEdit = item.status === 'new';
              const collapsed = item.status === 'completed' && !expandedIds.has(item.id);

              if (collapsed) {
                return (
                  <button
                    key={item.id}
                    onClick={() => toggleExpanded(item.id)}
                    className="w-full flex items-center gap-2 bg-white dark:bg-[#212b5e] border-l-2 border-green-500 rounded-md px-3 py-2 text-left hover:bg-gray-50 dark:hover:bg-[#2a3470]"
                  >
                    <span className="text-green-600 dark:text-green-400 text-xs w-3">▶</span>
                    <span className="flex-1 text-sm text-gray-600 dark:text-gray-400 truncate">{item.title}</span>
                    <span className="text-[10px] font-semibold text-green-600 dark:text-green-400">Completed</span>
                  </button>
                );
              }

              return (
                <div key={item.id} className="bg-white dark:bg-[#212b5e] rounded-md p-3">
                  {item.status === 'completed' && (
                    <button
                      onClick={() => toggleExpanded(item.id)}
                      className="flex items-center gap-1.5 mb-2 text-xs font-medium text-green-600 dark:text-green-400 hover:opacity-70"
                    >
                      <span>▼</span> Collapse
                    </button>
                  )}
                  <div className="flex items-start gap-2">
                    <div className="flex-1">
                      <div className="text-sm font-semibold text-gray-900 dark:text-white truncate">{item.title}</div>
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold mt-1 ${statusClass(item.status)}`}>
                        {statusLabel(item.status)}
                      </span>
                      {item.admin_reply && (
                        <div className="mt-2 bg-green-50 dark:bg-green-950/20 border-l-2 border-green-500 rounded px-3 py-2">
                          <div className="text-[10px] font-semibold text-green-700 dark:text-green-400 mb-0.5">
                            {!item.reply_seen ? '🟢 Response received:' : 'Response:'}
                          </div>
                          <div className="text-sm text-green-900 dark:text-green-200 whitespace-pre-wrap">{item.admin_reply}</div>
                        </div>
                      )}
                    </div>
                    {canEdit && (
                      <button
                        onClick={() => {
                          setEditingId(item.id);
                          setCategory(item.category);
                          setTitle(item.title);
                          setDescription(item.body);
                          setError(null);
                          setSuccess(false);
                          setShowModal(true);
                        }}
                        className="px-3 py-1 text-xs font-medium rounded-md bg-gray-100 dark:bg-[#2d3a6e] text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-[#3d4a7e]"
                      >
                        Edit
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-lg bg-white dark:bg-[#1a2040] rounded-lg p-5 shadow-xl">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
              {editingId ? 'Edit Feedback' : 'Send Feedback'}
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
              {editingId ? 'Update your submission.' : 'Report a bug or suggest a feature.'}
            </p>

            {success ? (
              <div className="bg-green-50 dark:bg-green-950/20 border border-green-500/40 rounded-md p-4 text-center text-green-700 dark:text-green-400 font-medium">
                Thanks! Feedback sent.
              </div>
            ) : (
              <>
                {error && (
                  <div className="bg-red-50 dark:bg-red-950/20 border border-red-500/40 rounded-md px-3 py-2 text-sm text-red-700 dark:text-red-300 mb-3">
                    {error}
                  </div>
                )}

                <label className="block text-[10px] font-semibold tracking-wider text-gray-500 dark:text-gray-400 mb-1">CATEGORY</label>
                <div className="flex gap-2 mb-3">
                  {(['bug', 'feature', 'other'] as const).map((cat) => (
                    <button
                      key={cat}
                      onClick={() => setCategory(cat)}
                      className={`flex-1 py-1.5 rounded-md text-xs font-medium border transition ${
                        category === cat
                          ? 'bg-blue-100 dark:bg-blue-950/40 border-blue-400 text-er-blue'
                          : 'bg-gray-50 dark:bg-[#212b5e] border-gray-200 dark:border-[#2d3a6e] text-gray-500 dark:text-gray-400 hover:border-gray-300'
                      }`}
                    >
                      {cat === 'feature' ? 'Feature Request' : cat.charAt(0).toUpperCase() + cat.slice(1)}
                    </button>
                  ))}
                </div>

                <label className="block text-[10px] font-semibold tracking-wider text-gray-500 dark:text-gray-400 mb-1">TITLE</label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Short title..."
                  className="w-full rounded-md border border-gray-300 dark:border-[#3d4a7e] bg-white dark:bg-[#212b5e] text-sm text-gray-900 dark:text-gray-100 px-3 py-2 mb-3 focus:outline-none focus:ring-2 focus:ring-er-orange"
                />

                <label className="block text-[10px] font-semibold tracking-wider text-gray-500 dark:text-gray-400 mb-1">DESCRIPTION</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Describe it..."
                  rows={4}
                  className="w-full rounded-md border border-gray-300 dark:border-[#3d4a7e] bg-white dark:bg-[#212b5e] text-sm text-gray-900 dark:text-gray-100 px-3 py-2 mb-3 focus:outline-none focus:ring-2 focus:ring-er-orange"
                />

                {!editingId && (
                  <button
                    onClick={handlePickAttachment}
                    className="w-full py-2 rounded-md border border-dashed border-gray-300 dark:border-[#3d4a7e] text-xs font-medium text-gray-600 dark:text-gray-400 hover:border-gray-400 mb-3"
                  >
                    {attachmentUri ? '📎 Change Screenshot' : '📎 Attach Screenshot (optional)'}
                  </button>
                )}

                {!editingId && attachmentUri && (
                  <div className="relative mb-3">
                    <img src={attachmentUri} alt="attachment" className="w-full max-h-44 object-cover rounded-md" />
                    <button
                      onClick={clearAttachment}
                      className="absolute top-2 right-2 w-6 h-6 flex items-center justify-center rounded-full bg-black/70 text-white text-xs"
                    >
                      ✕
                    </button>
                  </div>
                )}

                <div className="flex gap-2">
                  <button
                    onClick={() => { setShowModal(false); resetForm(); }}
                    className="flex-1 py-2 rounded-md bg-gray-100 dark:bg-[#2d3a6e] text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-[#3d4a7e]"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSubmit}
                    disabled={!title.trim() || !description.trim() || submitting}
                    className="flex-[2] py-2 rounded-md bg-er-orange text-white text-sm font-semibold hover:opacity-90 disabled:opacity-40"
                  >
                    {submitting ? 'Saving…' : editingId ? 'Save Changes' : 'Submit'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
