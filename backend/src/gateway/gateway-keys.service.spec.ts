import { createHash } from 'crypto';
import { GatewayKeysService, decryptKey, encryptKey } from './gateway-keys.service';
import { GatewayApiKey } from './gateway-key.entity';

describe('GatewayKeysService（K1-K4）', () => {
  let repo: { findOne: jest.Mock; find: jest.Mock; save: jest.Mock };
  let svc: GatewayKeysService;

  const savedRows: GatewayApiKey[] = [];

  beforeEach(() => {
    savedRows.length = 0;
    repo = {
      findOne: jest.fn(async (args: any) =>
        savedRows.find(
          (r) =>
            (args.where.workspaceId === undefined ||
              r.workspaceId === args.where.workspaceId) &&
            (args.where.status === undefined || r.status === args.where.status) &&
            (args.where.keyId === undefined || r.keyId === args.where.keyId) &&
            (args.where.keyHash === undefined || r.keyHash === args.where.keyHash),
        ) ?? null,
      ),
      find: jest.fn(async () => savedRows),
      save: jest.fn(async (row: GatewayApiKey) => {
        const existing = savedRows.findIndex((r) => r.keyId === row.keyId);
        if (existing >= 0) savedRows[existing] = row;
        else savedRows.push(row);
        return row;
      }),
    };
    svc = new GatewayKeysService(repo as never);
  });

  it('K1 签发：sk-csi- 明文仅返回一次；重复签发幂等返回同一 key（existing=true）', async () => {
    const first = await svc.issue('org-1', 'ws-1');
    expect(first.key).toMatch(/^sk-csi-[A-Za-z0-9_-]{30,}$/);
    expect(first.existing).toBe(false);
    // 库内只有密文，明文可解密还原且哈希一致
    const row = savedRows[0];
    expect(row.keyCiphertext).not.toContain(first.key);
    expect(decryptKey(row.keyCiphertext)).toBe(first.key);
    expect(row.keyHash).toBe(createHash('sha256').update(first.key).digest('hex'));

    const again = await svc.issue('org-1', 'ws-1');
    expect(again.existing).toBe(true);
    expect(again.key).toBe(first.key);
    expect(again.key_id).toBe(first.key_id);
    expect(savedRows).toHaveLength(1); // 不新建
  });

  it('K4 轮换：旧 key 置 rotated，新 key active 且明文不同', async () => {
    const first = await svc.issue('org-1', 'ws-1');
    const rotated = await svc.rotate(first.key_id);
    expect(rotated.key).not.toBe(first.key);
    expect(rotated.existing).toBe(false);
    expect(savedRows.find((r) => r.keyId === first.key_id)!.status).toBe('rotated');
    expect(savedRows.find((r) => r.keyId === rotated.key_id)!.rotatedFromId).toBe(
      first.key_id,
    );
    await expect(svc.rotate(first.key_id)).rejects.toMatchObject({
      status: 422,
      errorCode: 'STATE_INVALID_TRANSITION',
    });
  });

  it('K3 吊销：active → revoked；validate 对吊销 key 返回 valid=false（K2）', async () => {
    const key = await svc.issue('org-1', 'ws-1');
    expect((await svc.validate(key.key)).valid).toBe(true);
    expect((await svc.validate(key.key)).workspace_id).toBe('ws-1');
    expect((await svc.validate(key.key)).org_id).toBe('org-1');

    await svc.revoke(key.key_id);
    expect(savedRows[0].status).toBe('revoked');
    expect(savedRows[0].revokedAt).toBeInstanceOf(Date);
    expect((await svc.validate(key.key)).valid).toBe(false);
    expect((await svc.validate('sk-csi-nonexistent')).valid).toBe(false);
  });

  it('404：rotate/revoke 未知 keyId', async () => {
    await expect(svc.rotate('wk_none')).rejects.toMatchObject({ status: 404 });
    await expect(svc.revoke('wk_none')).rejects.toMatchObject({ status: 404 });
  });

  it('加密原语：AES-256-GCM 往返一致、密文不含明文', () => {
    const plain = 'sk-csi-test-value';
    const blob = encryptKey(plain);
    expect(blob).not.toContain(plain);
    expect(decryptKey(blob)).toBe(plain);
  });
});
