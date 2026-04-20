import { useEffect, useState, useCallback } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';

export interface Permissions {
  /** Set of permission keys the current user has. */
  permissions: Set<string>;
  /** Whether the permissions are still loading. */
  loading: boolean;
  /** Returns true if the user has the given permission. */
  has: (key: string) => boolean;
  /** Reload permissions from server (e.g. after a role change). */
  refresh: () => Promise<void>;
}

/**
 * Hook that loads the current user's permission keys from the server
 * via the shared `get_my_permissions` RPC.
 *
 * Usage:
 *   const perms = usePermissions(supabase);
 *   if (perms.has('manage_users')) { ... }
 */
export function usePermissions(supabase: SupabaseClient): Permissions {
  const [permissions, setPermissions] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc('get_my_permissions');
    if (error || !Array.isArray(data)) {
      setPermissions(new Set());
    } else {
      setPermissions(new Set(data as string[]));
    }
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const has = useCallback((key: string) => permissions.has(key), [permissions]);

  return { permissions, loading, has, refresh };
}
