import { useCallback, useEffect, useMemo, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { PermissionDef, Role } from '../rbac/types';

interface Props {
  supabase: SupabaseClient;
  /** The app's permission catalog — defines columns in the matrix. */
  permissions: PermissionDef[];
  /** Whether the current user can edit the role/permission matrix. */
  canManageRoles: boolean;
}

/**
 * Roles admin panel — edits role -> permission assignments.
 *
 * User-to-role assignment is NOT handled here; each app's own team/users
 * page uses `assign_user_role` / `revoke_user_role` RPCs directly with
 * dropdowns next to each user.
 */
export function UsersRolesGroupsPanel({ supabase, permissions, canManageRoles }: Props) {
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: rpcError } = await supabase.rpc('get_roles_with_permissions');
    if (rpcError) { setError(rpcError.message); setLoading(false); return; }
    setRoles((data as Role[]) ?? []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => { load(); }, [load]);

  const togglePermission = useCallback(async (role: Role, permKey: string) => {
    if (!canManageRoles) return;
    setSavingId(role.id);
    const next = role.permissions.includes(permKey)
      ? role.permissions.filter(p => p !== permKey)
      : [...role.permissions, permKey];
    const { error } = await supabase.rpc('update_role_permissions', { p_role_id: role.id, p_permissions: next });
    if (error) setError(error.message);
    else {
      setRoles(prev => prev.map(r => r.id === role.id ? { ...r, permissions: next } : r));
    }
    setSavingId(null);
  }, [supabase, canManageRoles]);

  const deleteRole = useCallback(async (role: Role) => {
    if (!canManageRoles || role.is_system) return;
    if (!confirm(`Delete role "${role.name}"? Users assigned to this role will lose it.`)) return;
    setSavingId(role.id);
    const { error } = await supabase.rpc('delete_role', { p_role_id: role.id });
    if (error) setError(error.message);
    else {
      setRoles(prev => prev.filter(r => r.id !== role.id));
    }
    setSavingId(null);
  }, [supabase, canManageRoles]);

  const addRole = useCallback(async () => {
    if (!canManageRoles) return;
    const name = prompt('New role name:')?.trim();
    if (!name) return;
    setSavingId('new');
    const { data, error } = await supabase.rpc('create_role', {
      p_name: name, p_description: null, p_permissions: [],
    });
    if (error) setError(error.message);
    else if (data) {
      setRoles(prev => [...prev, { id: data as string, name, description: null, is_system: false, permissions: [] }]);
    }
    setSavingId(null);
  }, [supabase, canManageRoles]);

  const permDefs = useMemo(() => permissions, [permissions]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-gray-400">
        <div className="animate-spin rounded-full h-7 w-7 border-2 border-er-orange border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="mb-4 flex items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-gray-900 dark:text-white">Roles</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            Edit what each role can access. Assign roles to users on the Team page.
          </p>
        </div>
        {canManageRoles && (
          <button
            onClick={addRole}
            className="px-3 py-1.5 rounded-md bg-er-orange text-white text-xs font-semibold hover:opacity-90 whitespace-nowrap"
          >
            + Add New Role
          </button>
        )}
      </div>

      {error && (
        <div className="mb-4 bg-red-50 dark:bg-red-950/20 border border-red-500/40 rounded-md px-3 py-2 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      <div className="bg-white dark:bg-[#212b5e] rounded-lg overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-left text-[10px] font-semibold tracking-wider text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-[#1a2040]">
              <th className="px-4 py-2 sticky left-0 bg-gray-50 dark:bg-[#1a2040]">NAME</th>
              {permDefs.map(p => (
                <th key={p.key} className="px-3 py-2 text-center whitespace-nowrap">{p.label}</th>
              ))}
              {canManageRoles && <th className="px-3 py-2"></th>}
            </tr>
          </thead>
          <tbody>
            {roles.map(role => (
              <tr key={role.id} className="border-t border-gray-100 dark:border-[#2d3a6e]">
                <td className="px-4 py-2 font-medium text-gray-900 dark:text-white sticky left-0 bg-white dark:bg-[#212b5e]">
                  {role.name}
                  {role.is_system && (
                    <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-semibold bg-gray-100 dark:bg-[#2d3a6e] text-gray-500 dark:text-gray-400">
                      system
                    </span>
                  )}
                </td>
                {permDefs.map(p => {
                  const active = role.permissions.includes(p.key);
                  const busy = savingId === role.id;
                  return (
                    <td key={p.key} className="px-3 py-2 text-center">
                      <input
                        type="checkbox"
                        checked={active}
                        disabled={!canManageRoles || busy}
                        onChange={() => togglePermission(role, p.key)}
                        className="w-4 h-4 accent-er-orange cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
                      />
                    </td>
                  );
                })}
                {canManageRoles && (
                  <td className="px-3 py-2 text-right">
                    {!role.is_system && (
                      <button
                        onClick={() => deleteRole(role)}
                        disabled={savingId === role.id}
                        className="text-xs text-red-600 dark:text-red-400 hover:underline disabled:opacity-40"
                      >
                        Delete
                      </button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
