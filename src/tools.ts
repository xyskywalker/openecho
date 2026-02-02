/**
 * OpenEcho - Moltbook API 工具封装
 * 提供所有与 Moltbook 交互的工具定义和实现
 * 
 * 重要: 必须使用 https://www.moltbook.com（带 www）
 * 使用不带 www 的域名会重定向并丢失 Authorization header！
 * 参考: https://www.moltbook.com/skill.md
 */

import { z } from "zod";
import { identityManager } from "./identity.js";
import { heartbeatManager } from "./heartbeat.js";

// ============================================================================
// 常量配置
// ============================================================================

/** 
 * Moltbook API 基础URL
 * 重要: 必须使用 www，否则会丢失 Authorization header！
 */
const MOLTBOOK_API_BASE = "https://www.moltbook.com/api/v1";

/** 默认重试次数 */
const DEFAULT_MAX_RETRIES = 3;

/** 重试间隔基数（毫秒） */
const RETRY_DELAY_BASE_MS = 1000;

// ============================================================================
// 类型定义
// ============================================================================

/** 帖子排序方式 */
export type PostSort = "hot" | "new" | "top" | "rising";

/** 评论排序方式 */
export type CommentSort = "top" | "new" | "controversial";

/** 搜索类型 */
export type SearchType = "posts" | "comments" | "all";

/** 投票方向 */
export type VoteDirection = "up" | "down";

/** 帖子信息 */
export interface Post {
  id: string;
  title: string;
  content?: string;
  url?: string;
  upvotes: number;
  downvotes: number;
  comment_count: number;
  created_at: string;
  author: { name: string };
  submolt: { name: string; display_name: string };
  is_pinned?: boolean;
}

/** 评论信息 */
export interface Comment {
  id: string;
  content: string;
  upvotes: number;
  downvotes: number;
  created_at: string;
  author: { name: string };
  parent_id?: string;
  replies?: Comment[];
}

/** Submolt信息 */
export interface Submolt {
  name: string;
  display_name: string;
  description: string;
  subscriber_count: number;
  created_at: string;
  your_role?: "owner" | "moderator" | null;
}

/** Agent资料 */
export interface AgentProfile {
  name: string;
  description?: string;
  karma: number;
  follower_count: number;
  following_count: number;
  is_claimed: boolean;
  is_active: boolean;
  created_at: string;
  last_active?: string;
  owner?: {
    x_handle: string;
    x_name: string;
    x_avatar?: string;
    x_bio?: string;
  };
}

/** 搜索结果项 */
export interface SearchResult {
  id: string;
  type: "post" | "comment";
  title?: string;
  content: string;
  upvotes: number;
  downvotes: number;
  created_at: string;
  similarity: number;
  author: { name: string };
  submolt?: { name: string; display_name: string };
  post?: { id: string; title: string };
  post_id: string;
}

// ============================================================================
// API 请求辅助函数
// ============================================================================

/** 
 * 发送API请求
 * @param endpoint API端点
 * @param options 请求选项
 * @param identityName 使用的身份名称（可选）
 */
/** API 请求响应类型 */
interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  hint?: string;
  debug?: {
    status?: number;
    endpoint?: string;
    retries?: number;
    requestedIdentity?: string;
    resolvedIdentity?: string | null;
    hasCurrentIdentity?: boolean;
  };
  /** 速率限制信息（429 错误时返回） */
  rateLimit?: {
    retryAfterSeconds?: number;
    retryAfterMinutes?: number;
    dailyRemaining?: number;
  };
}

/**
 * 发送API请求（带重试机制）
 * @param endpoint API端点
 * @param options 请求选项
 * @param identityName 使用的身份名称（可选）
 * @param maxRetries 最大重试次数（默认3次）
 */
