# OpenEcho Windows 一键安装脚本
# 用法: irm https://raw.githubusercontent.com/xyskywalker/openecho/main/install.ps1 | iex
# 或者: Set-ExecutionPolicy Bypass -Scope Process -Force; iex ((New-Object System.Net.WebClient).DownloadString('https://raw.githubusercontent.com/xyskywalker/openecho/main/install.ps1'))

$ErrorActionPreference = "Stop"

# 颜色函数
function Write-Info { Write-Host "i " -ForegroundColor Blue -NoNewline; Write-Host $args[0] }
function Write-Success { Write-Host "√ " -ForegroundColor Green -NoNewline; Write-Host $args[0] }
function Write-Warning { Write-Host "! " -ForegroundColor Yellow -NoNewline; Write-Host $args[0] }
function Write-Error { Write-Host "x " -ForegroundColor Red -NoNewline; Write-Host $args[0] }
function Write-Step { Write-Host "`n> " -ForegroundColor Cyan -NoNewline; Write-Host $args[0] }

# 打印 Banner
function Show-Banner {
    Write-Host @"

   ____                   ______     __         
  / __ \____  ___  ____  / ____/____/ /_  ____  
 / / / / __ \/ _ \/ __ \/ __/ / ___/ __ \/ __ \ 
/ /_/ / /_/ /  __/ / / / /___/ /__/ / / / /_/ / 
\____/ .___/\___/_/ /_/_____/\___/_/ /_/\____/  
    /_/                                         

"@ -ForegroundColor Cyan
    Write-Host "  OpenEcho (回声) - 聆听 Moltbook 生态的声音`n" -ForegroundColor Yellow
}

# 检查命令是否存在
function Test-Command {
    param([string]$Command)
    return $null -ne (Get-Command $Command -ErrorAction SilentlyContinue)
}

# 获取 Node.js 主版本号
function Get-NodeMajorVersion {
    try {
        $version = (node -v 2>$null) -replace 'v', ''
        return [int]($version.Split('.')[0])
    } catch {
        return 0
    }
}

# 检查 Node.js
function Test-NodeJS {
    Write-Step "检查 Node.js 环境..."
    
    if (-not (Test-Command "node")) {
        Write-Warning "未检测到 Node.js"
        return $false
    }
    
    $version = Get-NodeMajorVersion
    if ($version -lt 20) {
        Write-Warning "Node.js 版本 ($version) 过低，需要 >= 20.0.0"
        return $false
    }
    
    $fullVersion = node -v
    Write-Success "Node.js $fullVersion √"
    return $true
}

# 检查 nvm-windows 是否已安装
function Test-NVM {
    return (Test-Command "nvm")
}

# 使用 nvm 切换或安装 Node.js 20
function Use-NVMNode {
    Write-Step "检测到 nvm，尝试使用 nvm 管理 Node.js..."
    
    try {
        # 检查已安装的 node 20 版本
        $nvmList = nvm list 2>$null
        $node20Versions = $nvmList | Select-String "20\.\d+\.\d+" -AllMatches | ForEach-Object { $_.Matches.Value }
        
        if ($node20Versions) {
            $latestV20 = $node20Versions | Sort-Object -Descending | Select-Object -First 1
            Write-Info "检测到已安装的 Node.js 20: $latestV20"
            Write-Info "正在切换到 $latestV20..."
            
            nvm use $latestV20
            
            # 刷新环境变量
            $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
            
            Write-Success "已切换到 Node.js $(node -v)"
        } else {
            Write-Info "未检测到 Node.js 20，正在通过 nvm 安装..."
            nvm install 20
            
            # 获取刚安装的版本
            Start-Sleep -Seconds 2
            $nvmList = nvm list 2>$null
            $node20Versions = $nvmList | Select-String "20\.\d+\.\d+" -AllMatches | ForEach-Object { $_.Matches.Value }
            $latestV20 = $node20Versions | Sort-Object -Descending | Select-Object -First 1
            
            if ($latestV20) {
                nvm use $latestV20
            } else {
                nvm use 20
            }
            
            # 刷新环境变量
            $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
            
            Write-Success "Node.js 20 安装完成"
        }
        
        return $true
    } catch {
        Write-Warning "使用 nvm 失败: $_"
        return $false
    }
}

