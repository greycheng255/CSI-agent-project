import { MCPRequestId } from './mcp-request.dto';

export type MCPErrorPayload = {
  code: string;
  message: string;
  details?: unknown;
};

export type MCPResult = {
  success: boolean;
  data: unknown;
  error: MCPErrorPayload | null;
  request_id?: string | null;
};

export class MCPResponseDto {
  jsonrpc: '2.0';
  result: MCPResult;
  id?: MCPRequestId;
}
