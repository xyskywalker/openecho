#!/usr/bin/env node
/**
 * OpenEcho - 入口文件
 * 提供 CLI 命令解析和 TUI 交互界面
 */

import { Command } from "commander";
import { OpenEchoAgent, executeCommand, callToolDirect } from "./agent.js";
import { identityManager } from "./identity.js";
import { heartbeatManager } from "./heartbeat.js";
import { startMcpServer, generateMcpConfig } from "./mcp.js";
import { llmConfigManager, LLMConfigManager, PROVIDER_NAMES, DEFAULT_MODELS, type LLMProvider } from "./llm-config.js";
import chalk from "chalk";
import * as readline from "readline";
import { runTuiInk, type TuiHooks } from "./tui.js";
// 旧 readline/prompt 交互已逐步迁移到 Ink TUI


// ============================================================================
// Spinner 动画工具（类似 Claude Code 效果）
// ============================================================================

/** Spinner 动画帧 */
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/** 创建思考中的 Spinner */
class ThinkingSpinner {
  private frameIndex = 0;
  private intervalId: NodeJS.Timeout | null = null;
  private text: string;

  constructor(text: string = "思考中") {
    this.text = text;
  }

  /** 启动 spinner */
  start(): void {
    // 隐藏光标
    process.stdout.write("\x1B[?25l");
    this.render();
    this.intervalId = setInterval(() => {
      this.frameIndex = (this.frameIndex + 1) % SPINNER_FRAMES.length;
      this.render();
    }, 80);
  }

  /** 渲染当前帧 */
  private render(): void {
    const frame = chalk.cyan(SPINNER_FRAMES[this.frameIndex]);
    // 清除当前行并输出
    process.stdout.write(`\r${frame} ${chalk.gray(this.text)}   `);
  }

  /** 停止并清除 spinner */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    // 清除当前行，显示光标
    process.stdout.write("\r\x1B[K\x1B[?25h");
  }
}

// ============================================================================
// 后台心跳管理器（简化版，不使用固定位置状态栏）
// ============================================================================

/** 心跳状态图标 */
const HEARTBEAT_ICONS = {
  idle: "💤",      // 空闲
  checking: "💓",  // 检查中
  ok: "💚",        // 正常
  error: "❌",     // 错误
};

/** 后台心跳管理器 */
class BackgroundHeartbeat {
  private heartbeatStatus: "idle" | "checking" | "ok" | "error" = "idle";
  private heartbeatIntervalId: NodeJS.Timeout | null = null;
  private newPostsCount: number = 0;
  private isRunning: boolean = false;

  /** 启动后台心跳 */
  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;

    // 检查上次心跳结果
    const state = heartbeatManager.getState();
    if (state.lastResult) {
      this.heartbeatStatus = state.lastResult.success ? "ok" : "error";
      this.newPostsCount = state.lastResult.newPostsCount;
    }

    // 检查是否需要立即执行心跳
    if (heartbeatManager.shouldRunHeartbeat()) {
      // 延迟 3 秒后执行首次心跳
      setTimeout(() => this.runHeartbeat(), 3000);
    }

    // 设置定时心跳检查（每分钟检查一次是否需要执行）
    this.heartbeatIntervalId = setInterval(async () => {
      if (heartbeatManager.shouldRunHeartbeat()) {
        await this.runHeartbeat();
      }
    }, 60 * 1000);
  }

  /** 停止后台心跳 */
  stop(): void {
    this.isRunning = false;
    if (this.heartbeatIntervalId) {
      clearInterval(this.heartbeatIntervalId);
      this.heartbeatIntervalId = null;
    }
  }

  /** 执行心跳检查（静默执行） */
  private async runHeartbeat(): Promise<void> {
    this.heartbeatStatus = "checking";

    try {
      const result = await heartbeatManager.runHeartbeat();
      
      if (result.success) {
        this.heartbeatStatus = "ok";
        this.newPostsCount = result.newPostsCount;
      } else {
        this.heartbeatStatus = "error";
      }
    } catch {
      this.heartbeatStatus = "error";
    }
  }

  /** 手动触发心跳 */
  async triggerHeartbeat(): Promise<{ success: boolean; newPostsCount: number; suggestions: string[]; error?: string }> {
    this.heartbeatStatus = "checking";

    const result = await heartbeatManager.runHeartbeat();
    
    if (result.success) {
      this.heartbeatStatus = "ok";
      this.newPostsCount = result.newPostsCount;
    } else {
      this.heartbeatStatus = "error";
    }

    return result;
  }

  /** 获取心跳状态图标 */
  getStatusIcon(): string {
    return HEARTBEAT_ICONS[this.heartbeatStatus];
  }

  /** 获取简短状态文本 */
  getShortStatus(): string {
    if (this.heartbeatStatus === "ok") {
      return `${this.newPostsCount}帖`;
    } else if (this.heartbeatStatus === "checking") {
      return "...";
    } else if (this.heartbeatStatus === "error") {
      return "!";
    }
    return "";
  }
}

/** 全局后台心跳实例 */
let bgHeartbeat: BackgroundHeartbeat | null = null;

// Ink TUI 运行时注入的交互 hooks（用于替换 readline 交互）
let activeTuiHooks: TuiHooks | null = null;

/** 生成提示符前缀（包含状态信息） */
function getPromptPrefix(): string {
  const parts: string[] = [];
  
  // 心跳状态
  if (bgHeartbeat) {
    parts.push(bgHeartbeat.getStatusIcon() + bgHeartbeat.getShortStatus());
  }
  
  // LLM: provider/model（截取合适长度）
  const llmConfig = llmConfigManager.getLLMConfig();
  if (llmConfig) {
    // 显示 provider/model，model 最多 20 字符
    const model = llmConfig.model.length > 20 ? llmConfig.model.slice(0, 17) + "..." : llmConfig.model;
    parts.push(`🤖${llmConfig.provider}/${model}`);
  }
  
  // 身份名称（最多 20 字符）
  const identity = identityManager.getCurrent();
  if (identity) {
    const statusIcon = identity.status === "claimed" ? "✓" : "⏳";
    const name = identity.name.length > 20 ? identity.name.slice(0, 17) + "..." : identity.name;
    parts.push(`🦞${name}${statusIcon}`);
  }
  
  if (parts.length > 0) {
    return chalk.gray(`[${parts.join(" ")}] `);
  }
  return "";
}

// ============================================================================
// 版本信息
// ============================================================================

const VERSION = "0.1.0";
// Banner: 中文字符占2个宽度，手动对齐
const BANNER = `
╔══════════════════════════════════════════╗
║         OpenEcho (回声) v${VERSION}           ║
║        聆听 Moltbook 生态的声音          ║
╚══════════════════════════════════════════╝
`;

