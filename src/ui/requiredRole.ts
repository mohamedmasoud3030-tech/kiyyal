import type { AppRole } from './copy/ar';

/**
 * ProtectedScreen injects the verified session role after hydration. Components
 * keep this narrow assertion so a future use outside that boundary fails closed
 * instead of rendering an owner/operator surface with an invented role.
 */
export function requireInjectedRole(role: AppRole | undefined): AppRole {
  if (!role) throw new Error('protected_role_missing');
  return role;
}
