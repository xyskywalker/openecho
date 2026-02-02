/**
 * OpenEcho - 心跳模块
 * 实现 Moltbook 官方推荐的心跳检查机制
 * 参考: https://www.moltbook.com/heartbeat.md
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { identityManager } from "./identity.js";

// ============================================================================
// 常量配置
// ============================================================================

/** Moltbook API 基础URL（必须使用 www，否则会丢失 Authorization header） */
const MOLTBOOK_API_BASE = "https://www.moltbook.com/api/v1";

/** 心跳状态文件路径 */
const HEARTBEAT_STATE_FILE = path.join(os.homedir(), ".openecho", "heartbeat-state.json");

/** 默认心跳间隔（4小时，单位毫秒） */
const DEFAULT_HEARTBEAT_INTERVAL_MS = 4 * 60 * 60 * 1000;

/** 最小心跳间隔（1小时，防止过于频繁） */
const MIN_HEARTBEAT_INTERVAL_MS = 1 * 60 * 60 * 1000;

// ============================================================================
// 类型定义
// ============================================================================

/** 心跳状态 */
export interface HeartbeatState {
  /** 上次心跳检查时间 */
  lastCheck: string | null;
  /** 上次成功发帖时间 */
  lastPost: string | null;
  /** 上次成功评论时间 */
  lastComment: string | null;
  /** 心跳检查次数 */
  checkCount: number;
  /** 上次检查结果 */
  lastResult: HeartbeatResult | null;
}

/** 心跳检查结果 */
export interface HeartbeatResult {
  /** 是否成功 */
  success: boolean;
  /** 检查时间 */
  timestamp: string;
  /** 新帖子数量 */
  newPostsCount: number;
  /** 建议的操作 */
  suggestions: string[];
  /** 错误信息 */
  error?: string;
}

/** 简化的帖子信息（用于心跳返回） */
interface SimplePost {
  id: string;
  title: string;
  author: string;
  submolt: string;
  upvotes: number;
  comment_count: number;
  created_at: string;
}

// ============================================================================
// 心跳管理类
// ============================================================================

export class HeartbeatManager {
  private state: HeartbeatState;

  constructor() {
    this.state = this.loadState();
  }

  // --------------------------------------------------------------------------
  // 状态持久化
  // --------------------------------------------------------------------------

  /** 加载心跳状态 */
  private loadState(): HeartbeatState {
    try {
      if (fs.existsSync(HEARTBEAT_STATE_FILE)) {
        const data = fs.readFileSync(HEARTBEAT_STATE_FILE, "utf-8");
        return JSON.parse(data);
      }
    } catch (error) {
      console.error("加载心跳状态失败:", error);
    }

    // 返回默认状态
    return {
      lastCheck: null,
      lastPost: null,
      lastComment: null,
      checkCount: 0,
      lastResult: null,
    };
  }

  /** 保存心跳状态 */
  private saveState(): void {
    try {
      const dir = path.dirname(HEARTBEAT_STATE_FILE);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      // 明确指定 UTF-8 编码，确保跨平台兼容
      fs.writeFileSync(HEARTBEAT_STATE_FILE, JSON.stringify(this.state, null, 2), { encoding: "utf-8" });
    } catch (error) {
      console.error("保存心跳状态失败:", error);
    }
  }

  // --------------------------------------------------------------------------
  // 心跳检查逻辑
  // --------------------------------------------------------------------------

  /** 检查是否需要执行心跳 */
  shouldRunHeartbeat(intervalMs: number = DEFAULT_HEARTBEAT_INTERVAL_MS): boolean {
    // 确保间隔不小于最小值
    const effectiveInterval = Math.max(intervalMs, MIN_HEARTBEAT_INTERVAL_MS);

    if (!this.state.lastCheck) {
      return true;
    }

    const lastCheckTime = new Date(this.state.lastCheck).getTime();
    const now = Date.now();

    return now - lastCheckTime >= effectiveInterval;
  }

  /** 获取距离下次心跳的时间（毫秒） */
  getTimeUntilNextHeartbeat(intervalMs: number = DEFAULT_HEARTBEAT_INTERVAL_MS): number {
    if (!this.state.lastCheck) {
      return 0;
    }

    const lastCheckTime = new Date(this.state.lastCheck).getTime();
    const nextCheckTime = lastCheckTime + intervalMs;
    const remaining = nextCheckTime - Date.now();

    return Math.max(0, remaining);
  }

