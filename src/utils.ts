/**
 * OpenEcho - 工具函数
 * 提供通用的辅助函数
 */

import { z } from "zod";

// ============================================================================
// Zod Schema 转 JSON Schema
// ============================================================================

/**
 * 将 Zod Schema 转换为 JSON Schema
 * 简化版实现，支持常用类型
 */
export function zodToJsonSchema(schema: z.ZodType): Record<string, unknown> {
  // 处理 ZodObject
  if (schema instanceof z.ZodObject) {
    const shape = schema.shape;
    const properties: Record<string, unknown> = {};
    const required: string[] = [];

    for (const [key, value] of Object.entries(shape)) {
      const fieldSchema = value as z.ZodType;
      properties[key] = zodToJsonSchema(fieldSchema);

      // 检查是否必需（非 optional）
      if (!(fieldSchema instanceof z.ZodOptional) && !(fieldSchema instanceof z.ZodDefault)) {
        required.push(key);
      }
    }

    return {
      type: "object",
      properties,
      required: required.length > 0 ? required : undefined,
    };
  }

  // 处理 ZodOptional
  if (schema instanceof z.ZodOptional) {
    return zodToJsonSchema(schema.unwrap());
  }

  // 处理 ZodDefault
  if (schema instanceof z.ZodDefault) {
    const innerSchema = zodToJsonSchema(schema._def.innerType);
    return {
      ...innerSchema,
      default: schema._def.defaultValue(),
    };
  }

  // 处理 ZodString
  if (schema instanceof z.ZodString) {
    const result: Record<string, unknown> = { type: "string" };
    
    // 检查约束
    for (const check of schema._def.checks) {
      if (check.kind === "max") {
        result.maxLength = check.value;
      } else if (check.kind === "min") {
        result.minLength = check.value;
      } else if (check.kind === "url") {
        result.format = "uri";
      } else if (check.kind === "email") {
        result.format = "email";
      }
    }

    return result;
  }

  // 处理 ZodNumber
  if (schema instanceof z.ZodNumber) {
    const result: Record<string, unknown> = { type: "number" };

    for (const check of schema._def.checks) {
      if (check.kind === "min") {
        result.minimum = check.value;
      } else if (check.kind === "max") {
        result.maximum = check.value;
      } else if (check.kind === "int") {
        result.type = "integer";
      }
    }

    return result;
  }

  // 处理 ZodBoolean
  if (schema instanceof z.ZodBoolean) {
    return { type: "boolean" };
  }

  // 处理 ZodEnum
  if (schema instanceof z.ZodEnum) {
    return {
      type: "string",
      enum: schema._def.values,
    };
  }

  // 处理 ZodArray
  if (schema instanceof z.ZodArray) {
    return {
      type: "array",
      items: zodToJsonSchema(schema._def.type),
    };
  }

  // 处理 ZodLiteral
  if (schema instanceof z.ZodLiteral) {
    const value = schema._def.value;
    return {
      type: typeof value,
      const: value,
    };
  }

  // 处理 ZodUnion
  if (schema instanceof z.ZodUnion) {
    const options = schema._def.options as z.ZodType[];
    return {
      oneOf: options.map(zodToJsonSchema),
    };
  }

  // 处理 ZodNullable
  if (schema instanceof z.ZodNullable) {
    const inner = zodToJsonSchema(schema.unwrap());
    return {
      oneOf: [inner, { type: "null" }],
    };
  }

  // 默认返回 any
  return {};
}

// ============================================================================
// 格式化输出
// ============================================================================

/**
 * 格式化帖子列表
 */
export function formatPosts(posts: Array<{
  id: string;
  title: string;
  upvotes: number;
  downvotes: number;
  comment_count: number;
  author: { name: string };
  submolt: { name: string };
}>): string {
  if (posts.length === 0) {
    return "暂无帖子";
  }

  return posts
    .map((post, index) => {
      const score = post.upvotes - post.downvotes;
      const scoreStr = score >= 0 ? `+${score}` : `${score}`;
      return `${index + 1}. [${scoreStr}] ${post.title}\n   by ${post.author.name} in m/${post.submolt.name} | ${post.comment_count} 评论`;
    })
    .join("\n\n");
}

/**
 * 格式化搜索结果
 */
export function formatSearchResults(results: Array<{
  type: "post" | "comment";
  title?: string;
  content: string;
  author: { name: string };
  similarity: number;
}>): string {
  if (results.length === 0) {
    return "未找到相关内容";
  }

  return results
    .map((result, index) => {
      const typeLabel = result.type === "post" ? "帖子" : "评论";
      const similarity = (result.similarity * 100).toFixed(0);
      const preview = result.content.length > 100 
        ? result.content.substring(0, 100) + "..."
        : result.content;
      
      return `${index + 1}. [${typeLabel}] ${result.title || "(无标题)"}\n   相关度: ${similarity}% | by ${result.author.name}\n   ${preview}`;
    })
    .join("\n\n");
}

/**
 * 格式化 Agent 资料
 */
export function formatAgentProfile(agent: {
  name: string;
  description?: string;
  karma: number;
  follower_count: number;
  following_count: number;
  is_claimed: boolean;
  is_active: boolean;
}): string {
  const lines = [
    `🤖 ${agent.name}`,
    `   ${agent.description || "(无描述)"}`,
    `   `,
    `   Karma: ${agent.karma}`,
    `   关注者: ${agent.follower_count} | 正在关注: ${agent.following_count}`,
    `   状态: ${agent.is_claimed ? "已认证" : "待认证"} | ${agent.is_active ? "活跃" : "不活跃"}`,
  ];

  return lines.join("\n");
}

/**
 * 格式化时间
 */
export function formatTime(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diff = now.getTime() - date.getTime();

  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  if (hours < 24) return `${hours} 小时前`;
  if (days < 30) return `${days} 天前`;

  return date.toLocaleDateString("zh-CN");
}

// ============================================================================
// 错误处理
// ============================================================================

/**
 * 格式化错误信息
 */
export function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return JSON.stringify(error);
}

/**
 * 安全的 JSON 解析
 */
export function safeJsonParse<T>(text: string, fallback: T): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

// ============================================================================
// 字符串处理
// ============================================================================

/**
 * 截断文本
 */
export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return text.substring(0, maxLength - 3) + "...";
}

/**
 * 首字母大写
 */
export function capitalize(text: string): string {
  if (!text) return text;
  return text.charAt(0).toUpperCase() + text.slice(1);
}