// ============================================================================
// TUI 交互模式
// ============================================================================

/** 内置命令定义 */
interface CommandItem {
  title: string;
  value: string;
  description: string;
}

/** 所有内置命令列表 */
const BUILTIN_COMMANDS: CommandItem[] = [
  { title: "/help", value: "/help", description: "显示帮助信息" },
  { title: "/clear", value: "/clear", description: "清屏" },
  { title: "/exit", value: "/exit", description: "退出程序" },
  { title: "/model", value: "/model", description: "切换模型配置" },
  { title: "/config", value: "/config", description: "查看 LLM 配置" },
  { title: "/config add", value: "/config add", description: "添加模型配置" },
  { title: "/config list", value: "/config list", description: "列出所有模型配置" },
  { title: "/config remove", value: "/config remove", description: "删除模型配置" },
  { title: "/identity add", value: "/identity add", description: "添加新身份" },
  { title: "/identity list", value: "/identity list", description: "列出所有身份" },
  { title: "/identity switch", value: "/identity switch", description: "切换身份" },
  { title: "/identity status", value: "/identity status", description: "检查验证状态" },
  { title: "/identity remove", value: "/identity remove", description: "删除身份" },
  { title: "/identity import", value: "/identity import", description: "导入 API Key" },
  { title: "/debug", value: "/debug", description: "调试当前身份和API" },
  { title: "/heartbeat", value: "/heartbeat", description: "执行心跳检查" },
  { title: "/heartbeat status", value: "/heartbeat status", description: "查看心跳状态" },
  { title: "/mcp-config", value: "/mcp-config", description: "显示 MCP 配置" },
];

/** 简单的问答函数 - 原生 readline 实现 */
async function askQuestion(question: string): Promise<string> {
  if (activeTuiHooks) {
    return activeTuiHooks.execInput(question);
  }
  return new Promise((resolve) => {
    const tempRl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    tempRl.question(question + " ", (answer) => {
      tempRl.close();
      resolve(answer || "");
    });
  });
}

/** 简单的选择函数 - 原生实现 */
async function askSelect(
  message: string,
  choices: Array<{ title: string; value: string; description?: string }>
): Promise<string | null> {
  if (activeTuiHooks) {
    return activeTuiHooks.execSelect(message, choices);
  }
  console.log(chalk.bold(`\n${message}`));
  choices.forEach((choice, i) => {
    const desc = choice.description ? chalk.gray(` - ${choice.description}`) : "";
    console.log(`  ${chalk.cyan(i + 1)}. ${choice.title}${desc}`);
  });
  console.log();
  
  const answer = await askQuestion(`请输入选项编号 (1-${choices.length}):`);
  const num = parseInt(answer, 10);
  
  if (isNaN(num) || num < 1 || num > choices.length) {
    return null;
  }
  
  return choices[num - 1].value;
}

/** 简单的确认函数 - 原生实现 */
async function askConfirm(message: string): Promise<boolean> {
  if (activeTuiHooks) {
    return activeTuiHooks.execConfirm(message);
  }
  const answer = await askQuestion(`${message} (y/n):`);
  return answer.toLowerCase() === "y" || answer.toLowerCase() === "yes";
}

/** 
 * 获取用户输入（原生 readline 实现）
 * - 输入 / 开头，按 Tab 补全命令
 */
/** 需要参数的命令列表 */
const COMMANDS_NEED_ARGS: string[] = [];

// readline/prompt 交互旧实现已替换为 Ink TUI（见 src/tui.tsx）

/** 获取命令参数 */
async function getCommandArgs(command: string): Promise<string | null> {
  const prompt = `${chalk.gray(command)} ${chalk.green("参数")} › `;
  
  return new Promise<string | null>((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer?.trim() || null);
    });
  });
}

// ============================================================================
// 输出格式化函数
// ============================================================================

/** 格式化时间为相对时间 */
function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return "刚刚";
  if (diffMins < 60) return `${diffMins}分钟前`;
  if (diffHours < 24) return `${diffHours}小时前`;
  if (diffDays < 30) return `${diffDays}天前`;
  return date.toLocaleDateString("zh-CN");
}

/** 截断文本 */
function truncateText(text: string, maxLen: number): string {
  if (!text) return "";
  // 移除换行符
  const cleaned = text.replace(/\n/g, " ").trim();
  if (cleaned.length <= maxLen) return cleaned;
  return cleaned.slice(0, maxLen - 3) + "...";
}

/** 显示输出内容（跨平台兼容） */
async function showOutput(content: string): Promise<void> {
  const lines = content.split("\n").length;
  const terminalRows = process.stdout.rows || 24;
  
  // 内容不长，直接显示
  if (lines <= terminalRows - 3) {
    console.log(content);
    return;
  }
  
  // 检测平台，选择合适的分页工具
  const isWindows = process.platform === "win32";
  const pagerName = isWindows ? "more" : "less";
  const pagerHelp = isWindows 
    ? "more 中: 空格翻页, q 退出" 
    : "less 中: j/k 上下滚动, q 退出";
  
  // 长内容：询问用户是否用分页器查看
  console.log(chalk.yellow(`\n📄 内容较长 (${lines} 行)，是否用 ${pagerName} 查看？`));
  console.log(chalk.gray(`   ${pagerHelp}`));
  
  const answer = await askQuestion(`用 ${pagerName} 查看? (y/n, 默认 n):`);
  
  if (answer.toLowerCase() === "y" || answer.toLowerCase() === "yes") {
    try {
      const { spawn } = await import("child_process");
      
      if (isWindows) {
        // Windows: 使用 more 命令，通过 cmd.exe 执行
        const more = spawn("cmd.exe", ["/c", "more"], {
          stdio: ["pipe", "inherit", "inherit"],
        });
        more.stdin.write(content);
        more.stdin.end();
        await new Promise<void>((resolve) => {
          more.on("close", () => resolve());
        });
      } else {
        // macOS/Linux: 使用 less 命令
        const less = spawn("less", ["-R"], {
          stdio: ["pipe", "inherit", "inherit"],
        });
        less.stdin.write(content);
        less.stdin.end();
        await new Promise<void>((resolve) => {
          less.on("close", () => resolve());
        });
      }
    } catch (error) {
      // 分页器不可用时回退到直接输出
      console.log(chalk.gray(`(${pagerName} 不可用，直接显示)`));
      console.log(content);
    }
  } else {
    // 直接输出
    console.log(content);
  }
}

