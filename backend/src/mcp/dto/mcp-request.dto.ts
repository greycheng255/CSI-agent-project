export type MCPRequestId = string | number | null;

export class MCPRequestDto {
  jsonrpc: '2.0';
  method: string;
  params?: {
    name?: string;
    arguments?: Record<string, unknown>;
  };
  id?: MCPRequestId;
}
