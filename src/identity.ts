/**
 * OpenEcho - 多身份管理模块
 * 负责 Moltbook Agent 身份的注册、验证、切换和持久化存储
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// ============================================================================
// 类型定义
// ============================================================================

/** 身份状态 */
export type IdentityStatus = "pending_claim" | "claimed" | "inactive";

/** 单个身份信息 */
export interface Identity {
  /** API密钥 */
  api_key: string;
  /** Agent名称 */
  name: string;
  /** Agent描述 */
  description?: string;
  /** 身份状态 */
  status: IdentityStatus;
  /** 认领URL（pending状态时有效） */
  claim_url?: string;
  /** 验证码 */
  verification_code?: string;
  /** 创建时间 */
  created_at: string;
  /** 最后活跃时间 */
  last_active?: string;
}

/** 身份配置文件结构 */
export interface IdentitiesConfig {
  /** 默认身份名称 */
  default: string | null;
  /** 所有身份 */
  identities: Record<string, Identity>;
}

/** 注册API响应 */
interface RegisterResponse {
  agent: {
    api_key: string;
    claim_url: string;
    verification_code: string;
  };
  important: string;
}

/** 状态检查API响应 */
interface StatusResponse {
  status: "pending_claim" | "claimed";
}

// ============================================================================
// 常量配置
// ============================================================================

/** Moltbook API 基础URL */
const MOLTBOOK_API_BASE = "https://www.moltbook.com/api/v1";

/** 配置文件目录（使用 ~/.openecho 避免 ~/.config 权限问题） */
const CONFIG_DIR = path.join(os.homedir(), ".openecho");

/** 身份配置文件路径 */
const IDENTITIES_FILE = path.join(CONFIG_DIR, "identities.json");

// ============================================================================
// 身份管理类
// ============================================================================

export class IdentityManager {
  private config: IdentitiesConfig;

  constructor() {
    this.config = this.loadConfig();
  }

  // --------------------------------------------------------------------------
  // 配置文件操作
  // --------------------------------------------------------------------------

  /** 加载配置文件 */
  private loadConfig(): IdentitiesConfig {
    try {
      if (fs.existsSync(IDENTITIES_FILE)) {
        const data = fs.readFileSync(IDENTITIES_FILE, "utf-8");
        return JSON.parse(data);
      }
    } catch (error) {
      console.error("加载身份配置失败:", error);
    }

    // 返回默认空配置
    return {
      default: null,
      identities: {},
    };
  }

  /** 保存配置文件 */
  private saveConfig(): void {
    try {
      // 确保目录存在
      if (!fs.existsSync(CONFIG_DIR)) {
        fs.mkdirSync(CONFIG_DIR, { recursive: true });
      }
      // 明确指定 UTF-8 编码，确保跨平台兼容
      fs.writeFileSync(IDENTITIES_FILE, JSON.stringify(this.config, null, 2), { encoding: "utf-8" });
    } catch (error) {
      throw new Error(`保存身份配置失败: ${error}`);
    }
  }

  // --------------------------------------------------------------------------
  // 身份注册与验证
  // --------------------------------------------------------------------------

