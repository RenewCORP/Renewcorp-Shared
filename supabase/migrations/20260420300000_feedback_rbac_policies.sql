-- ============================================================
-- Harden feedback RLS + RPC using RBAC permissions.
-- Depends on RBAC migration (20260420200000_rbac.sql) for has_permission.
-- ============================================================

-- ── Tighter RLS policies: users see only own + completed/in_progress,
--    admins (with feedback_admin permission) see everything ───────────────
DROP POLICY IF EXISTS "feedback: authenticated insert"     ON feedback;
DROP POLICY IF EXISTS "feedback: authenticated can read"   ON feedback;
DROP POLICY IF EXISTS "feedback: authenticated can update" ON feedback;

CREATE POLICY "feedback: insert own"
  ON feedback FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "feedback: select by permission or ownership"
  ON feedback FOR SELECT
  USING (
    user_id = auth.uid()
    OR has_permission('feedback_admin')
    OR status IN ('in_progress', 'completed')
  );

CREATE POLICY "feedback: update own new or admin"
  ON feedback FOR UPDATE
  USING (
    (user_id = auth.uid() AND status = 'new')
    OR has_permission('feedback_admin')
  )
  WITH CHECK (
    (user_id = auth.uid() AND status = 'new')
    OR has_permission('feedback_admin')
  );

-- ── Filter get_all_feedback by permission ────────────────────────────────────
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
  WHERE has_permission('feedback_admin')
     OR f.user_id = auth.uid()
     OR f.status IN ('in_progress', 'completed')
  ORDER BY f.created_at DESC;
$$;
GRANT EXECUTE ON FUNCTION get_all_feedback() TO authenticated;

NOTIFY pgrst, 'reload schema';
