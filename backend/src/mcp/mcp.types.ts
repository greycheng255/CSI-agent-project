import { MCPResult } from './dto/mcp-response.dto';

export type JSONSchema = Record<string, unknown>;

export type MCPContext = {
  caller: string;
  requestId?: string | null;
  idempotencyKey?: string | null;
};

export interface IMCPTool {
  name: string;
  description: string;
  inputSchema: JSONSchema;
  isWrite: boolean;
  execute(args: Record<string, unknown>, ctx: MCPContext): Promise<MCPResult>;
}
