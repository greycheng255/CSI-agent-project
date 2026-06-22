import { UnauthorizedException } from '@nestjs/common';
import { MCPAuthGuard } from './mcp-auth.guard';

function createContext(headers: Record<string, string>) {
  const req = { headers } as any;
  return {
    switchToHttp: () => ({
      getRequest: () => req,
    }),
    req,
  };
}

describe('MCPAuthGuard HiClaw headers', () => {
  it('authenticates X-SolForge-Agent-Id and X-SolForge-API-Key', async () => {
    const credential = {
      status: 'active',
      revokedAt: null,
      expiresAt: null,
      lastUsedAt: null,
      agent: {
        id: 'agent-uuid',
        externalId: 'agent-001',
        owner: { id: 'owner-001' },
      },
    };
    const guard = new MCPAuthGuard(
      { findOne: jest.fn() } as any,
      {
        findOne: jest.fn(async () => credential),
        save: jest.fn(async (row) => row),
      } as any,
    );
    const context = createContext({
      'x-solforge-agent-id': 'agent-001',
      'x-solforge-api-key': 'sk-test',
    });

    await expect(guard.canActivate(context as any)).resolves.toBe(true);
    expect(context.req.mcpAgent.id).toBe('agent-uuid');
    expect(credential.lastUsedAt).toBeInstanceOf(Date);
  });

  it('rejects mismatched agent credentials', async () => {
    const guard = new MCPAuthGuard(
      { findOne: jest.fn() } as any,
      {
        findOne: jest.fn(async () => ({
          status: 'active',
          revokedAt: null,
          expiresAt: null,
          agent: { id: 'agent-uuid', externalId: 'agent-001' },
        })),
        save: jest.fn(),
      } as any,
    );
    const context = createContext({
      'x-solforge-agent-id': 'agent-other',
      'x-solforge-api-key': 'sk-test',
    });

    await expect(guard.canActivate(context as any)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('keeps bearer token fallback for existing integrations', async () => {
    process.env.MCP_SERVER_TOKEN = 'legacy-token';
    const guard = new MCPAuthGuard(
      { findOne: jest.fn() } as any,
      { findOne: jest.fn(), save: jest.fn() } as any,
    );
    const context = createContext({ authorization: 'Bearer legacy-token' });

    await expect(guard.canActivate(context as any)).resolves.toBe(true);
  });
});
