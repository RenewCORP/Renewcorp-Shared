-- ============================================================
-- Feedback system — complete schema (idempotent)
-- Safe to run against fresh or existing databases.
-- Requires: profiles table with (id uuid, username text, role text)
-- ============================================================

-- ── Table ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS feedback (
  id             uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id        uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  category       text        NOT NULL CHECK (category IN ('bug', 'feature', 'other')),
  title          text        NOT NULL,
  body           text        NOT NULL,
  is_read        boolean     NOT NULL DEFAULT false,
  status         text        NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'in_progress', 'completed')),
  attachment_url text,
  admin_reply    text,
  reply_seen     boolean     NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- Safety: add any missing columns on existing tables
ALTER TABLE feedback ADD COLUMN IF NOT EXISTS is_read        boolean     NOT NULL DEFAULT false;
ALTER TABLE feedback ADD COLUMN IF NOT EXISTS status         text        NOT NULL DEFAULT 'new';
ALTER TABLE feedback ADD COLUMN IF NOT EXISTS attachment_url text;
ALTER TABLE feedback ADD COLUMN IF NOT EXISTS admin_reply    text;
ALTER TABLE feedback ADD COLUMN IF NOT EXISTS reply_seen     boolean     NOT NULL DEFAULT true;

ALTER TABLE feedback ENABLE ROW LEVEL SECURITY;

-- ── RLS policies ──────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "feedback: authenticated insert"         ON feedback;
DROP POLICY IF EXISTS "feedback: authenticated can read"       ON feedback;
DROP POLICY IF EXISTS "feedback: authenticated can update"     ON feedback;
DROP POLICY IF EXISTS "feedback: authenticated can update is_read" ON feedback;

CREATE POLICY "feedback: authenticated insert"
  ON feedback FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "feedback: authenticated can read"
  ON feedback FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "feedback: authenticated can update"
  ON feedback FOR UPDATE
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

GRANT ALL ON feedback TO authenticated;

-- ── Storage bucket for attachments ────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('feedback-attachments', 'feedback-attachments', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "feedback-attachments: authenticated upload" ON storage.objects;
DROP POLICY IF EXISTS "feedback-attachments: public read"           ON storage.objects;

CREATE POLICY "feedback-attachments: authenticated upload"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'feedback-attachments');

CREATE POLICY "feedback-attachments: public read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'feedback-attachments');

-- ── Trigger: flip reply_seen=false when admin sets/changes admin_reply ────────
CREATE OR REPLACE FUNCTION _on_feedback_reply_changed()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.admin_reply IS DISTINCT FROM OLD.admin_reply)
     AND NEW.admin_reply IS NOT NULL
     AND trim(NEW.admin_reply) <> '' THEN
    NEW.reply_seen := false;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS feedback_reply_notify ON feedback;
CREATE TRIGGER feedback_reply_notify
  BEFORE UPDATE ON feedback
  FOR EACH ROW EXECUTE FUNCTION _on_feedback_reply_changed();

-- ── RPCs ──────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS get_all_feedback();

CREATE OR REPLACE FUNCTION get_all_feedback()
RETURNS TABLE (
  id             uuid,
  user_id        uuid,
  username       text,
  category       text,
  title          text,
  body           text,
  is_read        boolean,
  status         text,
  attachment_url text,
  admin_reply    text,
  reply_seen     boolean,
  created_at     timestamptz
) LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT f.id, f.user_id, COALESCE(p.username, 'Anonymous') AS username,
         f.category, f.title, f.body, f.is_read, f.status, f.attachment_url,
         f.admin_reply, f.reply_seen, f.created_at
  FROM feedback f
  LEFT JOIN profiles p ON p.id = f.user_id
  ORDER BY f.created_at DESC;
$$;
GRANT EXECUTE ON FUNCTION get_all_feedback() TO authenticated;

CREATE OR REPLACE FUNCTION mark_reply_seen(p_feedback_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE feedback SET reply_seen = true
  WHERE id = p_feedback_id AND user_id = auth.uid();
END;
$$;
GRANT EXECUTE ON FUNCTION mark_reply_seen(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
