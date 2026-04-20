import { useCallback, useEffect, useMemo, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { PermissionDef, Role, UserWithRoles } from '../rbac/types';

interface Props {
  supabase: SupabaseClient;
  /** The app's permission catalog — defines columns in the matrix. */
  permissions: PermissionDef[];
  /** Whether the current user can manage roles + permissions matrix. */
  canManageRoles: boolean;
  /** Whether the current user can assign roles to users. */
  canManageUsers: boolean;
}

type Tab = 'users' | 'roles';

export function UsersRolesGroupsPanel({ supabase, permissions, canManageRoles, canManageUsers }: Props) {
  const [tab, setTab] = useState<Tab>('users');
  const [roles, setRoles] = useState<Role[]>([]);
  const [users, setUsers] = useState<UserWithRoles[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [rolesRes, usersRes] = await Promise.all([
      supabase.rpc('get_roles_with_permissions'),
      supabase.rpc('get_users_with_roles'),
    ]);
    if (rolesRes.error) { setError(rolesRes.error.message); setLoading(false); return; }
    if (usersRes.error) { setError(usersRes.error.message); setLoading(false); return; }
    setRoles((rolesRes.data as Role[]) ?? []);
    setUsers((usersRes.data as UserWithRoles[]) ?? []);
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

  const toggleUserRole = useCallback(async (userId: string, roleId: string, assigned: boolean) => {
    if (!canManageUsers) return;
    setSavingId(userId);
    const fn = assigned ? 'revoke_user_role' : 'assign_user_role';
    const { error } = await supabase.rpc(fn, { p_user_id: userId, p_role_id: roleId });
    if (error) setError(error.message);
    else {
      setUsers(prev => prev.map(u => {
        if (u.user_id !== userId) return u;
        if (assigned) {
          const idx = u.role_ids.indexOf(roleId);
          if (idx < 0) return u;
          return {
            ...u,
            role_ids: u.role_ids.filter((_, i) => i !== idx),
            role_names: u.role_names.filter((_, i) => i !== idx),
          };
        } else {
          const roleName = roles.find(r => r.id === roleId)?.name ?? '';
          return {
            ...u,
            role_ids: [...u.role_ids, roleId],
            role_names: [...u.role_names, roleName],
          };
        }
      }));
    }
    setSavingId(null);
  }, [supabase, canManageUsers, roles]);

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
      <div className="mb-4 flex items-center gap-2">
        <h1 className="text-xl font-semibold text-gray-900 dark:text-white">Users / Roles</h1>
      </div>

      {error && (
        <div className="mb-4 bg-red-50 dark:bg-red-950/20 border border-red-500/40 rounded-md px-3 py-2 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      <div className="inline-flex bg-gray-100 dark:bg-[#212b5e] rounded-lg p-1 mb-4">
        <button
          onClick={() => setTab('users')}
          className={`px-4 py-1.5 rounded-md text-sm font-medium ${
            tab === 'users'
              ? 'bg-white dark:bg-[#2d3a6e] text-gray-900 dark:text-white shadow'
              : 'text-gray-600 dark:text-gray-400'
          }`}
        >
          Users
        </button>
        <button
          onClick={() => setTab('roles')}
          className={`px-4 py-1.5 rounded-md text-sm font-medium ${
            tab === 'roles'
              ? 'bg-white dark:bg-[#2d3a6e] text-gray-900 dark:text-white shadow'
              : 'text-gray-600 dark:text-gray-400'
          }`}
        >
          Roles
        </button>
      </div>

      {tab === 'roles' && (
        <div className="bg-white dark:bg-[#212b5e] rounded-lg overflow-x-auto">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-[#2d3a6e]">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Roles</h2>
            {canManageRoles && (
              <button
                onClick={addRole}
                className="px-3 py-1.5 rounded-md bg-er-orange text-white text-xs font-semibold hover:opacity-90"
              >
                + Add New Role
              </button>
            )}
          </div>
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
      )}

      {tab === 'users' && (
        <div className="bg-white dark:bg-[#212b5e] rounded-lg overflow-x-auto">
          <div className="px-4 py-3 border-b border-gray-100 dark:border-[#2d3a6e]">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Users</h2>
            {!canManageUsers && (
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">You don't have permission to change role assignments — viewing only.</p>
            )}
          </div>
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-[10px] font-semibold tracking-wider text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-[#1a2040]">
                <th className="px-4 py-2 sticky left-0 bg-gray-50 dark:bg-[#1a2040]">USERNAME</th>
                {roles.map(r => (
                  <th key={r.id} className="px-3 py-2 text-center whitespace-nowrap">{r.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {users.map(u => (
                <tr key={u.user_id} className="border-t border-gray-100 dark:border-[#2d3a6e]">
                  <td className="px-4 py-2 font-medium text-gray-900 dark:text-white sticky left-0 bg-white dark:bg-[#212b5e]">
                    {u.username}
                  </td>
                  {roles.map(r => {
                    const assigned = u.role_ids.includes(r.id);
                    const busy = savingId === u.user_id;
                    return (
                      <td key={r.id} className="px-3 py-2 text-center">
                        <input
                          type="checkbox"
                          checked={assigned}
                          disabled={!canManageUsers || busy}
                          onChange={() => toggleUserRole(u.user_id, r.id, assigned)}
                          className="w-4 h-4 accent-er-orange cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
