-- ============================================================
-- RBAC: roles, role_permissions, user_roles (idempotent)
-- Generic schema — apps seed their own roles + permission strings.
-- ============================================================

-- ── Tables ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS roles (
  id          uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        text        NOT NULL UNIQUE,
  description text,
  is_system   boolean     NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id        uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_key text NOT NULL,
  PRIMARY KEY (role_id, permission_key)
);

CREATE TABLE IF NOT EXISTS user_roles (
  user_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role_id     uuid        NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, role_id)
);

ALTER TABLE roles            ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_roles       ENABLE ROW LEVEL SECURITY;

-- ── Permission check function (SECURITY DEFINER avoids RLS recursion) ────────
CREATE OR REPLACE FUNCTION has_permission(p_permission text)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT EXISTS (
    SELECT 1
    FROM user_roles ur
    JOIN role_permissions rp ON rp.role_id = ur.role_id
    WHERE ur.user_id = auth.uid()
      AND rp.permission_key = p_permission
  );
$$;
GRANT EXECUTE ON FUNCTION has_permission(text) TO authenticated;

CREATE OR REPLACE FUNCTION get_my_permissions()
RETURNS SETOF text LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT DISTINCT rp.permission_key
  FROM user_roles ur
  JOIN role_permissions rp ON rp.role_id = ur.role_id
  WHERE ur.user_id = auth.uid();
$$;
GRANT EXECUTE ON FUNCTION get_my_permissions() TO authenticated;

CREATE OR REPLACE FUNCTION get_roles_with_permissions()
RETURNS TABLE (
  id          uuid,
  name        text,
  description text,
  is_system   boolean,
  permissions text[]
) LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT r.id, r.name, r.description, r.is_system,
         COALESCE(array_agg(rp.permission_key) FILTER (WHERE rp.permission_key IS NOT NULL), '{}')
  FROM roles r
  LEFT JOIN role_permissions rp ON rp.role_id = r.id
  GROUP BY r.id, r.name, r.description, r.is_system
  ORDER BY r.is_system DESC, r.name;
$$;
GRANT EXECUTE ON FUNCTION get_roles_with_permissions() TO authenticated;

CREATE OR REPLACE FUNCTION get_users_with_roles()
RETURNS TABLE (
  user_id   uuid,
  username  text,
  role_ids  uuid[],
  role_names text[]
) LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT p.id AS user_id,
         COALESCE(p.username, 'Anonymous') AS username,
         COALESCE(array_agg(ur.role_id) FILTER (WHERE ur.role_id IS NOT NULL), '{}') AS role_ids,
         COALESCE(array_agg(r.name)     FILTER (WHERE r.name     IS NOT NULL), '{}') AS role_names
  FROM profiles p
  LEFT JOIN user_roles ur ON ur.user_id = p.id
  LEFT JOIN roles r       ON r.id = ur.role_id
  GROUP BY p.id, p.username
  ORDER BY p.username;
$$;
GRANT EXECUTE ON FUNCTION get_users_with_roles() TO authenticated;

-- ── Mutation RPCs (gated by has_permission internally) ───────────────────────
CREATE OR REPLACE FUNCTION update_role_permissions(p_role_id uuid, p_permissions text[])
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NOT has_permission('manage_roles') THEN
    RAISE EXCEPTION 'Forbidden: requires manage_roles permission';
  END IF;
  DELETE FROM role_permissions WHERE role_id = p_role_id;
  INSERT INTO role_permissions (role_id, permission_key)
    SELECT p_role_id, unnest(p_permissions)
    ON CONFLICT DO NOTHING;
END;
$$;
GRANT EXECUTE ON FUNCTION update_role_permissions(uuid, text[]) TO authenticated;

CREATE OR REPLACE FUNCTION create_role(p_name text, p_description text, p_permissions text[])
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  new_id uuid;
BEGIN
  IF NOT has_permission('manage_roles') THEN
    RAISE EXCEPTION 'Forbidden: requires manage_roles permission';
  END IF;
  INSERT INTO roles (name, description) VALUES (p_name, p_description) RETURNING id INTO new_id;
  IF p_permissions IS NOT NULL AND array_length(p_permissions, 1) > 0 THEN
    INSERT INTO role_permissions (role_id, permission_key)
      SELECT new_id, unnest(p_permissions);
  END IF;
  RETURN new_id;
END;
$$;
GRANT EXECUTE ON FUNCTION create_role(text, text, text[]) TO authenticated;

CREATE OR REPLACE FUNCTION delete_role(p_role_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NOT has_permission('manage_roles') THEN
    RAISE EXCEPTION 'Forbidden: requires manage_roles permission';
  END IF;
  IF EXISTS (SELECT 1 FROM roles WHERE id = p_role_id AND is_system) THEN
    RAISE EXCEPTION 'Cannot delete a system role';
  END IF;
  DELETE FROM roles WHERE id = p_role_id;
END;
$$;
GRANT EXECUTE ON FUNCTION delete_role(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION assign_user_role(p_user_id uuid, p_role_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NOT has_permission('manage_users') THEN
    RAISE EXCEPTION 'Forbidden: requires manage_users permission';
  END IF;
  INSERT INTO user_roles (user_id, role_id) VALUES (p_user_id, p_role_id)
    ON CONFLICT DO NOTHING;
END;
$$;
GRANT EXECUTE ON FUNCTION assign_user_role(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION revoke_user_role(p_user_id uuid, p_role_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NOT has_permission('manage_users') THEN
    RAISE EXCEPTION 'Forbidden: requires manage_users permission';
  END IF;
  DELETE FROM user_roles WHERE user_id = p_user_id AND role_id = p_role_id;
END;
$$;
GRANT EXECUTE ON FUNCTION revoke_user_role(uuid, uuid) TO authenticated;

-- ── RLS (tables are effectively read-only from clients; mutate via RPCs) ─────
DROP POLICY IF EXISTS "roles: authenticated read"           ON roles;
DROP POLICY IF EXISTS "role_permissions: authenticated read" ON role_permissions;
DROP POLICY IF EXISTS "user_roles: own rows"                 ON user_roles;
DROP POLICY IF EXISTS "user_roles: managers read all"        ON user_roles;

CREATE POLICY "roles: authenticated read"
  ON roles FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "role_permissions: authenticated read"
  ON role_permissions FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "user_roles: own rows"
  ON user_roles FOR SELECT
  USING (user_id = auth.uid() OR has_permission('manage_users'));

NOTIFY pgrst, 'reload schema';
