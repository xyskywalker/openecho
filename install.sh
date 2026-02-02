#!/bin/bash

# OpenEcho 一键安装脚本
# 用法: curl -fsSL https://raw.githubusercontent.com/xyskywalker/openecho/main/install.sh | bash

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# 打印带颜色的消息
print_info() { echo -e "${BLUE}ℹ${NC} $1"; }
print_success() { echo -e "${GREEN}✔${NC} $1"; }
print_warning() { echo -e "${YELLOW}⚠${NC} $1"; }
print_error() { echo -e "${RED}✖${NC} $1"; }
print_step() { echo -e "\n${CYAN}▶${NC} $1"; }

# 打印 Banner
print_banner() {
    echo -e "${CYAN}"
    cat << 'EOF'
   ____                   ______     __         
  / __ \____  ___  ____  / ____/____/ /_  ____  
 / / / / __ \/ _ \/ __ \/ __/ / ___/ __ \/ __ \ 
/ /_/ / /_/ /  __/ / / / /___/ /__/ / / / /_/ / 
\____/ .___/\___/_/ /_/_____/\___/_/ /_/\____/  
    /_/                                         
EOF
    echo -e "${NC}"
    echo -e "  ${YELLOW}OpenEcho (回声) - 聆听 Moltbook 生态的声音${NC}\n"
}

# 检测操作系统
detect_os() {
    if [[ "$OSTYPE" == "darwin"* ]]; then
        OS="macOS"
    elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
        OS="Linux"
    elif [[ "$OSTYPE" == "msys" ]] || [[ "$OSTYPE" == "cygwin" ]]; then
        OS="Windows"
    else
        OS="Unknown"
    fi
    echo "$OS"
}

# 检查命令是否存在
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# 获取 Node.js 版本号（仅数字）
get_node_version() {
    node -v 2>/dev/null | sed 's/v//' | cut -d. -f1
}

# 检查 Node.js 版本
check_node() {
    print_step "检查 Node.js 环境..."
    
    if ! command_exists node; then
        print_warning "未检测到 Node.js"
        return 1
    fi
    
    local version=$(get_node_version)
    if [ "$version" -lt 20 ]; then
        print_warning "Node.js 版本 ($version) 过低，需要 >= 20.0.0"
        return 1
    fi
    
    print_success "Node.js $(node -v) ✓"
    return 0
}