async function apiRequest<T>(
  endpoint: string,
  options: RequestInit = {},
  identityName?: string,
  maxRetries: number = DEFAULT_MAX_RETRIES
): Promise<ApiResponse<T>> {
  const normalizedIdentity = identityName?.trim() || undefined;
  const apiKey = identityManager.getApiKey(normalizedIdentity);
  
  if (!apiKey) {
    const current = identityManager.getCurrent();
    return {
      success: false,
      error: "没有可用的身份或API Key",
      hint: "请先运行 'openecho identity add' 创建身份",
      debug: {
        status: 401,
        endpoint: `${MOLTBOOK_API_BASE}${endpoint}`,
        retries: 0,
        requestedIdentity: identityName,
        resolvedIdentity: normalizedIdentity || current?.name || null,
        hasCurrentIdentity: Boolean(current),
      },
    };
  }

  const fullUrl = `${MOLTBOOK_API_BASE}${endpoint}`;
  let lastError: string = "";
  let lastStatus: number = 0;

  // 重试循环
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(fullUrl, {
        ...options,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
          ...options.headers,
        },
      });

      lastStatus = response.status;

      // 尝试解析响应体
      let data: unknown;
      try {
        data = await response.json();
      } catch {
        data = {};
      }

      // 成功响应
      if (response.ok) {
        // 更新最后活跃时间
        identityManager.updateLastActive(identityName);
        return { success: true, data: data as T };
      }

      // 速率限制错误（429）- 不重试，直接返回限制信息
      if (response.status === 429) {
        const rateLimitData = data as {
          error?: string;
          hint?: string;
          retry_after_seconds?: number;
          retry_after_minutes?: number;
          daily_remaining?: number;
        };
        
        return {
          success: false,
          error: rateLimitData.error || "请求过于频繁，请稍后再试",
          hint: rateLimitData.hint,
          rateLimit: {
            retryAfterSeconds: rateLimitData.retry_after_seconds,
            retryAfterMinutes: rateLimitData.retry_after_minutes,
            dailyRemaining: rateLimitData.daily_remaining,
          },
          debug: { status: 429, endpoint: fullUrl, retries: attempt },
        };
      }

      // 客户端错误（4xx，非 429）- 不重试
      if (response.status >= 400 && response.status < 500) {
        const errorData = data as { error?: string; hint?: string };
        return {
          success: false,
          error: errorData.error || `请求失败: HTTP ${response.status}`,
          hint: errorData.hint,
          debug: {
            status: response.status,
            endpoint: fullUrl,
            retries: attempt,
            requestedIdentity: identityName,
            resolvedIdentity: normalizedIdentity || identityManager.getCurrent()?.name || null,
          },
        };
      }

      // 服务器错误（5xx）- 可重试
      const serverErr = data as { error?: string; hint?: string };
      lastError = serverErr.error || `服务器错误: HTTP ${response.status}`;
      
      // 如果还有重试机会，等待后重试
      if (attempt < maxRetries) {
        await sleep(RETRY_DELAY_BASE_MS * attempt); // 指数退避
        continue;
      }

      // 最后一次失败时，透传 hint/debug
      return {
        success: false,
        error: lastError,
        hint: serverErr.hint,
        debug: {
          status: response.status,
          endpoint: fullUrl,
          retries: attempt,
          requestedIdentity: identityName,
          resolvedIdentity: normalizedIdentity || identityManager.getCurrent()?.name || null,
          hasCurrentIdentity: Boolean(identityManager.getCurrent()),
        },
      };
    } catch (error) {
      lastError = `网络请求失败: ${error}`;
      
      // 网络错误可重试
      if (attempt < maxRetries) {
        await sleep(RETRY_DELAY_BASE_MS * attempt);
        continue;
      }
    }
  }

  // 所有重试都失败
  return {
    success: false,
    error: lastError || "请求失败",
    hint: "请检查网络连接，或稍后重试",
    debug: {
      status: lastStatus,
      endpoint: fullUrl,
      retries: maxRetries,
      requestedIdentity: identityName,
      resolvedIdentity: normalizedIdentity || identityManager.getCurrent()?.name || null,
      hasCurrentIdentity: Boolean(identityManager.getCurrent()),
    },
  };
}

/** 等待指定毫秒 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================================
// 阶段1: 读取工具
// ============================================================================

/** 获取帖子流参数Schema */
export const getFeedSchema = z.object({
  sort: z.enum(["hot", "new", "top", "rising"]).optional().default("hot"),
  limit: z.number().min(1).max(100).optional().default(25),
  submolt: z.string().optional(),
  identity: z.string().optional(),
});

/** 获取帖子流 */
export async function moltbook_get_feed(
  params: z.infer<typeof getFeedSchema>
): Promise<{ success: boolean; posts?: Post[]; error?: string; debug?: { status?: number; endpoint?: string } }> {
  const { sort, limit, submolt, identity } = getFeedSchema.parse(params);
  
  let endpoint = `/posts?sort=${sort}&limit=${limit}`;
  if (submolt) {
    endpoint = `/submolts/${submolt}/feed?sort=${sort}&limit=${limit}`;
  }

  const result = await apiRequest<{ posts?: Post[]; data?: Post[] }>(endpoint, {}, identity);
  
  if (result.success && result.data) {
    return {
      success: true,
      posts: result.data.posts || result.data.data || [],
    };
  }
  
  // 返回更详细的错误信息
  return { 
    success: false, 
    error: result.error,
    debug: result.debug,
  };
}

/** 语义搜索参数Schema */
export const searchSchema = z.object({
  query: z.string().max(500),
  type: z.enum(["posts", "comments", "all"]).optional().default("all"),
  limit: z.number().min(1).max(50).optional().default(20),
  identity: z.string().optional(),
});

/** 语义搜索 */
export async function moltbook_search(
  params: z.infer<typeof searchSchema>
): Promise<{ success: boolean; results?: SearchResult[]; error?: string; hint?: string; debug?: ApiResponse<unknown>["debug"] }> {
  const { query, type, limit, identity } = searchSchema.parse(params);
  
  const searchParams = new URLSearchParams({
    q: query,
    type,
    limit: limit.toString(),
  });

  const result = await apiRequest<{ results: SearchResult[] }>(
    `/search?${searchParams}`,
    {},
    identity
  );

  if (result.success && result.data) {
    return { success: true, results: result.data.results };
  }

  return { success: false, error: result.error, hint: result.hint, debug: result.debug };
}

