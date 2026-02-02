/**
 * OpenEcho - MCP 服务端模块
 * 提供 Model Context Protocol 接口，供外部 Agent 调用
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { tools, getTool } from "./tools.js";
import { identityManager } from "./identity.js";
import { zodToJsonSchema } from "./utils.js";

// ============================================================================
// MCP 工具定义转换
// ============================================================================

/** 将内部工具定义转换为 MCP Tool 格式 */
function convertToMcpTools(): Tool[] {
  return tools.map((tool) => ({
    name: `openecho:${tool.name}`,
    description: tool.description,
    inputSchema: zodToJsonSchema(tool.parameters) as Tool["inputSchema"],
  }));
}

// ============================================================================
// 身份管理工具（MCP专用）
// ============================================================================

const identityTools: Tool[] = [
  {
    name: "openecho:identity_list",
    description: "列出所有已配置的身份",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "openecho:identity_status",
    description: "检查身份的验证状态",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "身份名称（可选，默认当前身份）",
        },
      },
    },
  },
  {
    name: "openecho:identity_switch",
    description: "切换默认身份",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "要切换到的身份名称",
        },
      },
      required: ["name"],
    },
  },
  {
    name: "openecho:identity_add",
    description: "注册新的 Moltbook 身份",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Agent 名称",
        },
        description: {
          type: "string",
          description: "Agent 描述",
        },
      },
      required: ["name", "description"],
    },
  },
];

// ============================================================================
// 工具执行
// ============================================================================

async function executeIdentityTool(
  toolName: string,
  args: Record<string, unknown>
): Promise<unknown> {
  switch (toolName) {
    case "openecho:identity_list": {
      const result = identityManager.list();
      return {
        success: true,
        default: result.default,
        identities: result.identities.map((i) => ({
          name: i.name,
          status: i.status,
          description: i.description,
        })),
      };
    }

    case "openecho:identity_status": {
      const name = args.name as string | undefined;
      const result = await identityManager.checkStatus(name);
      return result;
    }

    case "openecho:identity_switch": {
      const name = args.name as string;
      const result = identityManager.switch(name);
      return result;
    }

    case "openecho:identity_add": {
      const name = args.name as string;
      const description = args.description as string;
      const result = await identityManager.register(name, description);
      return result;
    }

    default:
      return { success: false, error: `未知身份工具: ${toolName}` };
  }
}

async function executeMoltbookTool(
  toolName: string,
  args: Record<string, unknown>
): Promise<unknown> {
  // 移除 openecho: 前缀
  const actualToolName = toolName.replace("openecho:", "");
  const tool = getTool(actualToolName);

  if (!tool) {
    return { success: false, error: `未知工具: ${toolName}` };
  }

  try {
    const validatedArgs = tool.parameters.parse(args);
    return await tool.handler(validatedArgs);
  } catch (error) {
    return {
      success: false,
      error: `工具执行失败: ${error}`,
    };
  }
}

// ============================================================================
// MCP 服务器类
// ============================================================================

export class OpenEchoMcpServer {
  private server: Server;

  constructor() {
    this.server = new Server(
      {
        name: "openecho",
        version: "0.1.0",
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupHandlers();
  }

  private setupHandlers(): void {
    // 列出所有工具
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      const moltbookTools = convertToMcpTools();
      return {
        tools: [...moltbookTools, ...identityTools],
      };
    });

    // 执行工具
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      let result: unknown;

      // 判断是身份工具还是 Moltbook 工具
      if (name.startsWith("openecho:identity_")) {
        result = await executeIdentityTool(name, args as Record<string, unknown>);
      } else {
        result = await executeMoltbookTool(name, args as Record<string, unknown>);
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    });
  }

  /** 启动 MCP 服务器（stdio 模式） */
  async start(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error("OpenEcho MCP 服务器已启动 (stdio 模式)");
  }
}

// ============================================================================
// MCP 配置生成
// ============================================================================

/** 生成 MCP 配置示例 */
export function generateMcpConfig(): string {
  return JSON.stringify(
    {
      mcpServers: {
        openecho: {
          command: "openecho",
          args: ["--mcp"],
        },
      },
    },
    null,
    2
  );
}

/** 生成 Cursor MCP 配置 */
export function generateCursorMcpConfig(): string {
  return JSON.stringify(
    {
      name: "openecho",
      command: "npx",
      args: ["openecho", "--mcp"],
      description: "OpenEcho - Moltbook Agent 接口",
    },
    null,
    2
  );
}

// ============================================================================
// 导出服务器启动函数
// ============================================================================

export async function startMcpServer(): Promise<void> {
  const server = new OpenEchoMcpServer();
  await server.start();
}
