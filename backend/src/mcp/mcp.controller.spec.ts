import { MCPController } from './mcp.controller';

function createController(tool?: any) {
  const registry = {
    listTools: jest.fn(() => [
      {
        name: 'platform.quote.submit',
        description: 'Submit quote',
        inputSchema: { type: 'object' },
        isWrite: true,
        requiresIdempotency: true,
      },
    ]),
    get: jest.fn(() => tool),
  };
  const audit = { record: jest.fn(async () => ({})) };
  const idempotency = { getCachedResult: jest.fn(async () => null) };
  const permissionsRepository = { find: jest.fn(), findOne: jest.fn() };
  const invocationsRepository = { count: jest.fn() };
  return new MCPController(
    registry as any,
    audit as any,
    idempotency as any,
    permissionsRepository as any,
    invocationsRepository as any,
  );
}

describe('MCPController HiClaw lifecycle', () => {
  it('handles initialize with tools capability', async () => {
    const controller = createController();

    const response = await controller.handle({} as any, {
      jsonrpc: '2.0',
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
      },
      id: 1,
    });

    expect(response.jsonrpc).toBe('2.0');
    expect((response.result.data as any).protocolVersion).toBe('2025-06-18');
    expect((response.result.data as any).capabilities.tools).toEqual({});
  });

  it('handles notifications/initialized', async () => {
    const controller = createController();

    const response = await controller.handle({} as any, {
      jsonrpc: '2.0',
      method: 'notifications/initialized',
      id: null,
    });

    expect(response.result.success).toBe(true);
    expect(response.result.data).toEqual({});
  });

  it('allows HiClaw header-authenticated write calls without idempotency_key', async () => {
    const tool = {
      name: 'platform.quote.submit',
      isWrite: true,
      execute: jest.fn(async () => ({
        success: true,
        data: { bidId: 'bid-001' },
        error: null,
      })),
    };
    const controller = createController(tool);

    const response = await controller.handle(
      {
        mcpAgent: {
          id: 'agent-uuid',
          externalId: 'agent-001',
          owner: { id: 'owner-001' },
        },
      } as any,
      {
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: 'platform.quote.submit',
          arguments: { taskId: 'task-001', priceCny: 150 },
        },
        id: 'call-001',
      },
    );

    expect(response.result.success).toBe(true);
    expect(tool.execute).toHaveBeenCalledWith(
      { taskId: 'task-001', priceCny: 150 },
      expect.objectContaining({
        agentId: 'agent-uuid',
        agentExternalId: 'agent-001',
        ownerUserId: 'owner-001',
      }),
    );
  });
});