/** 格式化 Feed 结果 */
function formatFeedResult(
  result: { 
    success: boolean; 
    posts?: Array<{
      id: string;
      title: string;
      content?: string;
      upvotes: number;
      downvotes: number;
      comment_count: number;
      created_at: string;
      author: { name: string };
      submolt: { name: string; display_name: string };
    }>; 
    error?: string 
  },
  sort: string
): string {
  if (!result.success || !result.posts) {
    return chalk.red(`获取 Feed 失败: ${result.error || "未知错误"}`);
  }

  if (result.posts.length === 0) {
    return chalk.yellow("暂无帖子");
  }

  const sortNames: Record<string, string> = {
    hot: "🔥 热门",
    new: "🆕 最新",
    top: "⬆️ 最高",
    rising: "📈 上升",
  };

  const lines: string[] = [];
  lines.push(chalk.bold(`\n${sortNames[sort] || sort} Feed (${result.posts.length} 帖)\n`));
  lines.push(chalk.gray("─".repeat(60)));

  for (let i = 0; i < result.posts.length; i++) {
    const post = result.posts[i];
    const num = chalk.gray(`${i + 1}.`);
    const title = chalk.bold.white(truncateText(post.title, 50));
    const votes = chalk.green(`▲${post.upvotes}`) + chalk.red(`▼${post.downvotes}`);
    const comments = chalk.cyan(`💬${post.comment_count}`);
    const author = chalk.magenta(`@${post.author.name}`);
    const submolt = chalk.blue(`m/${post.submolt.name}`);
    const time = chalk.gray(formatRelativeTime(post.created_at));

    lines.push(`${num} ${title}`);
    lines.push(`   ${votes} ${comments}  ${author}  ${submolt}  ${time}`);
    
    // 显示正文内容预览（最多3行，每行约55字符）
    if (post.content) {
      const contentLines = post.content
        .replace(/\n+/g, " ")
        .trim()
        .match(/.{1,55}/g) || [];
      const previewLines = contentLines.slice(0, 3);
      for (const line of previewLines) {
        lines.push(chalk.gray(`   ${line.trim()}`));
      }
      if (contentLines.length > 3) {
        lines.push(chalk.gray.dim(`   ... (还有更多内容)`));
      }
    }
    lines.push("");
  }

  lines.push(chalk.gray("─".repeat(60)));
  lines.push(chalk.gray("提示: /feed [hot|new|top|rising] 切换排序"));

  return lines.join("\n");
}

/** 格式化搜索结果 */
function formatSearchResult(
  result: {
    success: boolean;
    results?: Array<{
      id: string;
      type: string;
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
    }>;
    error?: string;
  },
  query: string
): string {
  if (!result.success || !result.results) {
    return chalk.red(`搜索失败: ${result.error || "未知错误"}`);
  }

  if (result.results.length === 0) {
    return chalk.yellow(`未找到与 "${query}" 相关的内容`);
  }

  const lines: string[] = [];
  lines.push(chalk.bold(`\n🔍 搜索: "${query}" (${result.results.length} 结果)\n`));
  lines.push(chalk.gray("─".repeat(60)));

  for (let i = 0; i < result.results.length; i++) {
    const item = result.results[i];
    const num = chalk.gray(`${i + 1}.`);
    const typeIcon = item.type === "post" ? "📝" : "💬";
    const title = item.title 
      ? chalk.bold.white(truncateText(item.title, 45))
      : chalk.gray("(评论)");
    const similarity = chalk.yellow(`${Math.round(item.similarity * 100)}%`);
    const votes = chalk.green(`▲${item.upvotes}`);
    const author = chalk.magenta(`@${item.author.name}`);
    const time = chalk.gray(formatRelativeTime(item.created_at));

    lines.push(`${num} ${typeIcon} ${title}  ${similarity}`);
    lines.push(`   ${votes}  ${author}  ${time}`);
    
    // 显示内容预览
    const preview = truncateText(item.content, 80);
    lines.push(chalk.gray(`   ${preview}`));
    lines.push("");
  }

  lines.push(chalk.gray("─".repeat(60)));

  return lines.join("\n");
}

/** 格式化趋势分析结果 */
function formatTrendResult(
  result: {
    success: boolean;
    trends?: {
      hotTopics: Array<{ title: string; score: number; post_id: string }>;
      risingAuthors: Array<{ name: string; posts: number; engagement: number }>;
      activeSubmolts: Array<{ name: string; activity: number }>;
    };
    error?: string;
  },
  timerange: string
): string {
  if (!result.success || !result.trends) {
    return chalk.red(`趋势分析失败: ${result.error || "未知错误"}`);
  }

  const { hotTopics, risingAuthors, activeSubmolts } = result.trends;

  const lines: string[] = [];
  lines.push(chalk.bold(`\n📊 趋势分析 (${timerange})\n`));
  lines.push(chalk.gray("─".repeat(60)));

  // 热门话题
  lines.push(chalk.bold.yellow("\n🔥 热门话题"));
  if (hotTopics.length === 0) {
    lines.push(chalk.gray("  暂无数据"));
  } else {
    for (let i = 0; i < Math.min(hotTopics.length, 5); i++) {
      const topic = hotTopics[i];
      const num = chalk.gray(`${i + 1}.`);
      const title = truncateText(topic.title, 45);
      const score = chalk.green(`⚡${topic.score}`);
      lines.push(`  ${num} ${title}  ${score}`);
    }
  }

  // 活跃作者
  lines.push(chalk.bold.magenta("\n👤 活跃作者"));
  if (risingAuthors.length === 0) {
    lines.push(chalk.gray("  暂无数据"));
  } else {
    for (let i = 0; i < Math.min(risingAuthors.length, 5); i++) {
      const author = risingAuthors[i];
      const num = chalk.gray(`${i + 1}.`);
      const name = chalk.magenta(`@${author.name}`);
      const posts = chalk.cyan(`📝${author.posts}帖`);
      const engagement = chalk.green(`💬${author.engagement}`);
      lines.push(`  ${num} ${name}  ${posts}  ${engagement}`);
    }
  }

  // 活跃社区
  lines.push(chalk.bold.blue("\n🏠 活跃社区"));
  if (activeSubmolts.length === 0) {
    lines.push(chalk.gray("  暂无数据"));
  } else {
    for (let i = 0; i < Math.min(activeSubmolts.length, 5); i++) {
      const submolt = activeSubmolts[i];
      const num = chalk.gray(`${i + 1}.`);
      const name = chalk.blue(`m/${submolt.name}`);
      const activity = chalk.yellow(`📊${submolt.activity}活跃度`);
      lines.push(`  ${num} ${name}  ${activity}`);
    }
  }

  lines.push(chalk.gray("\n" + "─".repeat(60)));
  lines.push(chalk.gray("提示: /trend [1h|6h|24h|7d|30d] 切换时间范围"));

  return lines.join("\n");
}

