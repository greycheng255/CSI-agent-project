import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  MCPInvocationStatus,
  MCPToolInvocation,
} from './entities/mcp-tool-invocation.entity';

@Injectable()
export class MCPIdempotencyService {
  constructor(
    @InjectRepository(MCPToolInvocation)
    private readonly invocationsRepository: Repository<MCPToolInvocation>,
  ) {}

  async getCachedResult(idempotencyKey: string) {
    const invocation = await this.invocationsRepository.findOne({
      where: {
        idempotencyKey,
        status: MCPInvocationStatus.SUCCESS,
      },
      order: { createdAt: 'DESC' },
    });
    return invocation?.outputJson ?? null;
  }
}