# 安装 Node.js
function Install-NodeJS {
    Write-Step "准备安装 Node.js..."
    
    # 首先检查是否已有 nvm
    if (Test-NVM) {
        if (Use-NVMNode) {
            # 验证安装
            if (Test-NodeJS) {
                Write-Success "Node.js 准备完成"
                return
            }
        }
        Write-Warning "nvm 切换失败，尝试其他安装方式..."
    }
    
    # 检查是否有 winget
    if (Test-Command "winget") {
        Write-Info "使用 winget 安装 Node.js 20..."
        winget install OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
        
        # 刷新环境变量
        $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
    }
    # 检查是否有 choco
    elseif (Test-Command "choco") {
        Write-Info "使用 Chocolatey 安装 Node.js 20..."
        choco install nodejs-lts -y
        
        # 刷新环境变量
        $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
    }
    else {
        Write-Error "请手动安装 Node.js >= 20.0.0"
        Write-Info "下载地址: https://nodejs.org/"
        Write-Info "或者安装 nvm-windows: https://github.com/coreybutler/nvm-windows"
        Write-Host ""
        Write-Info "安装 Node.js 后，请重新运行此脚本"
        exit 1
    }
    
    # 验证安装
    if (Test-NodeJS) {
        Write-Success "Node.js 安装成功"
    } else {
        Write-Error "Node.js 安装失败，请手动安装: https://nodejs.org/"
        exit 1
    }
}

# 获取安装目录
function Get-InstallDir {
    $defaultDir = Join-Path $env:USERPROFILE "openecho"
    
    # 如果设置了环境变量
    if ($env:OPENECHO_INSTALL_DIR) {
        return $env:OPENECHO_INSTALL_DIR
    }
    
    Write-Host ""
    $installDir = Read-Host "? 安装目录 [$defaultDir]"
    
    if ([string]::IsNullOrWhiteSpace($installDir)) {
        $installDir = $defaultDir
    }
    
    return $installDir
}

# 克隆或更新仓库
function Get-Repository {
    param([string]$InstallDir)
    
    Write-Step "获取 OpenEcho 源码..."
    
    $gitDir = Join-Path $InstallDir ".git"
    
    if (Test-Path $gitDir) {
        Write-Info "检测到已有安装，正在更新..."
        Set-Location $InstallDir
        git pull origin main
    } else {
        if (Test-Path $InstallDir) {
            $backupDir = "$InstallDir.backup.$(Get-Date -Format 'yyyyMMddHHmmss')"
            Write-Warning "目录 $InstallDir 已存在但不是 git 仓库，备份中..."
            Move-Item $InstallDir $backupDir
        }
        
        Write-Info "克隆仓库到 $InstallDir..."
        git clone https://github.com/xyskywalker/openecho.git $InstallDir
        Set-Location $InstallDir
    }
    
    Write-Success "源码获取完成"
}

# 安装依赖
function Install-Dependencies {
    Write-Step "安装依赖..."
    npm install
    Write-Success "依赖安装完成"
}

# 编译项目
function Build-Project {
    Write-Step "编译项目..."
    npm run build
    Write-Success "项目编译完成"
}

# 设置配置
function Set-Configuration {
    Write-Step "设置配置..."
    
    $configDir = Join-Path $env:USERPROFILE ".openecho"
    $configFile = Join-Path $configDir "config.json"
    
    # 创建配置目录
    if (-not (Test-Path $configDir)) {
        New-Item -ItemType Directory -Path $configDir -Force | Out-Null
    }
    
    # 创建配置文件
    if (-not (Test-Path $configFile)) {
        $configContent = @'
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
'@
        $configContent | Out-File -FilePath $configFile -Encoding utf8
        Write-Success "配置文件已创建: $configFile"
    } else {
        Write-Info "配置文件已存在: $configFile"
    }
}

# 创建全局命令
function Set-GlobalCommand {
    Write-Step "创建全局命令..."
    
    try {
        npm link 2>$null
        Write-Success "全局命令 'openecho' 已创建"
    } catch {
        Write-Warning "无法创建全局命令 (可能需要管理员权限)"
        Write-Info "可以使用: npm run dev / npm start"
    }
}