/** 内置命令处理 */
async function handleBuiltinCommand(input: string): Promise<string | null> {
  const parts = input.trim().split(/\s+/);
  const command = parts[0].toLowerCase();
  const args = parts.slice(1);

  switch (command) {
    case "/help":
      return `
${chalk.bold("内置命令:")}
  /help                 显示帮助信息
  /clear                清屏
  /exit, /quit          退出程序

${chalk.bold("模型配置:")}
  /model                快速切换模型
  /config               查看当前配置
  /config add           添加模型配置
  /config list          列出所有配置
  /config remove        删除模型配置

${chalk.bold("身份管理:")}
  /identity add         添加新身份
  /identity list        列出所有身份
  /identity switch <n>  切换身份
  /identity status      检查验证状态
  /identity remove <n>  删除身份
  /identity import      导入 API Key

${chalk.bold("心跳 (官方推荐每4小时执行一次):")}
  /heartbeat            执行心跳检查
  /heartbeat status     查看心跳状态

${chalk.bold("调试:")}
  /debug                调试当前身份和API
  /mcp-config           显示 MCP 配置

${chalk.bold("对话示例:")}
  帮我看看 Moltbook 最新动态
  搜索关于 AI Agent 的帖子
  分析一下当前的热门话题

${chalk.gray("提示: 输入 / 后会自动显示命令列表，用上下键选择，回车确认")}
`;

    case "/clear":
      console.clear();
      return null;

    case "/exit":
    case "/quit":
      bgHeartbeat?.stop();
      console.log(chalk.yellow("\n再见! 🦞"));
      process.exit(0);

    case "/model":
      return await handleModelSwitch();

    case "/config":
      return await handleConfigCommand(args);

    case "/identity":
      return await handleIdentityCommand(args);

    case "/heartbeat":
      return await handleHeartbeatCommand(args);

    case "/mcp-config":
      return `
${chalk.bold("MCP 配置 (添加到 claude_desktop_config.json 或 Cursor MCP 配置):")}

${generateMcpConfig()}
`;

    case "/debug":
      return await handleDebugCommand();

    default:
      return null; // 不是内置命令
  }
}

/** 心跳命令处理 */
async function handleHeartbeatCommand(args: string[]): Promise<string> {
  const subcommand = args[0]?.toLowerCase();

  switch (subcommand) {
    case "status": {
      return heartbeatManager.getStatusSummary();
    }

    default: {
      // 手动触发心跳检查
      let result;
      
      if (bgHeartbeat) {
        result = await bgHeartbeat.triggerHeartbeat();
      } else {
        result = await heartbeatManager.runHeartbeat();
      }

      if (!result.success) {
        return chalk.red(`心跳检查失败: ${result.error}`);
      }

      const lines: string[] = [];
      lines.push(chalk.green("✓ 心跳检查完成"));
      lines.push(`${chalk.bold("新帖子:")} ${result.newPostsCount} 个\n`);

      if (result.suggestions.length > 0) {
        lines.push(chalk.bold("建议:"));
        for (const suggestion of result.suggestions) {
          lines.push(`  ${suggestion}`);
        }
      }

      // 冷却状态
      lines.push(`\n${chalk.bold("冷却状态:")}`);
      lines.push(`  发帖: ${heartbeatManager.canPost() ? chalk.green("已就绪 ✓") : chalk.yellow("冷却中...")}`);
      lines.push(`  评论: ${heartbeatManager.canComment() ? chalk.green("已就绪 ✓") : chalk.yellow("冷却中...")}`);

      return lines.join("\n");
    }
  }
}

/** 调试命令处理 - 检查身份和 API 状态 */
async function handleDebugCommand(): Promise<string> {
  const lines: string[] = [];
  lines.push(chalk.bold("=== 调试信息 ===\n"));

  // 1. 检查身份状态
  const currentIdentity = identityManager.getCurrent();
  if (!currentIdentity) {
    lines.push(chalk.red("❌ 没有配置身份"));
    lines.push(chalk.yellow("   请运行 /identity add 或 /identity import 添加身份\n"));
  } else {
    lines.push(chalk.green(`✓ 当前身份: ${currentIdentity.name}`));
    lines.push(`   状态: ${currentIdentity.status}`);
    // 安全显示 API Key（只显示前4后4）
    const apiKey = currentIdentity.api_key;
    const maskedKey = apiKey.length > 12
      ? apiKey.slice(0, 8) + "..." + apiKey.slice(-4)
      : "***";
    lines.push(`   API Key: ${maskedKey}`);
    lines.push(`   Key 长度: ${apiKey.length} 字符\n`);

    // 2. 测试 API 调用（使用 /agents/me 端点）
    lines.push(chalk.bold("--- API 测试 ---\n"));
    
    try {
      // 测试带认证的请求
      const testResponse = await fetch("https://www.moltbook.com/api/v1/agents/me", {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
      });
      
      const testData = await testResponse.json();
      
      if (testResponse.ok) {
        lines.push(chalk.green(`✓ API Key 有效`));
        lines.push(`   Agent 名称: ${(testData as { agent?: { name: string } }).agent?.name || "未知"}`);
      } else {
        lines.push(chalk.red(`❌ API Key 验证失败`));
        lines.push(`   HTTP 状态: ${testResponse.status}`);
        lines.push(`   错误信息: ${(testData as { error?: string }).error || JSON.stringify(testData)}`);
        lines.push(chalk.yellow("\n   建议: 请检查 API Key 是否正确，或尝试重新导入身份"));
      }
    } catch (error) {
      lines.push(chalk.red(`❌ 网络请求失败: ${error}`));
    }

    // 3. 测试获取 Feed（不带认证，作为对照）
    lines.push(chalk.bold("\n--- Feed 测试 ---\n"));
    try {
      // 不带认证测试
      const publicResponse = await fetch("https://www.moltbook.com/api/v1/posts?sort=hot&limit=1");
      const publicData = await publicResponse.json();
      
      if (publicResponse.ok) {
        lines.push(chalk.green(`✓ 公开 API 访问正常`));
        lines.push(`   返回帖子数: ${(publicData as { posts?: unknown[] }).posts?.length || 0}`);
      } else {
        lines.push(chalk.red(`❌ 公开 API 访问失败`));
      }

      // 带认证测试
      const authResponse = await fetch("https://www.moltbook.com/api/v1/posts?sort=hot&limit=1", {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
      });
      const authData = await authResponse.json();
      
      if (authResponse.ok) {
        lines.push(chalk.green(`✓ 认证 API 访问正常`));
      } else {
        lines.push(chalk.red(`❌ 认证 API 访问失败`));
        lines.push(`   HTTP 状态: ${authResponse.status}`);
        lines.push(`   错误信息: ${(authData as { error?: string }).error || JSON.stringify(authData)}`);
      }
    } catch (error) {
      lines.push(chalk.red(`❌ Feed 测试失败: ${error}`));
    }
  }

  return lines.join("\n");
}

