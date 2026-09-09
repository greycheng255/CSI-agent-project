import { OrgService } from './org.service';
import { Org } from './entities/org.entity';

describe('OrgService', () => {
  let service: OrgService;
  let orgsRepository: {
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
  };

  beforeEach(() => {
    orgsRepository = {
      findOne: jest.fn(),
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => value),
    };
    service = new OrgService(orgsRepository as any);
  });

  describe('ensureForUser', () => {
    it('账号已绑定 org 时幂等返回，不重复创建', async () => {
      const existing = { id: 'org-1', ownerUserId: 'u1' } as Org;
      orgsRepository.findOne.mockResolvedValue(existing);

      const org = await service.ensureForUser({ id: 'u1', phone: '13800000000' });

      expect(org).toBe(existing);
      expect(orgsRepository.create).not.toHaveBeenCalled();
      expect(orgsRepository.save).not.toHaveBeenCalled();
    });

    it('账号未绑定 org 时生成并绑定', async () => {
      orgsRepository.findOne.mockResolvedValue(null);
      const created = { id: 'org-new', ownerUserId: 'u2', slug: 'org-xxxx' };
      orgsRepository.create.mockReturnValue(created);
      orgsRepository.save.mockResolvedValue(created);

      const org = await service.ensureForUser({
        id: 'u2',
        phone: '13900000000',
        displayName: '示例账号',
      });

      expect(org).toBe(created);
      expect(orgsRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          ownerUserId: 'u2',
          name: '示例账号',
        }),
      );
      // slug 自动生成且以 org- 前缀
      expect(orgsRepository.create.mock.calls[0][0].slug).toMatch(/^org-/);
    });

    it('slug 唯一冲突时重试生成新 slug', async () => {
      orgsRepository.findOne.mockResolvedValue(null);
      const conflictErr = new Error('unique constraint failed');
      const created = { id: 'org-retry', ownerUserId: 'u3' };
      orgsRepository.create.mockReturnValue(created);
      orgsRepository.save
        .mockRejectedValueOnce(conflictErr)
        .mockResolvedValueOnce(created);

      const org = await service.ensureForUser({ id: 'u3' });

      expect(org).toBe(created);
      expect(orgsRepository.save).toHaveBeenCalledTimes(2);
    });

    it('连续冲突超过阈值时抛出', async () => {
      orgsRepository.findOne.mockResolvedValue(null);
      orgsRepository.create.mockReturnValue({ ownerUserId: 'u4' });
      orgsRepository.save.mockRejectedValue(new Error('UNIQUE constraint'));

      await expect(service.ensureForUser({ id: 'u4' })).rejects.toThrow(
        /unique|constraint/i,
      );
    });
  });

  describe('解析 API 兜底', () => {
    it('resolveByUserId 返回绑定的 org', async () => {
      const existing = { id: 'org-1' } as Org;
      orgsRepository.findOne.mockResolvedValue(existing);
      const org = await service.resolveByUserId('u1');
      expect(org).toBe(existing);
      expect(orgsRepository.findOne).toHaveBeenCalledWith({
        where: { ownerUserId: 'u1' },
      });
    });

    it('getOrgIdForUser 返回 org_id 或 null', async () => {
      orgsRepository.findOne.mockResolvedValueOnce({ id: 'org-1' } as Org);
      expect(await service.getOrgIdForUser('u1')).toBe('org-1');

      orgsRepository.findOne.mockResolvedValueOnce(null);
      expect(await service.getOrgIdForUser('u2')).toBeNull();
    });

    it('resolveByOrgId 按 org_id 反查', async () => {
      const existing = { id: 'org-1' } as Org;
      orgsRepository.findOne.mockResolvedValue(existing);
      const org = await service.resolveByOrgId('org-1');
      expect(org).toBe(existing);
      expect(orgsRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'org-1' },
      });
    });
  });
});
