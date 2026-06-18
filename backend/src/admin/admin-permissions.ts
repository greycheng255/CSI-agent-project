/**
 * 管理员权限常量
 * SUPER 管理员自动拥有所有权限（硬编码）
 * ADMIN / OPERATOR 的权限通过 permissions JSON 数组分配
 */
export const ADMIN_PERMISSIONS = {
  /** 仲裁管理 */
  ARBITRATION_VIEW: 'arbitration:view',
  ARBITRATION_RESOLVE: 'arbitration:resolve',

  /** 放款管理 */
  PAYMENT_RELEASE: 'payment:release',

  /** 平台收款码管理 */
  PLATFORM_CODES_MANAGE: 'platform_codes:manage',

  /** 用户管理 */
  USER_VIEW: 'user:view',

  /** 管理员管理（仅 SUPER） */
  ADMIN_MANAGE: 'admin:manage',

  /** Agent 管理 */
  AGENT_VIEW: 'agent:view',
  AGENT_MANAGE: 'agent:manage',
} as const;

export type AdminPermission = (typeof ADMIN_PERMISSIONS)[keyof typeof ADMIN_PERMISSIONS];

/** 所有权限值的数组 */
export const ALL_ADMIN_PERMISSIONS: AdminPermission[] =
  Object.values(ADMIN_PERMISSIONS);

/** 权限分组（用于前端展示） */
export const ADMIN_PERMISSION_GROUPS = [
  {
    group: '仲裁管理',
    permissions: [
      { key: ADMIN_PERMISSIONS.ARBITRATION_VIEW, label: '查看仲裁' },
      { key: ADMIN_PERMISSIONS.ARBITRATION_RESOLVE, label: '裁决仲裁' },
    ],
  },
  {
    group: '放款管理',
    permissions: [
      { key: ADMIN_PERMISSIONS.PAYMENT_RELEASE, label: '执行放款' },
    ],
  },
  {
    group: '平台收款码',
    permissions: [
      { key: ADMIN_PERMISSIONS.PLATFORM_CODES_MANAGE, label: '管理收款码' },
    ],
  },
  {
    group: '用户管理',
    permissions: [
      { key: ADMIN_PERMISSIONS.USER_VIEW, label: '查看用户' },
    ],
  },
  {
    group: 'Agent 管理',
    permissions: [
      { key: ADMIN_PERMISSIONS.AGENT_VIEW, label: '查看 Agent' },
      { key: ADMIN_PERMISSIONS.AGENT_MANAGE, label: '管理 Agent' },
    ],
  },
];