/** 快速切换模型配置 */
async function handleModelSwitch(): Promise<string> {
  const { configs, current } = llmConfigManager.listConfigs();

  if (configs.length === 0) {
    return chalk.yellow("暂无模型配置，使用 /config add 添加");
  }

  const choices = configs.map((c) => ({
    title: `${c.name}${c._key === current ? chalk.green(" (当前)") : ""} - ${PROVIDER_NAMES[c.provider]} / ${c.model}`,
    value: c._key as string,
    description: c.description,
  }));

  const selected = await askSelect("选择模型配置", choices);

  if (!selected) {
    return chalk.yellow("已取消");
  }

  const result = llmConfigManager.switchConfig(selected);
  if (result.success) {
    const config = llmConfigManager.getConfigByKey(selected);
    return chalk.green(`✓ 已切换到: ${config?.name || selected} (${config?.provider} / ${config?.model})`);
  } else {
    return chalk.red(`切换失败: ${result.error}`);
  }
}

/** 处理 LLM 配置相关命令 */
async function handleConfigCommand(args: string[]): Promise<string> {
  const subcommand = args[0]?.toLowerCase();

  switch (subcommand) {
    case "add": {
      // 交互式添加配置
      const nameInput = await askQuestion("配置名称 (唯一标识，如: claude-default)");
      if (!nameInput?.trim()) {
        return chalk.red("配置名称不能为空");
      }
      const name = nameInput.trim();

      // 检查是否已存在
      if (llmConfigManager.getConfigByName(name)) {
        return chalk.red(`配置 "${name}" 已存在`);
      }

      const descInput = await askQuestion("配置描述 (可选)");
      const description = descInput?.trim() || undefined;

      const providerChoices = [
        { title: "Claude (Anthropic)", value: "claude", description: "Anthropic 官方 API" },
        { title: "OpenAI", value: "openai", description: "OpenAI 官方 API" },
        { title: "Azure OpenAI", value: "azure", description: "Azure OpenAI 服务 (v1 API)" },
        { title: "自定义 (OpenAI 兼容)", value: "custom", description: "DeepSeek、通义千问、Ollama 等" },
      ];

      const providerValue = await askSelect("选择 LLM Provider", providerChoices);

      if (!providerValue) {
        return chalk.yellow("已取消");
      }

      const provider = providerValue as LLMProvider;
      const apiKey = await askQuestion("API Key");

      if (!apiKey?.trim()) {
        return chalk.red("API Key 不能为空");
      }

      // 询问模型名称
      const modelDefault = DEFAULT_MODELS[provider];
      const modelHint = provider === "azure" ? "deployment name" : "模型名称";
      const modelInput = await askQuestion(`${modelHint} (默认: ${modelDefault})`);
      const model = modelInput?.trim() || modelDefault;

      let endpoint: string | undefined;
      let azure_resource: string | undefined;

      if (provider === "azure") {
        // Azure 配置
        const resourceInput = await askQuestion("Azure 资源名称 (如: my-openai-resource)");
        if (!resourceInput?.trim()) {
          return chalk.red("Azure provider 必须配置资源名称");
        }
        azure_resource = resourceInput.trim();
        // 自动构建 endpoint
        endpoint = `https://${azure_resource}.openai.azure.com/openai/v1`;
      } else if (provider === "custom") {
        // 自定义 provider 需要 endpoint
        const endpointInput = await askQuestion("Endpoint URL (如: https://api.deepseek.com/v1)");
        if (!endpointInput?.trim()) {
          return chalk.red("自定义 provider 必须配置 endpoint");
        }
        endpoint = endpointInput.trim();
      } else {
        // Claude/OpenAI 可选自定义 endpoint
        const endpointInput = await askQuestion("自定义 Endpoint URL (可选，留空使用默认)");
        endpoint = endpointInput?.trim() || undefined;
      }

      // 保存配置
      llmConfigManager.addConfig({
        name,
        description,
        provider,
        api_key: apiKey.trim(),
        model,
        endpoint,
        azure_resource,
      });

      return `
${chalk.green("✓ 模型配置已添加!")}
  名称: ${name}
  Provider: ${PROVIDER_NAMES[provider]}
  Model: ${model}
  ${endpoint ? `Endpoint: ${endpoint}` : ""}
  配置文件: ${llmConfigManager.getConfigPath()}

${chalk.gray("使用 /model 快速切换模型")}
`;
    }

    case "list": {
      const { configs, current } = llmConfigManager.listConfigs();

      if (configs.length === 0) {
        return `
${chalk.yellow("暂无模型配置")}

使用 ${chalk.cyan("/config add")} 添加配置，或手动编辑配置文件:
${chalk.gray(llmConfigManager.getConfigPath())}

${chalk.bold("配置文件示例:")}
${LLMConfigManager.generateFullExampleConfig()}
`;
      }

      const lines = configs.map((c) => {
        // 使用 _key 判断是否是当前配置
        const isCurrent = c._key === current ? chalk.green(" (当前)") : "";
        const maskedKey = c.api_key.length > 12
          ? c.api_key.slice(0, 4) + "..." + c.api_key.slice(-4)
          : "***";
        return `  ${chalk.cyan(c.name)} [${c._key}]${isCurrent}
    ${c.description ? chalk.gray(c.description) + "\n    " : ""}Provider: ${PROVIDER_NAMES[c.provider]}
    Model: ${c.model}
    ${c.endpoint ? `Endpoint: ${c.endpoint}\n    ` : ""}API Key: ${maskedKey}`;
      });

      return `
${chalk.bold("模型配置列表:")}

${lines.join("\n\n")}

${chalk.gray("使用 /model 快速切换，/config add 添加，/config remove 删除")}
`;
    }

    case "remove": {
      const { configs, current } = llmConfigManager.listConfigs();

      if (configs.length === 0) {
        return chalk.yellow("暂无模型配置可删除");
      }

      const deleteChoices = configs.map((c) => ({
        title: `${c.name}${c._key === current ? chalk.green(" (当前)") : ""} - ${c.provider} / ${c.model}`,
        value: c._key as string,
      }));

      const selectedKey = await askSelect("选择要删除的配置", deleteChoices);

      if (!selectedKey) {
        return chalk.yellow("已取消");
      }

      // 确认删除
      const configToDelete = llmConfigManager.getConfigByKey(selectedKey);
      const confirmed = await askConfirm(`确定删除配置 "${configToDelete?.name || selectedKey}"?`);

      if (!confirmed) {
        return chalk.yellow("已取消");
      }

      const result = llmConfigManager.removeConfig(selectedKey);
      if (result.success) {
        return chalk.green(`✓ 已删除配置: ${selectedKey}`);
      } else {
        return chalk.red(`删除失败: ${result.error}`);
      }
    }

    default: {
      // 显示当前配置
      const config = llmConfigManager.getLLMConfig();
      const { configs } = llmConfigManager.listConfigs();

      if (!config) {
        return `
${chalk.yellow("LLM 尚未配置")}

${chalk.bold("支持的 Provider:")}
  - ${chalk.cyan("claude")}: Anthropic Claude 官方 API
  - ${chalk.cyan("openai")}: OpenAI 官方 API
  - ${chalk.cyan("azure")}: Azure OpenAI 服务 (v1 API)
  - ${chalk.cyan("custom")}: 自定义 endpoint (DeepSeek、通义千问、Ollama 等)

使用 ${chalk.cyan("/config add")} 交互式添加配置，或手动编辑配置文件:
${chalk.gray(llmConfigManager.getConfigPath())}

${chalk.bold("配置文件示例:")}
${LLMConfigManager.generateFullExampleConfig()}

${chalk.gray("也支持环境变量: OPENECHO_API_KEY, OPENECHO_LLM_PROVIDER, OPENECHO_MODEL, OPENECHO_ENDPOINT")}
`;
      }

      // 隐藏 API Key 中间部分
      const maskedKey = config.api_key.length > 12
        ? config.api_key.slice(0, 4) + "..." + config.api_key.slice(-4)
        : "***";

      return `
${chalk.bold("当前 LLM 配置:")}
  配置名: ${chalk.cyan(config.name)}
  Provider: ${chalk.cyan(PROVIDER_NAMES[config.provider])}
  Model: ${chalk.cyan(config.model)}
  ${config.endpoint ? `Endpoint: ${config.endpoint}\n  ` : ""}API Key: ${maskedKey}

${chalk.gray(`共 ${configs.length} 个配置，使用 /model 切换，/config list 查看全部`)}
`;
    }
  }
}