/** 获取Agent资料参数Schema */
export const getProfileSchema = z.object({
  name: z.string(),
  identity: z.string().optional(),
});

/** 获取Agent资料 */
export async function moltbook_get_profile(
  params: z.infer<typeof getProfileSchema>
): Promise<{ success: boolean; agent?: AgentProfile; recentPosts?: Post[]; error?: string }> {
  const { name, identity } = getProfileSchema.parse(params);

  const result = await apiRequest<{ agent: AgentProfile; recentPosts: Post[] }>(
    `/agents/profile?name=${encodeURIComponent(name)}`,
    {},
    identity
  );

  if (result.success && result.data) {
    return {
      success: true,
      agent: result.data.agent,
      recentPosts: result.data.recentPosts,
    };
  }

  return { success: false, error: result.error };
}

/** 获取Submolt列表参数Schema */
export const getSubmoltsSchema = z.object({
  identity: z.string().optional(),
});

/** 获取Submolt列表 */
export async function moltbook_get_submolts(
  params: z.infer<typeof getSubmoltsSchema>
): Promise<{ success: boolean; submolts?: Submolt[]; error?: string }> {
  const { identity } = getSubmoltsSchema.parse(params);

  const result = await apiRequest<{ submolts?: Submolt[]; data?: Submolt[] }>(
    "/submolts",
    {},
    identity
  );

  if (result.success && result.data) {
    return {
      success: true,
      submolts: result.data.submolts || result.data.data || [],
    };
  }

  return { success: false, error: result.error };
}

/** 获取单个帖子参数Schema */
export const getPostSchema = z.object({
  post_id: z.string(),
  identity: z.string().optional(),
});

/** 获取单个帖子详情 */
export async function moltbook_get_post(
  params: z.infer<typeof getPostSchema>
): Promise<{ success: boolean; post?: Post; comments?: Comment[]; error?: string }> {
  const { post_id, identity } = getPostSchema.parse(params);

  const result = await apiRequest<{ post: Post; comments?: Comment[] }>(
    `/posts/${post_id}`,
    {},
    identity
  );

  if (result.success && result.data) {
    return {
      success: true,
      post: result.data.post,
      comments: result.data.comments,
    };
  }

  return { success: false, error: result.error };
}

/** 获取帖子评论参数Schema */
export const getCommentsSchema = z.object({
  post_id: z.string(),
  sort: z.enum(["top", "new", "controversial"]).optional().default("top"),
  identity: z.string().optional(),
});

/** 获取帖子评论 */
export async function moltbook_get_comments(
  params: z.infer<typeof getCommentsSchema>
): Promise<{ success: boolean; comments?: Comment[]; error?: string }> {
  const { post_id, sort, identity } = getCommentsSchema.parse(params);

  const result = await apiRequest<{ comments: Comment[] }>(
    `/posts/${post_id}/comments?sort=${sort}`,
    {},
    identity
  );

  if (result.success && result.data) {
    return { success: true, comments: result.data.comments };
  }

  return { success: false, error: result.error };
}

// ============================================================================
// 阶段2: 写入工具
// ============================================================================

/** 发帖参数Schema */
export const postSchema = z.object({
  submolt: z.string(),
  title: z.string(),
  content: z.string().optional(),
  url: z.string().url().optional(),
  identity: z.string().optional(),
});

/** 发布帖子 */
export async function moltbook_post(
  params: z.infer<typeof postSchema>
): Promise<{ success: boolean; post?: Post; error?: string; retry_after_minutes?: number; hint?: string }> {
  const { submolt, title, content, url, identity } = postSchema.parse(params);

  // 检查冷却时间
  if (!heartbeatManager.canPost()) {
    return {
      success: false,
      error: "发帖冷却中，请稍后再试",
      hint: "发帖限制: 每 30 分钟 1 帖",
      retry_after_minutes: 30,
    };
  }

  const body: Record<string, string> = { submolt, title };
  if (content) body.content = content;
  if (url) body.url = url;

  const result = await apiRequest<{ post: Post; retry_after_minutes?: number }>(
    "/posts",
    {
      method: "POST",
      body: JSON.stringify(body),
    },
    identity
  );

  if (result.success && result.data) {
    // 记录发帖时间
    heartbeatManager.recordPost();
    return { success: true, post: result.data.post };
  }

  // 处理速率限制
  if (result.rateLimit?.retryAfterMinutes) {
    return {
      success: false,
      error: result.error,
      hint: result.hint,
      retry_after_minutes: result.rateLimit.retryAfterMinutes,
    };
  }

  return {
    success: false,
    error: result.error,
    hint: result.hint,
  };
}

/** 评论参数Schema */
export const commentSchema = z.object({
  post_id: z.string(),
  content: z.string(),
  parent_id: z.string().optional(),
  identity: z.string().optional(),
});

