/**
 * OpenEcho - Agent 核心模块
 * 封装 AI 对话能力和工具调度逻辑
 * 支持 Claude、OpenAI 和自定义 LLM provider
 */

import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { tools, getTool, type ToolDefinition } from "./tools.js";
import { identityManager } from "./identity.js";
import { zodToJsonSchema } from "./utils.js";
import { llmConfigManager, type LLMProvider, type ResolvedLLMConfig } from "./llm-config.js";

// ============================================================================
// 类型定义
// ============================================================================

/** 消息角色 */
export type MessageRole = "user" | "assistant";

/** 对话消息 */
export interface Message {
  role: MessageRole;
  content: string;
}

/** 工具调用结果 */
export interface ToolCallResult {
  name: string;
  input: Record<string, unknown>;
  output: unknown;
}

/** Agent配置 */
export interface AgentConfig {
  /** LLM Provider（可选，自动从配置文件读取） */
  provider?: LLMProvider;
  /** API Key（可选，自动从配置文件读取） */
  apiKey?: string;
  /** 模型名称（可选，自动从配置文件读取） */
  model?: string;
  /** Endpoint URL（可选，自动从配置文件读取） */
  endpoint?: string;
  /** 系统提示词 */
  systemPrompt?: string;
  /** 最大对话轮次 */
  maxTurns?: number;
  /** 是否启用工具 */
  enableTools?: boolean;
}

/** Agent响应 */
export interface AgentResponse {
  /** 文本回复 */
  text: string;
  /** 工具调用记录 */
  toolCalls?: ToolCallResult[];
  /** 是否需要继续对话 */
  needsContinue?: boolean;
}

/** 流式输出事件类型 */
export type StreamEvent = 
  | { type: "text"; content: string }           // 文本片段
  | { type: "tool_start"; name: string }        // 开始执行工具
  | { type: "tool_end"; name: string; result: unknown }  // 工具执行完成
  | { type: "done"; toolCalls?: ToolCallResult[] }       // 完成
  | { type: "error"; message: string };         // 错误

// ============================================================================
// 默认配置
// ============================================================================

const DEFAULT_SYSTEM_PROMPT = `你是 OpenEcho（回声），一个专门与 Moltbook（AI Agent 社交网络）交互的助手。

你的能力包括：
1. 读取 - 浏览帖子、搜索内容、查看 Agent 资料、查看 Submolt 社区
2. 写入 - 发帖、评论、投票、加入社区
3. 分析 - 趋势分析、情感分析、话题聚类、异常检测
4. 社交 - 关注/取关 Agent、获取个性化 Feed

当前身份信息会在工具调用时自动使用，你可以通过 identity 参数指定使用特定身份。

使用指南：
- 帮助用户浏览和参与 Moltbook 社区
- 提供有洞察力的数据分析
- 遵守 Moltbook 的社区规范
- 对于发帖和评论，注意速率限制（30分钟1帖，20秒1评论）

回复时请使用简洁友好的语气，必要时使用 markdown 格式化输出。`;

// ============================================================================
// OpenEcho Agent 类
// ============================================================================

/** 内部使用的完整配置 */
interface InternalConfig {
  provider: LLMProvider;
  apiKey: string;
  model: string;
  endpoint: string;
  systemPrompt: string;
  maxTurns: number;
  enableTools: boolean;
}

export class OpenEchoAgent {
  private anthropicClient?: Anthropic;
  private openaiClient?: OpenAI;
  private config: InternalConfig;
  private conversationHistory: Anthropic.MessageParam[] = [];
  private openaiHistory: OpenAI.ChatCompletionMessageParam[] = [];

