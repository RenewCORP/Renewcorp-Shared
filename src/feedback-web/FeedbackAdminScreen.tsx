import React, { useEffect, useState, useCallback } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { FeedbackRow, FeedbackStatus } from '../feedback/types';

interface Props {
  supabase: SupabaseClient;
  onBack: () => void;
}

function CategoryBadge({ category }: { category: FeedbackRow['category'] }) {
  const label = category === 'bug' ? 'Bug' : category === 'feature' ? 'Feature' : 'Other';
  const cls =
    category === 'bug'
      ? 'bg-red-100 text-red-700 dark:bg-red-950/30 dark:text-red-300'
      : category === 'feature'
      ? 'bg-blue-100 text-blue-700 dark:bg-blue-950/30 dark:text-blue-300'
      : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300';
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold tracking-wide ${cls}`}>
      {label}
    </span>
  );
}

function StatusBadge({ status }: { status: FeedbackStatus }) {
  const map: Record<FeedbackStatus, { label: string; cls: string }> = {
    new:         { label: 'New',         cls: 'bg-orange-100 text-er-orange dark:bg-orange-950/30 dark:text-orange-300' },
    in_progress: { label: 'In Progress', cls: 'bg-blue-100 text-er-blue   dark:bg-blue-950/30   dark:text-blue-300' },
    completed:   { label: 'Completed',   cls: 'bg-green-100 text-green-700 dark:bg-green-950/30 dark:text-green-300' },
  };
  const { label, cls } = map[status] ?? map.new;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold tracking-wide ${cls}`}>
      {label}
    </span>
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

      const role = profileData?.role;
      if (role !== 'admin' && role !== 'super_admin') {
        setIsAdmin(false);
        setLoading(false);
        return;
      }
      setIsAdmin(true);

      const { data, error: rpcError } = await supabase.rpc('get_all_feedback');
      if (cancelled) return;

      if (rpcError) { setError(rpcError.message); setLoading(false); return; }

      setItems(sortItems((data as FeedbackRow[]) ?? []));
      setLoading(false);

      supabase
        .from('feedback')
        .update({ is_read: true })
        .eq('is_read', false)
        .then(() => {
          if (!cancelled) setItems((prev) => prev.map((i) => ({ ...i, is_read: true })));
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
        sortItems(prev.map((i) =>
          i.id === id ? { ...i, status: 'completed' as FeedbackStatus, admin_reply: reply.trim(), is_read: true } : i
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
      if (next.has(id)) next.delete(id); else next.add(id);
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
      setItems((prev) => sortItems(prev.map((i) => (i.id === id ? { ...i, status, is_read: true } : i))));
    }
    setUpdatingId(null);
  }, [supabase]);

  const firstCompletedIdx = items.findIndex((i) => i.status === 'completed');

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-gray-400">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-er-orange border-t-transparent" />
      </div>
    );
  }

  if (isAdmin === false) {
    return (
      <div className="p-8 text-center text-sm text-red-600 dark:text-red-400">Access denied.</div>
    );
  }

  if (error) {
    return (
      <div className="p-8 text-center text-sm text-red-600 dark:text-red-400">{error}</div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={onBack}
          className="px-3 py-1.5 rounded-md bg-gray-100 dark:bg-[#2d3a6e] text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-[#3d4a7e]"
        >
          ← Back
        </button>
        <h1 className="text-xl font-semibold text-gray-900 dark:text-white">Feedback</h1>
      </div>

      {items.length === 0 ? (
        <div className="p-8 text-center text-sm text-gray-500">No feedback yet.</div>
      ) : (
        <div className="space-y-3">
          {items.map((item, idx) => {
            const isCompleting = completingId === item.id;
            const collapsed = item.status === 'completed' && !expandedIds.has(item.id);

            return (
              <React.Fragment key={item.id}>
                {idx === firstCompletedIdx && firstCompletedIdx > 0 && (
                  <div className="pt-4 pb-1 text-[10px] font-semibold tracking-widest text-green-600 dark:text-green-400">
                    COMPLETED
                  </div>
                )}

                {collapsed ? (
                  <button
                    onClick={() => toggleExpanded(item.id)}
                    className="w-full flex items-center gap-2 bg-white dark:bg-[#212b5e] border-l-2 border-green-500 rounded-md px-3 py-2 text-left hover:bg-gray-50 dark:hover:bg-[#2a3470]"
                  >
                    <span className="text-green-600 dark:text-green-400 text-xs w-3">▶</span>
                    <CategoryBadge category={item.category} />
                    <StatusBadge status={item.status} />
                    <span className="flex-1 text-sm text-gray-600 dark:text-gray-400 truncate">{item.title}</span>
                    <span className="text-xs text-gray-400">{formatDate(item.created_at)}</span>
                  </button>
                ) : (
                  <div
                    className={`rounded-md border-l-2 p-4 ${
                      !item.is_read
                        ? 'bg-orange-50 dark:bg-[#2a2340] border-er-orange'
                        : 'bg-white dark:bg-[#212b5e] border-transparent'
                    }`}
                  >
                    {item.status === 'completed' && (
                      <button
                        onClick={() => toggleExpanded(item.id)}
                        className="flex items-center gap-1.5 mb-3 text-xs font-medium text-green-600 dark:text-green-400 hover:opacity-70"
                      >
                        <span>▼</span> Collapse
                      </button>
                    )}

                    <div className="flex items-center gap-2 mb-2">
                      <CategoryBadge category={item.category} />
                      <StatusBadge status={item.status} />
                      {!item.is_read && (
                        <span className="ml-auto w-2 h-2 rounded-full bg-er-orange" />
                      )}
                    </div>

                    <h3 className="text-[15px] font-semibold text-gray-900 dark:text-white mb-1.5">{item.title}</h3>
                    <p className="text-sm text-gray-700 dark:text-gray-300 leading-6 mb-3 whitespace-pre-wrap">{item.body}</p>

                    {item.attachment_url && (
                      <a
                        href={item.attachment_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block rounded-md overflow-hidden mb-3 max-w-md"
                      >
                        <img src={item.attachment_url} alt="attachment" className="w-full h-auto" />
                      </a>
                    )}

                    {item.admin_reply && (
                      <div className="bg-green-50 dark:bg-green-950/20 border border-green-500/40 rounded-md p-3 mb-3">
                        <div className="text-[10px] font-semibold text-green-700 dark:text-green-400 tracking-wide mb-1">
                          REPLY SENT TO USER
                        </div>
                        <div className="text-sm text-green-900 dark:text-green-200 whitespace-pre-wrap">{item.admin_reply}</div>
                      </div>
                    )}

                    <div className="flex items-center justify-between border-t border-gray-100 dark:border-[#2d3a6e] pt-2 mb-3">
                      <span className="text-xs font-medium text-gray-500 dark:text-gray-400">{item.username}</span>
                      <span className="text-xs text-gray-400">{formatDate(item.created_at)}</span>
                    </div>

                    {isCompleting ? (
                      <div className="border-t border-gray-100 dark:border-[#2d3a6e] pt-3 mt-1">
                        <div className="text-[11px] font-semibold text-amber-600 dark:text-amber-400 tracking-wide mb-2">
                          RESOLUTION — REQUIRED TO MARK COMPLETED
                        </div>
                        <textarea
                          value={completionReply}
                          onChange={(e) => setCompletionReply(e.target.value)}
                          placeholder="Describe what was done, fixed, or implemented…"
                          rows={3}
                          autoFocus
                          className="w-full rounded-md border border-gray-300 dark:border-[#3d4a7e] bg-white dark:bg-[#1a2040] text-sm text-gray-900 dark:text-gray-100 px-3 py-2 mb-2 focus:outline-none focus:ring-2 focus:ring-er-orange"
                        />
                        {completionError && (
                          <div className="text-xs text-red-600 dark:text-red-400 mb-2">{completionError}</div>
                        )}
                        <div className="flex gap-2">
                          <button
                            onClick={() => { setCompletingId(null); setCompletionReply(''); setCompletionError(null); }}
                            className="flex-1 py-1.5 rounded-md bg-gray-100 dark:bg-[#2d3a6e] text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-[#3d4a7e]"
                          >
                            Cancel
                          </button>
                          <button
                            onClick={() => handleComplete(item.id, completionReply)}
                            disabled={!completionReply.trim() || savingCompletionId === item.id}
                            className="flex-[2] py-1.5 rounded-md bg-green-500 hover:bg-green-600 text-sm font-semibold text-white disabled:opacity-40"
                          >
                            {savingCompletionId === item.id ? 'Saving…' : 'Save & Complete'}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex gap-1.5">
                        {STATUS_OPTIONS.map((opt) => {
                          const active = item.status === opt.value;
                          const busy = updatingId === item.id || savingCompletionId === item.id;
                          return (
                            <button
                              key={opt.value}
                              onClick={() => {
                                if (opt.value === 'completed' && item.status !== 'completed') {
                                  setCompletingId(item.id);
                                  setCompletionReply(item.admin_reply ?? '');
                                } else if (item.status !== opt.value) {
                                  handleStatusChange(item.id, opt.value);
                                }
                              }}
                              disabled={busy}
                              className={`flex-1 py-1.5 rounded-md text-xs font-medium transition border ${
                                active
                                  ? 'bg-blue-100 dark:bg-blue-950/40 border-blue-400 text-er-blue'
                                  : 'bg-white dark:bg-[#1a2040] border-gray-200 dark:border-[#2d3a6e] text-gray-500 dark:text-gray-400 hover:border-gray-300'
                              } disabled:opacity-40`}
                            >
                              {opt.label}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </React.Fragment>
            );
          })}
        </div>
      )}
    </div>
  );
}
