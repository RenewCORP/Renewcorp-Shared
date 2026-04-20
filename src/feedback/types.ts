export type FeedbackStatus = 'new' | 'in_progress' | 'completed';

export interface FeedbackRow {
  id: string;
  user_id: string | null;
  username: string;
  category: 'bug' | 'feature' | 'other';
  title: string;
  body: string;
  is_read: boolean;
  status: FeedbackStatus;
  attachment_url: string | null;
  admin_reply: string | null;
  reply_seen: boolean;
  created_at: string;
}