/** 处理身份相关命令 */
async function handleIdentityCommand(args: string[]): Promise<string> {
  const subcommand = args[0]?.toLowerCase();

  switch (subcommand) {
    case "add": {
      const mode = await askSelect("创建身份方式", [
        { title: "手动输入", value: "manual", description: "手动填写 Agent 名称与描述" },
        { title: "AI 辅助生成", value: "ai", description: "用自然语言描述用途，让模型生成草案" },
      ]);

      if (!mode) return chalk.yellow("已取消");

      let name = "";
      let description = "";

      if (mode === "ai") {
        const brief = await askQuestion("用一句话描述这个身份的用途/风格（越具体越好）");
        if (!brief?.trim()) {
          return chalk.red("描述不能为空");
        }

        // 让模型生成草案（名称 + 描述），并要求输出 JSON，便于解析
        const agent = new OpenEchoAgent({ enableTools: false });
        const draftPrompt = `请根据以下需求为 Moltbook Agent 生成一个注册用的名称(name)和简介(description)。\n\n需求: ${brief.trim()}\n\n要求:\n- name: 3-20 字符，英文字母/数字/下划线优先，避免空格\n- description: 1-2 句话，清晰说明你能做什么\n- 只输出 JSON：{"name":"...","description":"..."}（不要输出其它文字）`;
        const draft = await agent.chat(draftPrompt);
        try {
          const parsed = JSON.parse(draft.text) as { name?: string; description?: string };
          name = String(parsed.name || "").trim();
          description = String(parsed.description || "").trim();
        } catch {
          return chalk.red("AI 生成草案失败：模型输出不是有效 JSON，请重试");
        }

        if (!name || !description) {
          return chalk.red("AI 生成草案不完整，请重试");
        }

        const ok = await askConfirm(`确认使用该草案注册？\n- 名称: ${name}\n- 描述: ${description}`);
        if (!ok) return chalk.yellow("已取消");
      } else {
        // 手动输入
        name = (await askQuestion("Agent 名称")).trim();
        description = (await askQuestion("Agent 描述")).trim();
      }

      if (!name?.trim() || !description?.trim()) {
        return chalk.red("名称和描述不能为空");
      }

      console.log(chalk.yellow("\n正在注册..."));
      const result = await identityManager.register(name.trim(), description.trim());

      if (result.success && result.identity) {
        return `
${chalk.green("✓ 身份创建成功!")}

${chalk.bold("下一步:")}
1. 访问认领链接: ${chalk.cyan(result.claim_url || "")}
2. 在 X(Twitter) 发布验证帖
3. 运行 ${chalk.cyan("/identity status")} 检查验证状态

${chalk.yellow("⚠️ 请保存你的 API Key:")} ${result.identity.api_key}
`;
      } else {
        return chalk.red(`注册失败: ${result.error}`);
      }
    }

    case "list": {
      const { identities, default: defaultName } = identityManager.list();

      if (identities.length === 0) {
        return chalk.yellow("暂无身份，使用 /identity add 添加");
      }

      const lines = identities.map((i) => {
        const isDefault = i.name === defaultName ? chalk.green(" (默认)") : "";
        const status =
          i.status === "claimed"
            ? chalk.green("✓ 已认证")
            : chalk.yellow("⏳ 待认证");
        return `  ${i.name}${isDefault} - ${status}`;
      });

      return `${chalk.bold("身份列表:")}\n${lines.join("\n")}`;
    }

    case "switch": {
      let name = args[1];
      if (!name) {
        // 交互式选择
        const { identities } = identityManager.list();
        if (identities.length === 0) {
          return chalk.yellow("暂无身份可切换");
        }
        const identityChoices = identities.map((i) => ({
          title: `${i.name} (${i.status})`,
          value: i.name,
        }));
        const selected = await askSelect("选择身份", identityChoices);
        name = selected || "";
        if (!name) return chalk.yellow("已取消");
      }

      const result = identityManager.switch(name);
      if (result.success) {
        return chalk.green(`✓ 已切换到身份: ${name}`);
      } else {
        return chalk.red(`切换失败: ${result.error}`);
      }
    }

    case "status": {
      const name = args[1];
      const result = await identityManager.checkStatus(name);

      if (result.success && result.identity) {
        const status =
          result.status === "claimed"
            ? chalk.green("✓ 已认证")
            : chalk.yellow("⏳ 待认证");

        let output = `
${chalk.bold("身份状态:")}
  名称: ${result.identity.name}
  状态: ${status}
  描述: ${result.identity.description || "(无)"}
`;
        if (result.identity.claim_url) {
          output += `  认领链接: ${result.identity.claim_url}\n`;
        }
        return output;
      } else {
        return chalk.red(`获取状态失败: ${result.error}`);
      }
    }

    case "remove": {
      let name = args[1];
      if (!name) {
        // 交互式选择
        const { identities } = identityManager.list();
        if (identities.length === 0) {
          return chalk.yellow("暂无身份可删除");
        }
        const removeChoices = identities.map((i) => ({
          title: `${i.name} (${i.status})`,
          value: i.name,
        }));
        const selected = await askSelect("选择要删除的身份", removeChoices);
        name = selected || "";
        if (!name) return chalk.yellow("已取消");

        // 确认删除
        const confirmed = await askConfirm(`确定删除身份 "${name}"?`);
        if (!confirmed) return chalk.yellow("已取消");
      }

      const result = identityManager.remove(name);
      if (result.success) {
        return chalk.green(`✓ 已删除身份: ${name}`);
      } else {
        return chalk.red(`删除失败: ${result.error}`);
      }
    }

    case "import": {
      // 交互式导入
      const name = await askQuestion("身份名称");
      const apiKey = await askQuestion("API Key");

      if (!name?.trim() || !apiKey?.trim()) {
        return chalk.red("名称和 API Key 不能为空");
      }

      console.log(chalk.yellow("\n正在验证..."));
      const result = await identityManager.import(name.trim(), apiKey.trim());

      if (result.success && result.identity) {
        return `
${chalk.green("✓ 身份导入成功!")}
  名称: ${result.identity.name}
  状态: ${result.identity.status}
`;
      } else {
        return chalk.red(`导入失败: ${result.error}`);
      }
    }

    default:
      return chalk.red(
        `未知子命令: ${subcommand || "(空)"}\n使用 /identity [add|list|switch|status|remove|import]`
      );
  }
}

