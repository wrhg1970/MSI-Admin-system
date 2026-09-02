import { useMemo } from 'react';
import { UserProfile, CustomRole } from '../types';

export function usePermissions(profile: UserProfile | null, rolePermissions: CustomRole | null) {
  const hasPermission = useMemo(() => (menuId: string, action: 'view' | 'create' | 'edit' | 'delete' = 'view') => {
    if (profile?.role === 'super_admin') return true;
    
    // Default system roles permissions if no custom role found
    if (!rolePermissions) {
      if (profile?.role === 'admin' || profile?.role === 'director') return true;
      if (profile?.role === 'seguros') return ['dashboard', 'request', 'clients', 'policies', 'catalogs', 'insurance-plans'].includes(menuId);
      if (profile?.role === 'administracion') return ['dashboard', 'reports', 'commissions'].includes(menuId);
      if (profile?.role === 'agent') {
        if (['dashboard', 'request', 'clients', 'policies', 'commissions', 'historico'].includes(menuId)) return action === 'view' || action === 'create' || action === 'edit';
        return false;
      }
      if (profile?.role === 'client') {
        if (['dashboard', 'request', 'policies'].includes(menuId)) return action === 'view';
        return false;
      }
      return false;
    }

    return rolePermissions.menuPermissions?.[menuId]?.[action] || false;
  }, [profile, rolePermissions]);

  return { hasPermission };
}