# 检查 nvm 是否已安装
check_nvm() {
    # 加载 nvm
    export NVM_DIR="$HOME/.nvm"
    [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
    
    if command_exists nvm; then
        return 0
    fi
    return 1
}

# 使用 nvm 切换或安装 Node.js 20
use_nvm_node() {
    print_step "检测到 nvm，尝试使用 nvm 管理 Node.js..."
    
    # 加载 nvm
    export NVM_DIR="$HOME/.nvm"
    [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
    
    # 检查是否已安装 node 20
    local installed_versions=$(nvm ls 20 2>/dev/null | grep -o 'v20\.[0-9]*\.[0-9]*' | head -n1)
    
    if [ -n "$installed_versions" ]; then
        print_info "检测到已安装的 Node.js 20: $installed_versions"
        print_info "正在切换到 $installed_versions..."
        nvm use 20
        nvm alias default 20
        print_success "已切换到 Node.js $(node -v)"
    else
        print_info "未检测到 Node.js 20，正在通过 nvm 安装..."
        nvm install 20
        nvm use 20
        nvm alias default 20
        print_success "Node.js 20 安装完成"
    fi
    
    return 0
}

# 安装 Node.js
install_node() {
    print_step "准备安装 Node.js..."
    
    # 首先检查是否已有 nvm
    if check_nvm; then
        use_nvm_node
        return 0
    fi
    
    local os=$(detect_os)
    
    if [ "$os" == "macOS" ]; then
        # 优先使用 Homebrew
        if command_exists brew; then
            print_info "使用 Homebrew 安装 Node.js 20..."
            brew install node@20
            brew link node@20 --force --overwrite || true
        else
            print_info "未检测到 Homebrew，使用 nvm 安装..."
            install_node_via_nvm
        fi
    elif [ "$os" == "Linux" ]; then
        # 使用 NodeSource 或 nvm
        if command_exists apt-get; then
            print_info "使用 NodeSource 安装 Node.js 20..."
            curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
            sudo apt-get install -y nodejs
        elif command_exists yum; then
            print_info "使用 NodeSource 安装 Node.js 20..."
            curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
            sudo yum install -y nodejs
        else
            install_node_via_nvm
        fi
    else
        print_error "不支持的操作系统: $os"
        exit 1
    fi
    
    # 验证安装
    if check_node; then
        print_success "Node.js 安装成功"
    else
        print_error "Node.js 安装失败，请手动安装: https://nodejs.org/"
        exit 1
    fi
}

# 通过 nvm 安装 Node.js
install_node_via_nvm() {
    print_info "通过 nvm 安装 Node.js..."
    
    if ! command_exists nvm; then
        curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
        export NVM_DIR="$HOME/.nvm"
        [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
    fi
    
    nvm install 20
    nvm use 20
    nvm alias default 20
}

# 获取安装目录
get_install_dir() {
    local default_dir="$HOME/openecho"
    
    # 如果设置了 OPENECHO_INSTALL_DIR 环境变量，使用它
    if [ -n "$OPENECHO_INSTALL_DIR" ]; then
        echo "$OPENECHO_INSTALL_DIR"
        return
    fi
    
    # 如果是交互式终端，询问用户
    if [ -t 0 ]; then
        echo -e "\n${CYAN}?${NC} 安装目录 [${default_dir}]: \c" >&2
        read install_dir
        if [ -z "$install_dir" ]; then
            install_dir="$default_dir"
        fi
        echo "$install_dir"
    else
        echo "$default_dir"
    fi
}

# 克隆或更新仓库
clone_or_update_repo() {
    local install_dir="$1"
    
    print_step "获取 OpenEcho 源码..."
    
    if [ -d "$install_dir/.git" ]; then
        print_info "检测到已有安装，正在更新..."
        cd "$install_dir"
        git pull origin main
    else
        if [ -d "$install_dir" ]; then
            print_warning "目录 $install_dir 已存在但不是 git 仓库，备份中..."
            mv "$install_dir" "${install_dir}.backup.$(date +%s)"
        fi
        
        print_info "克隆仓库到 $install_dir..."
        git clone https://github.com/xyskywalker/openecho.git "$install_dir"
        cd "$install_dir"
    fi
    
    print_success "源码获取完成"
}

# 安装依赖
install_dependencies() {
    print_step "安装依赖..."
    npm install
    print_success "依赖安装完成"
}

# 编译项目
build_project() {
    print_step "编译项目..."
    npm run build
    print_success "项目编译完成"
}

# 创建配置文件
setup_config() {
    print_step "设置配置..."
    
    local config_dir="$HOME/.openecho"
    local config_file="$config_dir/config.json"
    
    # 创建配置目录
    mkdir -p "$config_dir"
    
    # 如果配置文件不存在，创建默认配置
    if [ ! -f "$config_file" ]; then
        cat > "$config_file" << 'EOF'
{
  "_comment": "OpenEcho LLM 配置文件",
  "current": "deepseek",
  "models": {
    "deepseek": {
      "name": "deepseek",
      "description": "DeepSeek Chat (推荐新手使用)",
      "provider": "custom",
      "api_key": "YOUR_API_KEY_HERE",
      "endpoint": "https://api.deepseek.com/v1",
      "model": "deepseek-chat"
    },
    "claude-default": {
      "name": "claude-default",
      "description": "Claude Sonnet 默认配置",
      "provider": "claude",
      "api_key": "YOUR_API_KEY_HERE",
      "model": "claude-sonnet-4-20250514"
    },
    "openai-gpt4o": {
      "name": "openai-gpt4o",
      "description": "OpenAI GPT-4o",
      "provider": "openai",
      "api_key": "YOUR_API_KEY_HERE",
      "model": "gpt-4o"
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
}
EOF
        print_success "配置文件已创建: $config_file"
    else
        print_info "配置文件已存在: $config_file"
    fi
}

# 全局链接
global_link() {
    print_step "创建全局命令..."
    
    # 尝试 npm link
    if npm link 2>/dev/null; then
        print_success "全局命令 'openecho' 已创建"
        return 0
    fi
    
    # 如果失败，尝试创建软链接到 /usr/local/bin
    local install_dir=$(pwd)
    local bin_path="/usr/local/bin/openecho"
    
    if [ -w "/usr/local/bin" ]; then
        ln -sf "$install_dir/dist/index.js" "$bin_path"
        chmod +x "$bin_path"
        print_success "全局命令 'openecho' 已创建"
    else
        print_warning "无法创建全局命令，请手动运行: sudo npm link"
        print_info "或者使用: npm run dev / npm start"
    fi
}

# 配置向导
config_wizard() {
    if [ ! -t 0 ]; then
        # 非交互式模式，跳过向导
        return
    fi
    
    echo ""
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${YELLOW}配置向导${NC}"
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
    
    echo -e "${CYAN}?${NC} 是否现在配置 API Key? [Y/n]: \c"
    read configure_now
    
    if [ "$configure_now" != "n" ] && [ "$configure_now" != "N" ]; then
        local config_file="$HOME/.openecho/config.json"
        
        echo ""
        echo -e "请选择大模型提供商:"
        echo -e "  1) DeepSeek (推荐，性价比高)"
        echo -e "  2) Claude (Anthropic)"
        echo -e "  3) OpenAI GPT-4o"
        echo -e "  4) 本地 Ollama"
        echo -e "  5) 跳过，稍后配置"
        echo ""
        echo -e "${CYAN}?${NC} 请选择 [1-5]: \c"
        read choice
        
        case $choice in
            1)
                echo -e "${CYAN}?${NC} 请输入 DeepSeek API Key: \c"
                read -s api_key
                echo ""
                if [ -n "$api_key" ]; then
                    # 更新配置文件
                    if command_exists jq; then
                        tmp_file=$(mktemp)
                        jq --arg key "$api_key" '.models.deepseek.api_key = $key | .current = "deepseek"' "$config_file" > "$tmp_file"
                        mv "$tmp_file" "$config_file"
                    else
                        sed -i.bak "s/YOUR_API_KEY_HERE/$api_key/g" "$config_file" 2>/dev/null || \
                        sed -i "" "s/YOUR_API_KEY_HERE/$api_key/g" "$config_file"
                    fi
                    print_success "DeepSeek 配置完成"
                fi
                ;;
            2)
                echo -e "${CYAN}?${NC} 请输入 Claude API Key: \c"
                read -s api_key
                echo ""
                if [ -n "$api_key" ]; then
                    if command_exists jq; then
                        tmp_file=$(mktemp)
                        jq --arg key "$api_key" '.models."claude-default".api_key = $key | .current = "claude-default"' "$config_file" > "$tmp_file"
                        mv "$tmp_file" "$config_file"
                    else
                        sed -i.bak "s/YOUR_API_KEY_HERE/$api_key/g" "$config_file" 2>/dev/null || \
                        sed -i "" "s/YOUR_API_KEY_HERE/$api_key/g" "$config_file"
                    fi
                    print_success "Claude 配置完成"
                fi
                ;;
            3)
                echo -e "${CYAN}?${NC} 请输入 OpenAI API Key: \c"
                read -s api_key
                echo ""
                if [ -n "$api_key" ]; then
                    if command_exists jq; then
                        tmp_file=$(mktemp)
                        jq --arg key "$api_key" '.models."openai-gpt4o".api_key = $key | .current = "openai-gpt4o"' "$config_file" > "$tmp_file"
                        mv "$tmp_file" "$config_file"
                    else
                        sed -i.bak "s/YOUR_API_KEY_HERE/$api_key/g" "$config_file" 2>/dev/null || \
                        sed -i "" "s/YOUR_API_KEY_HERE/$api_key/g" "$config_file"
                    fi
                    print_success "OpenAI 配置完成"
                fi
                ;;
            4)
                if command_exists jq; then
                    tmp_file=$(mktemp)
                    jq '.current = "ollama-local"' "$config_file" > "$tmp_file"
                    mv "$tmp_file" "$config_file"
                fi
                print_success "Ollama 配置完成"
                print_info "请确保 Ollama 服务已启动: ollama serve"
                ;;
            *)
                print_info "已跳过配置，可稍后编辑: $config_file"
                ;;
        esac
    fi
}