  constructor(config: AgentConfig = {}) {
    // 从配置管理器获取 LLM 配置
    const llmConfig = llmConfigManager.getLLMConfig();

    // 合并配置（传入参数优先级最高）
    this.config = {
      provider: config.provider || llmConfig?.provider || "claude",
      apiKey: config.apiKey || llmConfig?.api_key || "",
      model: config.model || llmConfig?.model || "claude-sonnet-4-20250514",
      endpoint: config.endpoint || llmConfig?.endpoint || "",
      systemPrompt: config.systemPrompt || DEFAULT_SYSTEM_PROMPT,
      maxTurns: config.maxTurns || 10,
      enableTools: config.enableTools ?? true,
    };

    // 根据 provider 初始化对应的客户端
    this.initializeClient();
  }

  /** 初始化 LLM 客户端 */
  private initializeClient(): void {
    if (this.config.provider === "claude") {
      // Claude 使用 Anthropic SDK
      this.anthropicClient = new Anthropic({
        apiKey: this.config.apiKey,
      });
    } else {
      // OpenAI、Azure、Custom 都使用 OpenAI SDK
      // - openai: 使用默认 endpoint
      // - azure: 使用 Azure OpenAI v1 API (https://<resource>.openai.azure.com/openai/v1)
      // - custom: 使用用户自定义 endpoint
      this.openaiClient = new OpenAI({
        apiKey: this.config.apiKey,
        baseURL: this.config.endpoint || undefined,
      });
    }
  }

  /** 获取当前使用的 provider */
  getProvider(): LLMProvider {
    return this.config.provider;
  }

  /** 获取当前使用的模型 */
  getModel(): string {
    return this.config.model;
  }

  // --------------------------------------------------------------------------
  // 工具定义转换
  // --------------------------------------------------------------------------