/** 发表评论 */
export async function moltbook_comment(
  params: z.infer<typeof commentSchema>
): Promise<{ success: boolean; comment?: Comment; error?: string; retry_after_seconds?: number; daily_remaining?: number; hint?: string }> {
  const { post_id, content, parent_id, identity } = commentSchema.parse(params);

  // 检查冷却时间
  if (!heartbeatManager.canComment()) {
    return {
      success: false,
      error: "评论冷却中，请稍后再试",
      hint: "评论限制: 每 20 秒 1 条，每天 50 条",
      retry_after_seconds: 20,
    };
  }

  const body: Record<string, string> = { content };
  if (parent_id) body.parent_id = parent_id;

  const result = await apiRequest<{ comment: Comment; retry_after_seconds?: number; daily_remaining?: number }>(
    `/posts/${post_id}/comments`,
    {
      method: "POST",
      body: JSON.stringify(body),
    },
    identity
  );

  if (result.success && result.data) {
    // 记录评论时间
    heartbeatManager.recordComment();
    return { 
      success: true, 
      comment: result.data.comment,
      daily_remaining: result.data.daily_remaining,
    };
  }

  // 处理速率限制
  if (result.rateLimit) {
    return {
      success: false,
      error: result.error,
      hint: result.hint,
      retry_after_seconds: result.rateLimit.retryAfterSeconds,
      daily_remaining: result.rateLimit.dailyRemaining,
    };
  }

  return {
    success: false,
    error: result.error,
    hint: result.hint,
  };
}

/** 投票参数Schema */
export const voteSchema = z.object({
  post_id: z.string(),
  direction: z.enum(["up", "down"]),
  identity: z.string().optional(),
});

/** 投票 */
export async function moltbook_vote(
  params: z.infer<typeof voteSchema>
): Promise<{ success: boolean; message?: string; author?: { name: string }; error?: string }> {
  const { post_id, direction, identity } = voteSchema.parse(params);

  const endpoint = `/posts/${post_id}/${direction === "up" ? "upvote" : "downvote"}`;

  const result = await apiRequest<{ message: string; author?: { name: string } }>(
    endpoint,
    { method: "POST" },
    identity
  );

  if (result.success && result.data) {
    return {
      success: true,
      message: result.data.message,
      author: result.data.author,
    };
  }

  return { success: false, error: result.error };
}

/** 评论投票参数Schema */
export const voteCommentSchema = z.object({
  comment_id: z.string(),
  direction: z.enum(["up", "down"]),
  identity: z.string().optional(),
});

/** 评论投票 */
export async function moltbook_vote_comment(
  params: z.infer<typeof voteCommentSchema>
): Promise<{ success: boolean; message?: string; error?: string }> {
  const { comment_id, direction, identity } = voteCommentSchema.parse(params);

  const endpoint = `/comments/${comment_id}/${direction === "up" ? "upvote" : "downvote"}`;

  const result = await apiRequest<{ message: string }>(
    endpoint,
    { method: "POST" },
    identity
  );

  if (result.success && result.data) {
    return { success: true, message: result.data.message };
  }

  return { success: false, error: result.error };
}

/** 加入Submolt参数Schema */
export const joinSubmoltSchema = z.object({
  name: z.string(),
  identity: z.string().optional(),
});

/** 加入/订阅Submolt */
export async function moltbook_join_submolt(
  params: z.infer<typeof joinSubmoltSchema>
): Promise<{ success: boolean; message?: string; error?: string }> {
  const { name, identity } = joinSubmoltSchema.parse(params);

  const result = await apiRequest<{ message: string }>(
    `/submolts/${name}/subscribe`,
    { method: "POST" },
    identity
  );

  if (result.success && result.data) {
    return { success: true, message: result.data.message };
  }

  return { success: false, error: result.error };
}

/** 退出Submolt参数Schema */
export const leaveSubmoltSchema = z.object({
  name: z.string(),
  identity: z.string().optional(),
});

/** 退出/取消订阅Submolt */
export async function moltbook_leave_submolt(
  params: z.infer<typeof leaveSubmoltSchema>
): Promise<{ success: boolean; message?: string; error?: string }> {
  const { name, identity } = leaveSubmoltSchema.parse(params);

  const result = await apiRequest<{ message: string }>(
    `/submolts/${name}/subscribe`,
    { method: "DELETE" },
    identity
  );

  if (result.success && result.data) {
    return { success: true, message: result.data.message };
  }

  return { success: false, error: result.error };
}

/** 创建Submolt参数Schema */
export const createSubmoltSchema = z.object({
  name: z.string(),
  display_name: z.string(),
  description: z.string(),
  identity: z.string().optional(),
});

/** 创建Submolt */
export async function moltbook_create_submolt(
  params: z.infer<typeof createSubmoltSchema>
): Promise<{ success: boolean; submolt?: Submolt; error?: string }> {
  const { name, display_name, description, identity } = createSubmoltSchema.parse(params);

  const result = await apiRequest<{ submolt: Submolt }>(
    "/submolts",
    {
      method: "POST",
      body: JSON.stringify({ name, display_name, description }),
    },
    identity
  );

  if (result.success && result.data) {
    return { success: true, submolt: result.data.submolt };
  }

  return { success: false, error: result.error };
}

/** 删除帖子参数Schema */
export const deletePostSchema = z.object({
  post_id: z.string(),
  identity: z.string().optional(),
});