# 打印完成信息
print_completion() {
    local install_dir="$1"
    
    echo ""
    echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${GREEN}✔ OpenEcho 安装完成!${NC}"
    echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
    echo -e "安装目录: ${CYAN}$install_dir${NC}"
    echo -e "配置文件: ${CYAN}$HOME/.openecho/config.json${NC}"
    echo ""
    echo -e "${YELLOW}快速开始:${NC}"
    echo ""
    echo -e "  ${CYAN}cd $install_dir${NC}"
    echo ""
    echo -e "  # 启动 TUI 交互模式"
    echo -e "  ${CYAN}npm run dev${NC}"
    echo ""
    echo -e "  # 或者使用全局命令"
    echo -e "  ${CYAN}openecho${NC}"
    echo ""
    echo -e "  # 添加 Moltbook 身份"
    echo -e "  ${CYAN}openecho identity add -n \"你的Agent名称\" -d \"Agent描述\"${NC}"
    echo ""
    echo -e "${YELLOW}更多信息:${NC}"
    echo -e "  文档: https://github.com/xyskywalker/openecho"
    echo -e "  问题: https://github.com/xyskywalker/openecho/issues"
    echo ""
}

# 主函数
main() {
    print_banner
    
    # 检查操作系统
    local os=$(detect_os)
    print_info "检测到操作系统: $os"
    
    # 检查 Git
    if ! command_exists git; then
        print_error "未检测到 Git，请先安装 Git"
        exit 1
    fi
    
    # 检查或安装 Node.js
    if ! check_node; then
        echo -e "\n${CYAN}?${NC} 是否自动安装 Node.js 20? [Y/n]: \c"
        if [ -t 0 ]; then
            read install_node_confirm
            if [ "$install_node_confirm" != "n" ] && [ "$install_node_confirm" != "N" ]; then
                install_node
            else
                print_error "请先安装 Node.js >= 20.0.0: https://nodejs.org/"
                exit 1
            fi
        else
            install_node
        fi
    fi
    
    # 获取安装目录
    local install_dir=$(get_install_dir)
    
    # 克隆/更新仓库
    clone_or_update_repo "$install_dir"
    
    # 安装依赖
    install_dependencies
    
    # 编译项目
    build_project
    
    # 设置配置
    setup_config
    
    # 全局链接
    global_link
    
    # 配置向导
    config_wizard
    
    # 完成
    print_completion "$install_dir"
}

# 运行
main "$@"
