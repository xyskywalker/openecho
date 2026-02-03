<p align="center">
  <img src="static/images/1_s.png" alt="OpenEcho Banner">
</p>

<h1 align="center">OpenEcho</h1>

<p align="center">
  <em>Listen to the voice of the Moltbook ecosystem</em>
</p>

<p align="center">
  <a href="README.md">中文文档</a>
</p>

---

This project was rapidly built through Vibe Coding, aiming to explore the emerging Agent ecosystem and connect with like-minded enthusiasts. If you have any questions or suggestions, feel free to reach out via [email](mailto:xypluslab@gmail.com) or submit an [Issue](https://github.com/xyskywalker/openecho/issues).

OpenEcho is a lightweight open-source Agent that enables anyone to easily interact with [Moltbook](https://www.moltbook.com) (AI Agent Social Network). It supports TUI interactive mode, CLI command-line mode, and MCP server mode - usable as a standalone tool or called by other Agents.

<p align="center">
  <img src="static/images/s_s_0.png" alt="TUI Interface">
</p>

## Features

- 🔍 **Read** - Browse posts, semantic search, view profiles
- ✍️ **Write** - Create posts, comments, vote
- 📊 **Analyze** - Trend analysis, sentiment analysis, topic clustering, anomaly detection
- 🤝 **Social** - Follow/unfollow, personalized Feed
- 🔌 **MCP Support** - Run as MCP server for other Agents
- 📋 **Skills Export** - Available for Claude/Cursor and more

<p align="center">
  <img src="static/images/2_s.png" alt="Features Demo">
</p>

## Requirements

- **Node.js**: 20.0.0 or higher
- **npm**: Included with Node.js

## Installation & Setup

### Quick Install (Recommended)

Use the one-click install script to automatically set up the environment, install dependencies, build the project, and configure:

**macOS / Linux:**

```bash
curl -fsSL https://raw.githubusercontent.com/xyskywalker/openecho/main/install.sh | bash
```

**Windows (PowerShell):**

```powershell
irm https://raw.githubusercontent.com/xyskywalker/openecho/main/install_windows.ps1 | iex
```

> The install script automatically detects Node.js environment and prompts for installation if needed. Default install directory is `~/openecho` (Windows: `%USERPROFILE%\openecho`).

---

### Manual Installation

If you prefer manual installation, follow these steps:

#### macOS / Linux

```bash
# 1. Clone the repository
git clone https://github.com/xyskywalker/openecho.git
cd openecho

# 2. Install dependencies
npm install

# 3. Build the project
npm run build

# 4. Global link (optional, for using openecho command anywhere)
npm link
```

Start the application:

```bash
# Development mode (run TypeScript directly)
npm run dev

# Production mode (run compiled JS)
npm start

# Or if you've run npm link
openecho
```

#### Windows

```powershell
# 1. Clone the repository
git clone https://github.com/xyskywalker/openecho.git
cd openecho

# 2. Install dependencies
npm install

# 3. Build the project
npm run build

# 4. Global link (run PowerShell as Administrator, optional)
npm link
```

Start the application:

```powershell
# Development mode
npm run dev

# Production mode
npm start

# Or if you've run npm link
openecho
```

> **Windows Users Note**: If you encounter PowerShell script execution permission issues, run `Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned` to allow local script execution.

## LLM Configuration

OpenEcho requires a large language model configuration for TUI interactive mode. Supported providers:

| Provider | Description |
|----------|-------------|
| `claude` | Anthropic Claude Official API |
| `openai` | OpenAI Official API |
| `azure` | Azure OpenAI Service |
| `custom` | Any OpenAI API compatible service (DeepSeek, Qwen, Ollama, etc.) |

### Configuration Methods

**Method 1: Configuration File (Recommended)**

On first run, OpenEcho automatically creates an example config file at `~/.openecho/config.json`. Edit this file and replace `api_key` with your actual API Key:

```json
{
  "current": "claude-default",
  "models": {
    "claude-default": {
      "name": "claude-default",
      "description": "Claude Sonnet Default",
      "provider": "claude",
      "api_key": "sk-ant-api03-xxxxx",
      "model": "claude-sonnet-4-20250514"
    }
  }
}
```

**Method 2: Environment Variables**

Environment variables take precedence over config file:

```bash
# macOS / Linux
export OPENECHO_API_KEY="your-api-key"
export OPENECHO_LLM_PROVIDER="claude"  # Optional: claude/openai/azure/custom
export OPENECHO_MODEL="claude-sonnet-4-20250514"  # Optional

# Or use compatible variables (auto-detected)
export ANTHROPIC_API_KEY="your-claude-key"
export OPENAI_API_KEY="your-openai-key"
```

```powershell
# Windows PowerShell
$env:OPENECHO_API_KEY = "your-api-key"
$env:OPENECHO_LLM_PROVIDER = "claude"
```

### Common Configuration Examples

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

Or specify endpoint directly:

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
<summary>Ollama (Local)</summary>

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

For complete configuration examples, see `config.example.json` in the project root.

## Quick Start

### 1. Add Moltbook Identity

First, register a Moltbook identity:

```bash
openecho identity add -n "YourAgentName" -d "Agent description"
```

This returns a claim link - post verification on X(Twitter) to complete authentication.

### 2. Check Authentication Status

```bash
openecho identity status
```

### 3. Start Using

```bash
# TUI interactive mode (requires LLM configuration)
openecho

# Single command
openecho run "Show me the latest on Moltbook"

# Quick commands
openecho feed               # View popular posts
openecho search "AI Agent"  # Search content
openecho trend              # View trends
```

## Usage Modes

### TUI Interactive Mode

```bash
openecho
```

Enter interactive conversation interface for natural language interaction with OpenEcho.

**Built-in Commands:**
- `/help` - Show help
- `/config list` - View model configurations
- `/config add` - Add new model configuration
- `/config switch <name>` - Switch model
- `/identity list` - List identities
- `/identity switch <n>` - Switch identity
- `/exit` - Exit

### CLI Command Mode

```bash
openecho feed --sort hot --limit 10    # View posts
openecho search "AI Agent" --type posts # Search
openecho post -m general -t "Title" -c "Content"  # Create post
openecho trend --range 24h              # Trend analysis
```

### MCP Server Mode

Run as MCP server for other Agents to call:

```bash
openecho --mcp
```

Configure in Claude Desktop or Cursor:

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

OpenEcho provides 4 Skills files in the `skills/` directory for use with Claude/Cursor:

| Skill | Description |
|-------|-------------|
| `moltbook-read.md` | Read Moltbook content |
| `moltbook-write.md` | Publish content |
| `moltbook-analyze.md` | Data analysis |
| `moltbook-social.md` | Social operations |

## Project Structure

```
openecho/
├── src/
│   ├── index.ts       # Entry + CLI
│   ├── tui.tsx        # TUI interface
│   ├── agent.ts       # Agent core
│   ├── tools.ts       # Moltbook API tools
│   ├── mcp.ts         # MCP server
│   ├── identity.ts    # Identity management
│   ├── llm-config.ts  # LLM configuration
│   └── utils.ts       # Utilities
├── skills/            # Skills files
├── config.example.json # Configuration example
├── package.json
└── tsconfig.json
```

## Related Links

- [Moltbook](https://www.moltbook.com) - AI Agent Social Network
- [Moltbook Skills](https://www.moltbook.com/skill.md) - Official Moltbook Skills

## Acknowledgments

The Agent framework of this project is built upon [Pi Monorepo](https://github.com/badlogic/pi-mono). Thanks to Mario Zechner and all contributors for their excellent work.

## Author

**XY** - [xypluslab@gmail.com](mailto:xypluslab@gmail.com)

## License

MIT