  /**
   * 执行心跳检查
   * 按照官方 heartbeat.md 的要求：
   * 1. 获取最新帖子
   * 2. 检查是否有值得互动的内容
   * 3. 返回建议的操作
   */
  async runHeartbeat(): Promise<HeartbeatResult> {
    const timestamp = new Date().toISOString();
    const suggestions: string[] = [];

    // 检查身份
    const apiKey = identityManager.getApiKey();
    if (!apiKey) {
      const result: HeartbeatResult = {
        success: false,
        timestamp,
        newPostsCount: 0,
        suggestions: ["请先运行 'openecho identity add' 创建身份"],
        error: "没有可用的身份",
      };
      this.state.lastResult = result;
      this.saveState();
      return result;
    }

    try {
      // 1. 获取个性化 Feed（订阅的 submolts + 关注的 moltys）
      const feedResponse = await this.fetchWithRetry(
        `${MOLTBOOK_API_BASE}/feed?sort=new&limit=10`,
        apiKey
      );

      let newPostsCount = 0;
      const recentPosts: SimplePost[] = [];

      if (feedResponse.ok) {
        const feedData = await feedResponse.json() as { posts?: Array<{
          id: string;
          title: string;
          author: { name: string };
          submolt: { name: string };
          upvotes: number;
          comment_count: number;
          created_at: string;
        }> };
        
        if (feedData.posts && feedData.posts.length > 0) {
          // 统计新帖子（4小时内）
          const fourHoursAgo = Date.now() - DEFAULT_HEARTBEAT_INTERVAL_MS;
          for (const post of feedData.posts) {
            const postTime = new Date(post.created_at).getTime();
            if (postTime > fourHoursAgo) {
              newPostsCount++;
              recentPosts.push({
                id: post.id,
                title: post.title,
                author: post.author.name,
                submolt: post.submolt.name,
                upvotes: post.upvotes,
                comment_count: post.comment_count,
                created_at: post.created_at,
              });
            }
          }
        }
      }

      // 2. 如果个性化 Feed 为空，尝试全局 Feed
      if (newPostsCount === 0) {
        const globalResponse = await this.fetchWithRetry(
          `${MOLTBOOK_API_BASE}/posts?sort=new&limit=10`,
          apiKey
        );

        if (globalResponse.ok) {
          const globalData = await globalResponse.json() as { posts?: Array<{
            id: string;
            title: string;
            author: { name: string };
            submolt: { name: string };
            upvotes: number;
            comment_count: number;
            created_at: string;
          }> };
          
          if (globalData.posts && globalData.posts.length > 0) {
            const fourHoursAgo = Date.now() - DEFAULT_HEARTBEAT_INTERVAL_MS;
            for (const post of globalData.posts) {
              const postTime = new Date(post.created_at).getTime();
              if (postTime > fourHoursAgo) {
                newPostsCount++;
                recentPosts.push({
                  id: post.id,
                  title: post.title,
                  author: post.author.name,
                  submolt: post.submolt.name,
                  upvotes: post.upvotes,
                  comment_count: post.comment_count,
                  created_at: post.created_at,
                });
              }
            }
          }
        }
      }

      // 3. 生成建议
      if (newPostsCount > 0) {
        suggestions.push(`发现 ${newPostsCount} 个新帖子，可以浏览并互动`);
        
        // 找出值得互动的帖子
        const interestingPosts = recentPosts
          .filter(p => p.comment_count < 10 || p.upvotes > 5)
          .slice(0, 3);
        
        if (interestingPosts.length > 0) {
          suggestions.push("推荐互动的帖子:");
          for (const post of interestingPosts) {
            suggestions.push(`  - "${post.title.slice(0, 50)}${post.title.length > 50 ? '...' : ''}" by ${post.author} (${post.comment_count} 评论)`);
          }
        }
      } else {
        suggestions.push("暂无新帖子，可以考虑发布一些内容");
      }

      // 检查是否该发帖了（30分钟冷却）
      const canPost = this.canPost();
      if (canPost) {
        suggestions.push("发帖冷却已结束，可以发布新内容");
      }

      // 更新状态
      this.state.lastCheck = timestamp;
      this.state.checkCount++;
      
      const result: HeartbeatResult = {
        success: true,
        timestamp,
        newPostsCount,
        suggestions,
      };
      
      this.state.lastResult = result;
      this.saveState();

      return result;
    } catch (error) {
      const result: HeartbeatResult = {
        success: false,
        timestamp,
        newPostsCount: 0,
        suggestions: ["心跳检查失败，请稍后重试"],
        error: `${error}`,
      };
      
      this.state.lastResult = result;
      this.saveState();
      
      return result;
    }
  }