  /**
   * 注册新身份
   * @param name Agent名称
   * @param description Agent描述
   * @returns 注册结果，包含claim_url和verification_code
   */
  async register(
    name: string,
    description: string
  ): Promise<{
    success: boolean;
    identity?: Identity;
    claim_url?: string;
    verification_code?: string;
    error?: string;
  }> {
    try {
      const response = await fetch(`${MOLTBOOK_API_BASE}/agents/register`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name, description }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        return {
          success: false,
          error: (errorData as { error?: string }).error || `注册失败: HTTP ${response.status}`,
        };
      }

      const data = (await response.json()) as RegisterResponse;

      // 创建身份记录
      const identity: Identity = {
        api_key: data.agent.api_key,
        name,
        description,
        status: "pending_claim",
        claim_url: data.agent.claim_url,
        verification_code: data.agent.verification_code,
        created_at: new Date().toISOString(),
      };

      // 保存到配置
      this.config.identities[name] = identity;

      // 如果是第一个身份，设为默认
      if (!this.config.default) {
        this.config.default = name;
      }

      this.saveConfig();

      return {
        success: true,
        identity,
        claim_url: data.agent.claim_url,
        verification_code: data.agent.verification_code,
      };
    } catch (error) {
      return {
        success: false,
        error: `注册请求失败: ${error}`,
      };
    }
  }

  /**
   * 检查身份验证状态
   * @param name 身份名称（可选，默认使用当前身份）
   * @returns 状态信息
   */
  async checkStatus(name?: string): Promise<{
    success: boolean;
    status?: IdentityStatus;
    identity?: Identity;
    error?: string;
  }> {
    const identityName = name || this.config.default;
    if (!identityName) {
      return { success: false, error: "没有可用的身份" };
    }

    const identity = this.config.identities[identityName];
    if (!identity) {
      return { success: false, error: `身份 "${identityName}" 不存在` };
    }

    try {
      const response = await fetch(`${MOLTBOOK_API_BASE}/agents/status`, {
        headers: {
          Authorization: `Bearer ${identity.api_key}`,
        },
      });

      if (!response.ok) {
        return {
          success: false,
          error: `状态检查失败: HTTP ${response.status}`,
        };
      }

      const data = (await response.json()) as StatusResponse;

      // 更新本地状态
      if (data.status === "claimed" && identity.status !== "claimed") {
        identity.status = "claimed";
        delete identity.claim_url;
        delete identity.verification_code;
        this.saveConfig();
      }

      return {
        success: true,
        status: identity.status,
        identity,
      };
    } catch (error) {
      return {
        success: false,
        error: `状态检查请求失败: ${error}`,
      };
    }
  }

  // --------------------------------------------------------------------------
  // 身份管理操作
  // --------------------------------------------------------------------------

  /** 获取所有身份列表 */
  list(): { identities: Identity[]; default: string | null } {
    return {
      identities: Object.values(this.config.identities),
      default: this.config.default,
    };
  }

  /** 获取当前默认身份 */
  getCurrent(): Identity | null {
    if (!this.config.default) {
      return null;
    }
    return this.config.identities[this.config.default] || null;
  }

  /** 根据名称获取身份 */
  get(name: string): Identity | null {
    return this.config.identities[name] || null;
  }

  /** 获取身份的API Key */
  getApiKey(name?: string): string | null {
    const identity = name ? this.get(name) : this.getCurrent();
    return identity?.api_key || null;
  }

  /**
   * 切换默认身份
   * @param name 身份名称
   */
  switch(name: string): { success: boolean; error?: string } {
    if (!this.config.identities[name]) {
      return { success: false, error: `身份 "${name}" 不存在` };
    }

    this.config.default = name;
    this.saveConfig();

    return { success: true };
  }

  /**
   * 删除身份
   * @param name 身份名称
   */
  remove(name: string): { success: boolean; error?: string } {
    if (!this.config.identities[name]) {
      return { success: false, error: `身份 "${name}" 不存在` };
    }

    delete this.config.identities[name];

    // 如果删除的是默认身份，重新选择一个
    if (this.config.default === name) {
      const remaining = Object.keys(this.config.identities);
      this.config.default = remaining.length > 0 ? remaining[0] : null;
    }

    this.saveConfig();

    return { success: true };
  }

  /**
   * 手动添加已有身份（导入API Key）
   * @param name Agent名称
   * @param apiKey API密钥
   */
  async import(
    name: string,
    apiKey: string
  ): Promise<{ success: boolean; identity?: Identity; error?: string }> {
    try {
      // 验证API Key是否有效
      const response = await fetch(`${MOLTBOOK_API_BASE}/agents/me`, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      });

      if (!response.ok) {
        return {
          success: false,
          error: "API Key 无效或已过期",
        };
      }

      const data = (await response.json()) as { agent?: { name: string; description?: string } };

      // 创建身份记录
      const identity: Identity = {
        api_key: apiKey,
        name: data.agent?.name || name,
        description: data.agent?.description,
        status: "claimed",
        created_at: new Date().toISOString(),
      };

      this.config.identities[identity.name] = identity;

      if (!this.config.default) {
        this.config.default = identity.name;
      }

      this.saveConfig();

      return { success: true, identity };
    } catch (error) {
      return {
        success: false,
        error: `导入身份失败: ${error}`,
      };
    }
  }

  /** 更新身份的最后活跃时间 */
  updateLastActive(name?: string): void {
    const identityName = name || this.config.default;
    if (identityName && this.config.identities[identityName]) {
      this.config.identities[identityName].last_active = new Date().toISOString();
      this.saveConfig();
    }
  }

  /** 检查是否有任何可用身份 */
  hasIdentity(): boolean {
    return Object.keys(this.config.identities).length > 0;
  }

  /** 检查是否有已认证的身份 */
  hasClaimedIdentity(): boolean {
    return Object.values(this.config.identities).some((i) => i.status === "claimed");
  }
}

// ============================================================================
// 导出单例
// ============================================================================

export const identityManager = new IdentityManager();