/** 删除帖子 */
export async function moltbook_delete_post(
  params: z.infer<typeof deletePostSchema>
): Promise<{ success: boolean; message?: string; error?: string; note?: string }> {
  const { post_id, identity } = deletePostSchema.parse(params);

  const result = await apiRequest<{ message: string }>(
    `/posts/${post_id}`,
    { method: "DELETE" },
    identity
  );

  if (result.success) {
    // 尝试做一次轻量验证：部分情况下服务端会返回成功但帖子仍可被 GET 到。
    const verify = await apiRequest<{ success: boolean; post?: unknown }>(
      `/posts/${post_id}`,
      { method: "GET" },
      identity,
      1
    );

    if (verify.success) {
      return {
        success: true,
        message: result.data?.message || "Delete requested",
        note: "删除请求已提交，但帖子暂时仍可访问。Moltbook 平台可能存在较长延迟或删除功能异常；建议稍后再检查或在网页端确认。",
      };
    }

    return { success: true, message: result.data?.message || "Post deleted" };
  }

  return { success: false, error: result.error };
}

// ============================================================================
// 阶段3: 分析工具
// ============================================================================

/** 趋势分析参数Schema */
export const analyzeTrendSchema = z.object({
  submolt: z.string().optional(),
  timerange: z.enum(["1h", "6h", "24h", "7d", "30d"]).optional().default("24h"),
  identity: z.string().optional(),
});

/** 
 * 热度趋势分析
 * 基于帖子的投票、评论数据计算热度趋势
 */
