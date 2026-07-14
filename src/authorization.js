import { MetricmindError } from './errors.js';

export const ORGANIZATION_ROLES = Object.freeze([
  'viewer',
  'analyst',
  'metric_editor',
  'metric_approver',
  'organization_admin'
]);

const ROLE_PERMISSIONS = Object.freeze({
  viewer: ['analytics:read', 'semantic:read', 'investigation:read'],
  analyst: ['analytics:read', 'semantic:read', 'investigation:read', 'investigation:create', 'investigation:review'],
  metric_editor: ['analytics:read', 'semantic:read', 'semantic:edit', 'investigation:read', 'investigation:create', 'investigation:review'],
  metric_approver: ['analytics:read', 'semantic:read', 'semantic:approve', 'investigation:read', 'investigation:create', 'investigation:review'],
  organization_admin: ['*']
});

export function authorize(principal, permission) {
  if (!principal?.userId || !principal?.organizationId || !ORGANIZATION_ROLES.includes(principal.role)) {
    throw new MetricmindError('INVALID_AUTHORIZATION_CONTEXT', 'A valid organization principal is required.', undefined, 401);
  }
  const permissions = ROLE_PERMISSIONS[principal.role] ?? [];
  if (!permissions.includes('*') && !permissions.includes(permission)) {
    throw new MetricmindError(
      'FORBIDDEN',
      'Your organization role does not permit this action.',
      { requiredPermission: permission, role: principal.role },
      403
    );
  }
  return principal;
}

export function can(principal, permission) {
  try {
    authorize(principal, permission);
    return true;
  } catch {
    return false;
  }
}