# 配置向导
function Start-ConfigWizard {
    Write-Host ""
    Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
    Write-Host "配置向导" -ForegroundColor Yellow
    Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
    Write-Host ""
    
    $configNow = Read-Host "? 是否现在配置 API Key? [Y/n]"
    
    if ($configNow -ne "n" -and $configNow -ne "N") {
        $configFile = Join-Path $env:USERPROFILE ".openecho\config.json"
        
        Write-Host ""
        Write-Host "请选择大模型提供商:"
        Write-Host "  1) DeepSeek (推荐，性价比高)"
        Write-Host "  2) Claude (Anthropic)"
        Write-Host "  3) OpenAI GPT-4o"
        Write-Host "  4) 本地 Ollama"
        Write-Host "  5) 跳过，稍后配置"
        Write-Host ""
        $choice = Read-Host "? 请选择 [1-5]"
        
        switch ($choice) {
            "1" {
                $apiKey = Read-Host "? 请输入 DeepSeek API Key" -AsSecureString
                $apiKeyPlain = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($apiKey))
                if ($apiKeyPlain) {
                    $config = Get-Content $configFile | ConvertFrom-Json
                    $config.models.deepseek.api_key = $apiKeyPlain
                    $config.current = "deepseek"
                    $config | ConvertTo-Json -Depth 10 | Out-File -FilePath $configFile -Encoding utf8
                    Write-Success "DeepSeek 配置完成"
                }
            }
            "2" {
                $apiKey = Read-Host "? 请输入 Claude API Key" -AsSecureString
                $apiKeyPlain = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($apiKey))
                if ($apiKeyPlain) {
                    $config = Get-Content $configFile | ConvertFrom-Json
                    $config.models.'claude-default'.api_key = $apiKeyPlain
                    $config.current = "claude-default"
                    $config | ConvertTo-Json -Depth 10 | Out-File -FilePath $configFile -Encoding utf8
                    Write-Success "Claude 配置完成"
                }
            }
            "3" {
                $apiKey = Read-Host "? 请输入 OpenAI API Key" -AsSecureString
                $apiKeyPlain = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($apiKey))
                if ($apiKeyPlain) {
                    $config = Get-Content $configFile | ConvertFrom-Json
                    $config.models.'openai-gpt4o'.api_key = $apiKeyPlain
                    $config.current = "openai-gpt4o"
                    $config | ConvertTo-Json -Depth 10 | Out-File -FilePath $configFile -Encoding utf8
                    Write-Success "OpenAI 配置完成"
                }
            }
            "4" {
                $config = Get-Content $configFile | ConvertFrom-Json
                $config.current = "ollama-local"
                $config | ConvertTo-Json -Depth 10 | Out-File -FilePath $configFile -Encoding utf8
                Write-Success "Ollama 配置完成"
                Write-Info "请确保 Ollama 服务已启动: ollama serve"
            }
            default {
                Write-Info "已跳过配置，可稍后编辑: $configFile"
            }
        }
    }
}

# 显示完成信息
function Show-Completion {
    param([string]$InstallDir)
    
    $configFile = Join-Path $env:USERPROFILE ".openecho\config.json"
    
    Write-Host ""
    Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Green
    Write-Host "√ OpenEcho 安装完成!" -ForegroundColor Green
    Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Green
    Write-Host ""
    Write-Host "安装目录: " -NoNewline; Write-Host $InstallDir -ForegroundColor Cyan
    Write-Host "配置文件: " -NoNewline; Write-Host $configFile -ForegroundColor Cyan
    Write-Host ""
    Write-Host "快速开始:" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  cd $InstallDir" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  # 启动 TUI 交互模式"
    Write-Host "  npm run dev" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  # 或者使用全局命令"
    Write-Host "  openecho" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  # 添加 Moltbook 身份"
    Write-Host "  openecho identity add -n `"你的Agent名称`" -d `"Agent描述`"" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "更多信息:" -ForegroundColor Yellow
    Write-Host "  文档: https://github.com/xyskywalker/openecho"
    Write-Host "  问题: https://github.com/xyskywalker/openecho/issues"
    Write-Host ""
}

# 主函数
function Main {
    Show-Banner
    
    Write-Info "检测到操作系统: Windows"
    
    # 检查 Git
    if (-not (Test-Command "git")) {
        Write-Error "未检测到 Git，请先安装 Git"
        Write-Info "下载地址: https://git-scm.com/download/win"
        exit 1
    }
    
    # 检查或安装 Node.js
    if (-not (Test-NodeJS)) {
        $installNode = Read-Host "`n? 是否自动安装 Node.js 20? [Y/n]"
        if ($installNode -ne "n" -and $installNode -ne "N") {
            Install-NodeJS
        } else {
            Write-Error "请先安装 Node.js >= 20.0.0: https://nodejs.org/"
            exit 1
        }
    }
    
    # 获取安装目录
    $installDir = Get-InstallDir
    
    # 克隆/更新仓库
    Get-Repository -InstallDir $installDir
    
    # 安装依赖
    Install-Dependencies
    
    # 编译项目
    Build-Project
    
    # 设置配置
    Set-Configuration
    
    # 全局链接
    Set-GlobalCommand
    
    # 配置向导
    Start-ConfigWizard
    
    # 完成
    Show-Completion -InstallDir $installDir
}

# 运行
Main
