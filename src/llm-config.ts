/**
 * OpenEcho - LLM 配置管理模块
 * 支持 Claude、OpenAI 官方 API 和自定义 endpoint
 * 支持配置多个模型并快速切换
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// ============================================================================
// 类型定义
// ============================================================================

/** 
 * LLM Provider 类型
 * - claude: Anthropic Claude 官方 API
 * - openai: OpenAI 官方 API
 * - azure: Azure OpenAI 服务（新 v1 API）
 * - custom: 自定义 endpoint（兼容 OpenAI API 格式）
 */
export type LLMProvider = "claude" | "openai" | "azure" | "custom";

/** 所有支持的 Provider 列表 */
export const SUPPORTED_PROVIDERS: LLMProvider[] = ["claude", "openai", "azure", "custom"];

/** Provider 显示名称 */
export const PROVIDER_NAMES: Record<LLMProvider, string> = {
  claude: "Claude (Anthropic)",
  openai: "OpenAI",
  azure: "Azure OpenAI",
  custom: "自定义 (OpenAI 兼容)",
};

/** 单个 LLM 配置项 */
export interface LLMConfigItem {
  /** 配置名称（唯一标识） */
  name: string;
  /** 配置描述（可选） */
  description?: string;
  /** Provider 类型 */
  provider: LLMProvider;
  /** API Key */
  api_key: string;
  /** 模型名称（Azure 时为 deployment name） */
  model: string;
  /** 自定义 endpoint URL */
  endpoint?: string;
  
  // ---- Azure 特有字段 ----
  /** Azure 资源名称（用于构建 endpoint） */
  azure_resource?: string;
  /** Azure API 版本（旧版 API 需要，新 v1 API 不需要） */
  azure_api_version?: string;
}

/** 完整配置文件结构 */
export interface OpenEchoConfig {
  /** 当前使用的配置名称 */
  current?: string;
  /** 所有模型配置 */
  models?: Record<string, LLMConfigItem>;
}

/** 解析后的 LLM 配置（所有字段都有值） */
export interface ResolvedLLMConfig {
  name: string;
  provider: LLMProvider;
  api_key: string;
  model: string;
  endpoint: string;
  /** Azure API 版本（仅 Azure 旧版 API 需要） */
  azure_api_version?: string;
}

// ============================================================================
// 默认配置
// ============================================================================

/** 各 Provider 的默认模型 */
export const DEFAULT_MODELS: Record<LLMProvider, string> = {
  claude: "claude-sonnet-4-20250514",
  openai: "gpt-4o",
  azure: "gpt-4o",  // Azure 使用 deployment name
  custom: "gpt-4o",
};

/** 各 Provider 的默认 endpoint */
export const DEFAULT_ENDPOINTS: Record<LLMProvider, string> = {
  claude: "https://api.anthropic.com",
  openai: "https://api.openai.com/v1",
  azure: "",  // Azure endpoint 需要根据 resource name 构建
  custom: "",
};

/** 构建 Azure OpenAI endpoint */
export function buildAzureEndpoint(resourceName: string, useV1Api: boolean = true): string {
  if (useV1Api) {
    // 新 v1 API（推荐，2025年8月后）- 直接兼容 OpenAI SDK
    return `https://${resourceName}.openai.azure.com/openai/v1`;
  } else {
    // 旧版 API（需要 api-version 参数）
    return `https://${resourceName}.openai.azure.com`;
  }
}

// ============================================================================
// 配置路径
// ============================================================================

/** 配置文件目录 */
const CONFIG_DIR = path.join(os.homedir(), ".openecho");

/** LLM 配置文件路径 */
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");

// ============================================================================
// 配置管理类
// ============================================================================

export class LLMConfigManager {
  private config: OpenEchoConfig;
  /** 标记是否为首次运行（配置文件不存在时创建了示例配置） */
  private _isFirstRun: boolean = false;

  constructor() {
    this.config = this.loadConfig();
  }

  // --------------------------------------------------------------------------
  // 配置文件操作
  // --------------------------------------------------------------------------

  /** 加载配置文件，如果不存在则创建示例配置 */
  private loadConfig(): OpenEchoConfig {
    try {
      if (fs.existsSync(CONFIG_FILE)) {
        const data = fs.readFileSync(CONFIG_FILE, "utf-8");
        return JSON.parse(data);
      } else {
        // 配置文件不存在，首次运行
        this._isFirstRun = true;
        // 自动创建示例配置文件
        this.createExampleConfig();
        // 返回空配置（示例配置的 API Key 是占位符，不能直接使用）
        return { models: {} };
      }
    } catch (error) {
      console.error("加载配置文件失败:", error);
    }
    return { models: {} };
  }