export async function analyze_trend(
  params: z.infer<typeof analyzeTrendSchema>
): Promise<{
  success: boolean;
  trends?: {
    hotTopics: Array<{ title: string; score: number; post_id: string }>;
    risingAuthors: Array<{ name: string; posts: number; engagement: number }>;
    activeSubmolts: Array<{ name: string; activity: number }>;
  };
  error?: string;
}> {
  const { submolt, timerange, identity } = analyzeTrendSchema.parse(params);

  // 获取帖子数据
  const feedResult = await moltbook_get_feed({
    submolt,
    sort: "hot",
    limit: 100,
    identity,
  });

  if (!feedResult.success || !feedResult.posts) {
    return { success: false, error: feedResult.error };
  }

  const posts = feedResult.posts;

  // 计算热度分数
  const hotTopics = posts
    .map((post) => ({
      title: post.title,
      score: post.upvotes - post.downvotes + post.comment_count * 2,
      post_id: post.id,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);

  // 统计活跃作者
  const authorStats = new Map<string, { posts: number; engagement: number }>();
  for (const post of posts) {
    const name = post.author.name;
    const existing = authorStats.get(name) || { posts: 0, engagement: 0 };
    existing.posts += 1;
    existing.engagement += post.upvotes + post.comment_count;
    authorStats.set(name, existing);
  }

  const risingAuthors = Array.from(authorStats.entries())
    .map(([name, stats]) => ({ name, ...stats }))
    .sort((a, b) => b.engagement - a.engagement)
    .slice(0, 10);

  // 统计活跃Submolt
  const submoltStats = new Map<string, number>();
  for (const post of posts) {
    const name = post.submolt.name;
    submoltStats.set(name, (submoltStats.get(name) || 0) + 1);
  }

  const activeSubmolts = Array.from(submoltStats.entries())
    .map(([name, activity]) => ({ name, activity }))
    .sort((a, b) => b.activity - a.activity)
    .slice(0, 10);

  return {
    success: true,
    trends: {
      hotTopics,
      risingAuthors,
      activeSubmolts,
    },
  };
}

/** 情感分析参数Schema */
export const analyzeSentimentSchema = z.object({
  query: z.string().optional(),
  post_ids: z.array(z.string()).optional(),
  identity: z.string().optional(),
});

/**
 * 情感分析
 * 基于投票比例和关键词简单判断情感倾向
 */
export async function analyze_sentiment(
  params: z.infer<typeof analyzeSentimentSchema>
): Promise<{
  success: boolean;
  sentiment?: {
    overall: "positive" | "negative" | "neutral" | "mixed";
    score: number;
    details: Array<{
      post_id: string;
      title: string;
      sentiment: "positive" | "negative" | "neutral";
      ratio: number;
    }>;
  };
  error?: string;
}> {
  const { query, post_ids, identity } = analyzeSentimentSchema.parse(params);

  let posts: Post[] = [];

  if (query) {
    const searchResult = await moltbook_search({ query, type: "posts", limit: 20, identity });
    if (searchResult.success && searchResult.results) {
      posts = searchResult.results.map((r) => ({
        id: r.post_id,
        title: r.title || "",
        content: r.content,
        upvotes: r.upvotes,
        downvotes: r.downvotes,
        comment_count: 0,
        created_at: r.created_at,
        author: r.author,
        submolt: r.submolt || { name: "", display_name: "" },
      }));
    }
  } else if (post_ids && post_ids.length > 0) {
    // 获取指定帖子
    for (const postId of post_ids.slice(0, 20)) {
      const result = await moltbook_get_post({ post_id: postId, identity });
      if (result.success && result.post) {
        posts.push(result.post);
      }
    }
  } else {
    // 默认获取最新帖子
    const feedResult = await moltbook_get_feed({ sort: "new", limit: 20, identity });
    if (feedResult.success && feedResult.posts) {
      posts = feedResult.posts;
    }
  }

  if (posts.length === 0) {
    return { success: false, error: "没有找到可分析的帖子" };
  }

  // 计算每个帖子的情感
  const details = posts.map((post) => {
    const total = post.upvotes + post.downvotes;
    const ratio = total > 0 ? post.upvotes / total : 0.5;
    let sentiment: "positive" | "negative" | "neutral" = "neutral";
    if (ratio > 0.6) sentiment = "positive";
    else if (ratio < 0.4) sentiment = "negative";
    return {
      post_id: post.id,
      title: post.title,
      sentiment,
      ratio,
    };
  });

  // 计算整体情感
  const avgRatio = details.reduce((sum, d) => sum + d.ratio, 0) / details.length;
  const positiveCount = details.filter((d) => d.sentiment === "positive").length;
  const negativeCount = details.filter((d) => d.sentiment === "negative").length;

  let overall: "positive" | "negative" | "neutral" | "mixed" = "neutral";
  if (positiveCount > details.length * 0.6) overall = "positive";
  else if (negativeCount > details.length * 0.6) overall = "negative";
  else if (positiveCount > 0 && negativeCount > 0) overall = "mixed";

  return {
    success: true,
    sentiment: {
      overall,
      score: avgRatio,
      details,
    },
  };
}

/** 话题分析参数Schema */
export const analyzeTopicsSchema = z.object({
  submolt: z.string().optional(),
  limit: z.number().min(5).max(50).optional().default(20),
  identity: z.string().optional(),
});

/**
 * 话题聚类分析
 * 基于标题关键词进行简单的话题聚类
 */
export async function analyze_topics(
  params: z.infer<typeof analyzeTopicsSchema>
): Promise<{
  success: boolean;
  topics?: Array<{
    keyword: string;
    count: number;
    posts: Array<{ id: string; title: string }>;
  }>;
  error?: string;
}> {
  const { submolt, limit, identity } = analyzeTopicsSchema.parse(params);

  const feedResult = await moltbook_get_feed({ submolt, sort: "hot", limit, identity });

  if (!feedResult.success || !feedResult.posts) {
    return { success: false, error: feedResult.error };
  }

  // 简单的关键词提取（基于词频）
  const wordMap = new Map<string, Array<{ id: string; title: string }>>();
  const stopWords = new Set([
    "the", "a", "an", "is", "are", "was", "were", "be", "been",
    "being", "have", "has", "had", "do", "does", "did", "will",
    "would", "could", "should", "may", "might", "can", "to", "of",
    "in", "for", "on", "with", "at", "by", "from", "as", "into",
    "through", "during", "before", "after", "above", "below",
    "and", "or", "but", "if", "then", "else", "when", "where",
    "why", "how", "all", "each", "every", "both", "few", "more",
    "most", "other", "some", "such", "no", "nor", "not", "only",
    "own", "same", "so", "than", "too", "very", "just", "i", "me",
    "my", "myself", "we", "our", "you", "your", "he", "him", "his",
    "she", "her", "it", "its", "they", "them", "their", "what",
    "which", "who", "whom", "this", "that", "these", "those", "am",
  ]);

  for (const post of feedResult.posts) {
    const words = post.title
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !stopWords.has(w));

    for (const word of words) {
      const existing = wordMap.get(word) || [];
      if (!existing.some((p) => p.id === post.id)) {
        existing.push({ id: post.id, title: post.title });
        wordMap.set(word, existing);
      }
    }
  }

  // 按出现次数排序
  const topics = Array.from(wordMap.entries())
    .map(([keyword, posts]) => ({ keyword, count: posts.length, posts }))
    .filter((t) => t.count >= 2) // 至少出现2次
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  return { success: true, topics };
}

/** 异常检测参数Schema */
export const analyzeAnomalySchema = z.object({
  submolt: z.string().optional(),
  identity: z.string().optional(),
});

/**
 * 异常信号识别
 * 检测异常的投票模式或活动模式
 */
export async function analyze_anomaly(
  params: z.infer<typeof analyzeAnomalySchema>
): Promise<{
  success: boolean;
  anomalies?: {
    unusualPosts: Array<{
      post_id: string;
      title: string;
      reason: string;
      score: number;
    }>;
    summary: string;
  };
  error?: string;
}> {
  const { submolt, identity } = analyzeAnomalySchema.parse(params);

  const feedResult = await moltbook_get_feed({ submolt, sort: "new", limit: 50, identity });

  if (!feedResult.success || !feedResult.posts) {
    return { success: false, error: feedResult.error };
  }

  const posts = feedResult.posts;

  // 计算平均值
  const avgUpvotes = posts.reduce((sum, p) => sum + p.upvotes, 0) / posts.length;
  const avgDownvotes = posts.reduce((sum, p) => sum + p.downvotes, 0) / posts.length;
  const avgComments = posts.reduce((sum, p) => sum + p.comment_count, 0) / posts.length;

  // 检测异常
  const unusualPosts: Array<{
    post_id: string;
    title: string;
    reason: string;
    score: number;
  }> = [];

  for (const post of posts) {
    const reasons: string[] = [];
    let anomalyScore = 0;

    // 异常高的投票
    if (post.upvotes > avgUpvotes * 3) {
      reasons.push(`投票数异常高 (${post.upvotes} vs avg ${avgUpvotes.toFixed(1)})`);
      anomalyScore += 2;
    }

    // 异常高的反对票
    if (post.downvotes > avgDownvotes * 3 && post.downvotes > 5) {
      reasons.push(`反对票异常高 (${post.downvotes})`);
      anomalyScore += 2;
    }

    // 投票比例异常
    const total = post.upvotes + post.downvotes;
    if (total > 10 && post.downvotes / total > 0.5) {
      reasons.push(`反对比例异常高 (${((post.downvotes / total) * 100).toFixed(0)}%)`);
      anomalyScore += 1;
    }

    // 评论数异常
    if (post.comment_count > avgComments * 4) {
      reasons.push(`评论数异常高 (${post.comment_count})`);
      anomalyScore += 1;
    }

    if (reasons.length > 0) {
      unusualPosts.push({
        post_id: post.id,
        title: post.title,
        reason: reasons.join("; "),
        score: anomalyScore,
      });
    }
  }

  // 按异常分数排序
  unusualPosts.sort((a, b) => b.score - a.score);

  const summary =
    unusualPosts.length > 0
      ? `在 ${posts.length} 个帖子中发现 ${unusualPosts.length} 个异常信号`
      : `在 ${posts.length} 个帖子中未发现明显异常`;

  return {
    success: true,
    anomalies: {
      unusualPosts: unusualPosts.slice(0, 10),
      summary,
    },
  };
}

// ============================================================================
// 阶段4: 社交工具
// ============================================================================

/** 关注参数Schema */
export const followSchema = z.object({
  agent_name: z.string(),
  identity: z.string().optional(),
});

/** 关注Agent */
export async function moltbook_follow(
  params: z.infer<typeof followSchema>
): Promise<{ success: boolean; message?: string; error?: string }> {
  const { agent_name, identity } = followSchema.parse(params);

  const result = await apiRequest<{ message: string }>(
    `/agents/${encodeURIComponent(agent_name)}/follow`,
    { method: "POST" },
    identity
  );

  if (result.success && result.data) {
    return { success: true, message: result.data.message };
  }

  return { success: false, error: result.error };
}

/** 取关参数Schema */
export const unfollowSchema = z.object({
  agent_name: z.string(),
  identity: z.string().optional(),
});

/** 取消关注Agent */
export async function moltbook_unfollow(
  params: z.infer<typeof unfollowSchema>
): Promise<{ success: boolean; message?: string; error?: string }> {
  const { agent_name, identity } = unfollowSchema.parse(params);

  const result = await apiRequest<{ message: string }>(
    `/agents/${encodeURIComponent(agent_name)}/follow`,
    { method: "DELETE" },
    identity
  );

  if (result.success && result.data) {
    return { success: true, message: result.data.message };
  }

  return { success: false, error: result.error };
}

/** 个性化Feed参数Schema */
export const getPersonalizedFeedSchema = z.object({
  sort: z.enum(["hot", "new", "top"]).optional().default("hot"),
  limit: z.number().min(1).max(100).optional().default(25),
  identity: z.string().optional(),
});

/** 获取个性化Feed */
export async function moltbook_get_personalized_feed(
  params: z.infer<typeof getPersonalizedFeedSchema>
): Promise<{ success: boolean; posts?: Post[]; error?: string }> {
  const { sort, limit, identity } = getPersonalizedFeedSchema.parse(params);

  const result = await apiRequest<{ posts?: Post[]; data?: Post[] }>(
    `/feed?sort=${sort}&limit=${limit}`,
    {},
    identity
  );

  if (result.success && result.data) {
    return {
      success: true,
      posts: result.data.posts || result.data.data || [],
    };
  }

  return { success: false, error: result.error };
}

/** 获取自己的资料 */
export async function moltbook_get_me(
  params: { identity?: string }
): Promise<{ success: boolean; agent?: AgentProfile; error?: string }> {
  const result = await apiRequest<{ agent: AgentProfile }>(
    "/agents/me",
    {},
    params.identity
  );

  if (result.success && result.data) {
    return { success: true, agent: result.data.agent };
  }

  return { success: false, error: result.error };
}

// ============================================================================
// 工具注册表（供Agent和MCP使用）
// ============================================================================

/** 工具定义类型 */
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: z.ZodType;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: (params: any) => Promise<any>;
}

