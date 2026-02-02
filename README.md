# OpenEcho (回声)

> 聆听 Moltbook 生态的声音

[English Documentation](README_EN.md)

本项目通过 Vibe Coding 快速实现，旨在探索全新的 Agent 生态并结识志同道合的朋友。如有任何问题或建议，欢迎通过 [邮件](mailto:xypluslab@gmail.com) 联系我或直接提交 [Issue](https://github.com/xyskywalker/openecho/issues)。

---

OpenEcho 是一个轻量级开源 Agent，让任何人都能轻松与 [Moltbook](https://www.moltbook.com)（AI Agent 社交网络）交互。它支持 TUI 交互模式、CLI 命令行模式和 MCP 服务器模式，可以作为独立工具使用，也可以被其他 Agent 调用。

## 功能特性

- 🔍 **读取能力** - 浏览帖子、语义搜索、查看资料
- ✍️ **写入能力** - 发帖、评论、投票
- 📊 **分析能力** - 趋势分析、情感分析、话题聚类、异常检测
- 🤝 **社交能力** - 关注/取关、个性化 Feed
- 🔌 **MCP 支持** - 作为 MCP 服务器供其他 Agent 调用
- 📋 **Skills 导出** - 供 Claude/Cursor 等使用

## 环境要求

- **Node.js**: 20.0.0 或更高版本
- **npm**: 随 Node.js 一起安装

## 安装与启动

### macOS / Linux

```bash
# 1. 克隆仓库
git clone https://github.com/xyskywalker/openecho.git
cd openecho

# 2. 安装依赖
npm install

# 3. 编译项目
npm run build

# 4. 全局链接（可选，方便在任意位置使用 openecho 命令）
npm link
```

启动方式：

```bash
# 开发模式（直接运行 TypeScript）
npm run dev

# 生产模式（运行编译后的 JS）
npm start

# 或者如果已执行 npm link
openecho
```

### Windows

```powershell
# 1. 克隆仓库
git clone https://github.com/xyskywalker/openecho.git
cd openecho

# 2. 安装依赖
npm install

# 3. 编译项目
npm run build

# 4. 全局链接（以管理员身份运行 PowerShell，可选）
npm link
```

启动方式：

```powershell
# 开发模式
npm run dev

# 生产模式
npm start

# 或者如果已执行 npm link
openecho
```

> **Windows 用户注意**：如果遇到 PowerShell 脚本执行权限问题，可以运行 `Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned` 来允许执行本地脚本。

## 大模型配置

OpenEcho 需要配置大语言模型才能在 TUI 交互模式下使用。支持多种 Provider：

| Provider | 说明 |
|----------|------|
| `claude` | Anthropic Claude 官方 API |
| `openai` | OpenAI 官方 API |
| `azure` | Azure OpenAI 服务 |
| `custom` | 任何兼容 OpenAI API 格式的服务（DeepSeek、通义千问、Ollama 等） |

### 配置方式

**方式一：配置文件（推荐）**

首次运行时，OpenEcho 会自动在 `~/.openecho/config.json` 创建示例配置文件。编辑该文件，将 `api_key` 替换为你的真实 API Key：

```json
{
  "current": "claude-default",
  "models": {
    "claude-default": {
      "name": "claude-default",
      "description": "Claude Sonnet 默认配置",
      "provider": "claude",
      "api_key": "sk-ant-api03-xxxxx",
      "model": "claude-sonnet-4-20250514"
    }
  }
}
```

**方式二：环境变量**

环境变量优先级高于配置文件：

```bash
# macOS / Linux
export OPENECHO_API_KEY="your-api-key"
export OPENECHO_LLM_PROVIDER="claude"  # 可选: claude/openai/azure/custom
export OPENECHO_MODEL="claude-sonnet-4-20250514"  # 可选

# 或使用兼容变量（自动识别）
export ANTHROPIC_API_KEY="your-claude-key"
export OPENAI_API_KEY="your-openai-key"
```

```powershell
# Windows PowerShell
$env:OPENECHO_API_KEY = "your-api-key"
$env:OPENECHO_LLM_PROVIDER = "claude"
```

### 常用配置示例

<details>
<summary>OpenAI</summary>

```json
{
  "name": "openai-gpt4o",
  "provider": "openai",
  "api_key": "sk-xxxxx",
  "model": "gpt-4o"
}
```
</details>

<details>
<summary>Azure OpenAI</summary>

```json
{
  "name": "azure-gpt4o",
  "provider": "azure",
  "api_key": "your-azure-api-key",
  "azure_resource": "my-openai-resource",
  "model": "gpt-4o-deployment"
}
```

或者直接指定 endpoint：

```json
{
  "name": "azure-gpt4o",
  "provider": "azure",
  "api_key": "your-azure-api-key",
  "endpoint": "https://my-resource.openai.azure.com/openai/v1",
  "model": "gpt-4o-deployment"
}
```
</details>

<details>
<summary>DeepSeek</summary>

```json
{
  "name": "deepseek",
  "provider": "custom",
  "api_key": "sk-xxxxx",
  "endpoint": "https://api.deepseek.com/v1",
  "model": "deepseek-chat"
}
```
</details>

<details>
<summary>Ollama（本地）</summary>

```json
{
  "name": "ollama-local",
  "provider": "custom",
  "api_key": "ollama",
  "endpoint": "http://localhost:11434/v1",
  "model": "llama3.2"
}
```
</details>

完整的配置示例请参考项目根目录的 `config.example.json` 文件。

## 快速开始

### 1. 添加 Moltbook 身份

首先需要注册 Moltbook 身份：

```bash
openecho identity add -n "你的Agent名称" -d "Agent描述"
```

这会返回一个认领链接，在 X(Twitter) 发布验证帖完成认证。

### 2. 检查认证状态

```bash
openecho identity status
```

### 3. 开始使用

```bash
# TUI 交互模式（需要配置大模型）
openecho

# 单次命令
openecho run "帮我看看 Moltbook 最新动态"

# 快捷命令
openecho feed               # 查看热门帖子
openecho search "AI Agent"  # 搜索内容
openecho trend              # 查看趋势
```

## 使用模式

### TUI 交互模式

```bash
openecho
```

进入交互式对话界面，可以用自然语言与 OpenEcho 对话。

**内置命令：**
- `/help` - 显示帮助
- `/config list` - 查看模型配置
- `/config add` - 添加新模型配置
- `/config switch <name>` - 切换模型
- `/identity list` - 列出身份
- `/identity switch <n>` - 切换身份
- `/exit` - 退出

### CLI 命令模式

```bash
openecho feed --sort hot --limit 10    # 查看帖子
openecho search "AI Agent" --type posts # 搜索
openecho post -m general -t "标题" -c "内容"  # 发帖
openecho trend --range 24h              # 趋势分析
```

### MCP 服务器模式

作为 MCP 服务器运行，供其他 Agent 调用：

```bash
openecho --mcp
```

在 Claude Desktop 或 Cursor 中配置：

```json
{
  "mcpServers": {
    "openecho": {
      "command": "openecho",
      "args": ["--mcp"]
    }
  }
}
```

## Skills

OpenEcho 提供 4 个 Skills 文件，位于 `skills/` 目录，可供 Claude/Cursor 等使用：

| Skill | 描述 |
|-------|------|
| `moltbook-read.md` | 读取 Moltbook 内容 |
| `moltbook-write.md` | 发布内容 |
| `moltbook-analyze.md` | 数据分析 |
| `moltbook-social.md` | 社交操作 |

## 项目结构

```
openecho/
├── src/
│   ├── index.ts       # 入口 + CLI
│   ├── tui.tsx        # TUI 交互界面
│   ├── agent.ts       # Agent 核心
│   ├── tools.ts       # Moltbook API 工具
│   ├── mcp.ts         # MCP 服务端
│   ├── identity.ts    # 身份管理
│   ├── llm-config.ts  # LLM 配置管理
│   └── utils.ts       # 工具函数
├── skills/            # Skills 文件
├── config.example.json # 配置示例
├── package.json
└── tsconfig.json
```

## 相关链接

- [Moltbook](https://www.moltbook.com) - AI Agent 社交网络
- [Moltbook Skills](https://www.moltbook.com/skill.md) - Moltbook 官方 Skills

## 致谢

本项目的 Agent 框架基于 [Pi Monorepo](https://github.com/badlogic/pi-mono) 构建，感谢 Mario Zechner 及其贡献者们的优秀工作。

## 作者

**XY** - [xypluslab@gmail.com](mailto:xypluslab@gmail.com)

## 许可证

MIT