  /**
   * 创建示例配置文件
   * 在首次运行时自动调用，方便用户了解配置格式
   */
  private createExampleConfig(): void {
    try {
      // 确保配置目录存在
      if (!fs.existsSync(CONFIG_DIR)) {
        fs.mkdirSync(CONFIG_DIR, { recursive: true });
      }

      // 生成示例配置（带注释说明）
      const exampleConfig = {
        "_comment": "OpenEcho LLM 配置文件 - 请修改下方配置后使用",
        "_usage": "修改 api_key 为你的真实 API Key，然后重启程序",
        "_tui_tip": "也可以在 TUI 中使用 /config add 命令交互式添加配置",
        
        "current": "claude-default",
        
        "models": {
          "claude-default": {
            "name": "claude-default",
            "description": "Claude Sonnet 默认配置",
            "provider": "claude",
            "api_key": "sk-ant-api03-xxxxx",
            "model": "claude-sonnet-4-20250514"
          },
          "openai-gpt4o": {
            "name": "openai-gpt4o",
            "description": "OpenAI GPT-4o",
            "provider": "openai",
            "api_key": "sk-xxxxx",
            "model": "gpt-4o"
          },
          "deepseek": {
            "name": "deepseek",
            "description": "DeepSeek Chat",
            "provider": "custom",
            "api_key": "sk-xxxxx",
            "endpoint": "https://api.deepseek.com/v1",
            "model": "deepseek-chat"
          },
          "ollama-local": {
            "name": "ollama-local",
            "description": "本地 Ollama 服务",
            "provider": "custom",
            "api_key": "ollama",
            "endpoint": "http://localhost:11434/v1",
            "model": "llama3.2"
          }
        }
      };

      // 明确指定 UTF-8 编码，确保跨平台兼容（Windows/macOS/Linux）
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(exampleConfig, null, 2), { encoding: "utf-8" });
    } catch (error) {
      // 创建示例配置失败不影响程序运行
      console.error("创建示例配置文件失败:", error);
    }
  }

  /**
   * 检查是否为首次运行
   * 首次运行指的是配置文件之前不存在，刚刚创建了示例配置
   */
  isFirstRun(): boolean {
    return this._isFirstRun;
  }

  /**
   * 重置首次运行标记
   * 在用户确认看到提示后调用
   */
  clearFirstRunFlag(): void {
    this._isFirstRun = false;
  }

  /** 保存配置文件 */
  private saveConfig(): void {
    try {
      if (!fs.existsSync(CONFIG_DIR)) {
        fs.mkdirSync(CONFIG_DIR, { recursive: true });
      }
      // 明确指定 UTF-8 编码，确保跨平台兼容
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(this.config, null, 2), { encoding: "utf-8" });
    } catch (error) {
      throw new Error(`保存配置文件失败: ${error}`);
    }
  }

  /** 重新加载配置 */
  reload(): void {
    this.config = this.loadConfig();
  }

  // --------------------------------------------------------------------------
  // 获取配置
  // --------------------------------------------------------------------------

  /**
   * 获取当前使用的 LLM 配置
   * 优先级: 环境变量 > 配置文件当前选择 > 第一个配置
   */
  getLLMConfig(): ResolvedLLMConfig | null {
    // 从环境变量获取配置（优先级最高）
    const envProvider = process.env.OPENECHO_LLM_PROVIDER as LLMProvider | undefined;
    const envApiKey = process.env.OPENECHO_API_KEY;
    const envModel = process.env.OPENECHO_MODEL;
    const envEndpoint = process.env.OPENECHO_ENDPOINT;

    // 兼容旧的环境变量
    const legacyAnthropicKey = process.env.ANTHROPIC_API_KEY;
    const legacyOpenAIKey = process.env.OPENAI_API_KEY;

    // 如果有环境变量配置，优先使用
    if (envApiKey || legacyAnthropicKey || legacyOpenAIKey) {
      let provider: LLMProvider;
      let apiKey: string;

      if (envApiKey) {
        provider = envProvider || "claude";
        apiKey = envApiKey;
      } else if (legacyAnthropicKey) {
        provider = "claude";
        apiKey = legacyAnthropicKey;
      } else {
        provider = "openai";
        apiKey = legacyOpenAIKey!;
      }

      const model = envModel || DEFAULT_MODELS[provider];
      const endpoint = envEndpoint || DEFAULT_ENDPOINTS[provider];

      return {
        name: "env",
        provider,
        api_key: apiKey,
        model,
        endpoint,
      };
    }

    // 从配置文件获取当前配置
    const currentName = this.config.current;
    const models = this.config.models || {};

    // 获取当前配置或第一个配置
    let configItem: LLMConfigItem | undefined;
    if (currentName && models[currentName]) {
      configItem = models[currentName];
    } else {
      // 没有指定当前配置，使用第一个
      const firstKey = Object.keys(models)[0];
      if (firstKey) {
        configItem = models[firstKey];
      }
    }

    if (!configItem) {
      return null;
    }

    // 确定 endpoint
    let endpoint: string;
    
    if (configItem.provider === "azure") {
      // Azure 特殊处理
      if (configItem.endpoint) {
        // 使用用户自定义的 endpoint
        endpoint = configItem.endpoint;
      } else if (configItem.azure_resource) {
        // 根据 resource name 构建 endpoint
        const useV1Api = !configItem.azure_api_version;
        endpoint = buildAzureEndpoint(configItem.azure_resource, useV1Api);
      } else {
        console.error("Azure provider 必须配置 endpoint 或 azure_resource");
        return null;
      }
    } else {
      endpoint = configItem.endpoint || DEFAULT_ENDPOINTS[configItem.provider];
    }

    // custom provider 必须有 endpoint
    if (configItem.provider === "custom" && !endpoint) {
      console.error("custom provider 必须配置 endpoint");
      return null;
    }

    return {
      name: configItem.name,
      provider: configItem.provider,
      api_key: configItem.api_key,
      model: configItem.model,
      endpoint,
      azure_api_version: configItem.azure_api_version,
    };
  }

  /** 检查是否已配置 LLM */
  isConfigured(): boolean {
    return this.getLLMConfig() !== null;
  }

  /** 获取原始配置（用于显示） */
  getRawConfig(): OpenEchoConfig {
    return { ...this.config };
  }

  /** 配置项（带 key） */
  /** 获取所有配置列表（返回带 key 的配置） */
  listConfigs(): { configs: Array<LLMConfigItem & { _key: string }>; current: string | undefined } {
    const models = this.config.models || {};
    return {
      configs: Object.entries(models).map(([key, config]) => ({
        ...config,
        _key: key,  // 添加配置的 key
      })),
      current: this.config.current,
    };
  }

  /** 根据 key 获取配置 */
  getConfigByKey(key: string): LLMConfigItem | null {
    return this.config.models?.[key] || null;
  }

  /** 根据名称获取配置（兼容旧代码） */
  getConfigByName(name: string): LLMConfigItem | null {
    return this.config.models?.[name] || null;
  }

  // --------------------------------------------------------------------------
  // 设置配置
  // --------------------------------------------------------------------------

  /** 添加或更新配置 */
  addConfig(config: LLMConfigItem): void {
    if (!this.config.models) {
      this.config.models = {};
    }
    this.config.models[config.name] = config;

    // 如果是第一个配置，设为当前
    if (!this.config.current) {
      this.config.current = config.name;
    }

    this.saveConfig();
  }

  /** 删除配置 */
  removeConfig(name: string): { success: boolean; error?: string } {
    if (!this.config.models?.[name]) {
      return { success: false, error: `配置 "${name}" 不存在` };
    }

    delete this.config.models[name];

    // 如果删除的是当前配置，切换到第一个
    if (this.config.current === name) {
      const remaining = Object.keys(this.config.models);
      this.config.current = remaining.length > 0 ? remaining[0] : undefined;
    }

    this.saveConfig();
    return { success: true };
  }

  /** 切换当前配置 */
  switchConfig(name: string): { success: boolean; error?: string } {
    if (!this.config.models?.[name]) {
      return { success: false, error: `配置 "${name}" 不存在` };
    }

    this.config.current = name;
    this.saveConfig();
    return { success: true };
  }

  /** 快速添加 Claude 配置 */
  addClaude(name: string, apiKey: string, model?: string, description?: string): void {
    this.addConfig({
      name,
      description,
      provider: "claude",
      api_key: apiKey,
      model: model || DEFAULT_MODELS.claude,
    });
  }

  /** 快速添加 OpenAI 配置 */
  addOpenAI(name: string, apiKey: string, model?: string, description?: string): void {
    this.addConfig({
      name,
      description,
      provider: "openai",
      api_key: apiKey,
      model: model || DEFAULT_MODELS.openai,
    });
  }

  /** 快速添加自定义配置 */
  addCustom(name: string, apiKey: string, endpoint: string, model: string, description?: string): void {
    this.addConfig({
      name,
      description,
      provider: "custom",
      api_key: apiKey,
      endpoint,
      model,
    });
  }

  // --------------------------------------------------------------------------
  // 工具方法
  // --------------------------------------------------------------------------

  /** 获取配置文件路径 */
  getConfigPath(): string {
    return CONFIG_FILE;
  }

  /** 获取配置目录路径 */
  getConfigDir(): string {
    return CONFIG_DIR;
  }

  /** 生成完整示例配置 */
  static generateFullExampleConfig(): string {
    const example: OpenEchoConfig = {
      current: "claude-default",
      models: {
        "claude-default": {
          name: "claude-default",
          description: "Claude Sonnet 默认配置",
          provider: "claude",
          api_key: "sk-ant-api03-xxxxx",
          model: "claude-sonnet-4-20250514",
        },
        "openai-gpt4": {
          name: "openai-gpt4",
          description: "OpenAI GPT-4o",
          provider: "openai",
          api_key: "sk-xxxxx",
          model: "gpt-4o",
        },
        "azure-gpt4": {
          name: "azure-gpt4",
          description: "Azure OpenAI (v1 API)",
          provider: "azure",
          api_key: "xxxxx",
          azure_resource: "my-resource",
          model: "gpt-4o-deployment",
        },
        "deepseek": {
          name: "deepseek",
          description: "DeepSeek API",
          provider: "custom",
          api_key: "sk-xxxxx",
          endpoint: "https://api.deepseek.com/v1",
          model: "deepseek-chat",
        },
      },
    };
    return JSON.stringify(example, null, 2);
  }
}

// ============================================================================
// 导出单例
// ============================================================================

export const llmConfigManager = new LLMConfigManager();