/** 启动 TUI 交互模式 */
async function startTUI(): Promise<void> {
  // 启动后台心跳
  bgHeartbeat = new BackgroundHeartbeat();
  bgHeartbeat.start();

  // 统一退出链路（跨 macOS/Linux/Windows）：
  // - macOS Terminal 下 Ctrl+C 有时先进入 tty/raw mode 的中间态，导致需要按两次。
  // - 这里注册多路信号/流关闭兜底，并强制恢复 raw mode 后立刻退出。
  let exiting = false;
  const cleanup = () => {
    bgHeartbeat?.stop();
    bgHeartbeat = null;
    activeTuiHooks = null;
  };
  const hardExit = () => {
    if (exiting) return;
    exiting = true;
    cleanup();
    try {
      process.stdin.setRawMode?.(false);
    } catch {
      // ignore
    }
    try {
      process.stdout.write("\n");
    } catch {
      // ignore
    }
    process.exit(0);
  };

  // 有些终端/TTY 场景下，第一次 Ctrl+C 可能不会触发 SIGINT，
  // 但会产生一个字节 0x03 (ETX) 输入事件。这里作为最终兜底。
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const onData = (chunk: any) => {
    try {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      if (buf.includes(0x03)) hardExit();
    } catch {
      // ignore
    }
  };
  process.stdin.on("data", onData);

  process.on("exit", cleanup);
  process.once("SIGINT", hardExit);
  process.once("SIGTERM", hardExit);
  // SIGHUP 在 Windows 上不存在，需要条件注册
  if (process.platform !== "win32") {
    process.once("SIGHUP", hardExit);
  }
  process.stdin.once("end", hardExit);
  process.stdin.once("close", hardExit);

  const agent = new OpenEchoAgent();
  const llmConfig = llmConfigManager.getLLMConfig();
  const currentIdentity = identityManager.getCurrent();

  // 检测是否为首次运行（配置文件刚创建）
  const isFirstRun = llmConfigManager.isFirstRun();

  const statusLine = (() => {
    const parts: string[] = [];
    if (llmConfig) parts.push(`🤖 ${llmConfig.provider}/${llmConfig.model}`);
    else parts.push("🤖 未配置LLM");
    if (currentIdentity) {
      const icon = currentIdentity.status === "claimed" ? "✓" : "⏳";
      parts.push(`🦞 ${currentIdentity.name}${icon}`);
    } else {
      parts.push("🦞 无身份");
    }
    return parts.join("  │  ");
  })();

  const introLines: string[] = [];
  introLines.push(BANNER.trimEnd());
  introLines.push(statusLine);

  // 首次运行时显示配置文件创建提示
  if (isFirstRun) {
    introLines.push("");
    introLines.push(chalk.yellow("═".repeat(50)));
    introLines.push(chalk.yellow.bold("📝 首次运行 - 已自动创建示例配置文件"));
    introLines.push(chalk.yellow("═".repeat(50)));
    introLines.push("");
    introLines.push(chalk.white("配置文件位置:"));
    introLines.push(chalk.cyan(`  ${llmConfigManager.getConfigPath()}`));
    introLines.push("");
    introLines.push(chalk.white("你可以选择以下方式配置 LLM:"));
    introLines.push(chalk.green("  方式 1: ") + chalk.white("手动编辑配置文件，修改 api_key 为真实密钥"));
    introLines.push(chalk.green("  方式 2: ") + chalk.white("在 TUI 中使用 ") + chalk.cyan("/config add") + chalk.white(" 交互式添加"));
    introLines.push(chalk.green("  方式 3: ") + chalk.white("设置环境变量 ") + chalk.cyan("OPENECHO_API_KEY"));
    introLines.push("");
    introLines.push(chalk.gray("配置完成后重启程序，或使用 /config add 立即添加"));
    introLines.push(chalk.yellow("═".repeat(50)));
    introLines.push("");
    // 清除首次运行标记
    llmConfigManager.clearFirstRunFlag();
  }

  if (!llmConfig && !isFirstRun) introLines.push("提示: 使用 /config add 配置 LLM");
  if (!currentIdentity) introLines.push("提示: 使用 /identity add 添加 Moltbook 身份");
  introLines.push("输入 / 或 Ctrl+K 打开命令面板，/help 查看帮助，/exit 退出");
  introLines.push("后台心跳每4小时自动检查，状态显示在提示符前");

  runTuiInk({
    introLines,
    promptPrefix: () => getPromptPrefix(),
    commands: BUILTIN_COMMANDS,
    commandsNeedArgs: COMMANDS_NEED_ARGS,
    onReady: (hooks) => {
      activeTuiHooks = hooks;
    },
    execBuiltinCommand: async (command) => {
      return await handleBuiltinCommand(command);
    },
    execChat: (message) => agent.chatStream(message),
    onClear: () => {
      agent.resetConversation();
    },
    onExit: () => {
      hardExit();
    },
  });
}

// ============================================================================
// CLI 命令定义
// ============================================================================

const program = new Command();

program
  .name("openecho")
  .description("OpenEcho (回声) - 轻量级 Moltbook Agent")
  .version(VERSION);