/** 所有可用工具 */
export const tools: ToolDefinition[] = [
  // 阶段1: 读取工具
  {
    name: "moltbook_get_feed",
    description: "获取Moltbook帖子流，可按热度、最新、最高、上升排序",
    parameters: getFeedSchema,
    handler: moltbook_get_feed,
  },
  {
    name: "moltbook_search",
    description: "语义搜索Moltbook内容，支持自然语言查询",
    parameters: searchSchema,
    handler: moltbook_search,
  },
  {
    name: "moltbook_get_profile",
    description: "获取指定Agent的资料和最近帖子",
    parameters: getProfileSchema,
    handler: moltbook_get_profile,
  },
  {
    name: "moltbook_get_submolts",
    description: "获取所有Submolt社区列表",
    parameters: getSubmoltsSchema,
    handler: moltbook_get_submolts,
  },
  {
    name: "moltbook_get_post",
    description: "获取单个帖子的详细信息和评论",
    parameters: getPostSchema,
    handler: moltbook_get_post,
  },
  {
    name: "moltbook_get_comments",
    description: "获取帖子的评论列表",
    parameters: getCommentsSchema,
    handler: moltbook_get_comments,
  },

  // 阶段2: 写入工具
  {
    name: "moltbook_post",
    description: "在Moltbook发布新帖子",
    parameters: postSchema,
    handler: moltbook_post,
  },
  {
    name: "moltbook_comment",
    description: "在帖子下发表评论或回复",
    parameters: commentSchema,
    handler: moltbook_comment,
  },
  {
    name: "moltbook_vote",
    description: "对帖子进行投票（赞成/反对）",
    parameters: voteSchema,
    handler: moltbook_vote,
  },
  {
    name: "moltbook_vote_comment",
    description: "对评论进行投票",
    parameters: voteCommentSchema,
    handler: moltbook_vote_comment,
  },
  {
    name: "moltbook_join_submolt",
    description: "订阅/加入一个Submolt社区",
    parameters: joinSubmoltSchema,
    handler: moltbook_join_submolt,
  },
  {
    name: "moltbook_leave_submolt",
    description: "取消订阅/退出一个Submolt社区",
    parameters: leaveSubmoltSchema,
    handler: moltbook_leave_submolt,
  },
  {
    name: "moltbook_create_submolt",
    description: "创建新的Submolt社区",
    parameters: createSubmoltSchema,
    handler: moltbook_create_submolt,
  },
  {
    name: "moltbook_delete_post",
    description: "删除自己发布的帖子",
    parameters: deletePostSchema,
    handler: moltbook_delete_post,
  },

  // 阶段3: 分析工具
  {
    name: "analyze_trend",
    description: "分析Moltbook热度趋势，发现热门话题和活跃作者",
    parameters: analyzeTrendSchema,
    handler: analyze_trend,
  },
  {
    name: "analyze_sentiment",
    description: "情感分析，判断帖子或搜索结果的情感倾向",
    parameters: analyzeSentimentSchema,
    handler: analyze_sentiment,
  },
  {
    name: "analyze_topics",
    description: "话题聚类分析，发现当前热门关键词",
    parameters: analyzeTopicsSchema,
    handler: analyze_topics,
  },
  {
    name: "analyze_anomaly",
    description: "异常信号识别，检测异常投票或活动模式",
    parameters: analyzeAnomalySchema,
    handler: analyze_anomaly,
  },

  // 阶段4: 社交工具
  {
    name: "moltbook_follow",
    description: "关注一个Agent",
    parameters: followSchema,
    handler: moltbook_follow,
  },
  {
    name: "moltbook_unfollow",
    description: "取消关注一个Agent",
    parameters: unfollowSchema,
    handler: moltbook_unfollow,
  },
  {
    name: "moltbook_get_personalized_feed",
    description: "获取个性化Feed（来自订阅的Submolt和关注的Agent）",
    parameters: getPersonalizedFeedSchema,
    handler: moltbook_get_personalized_feed,
  },
  {
    name: "moltbook_get_me",
    description: "获取当前身份的Agent资料",
    parameters: z.object({ identity: z.string().optional() }),
    handler: moltbook_get_me,
  },

  // 心跳工具
  {
    name: "heartbeat_run",
    description: "执行心跳检查，获取最新帖子和互动建议",
    parameters: z.object({}),
    handler: heartbeat_run,
  },
  {
    name: "heartbeat_status",
    description: "获取心跳状态（上次检查时间、冷却状态等）",
    parameters: z.object({}),
    handler: heartbeat_status,
  },
];

// ============================================================================
// 心跳工具
// ============================================================================

/** 执行心跳检查 */
export async function heartbeat_run(): Promise<{
  success: boolean;
  newPostsCount: number;
  suggestions: string[];
  error?: string;
}> {
  const result = await heartbeatManager.runHeartbeat();
  return {
    success: result.success,
    newPostsCount: result.newPostsCount,
    suggestions: result.suggestions,
    error: result.error,
  };
}

/** 获取心跳状态 */
export async function heartbeat_status(): Promise<{
  success: boolean;
  status: string;
  canPost: boolean;
  canComment: boolean;
}> {
  const statusSummary = heartbeatManager.getStatusSummary();
  return {
    success: true,
    status: statusSummary,
    canPost: heartbeatManager.canPost(),
    canComment: heartbeatManager.canComment(),
  };
}

/** 根据名称获取工具 */
export function getTool(name: string): ToolDefinition | undefined {
  return tools.find((t) => t.name === name);
}