  // --------------------------------------------------------------------------
  // 辅助方法
  // --------------------------------------------------------------------------

  /** 带重试的 fetch 请求 */
  private async fetchWithRetry(
    url: string,
    apiKey: string,
    maxRetries: number = 3
  ): Promise<Response> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const response = await fetch(url, {
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
        });

        // 如果不是服务器错误，直接返回
        if (response.status < 500) {
          return response;
        }

        // 服务器错误，等待后重试
        lastError = new Error(`HTTP ${response.status}`);
        if (attempt < maxRetries) {
          await this.sleep(1000 * attempt); // 指数退避
        }
      } catch (error) {
        lastError = error as Error;
        if (attempt < maxRetries) {
          await this.sleep(1000 * attempt);
        }
      }
    }

    throw lastError || new Error("请求失败");
  }

  /** 等待指定毫秒 */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /** 检查是否可以发帖（30分钟冷却） */
  canPost(): boolean {
    if (!this.state.lastPost) {
      return true;
    }

    const lastPostTime = new Date(this.state.lastPost).getTime();
    const cooldownMs = 30 * 60 * 1000; // 30分钟

    return Date.now() - lastPostTime >= cooldownMs;
  }

  /** 检查是否可以评论（20秒冷却） */
  canComment(): boolean {
    if (!this.state.lastComment) {
      return true;
    }

    const lastCommentTime = new Date(this.state.lastComment).getTime();
    const cooldownMs = 20 * 1000; // 20秒

    return Date.now() - lastCommentTime >= cooldownMs;
  }

  /** 记录发帖时间 */
  recordPost(): void {
    this.state.lastPost = new Date().toISOString();
    this.saveState();
  }

  /** 记录评论时间 */
  recordComment(): void {
    this.state.lastComment = new Date().toISOString();
    this.saveState();
  }

  /** 获取当前状态 */
  getState(): HeartbeatState {
    return { ...this.state };
  }

  /** 获取状态摘要 */
  getStatusSummary(): string {
    const lines: string[] = [];
    
    lines.push("=== 心跳状态 ===");
    
    if (this.state.lastCheck) {
      const lastCheckDate = new Date(this.state.lastCheck);
      const timeSince = this.formatTimeSince(lastCheckDate);
      lines.push(`上次检查: ${timeSince}`);
    } else {
      lines.push("上次检查: 从未");
    }
    
    lines.push(`检查总次数: ${this.state.checkCount}`);
    
    if (this.state.lastResult) {
      lines.push(`上次结果: ${this.state.lastResult.success ? "成功" : "失败"}`);
      if (this.state.lastResult.newPostsCount > 0) {
        lines.push(`  新帖子: ${this.state.lastResult.newPostsCount}`);
      }
    }
    
    // 冷却状态
    const canPost = this.canPost();
    const canComment = this.canComment();
    lines.push(`\n发帖冷却: ${canPost ? "已结束 ✓" : "冷却中..."}`);
    lines.push(`评论冷却: ${canComment ? "已结束 ✓" : "冷却中..."}`);
    
    // 下次心跳
    const timeUntil = this.getTimeUntilNextHeartbeat();
    if (timeUntil > 0) {
      lines.push(`\n下次心跳: ${this.formatDuration(timeUntil)} 后`);
    } else {
      lines.push("\n可以执行心跳检查");
    }
    
    return lines.join("\n");
  }

  /** 格式化时间间隔 */
  private formatTimeSince(date: Date): string {
    const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
    
    if (seconds < 60) return `${seconds} 秒前`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)} 小时前`;
    return `${Math.floor(seconds / 86400)} 天前`;
  }

  /** 格式化持续时间 */
  private formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    
    if (seconds < 60) return `${seconds} 秒`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟`;
    return `${Math.floor(seconds / 3600)} 小时 ${Math.floor((seconds % 3600) / 60)} 分钟`;
  }
}

// ============================================================================
// 导出单例
// ============================================================================

export const heartbeatManager = new HeartbeatManager();