  /** 将工具定义转换为 Anthropic 格式 */
  private getAnthropicTools(): Anthropic.Tool[] {
    if (!this.config.enableTools) {
      return [];
    }

    return tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: zodToJsonSchema(tool.parameters) as Anthropic.Tool.InputSchema,
    }));
  }

  /** 将工具定义转换为 OpenAI 格式 */
  private getOpenAITools(): OpenAI.ChatCompletionTool[] {
    if (!this.config.enableTools) {
      return [];
    }

    return tools.map((tool) => ({
      type: "function" as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: zodToJsonSchema(tool.parameters),
      },
    }));
  }

  // --------------------------------------------------------------------------
  // 工具执行
  // --------------------------------------------------------------------------

  /** 执行工具调用 */
  private async executeTool(
    name: string,
    input: Record<string, unknown>
  ): Promise<unknown> {
    const tool = getTool(name);
    if (!tool) {
      return { error: `未知工具: ${name}` };
    }

    try {
      // 验证并执行
      const validatedInput = tool.parameters.parse(input);
      const result = await tool.handler(validatedInput);

      // Agent 层降级策略：search 500 时用 feed 近似匹配
      if (name === "moltbook_search" && this.isSearchFailure(result)) {
        return await this.fallbackSearch(validatedInput as Record<string, unknown>);
      }

      return result;
    } catch (error) {
      return { error: `工具执行失败: ${error}` };
    }
  }

  private isToolFailure(result: unknown): boolean {
    if (!result || typeof result !== "object") return false;
    const r = result as { success?: unknown };
    return r.success === false;
  }

  private isSearchFailure(result: unknown): boolean {
    if (!this.isToolFailure(result)) return false;
    const r = result as { error?: unknown; debug?: unknown };
    const err = typeof r.error === "string" ? r.error : "";
    const status = (r.debug as { status?: unknown } | undefined)?.status;
    return err.toLowerCase().includes("search failed") || status === 500;
  }

  private extractSearchQuery(input: Record<string, unknown>): string {
    const q = input["query"];
    if (typeof q === "string") return q;
    return "";
  }

  private async fallbackSearch(input: Record<string, unknown>): Promise<unknown> {
    const query = this.extractSearchQuery(input);
    // 拉取近期帖子做近似匹配
    const feed = await this.executeTool("moltbook_get_feed", {
      sort: "new",
      limit: 100,
    });

    if (!feed || typeof feed !== "object") {
      return {
        success: false,
        error: "Search failed (fallback feed unavailable)",
      };
    }

    const f = feed as { success?: boolean; posts?: Array<{ id: string; title: string; content?: string }> };
    if (!f.success || !Array.isArray(f.posts)) {
      return {
        success: false,
        error: "Search failed (fallback feed unavailable)",
        original: input,
      };
    }

    const q = query.trim().toLowerCase();
    const matches = q
      ? f.posts.filter((p) => {
          const hay = `${p.title ?? ""} ${p.content ?? ""}`.toLowerCase();
          return hay.includes(q);
        })
      : f.posts;

    return {
      success: true,
      results: matches.slice(0, 20).map((p) => ({
        id: p.id,
        type: "post",
        title: p.title,
        content: p.content ?? "",
        similarity: 0,
        post_id: p.id,
        fallback: true,
      })),
      note: "Moltbook 搜索接口当前失败，已使用最新帖子做近似匹配（非语义搜索，结果可能不完整）。",
      query,
    };
  }

  // --------------------------------------------------------------------------
  // 对话处理
  // --------------------------------------------------------------------------

  /** 
   * 处理用户消息并返回响应
   * @param userMessage 用户消息
   * @returns Agent响应
   */
  async chat(userMessage: string): Promise<AgentResponse> {
    // 根据 provider 调用不同的实现
    if (this.config.provider === "claude") {
      return this.chatWithClaude(userMessage);
    } else {
      return this.chatWithOpenAI(userMessage);
    }
  }

  /**
   * 流式处理用户消息
   * @param userMessage 用户消息
   * @returns 流式事件生成器
   */
  async *chatStream(userMessage: string): AsyncGenerator<StreamEvent> {
    // 根据 provider 调用不同的实现
    if (this.config.provider === "claude") {
      yield* this.chatStreamWithClaude(userMessage);
    } else {
      yield* this.chatStreamWithOpenAI(userMessage);
    }
  }

  /** 清空对话上下文（用于 /clear） */
  resetConversation(): void {
    this.conversationHistory = [];
    this.openaiHistory = [];
  }

  /** 使用 Claude API 进行流式对话 */
  private async *chatStreamWithClaude(userMessage: string): AsyncGenerator<StreamEvent> {
    if (!this.anthropicClient) {
      yield { type: "error", message: "错误: Claude 客户端未初始化" };
      return;
    }

    // 添加用户消息到历史
    this.conversationHistory.push({
      role: "user",
      content: userMessage,
    });

    const systemPrompt = this.buildSystemPrompt();
    const toolCalls: ToolCallResult[] = [];
    let turn = 0;

    while (turn < this.config.maxTurns) {
      turn++;

      try {
        // 使用流式 API
        const stream = this.anthropicClient.messages.stream({
          model: this.config.model,
          max_tokens: 4096,
          system: systemPrompt,
          tools: this.getAnthropicTools(),
          messages: this.conversationHistory,
        });

        // 处理流式事件
        for await (const event of stream) {
          if (event.type === "content_block_delta") {
            if (event.delta.type === "text_delta") {
              // 实时输出文本片段
              yield { type: "text", content: event.delta.text };
            }
          }
        }

        // 获取最终响应
        const finalMessage = await stream.finalMessage();

        // 检查是否有工具调用
        const toolUseBlocks = finalMessage.content.filter(
          (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
        );

        if (toolUseBlocks.length === 0) {
          // 没有工具调用，完成
          this.conversationHistory.push({
            role: "assistant",
            content: finalMessage.content,
          });
          yield { type: "done", toolCalls: toolCalls.length > 0 ? toolCalls : undefined };
          return;
        }

        // 执行工具调用
        const toolResults: Anthropic.ToolResultBlockParam[] = [];
        for (const toolUse of toolUseBlocks) {
          yield { type: "tool_start", name: toolUse.name };
          
          const result = await this.executeTool(
            toolUse.name,
            toolUse.input as Record<string, unknown>
          );

          toolCalls.push({
            name: toolUse.name,
            input: toolUse.input as Record<string, unknown>,
            output: result,
          });

          yield { type: "tool_end", name: toolUse.name, result };

          toolResults.push({
            type: "tool_result",
            tool_use_id: toolUse.id,
            content: JSON.stringify(result, null, 2),
          });
        }

        // 更新历史
        this.conversationHistory.push({
          role: "assistant",
          content: finalMessage.content,
        });
        this.conversationHistory.push({
          role: "user",
          content: toolResults,
        });

        if (finalMessage.stop_reason === "end_turn") {
          yield { type: "done", toolCalls };
          return;
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        yield { type: "error", message: errorMessage };
        return;
      }
    }

    yield { type: "done", toolCalls };
  }

  /** 使用 OpenAI API 进行流式对话 */
  private async *chatStreamWithOpenAI(userMessage: string): AsyncGenerator<StreamEvent> {
    if (!this.openaiClient) {
      yield { type: "error", message: "错误: OpenAI 客户端未初始化" };
      return;
    }

    const systemPrompt = this.buildSystemPrompt();

    if (this.openaiHistory.length === 0) {
      this.openaiHistory.push({
        role: "system",
        content: systemPrompt,
      });
    }

    this.openaiHistory.push({
      role: "user",
      content: userMessage,
    });

    const toolCalls: ToolCallResult[] = [];
    let turn = 0;

    while (turn < this.config.maxTurns) {
      turn++;

      try {
        // 使用流式 API
        const stream = await this.openaiClient.chat.completions.create({
          model: this.config.model,
          max_completion_tokens: 4096,
          messages: this.openaiHistory,
          tools: this.config.enableTools ? this.getOpenAITools() : undefined,
          stream: true,
        });

        let fullText = "";
        const pendingToolCalls: Map<number, { id: string; name: string; arguments: string }> = new Map();

        for await (const chunk of stream) {
          const delta = chunk.choices[0]?.delta;
          
          if (delta?.content) {
            yield { type: "text", content: delta.content };
            fullText += delta.content;
          }

          // 处理工具调用
          if (delta?.tool_calls) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index;
              if (!pendingToolCalls.has(idx)) {
                pendingToolCalls.set(idx, { id: tc.id || "", name: tc.function?.name || "", arguments: "" });
              }
              const pending = pendingToolCalls.get(idx)!;
              if (tc.id) pending.id = tc.id;
              if (tc.function?.name) pending.name = tc.function.name;
              if (tc.function?.arguments) pending.arguments += tc.function.arguments;
            }
          }
        }

        // 检查是否有工具调用
        if (pendingToolCalls.size > 0) {
          // 构建 assistant 消息
          const assistantMessage: OpenAI.ChatCompletionMessageParam = {
            role: "assistant",
            content: fullText || null,
            tool_calls: Array.from(pendingToolCalls.values()).map((tc) => ({
              id: tc.id,
              type: "function" as const,
              function: { name: tc.name, arguments: tc.arguments },
            })),
          };
          this.openaiHistory.push(assistantMessage);

          // 执行工具
          for (const [, tc] of pendingToolCalls) {
            yield { type: "tool_start", name: tc.name };

            let functionArgs: Record<string, unknown> = {};
            try {
              functionArgs = JSON.parse(tc.arguments);
            } catch {
              functionArgs = {};
            }

            const result = await this.executeTool(tc.name, functionArgs);

            toolCalls.push({
              name: tc.name,
              input: functionArgs,
              output: result,
            });

            yield { type: "tool_end", name: tc.name, result };

            this.openaiHistory.push({
              role: "tool",
              tool_call_id: tc.id,
              content: JSON.stringify(result, null, 2),
            });
          }

          // 继续循环获取最终响应
          continue;
        }

        // 没有工具调用，完成
        this.openaiHistory.push({
          role: "assistant",
          content: fullText,
        });

        yield { type: "done", toolCalls: toolCalls.length > 0 ? toolCalls : undefined };
        return;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        yield { type: "error", message: errorMessage };
        return;
      }
    }

    yield { type: "done", toolCalls };
  }

  /** 使用 Claude API 进行对话 */
  private async chatWithClaude(userMessage: string): Promise<AgentResponse> {
    if (!this.anthropicClient) {
      return { text: "错误: Claude 客户端未初始化" };
    }

    // 添加用户消息到历史
    this.conversationHistory.push({
      role: "user",
      content: userMessage,
    });

    // 构建系统提示（包含当前身份信息）
    const systemPrompt = this.buildSystemPrompt();
    const toolCalls: ToolCallResult[] = [];
    let turn = 0;

    // Agent 循环（处理工具调用）
    while (turn < this.config.maxTurns) {
      turn++;

      try {
        // 调用 Claude API
        const response = await this.anthropicClient.messages.create({
          model: this.config.model,
          max_tokens: 4096,
          system: systemPrompt,
          tools: this.getAnthropicTools(),
          messages: this.conversationHistory,
        });

        // 检查是否有工具调用
        const toolUseBlocks = response.content.filter(
          (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
        );

        // 提取文本响应
        const textBlocks = response.content.filter(
          (block): block is Anthropic.TextBlock => block.type === "text"
        );
        const textResponse = textBlocks.map((b) => b.text).join("\n");

        // 如果没有工具调用，返回响应
        if (toolUseBlocks.length === 0) {
          this.conversationHistory.push({
            role: "assistant",
            content: response.content,
          });

          return {
            text: textResponse,
            toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
          };
        }

        // 执行工具调用
        const toolResults: Anthropic.ToolResultBlockParam[] = [];

        for (const toolUse of toolUseBlocks) {
          const result = await this.executeTool(
            toolUse.name,
            toolUse.input as Record<string, unknown>
          );
          
          toolCalls.push({
            name: toolUse.name,
            input: toolUse.input as Record<string, unknown>,
            output: result,
          });

          toolResults.push({
            type: "tool_result",
            tool_use_id: toolUse.id,
            content: JSON.stringify(result, null, 2),
          });
        }

        // 添加助手消息和工具结果到历史
        this.conversationHistory.push({
          role: "assistant",
          content: response.content,
        });

        this.conversationHistory.push({
          role: "user",
          content: toolResults,
        });

        // 如果 stop_reason 是 end_turn，结束循环
        if (response.stop_reason === "end_turn") {
          return {
            text: textResponse,
            toolCalls,
          };
        }
      } catch (error) {
        return this.handleError(error, toolCalls);
      }
    }

    return {
      text: "对话轮次已达上限，请重新开始对话。",
      toolCalls,
      needsContinue: true,
    };
  }

  /** 使用 OpenAI API 进行对话（也支持兼容 API） */
  private async chatWithOpenAI(userMessage: string): Promise<AgentResponse> {
    if (!this.openaiClient) {
      return { text: "错误: OpenAI 客户端未初始化" };
    }

    // 构建系统提示（包含当前身份信息）
    const systemPrompt = this.buildSystemPrompt();

    // 如果是新对话，添加系统消息
    if (this.openaiHistory.length === 0) {
      this.openaiHistory.push({
        role: "system",
        content: systemPrompt,
      });
    }

    // 添加用户消息到历史
    this.openaiHistory.push({
      role: "user",
      content: userMessage,
    });

    const toolCalls: ToolCallResult[] = [];
    let turn = 0;

    // Agent 循环（处理工具调用）
    while (turn < this.config.maxTurns) {
      turn++;

      try {
        // 调用 OpenAI API
        // 注意: 部分模型（如 doubao-seed）不支持 max_tokens，需要用 max_completion_tokens
        const response = await this.openaiClient.chat.completions.create({
          model: this.config.model,
          max_completion_tokens: 4096,
          messages: this.openaiHistory,
          tools: this.config.enableTools ? this.getOpenAITools() : undefined,
        });

        const choice = response.choices[0];
        const message = choice.message;

        // 添加助手消息到历史
        this.openaiHistory.push(message);

        // 检查是否有工具调用
        if (message.tool_calls && message.tool_calls.length > 0) {
          // 执行所有工具调用
          for (const toolCall of message.tool_calls) {
            const functionName = toolCall.function.name;
            let functionArgs: Record<string, unknown> = {};
            
            try {
              functionArgs = JSON.parse(toolCall.function.arguments);
            } catch {
              functionArgs = {};
            }

            const result = await this.executeTool(functionName, functionArgs);
            
            toolCalls.push({
              name: functionName,
              input: functionArgs,
              output: result,
            });

            // 添加工具结果到历史
            this.openaiHistory.push({
              role: "tool",
              tool_call_id: toolCall.id,
              content: JSON.stringify(result, null, 2),
            });
          }

          // 继续循环，让模型基于工具结果生成最终响应
          continue;
        }

        // 没有工具调用，返回响应
        return {
          text: message.content || "",
          toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        };
      } catch (error) {
        return this.handleError(error, toolCalls);
      }
    }

    return {
      text: "对话轮次已达上限，请重新开始对话。",
      toolCalls,
      needsContinue: true,
    };
  }

  /** 构建系统提示词 */
  private buildSystemPrompt(): string {
    let systemPrompt = this.config.systemPrompt;
    const currentIdentity = identityManager.getCurrent();
    if (currentIdentity) {
      systemPrompt += `\n\n当前身份: ${currentIdentity.name} (${currentIdentity.status})`;
    } else {
      systemPrompt += "\n\n注意: 当前没有配置身份，部分功能将不可用。请先使用 /identity add 添加身份。";
    }
    return systemPrompt;
  }

  /** 统一错误处理 */
  private handleError(error: unknown, toolCalls: ToolCallResult[]): AgentResponse {
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    // 检查是否是 API Key 问题
    if (errorMessage.includes("authentication") || errorMessage.includes("api_key") || errorMessage.includes("401")) {
      const provider = this.config.provider;
      return {
        text: `错误: ${provider} API Key 无效或未配置。请检查 ~/.openecho/config.json 配置。`,
      };
    }

    return {
      text: `与 AI 通信时发生错误: ${errorMessage}`,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    };
  }

  /** 清空对话历史 */
  clearHistory(): void {
    this.conversationHistory = [];
    this.openaiHistory = [];
  }

  /** 获取对话历史（Claude 格式） */
  getHistory(): Anthropic.MessageParam[] {
    return [...this.conversationHistory];
  }

  /** 设置对话历史（Claude 格式） */
  setHistory(history: Anthropic.MessageParam[]): void {
    this.conversationHistory = [...history];
  }
}

// ============================================================================
// 单次执行函数（CLI模式）
// ============================================================================

/**
 * 单次执行命令
 * @param command 用户命令
 * @param config Agent配置
 * @returns 执行结果
 */
export async function executeCommand(
  command: string,
  config: AgentConfig = {}
): Promise<string> {
  const agent = new OpenEchoAgent(config);
  const response = await agent.chat(command);
  return response.text;
}

// ============================================================================
// 直接工具调用（无需AI）
// ============================================================================

/**
 * 直接调用工具（不通过AI）
 * @param toolName 工具名称
 * @param params 工具参数
 * @returns 工具执行结果
 */
export async function callToolDirect(
  toolName: string,
  params: Record<string, unknown>
): Promise<unknown> {
  const tool = getTool(toolName);
  if (!tool) {
    return { success: false, error: `未知工具: ${toolName}` };
  }

  try {
    const validatedParams = tool.parameters.parse(params);
    return await tool.handler(validatedParams);
  } catch (error) {
    return { success: false, error: `工具调用失败: ${error}` };
  }
}
