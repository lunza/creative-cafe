#!/bin/bash

# TravenManager project starter for macOS

# Change to script directory
cd "$(dirname "$0")"

echo "************************************"
echo "TravenManager project starter"
echo "************************************"
echo ""

# Check Node.js installation
echo "Checking Node.js environment..."
if command -v node &> /dev/null; then
    nodeVersion=$(node --version)
    echo "Node.js installed: $nodeVersion"
else
    echo "Error: Node.js not found, please install Node.js first"
    echo "Please visit https://nodejs.org/ to download and install"
    read -p "Press Enter to exit..."
    exit 1
fi

# Check npm availability
echo "Checking npm environment..."
if command -v npm &> /dev/null; then
    npmVersion=$(npm --version)
    echo "npm available: $npmVersion"
else
    echo "Error: npm not available"
    read -p "Press Enter to exit..."
    exit 1
fi

# 直接启动开发服务器（跳过electron安装）
echo ""
echo "Checking vector system dependencies..."

# 检查 @xenova/transformers
if [ -d "node_modules/@xenova/transformers" ]; then
    echo "[OK] @xenova/transformers: installed"
else
    echo "[WARN] @xenova/transformers: not installed"
    echo "[INFO] Run 'npm install' to enable local embedding"
fi

# 检查 lru-cache
if [ -d "node_modules/lru-cache" ]; then
    echo "[OK] lru-cache: installed"
else
    echo "[WARN] lru-cache: not installed"
    echo "[INFO] Vector cache functionality may be limited"
fi

echo ""
echo "Starting development server..."
# 使用5174端口启动开发服务器
if npm run dev -- --port 5174; then
    echo "Server started successfully"
else
    echo "Failed to start server, trying to install dependencies..."
    # 尝试安装依赖
    if npm install --legacy-peer-deps --ignore-scripts; then
        echo "Dependencies installed successfully, restarting server..."
        # 使用5174端口启动开发服务器
        if npm run dev -- --port 5174; then
            echo "Server started successfully"
        else
            echo "Failed to start server"
            read -p "Press Enter to exit..."
            exit 1
        fi
    else
        echo "Failed to install dependencies"
        read -p "Press Enter to exit..."
        exit 1
    fi
fi

read -p "Press Enter to exit..."
