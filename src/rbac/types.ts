export interface Role {
  id: string;
  name: string;
  description: string | null;
  is_system: boolean;
  permissions: string[];
}

export interface UserWithRoles {
  user_id: string;
  username: string;
  role_ids: string[];
  role_names: string[];
}

/** Permission definition — the human-readable label + the key used in the database. */
export interface PermissionDef {
  /** Stable key stored in role_permissions.permission_key */
  key: string;
  /** Column header label shown in the matrix */
  label: string;
  /** Optional grouping for rendering (future) */
  group?: string;
}
