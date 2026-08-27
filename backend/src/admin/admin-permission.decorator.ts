import { SetMetadata } from '@nestjs/common';

export const PERMISSION_KEY = 'admin_permission';

/**
 * 要求管理员拥有特定权限
 * 配合 AdminPermissionGuard 使用
 *
 * @example @RequirePermission('arbitration:resolve')
 */
export const RequirePermission = (permission: string) =>
  SetMetadata(PERMISSION_KEY, permission);
