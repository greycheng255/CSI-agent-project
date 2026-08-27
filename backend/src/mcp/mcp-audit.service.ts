import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  MCPInvocationStatus,
  MCPToolInvocation,
} from './entities/mcp-tool-invocation.entity';

type RecordInvocationInput = {
  toolName: string;
  caller: string;
  requestId?: string | null;
  idempotencyKey?: string | null;
  input?: Record<string, unknown> | null;
  output?: unknown;
  status: MCPInvocationStatus;
  errorMessage?: string | null;
  durationMs?: number | null;
};

@Injectable()
export class MCPAuditService {
  constructor(
    @InjectRepository(MCPToolInvocation)
    private readonly invocationsRepository: Repository<MCPToolInvocation>,
  ) {}

  async record(input: RecordInvocationInput) {
    const invocation = this.invocationsRepository.create({
      toolName: input.toolName,
      caller: input.caller,
      requestId: input.requestId || null,
      idempotencyKey: input.idempotencyKey || null,
      inputJson: input.input || null,
      outputJson: input.output ?? null,
      status: input.status,
      errorMessage: input.errorMessage || null,
      durationMs: input.durationMs ?? null,
    });
    return this.invocationsRepository.save(invocation);
  }
}
