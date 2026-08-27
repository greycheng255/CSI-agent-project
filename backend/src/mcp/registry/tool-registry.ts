import { Injectable, OnModuleInit } from '@nestjs/common';
import { IMCPTool } from '../mcp.types';
import { MCPToolsProvider } from '../tools/platform.tools';

@Injectable()
export class ToolRegistry implements OnModuleInit {
  private readonly tools = new Map<string, IMCPTool>();

  constructor(private readonly toolsProvider: MCPToolsProvider) {}

  onModuleInit() {
    for (const tool of this.toolsProvider.getTools()) {
      this.register(tool);
    }
  }

  register(tool: IMCPTool) {
    this.tools.set(tool.name, tool);
  }

  get(name: string) {
    return this.tools.get(name);
  }

  listTools() {
    return Array.from(this.tools.values()).map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      isWrite: tool.isWrite,
      requiresIdempotency: tool.isWrite,
    }));
  }
}