// TUI 模式（默认）
program
  .command("tui", { isDefault: true })
  .description("启动交互式 TUI 界面")
  .action(async () => {
    await startTUI();
  });

// MCP 模式
program
  .command("mcp")
  .description("以 MCP 服务器模式运行")
  .action(async () => {
    await startMcpServer();
  });

// 单次命令执行
program
  .command("run <command>")
  .description("执行单次命令")
  .action(async (command: string) => {
    try {
      const result = await executeCommand(command);
      console.log(result);
    } catch (error) {
      console.error(chalk.red(`错误: ${error}`));
      process.exit(1);
    }
  });

// 身份管理命令组
const identityCmd = program
  .command("identity")
  .description("身份管理命令");

identityCmd
  .command("add")
  .description("注册新身份")
  .requiredOption("-n, --name <name>", "Agent 名称")
  .requiredOption("-d, --description <desc>", "Agent 描述")
  .action(async (options: { name: string; description: string }) => {
    const result = await identityManager.register(options.name, options.description);

    if (result.success && result.identity) {
      console.log(chalk.green("✓ 身份创建成功!"));
      console.log(`\n认领链接: ${chalk.cyan(result.claim_url || "")}`);
      console.log(`验证码: ${result.verification_code}`);
      console.log(chalk.yellow(`\n⚠️ API Key: ${result.identity.api_key}`));
      console.log("\n请访问认领链接，在 X(Twitter) 发布验证帖完成认证。");
    } else {
      console.error(chalk.red(`注册失败: ${result.error}`));
      process.exit(1);
    }
  });

identityCmd
  .command("list")
  .description("列出所有身份")
  .action(() => {
    const { identities, default: defaultName } = identityManager.list();

    if (identities.length === 0) {
      console.log(chalk.yellow("暂无身份"));
      return;
    }

    console.log(chalk.bold("身份列表:\n"));
    for (const identity of identities) {
      const isDefault = identity.name === defaultName ? chalk.green(" (默认)") : "";
      const status =
        identity.status === "claimed"
          ? chalk.green("已认证")
          : chalk.yellow("待认证");
      console.log(`  ${identity.name}${isDefault}`);
      console.log(`    状态: ${status}`);
      if (identity.description) {
        console.log(`    描述: ${identity.description}`);
      }
      console.log();
    }
  });

identityCmd
  .command("switch <name>")
  .description("切换默认身份")
  .action((name: string) => {
    const result = identityManager.switch(name);
    if (result.success) {
      console.log(chalk.green(`✓ 已切换到身份: ${name}`));
    } else {
      console.error(chalk.red(`切换失败: ${result.error}`));
      process.exit(1);
    }
  });

identityCmd
  .command("status [name]")
  .description("检查身份验证状态")
  .action(async (name?: string) => {
    const result = await identityManager.checkStatus(name);

    if (result.success && result.identity) {
      console.log(chalk.bold("身份状态:\n"));
      console.log(`  名称: ${result.identity.name}`);
      console.log(
        `  状态: ${
          result.status === "claimed"
            ? chalk.green("已认证")
            : chalk.yellow("待认证")
        }`
      );
      if (result.identity.description) {
        console.log(`  描述: ${result.identity.description}`);
      }
      if (result.identity.claim_url) {
        console.log(`  认领链接: ${result.identity.claim_url}`);
      }
    } else {
      console.error(chalk.red(`获取状态失败: ${result.error}`));
      process.exit(1);
    }
  });

identityCmd
  .command("remove <name>")
  .description("删除身份")
  .action((name: string) => {
    const result = identityManager.remove(name);
    if (result.success) {
      console.log(chalk.green(`✓ 已删除身份: ${name}`));
    } else {
      console.error(chalk.red(`删除失败: ${result.error}`));
      process.exit(1);
    }
  });

identityCmd
  .command("import")
  .description("导入已有的 API Key")
  .requiredOption("-n, --name <name>", "身份名称")
  .requiredOption("-k, --key <apiKey>", "Moltbook API Key")
  .action(async (options: { name: string; key: string }) => {
    const result = await identityManager.import(options.name, options.key);

    if (result.success && result.identity) {
      console.log(chalk.green("✓ 身份导入成功!"));
      console.log(`  名称: ${result.identity.name}`);
      console.log(`  状态: ${result.identity.status}`);
    } else {
      console.error(chalk.red(`导入失败: ${result.error}`));
      process.exit(1);
    }
  });

// 快捷命令
program
  .command("feed")
  .description("查看热门帖子")
  .option("-s, --sort <sort>", "排序方式 (hot|new|top|rising)", "hot")
  .option("-l, --limit <limit>", "数量限制", "10")
  .option("-m, --submolt <submolt>", "指定 Submolt")
  .action(async (options: { sort: string; limit: string; submolt?: string }) => {
    const result = await callToolDirect("moltbook_get_feed", {
      sort: options.sort,
      limit: parseInt(options.limit),
      submolt: options.submolt,
    });
    console.log(JSON.stringify(result, null, 2));
  });

program
  .command("search <query>")
  .description("搜索内容")
  .option("-t, --type <type>", "搜索类型 (posts|comments|all)", "all")
  .option("-l, --limit <limit>", "数量限制", "10")
  .action(async (query: string, options: { type: string; limit: string }) => {
    const result = await callToolDirect("moltbook_search", {
      query,
      type: options.type,
      limit: parseInt(options.limit),
    });
    console.log(JSON.stringify(result, null, 2));
  });

program
  .command("trend")
  .description("查看趋势分析")
  .option("-m, --submolt <submolt>", "指定 Submolt")
  .option("-r, --range <range>", "时间范围 (1h|6h|24h|7d|30d)", "24h")
  .action(async (options: { submolt?: string; range: string }) => {
    const result = await callToolDirect("analyze_trend", {
      submolt: options.submolt,
      timerange: options.range,
    });
    console.log(JSON.stringify(result, null, 2));
  });

program
  .command("post")
  .description("发布帖子")
  .requiredOption("-m, --submolt <submolt>", "目标 Submolt")
  .requiredOption("-t, --title <title>", "标题")
  .option("-c, --content <content>", "内容")
  .option("-u, --url <url>", "链接 (链接帖子)")
  .action(async (options: { submolt: string; title: string; content?: string; url?: string }) => {
    const result = await callToolDirect("moltbook_post", {
      submolt: options.submolt,
      title: options.title,
      content: options.content,
      url: options.url,
    });
    console.log(JSON.stringify(result, null, 2));
  });

// 处理 --mcp 参数（兼容性）
if (process.argv.includes("--mcp")) {
  startMcpServer().catch(console.error);
} else {
  // 解析命令行参数
  program.parse();
}
