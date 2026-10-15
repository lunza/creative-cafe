#!/usr/bin/env bash
# ============================================================
#  Creative Cafe - 快速启动脚本（macOS + Linux 统一版）
#  七步流水线：环境检测 → 运行时准备 → 镜像验证 → 依赖安装
#              → 目录初始化 → 端口检测 → 启动与成功验证
#  原则：零交互、零全局安装、零 root 依赖（便携运行时放 .runtime/）
# ============================================================
set -euo pipefail

cd "$(dirname "$0")"

# ================= 配置 =================
APP_NAME="Creative Cafe"
NODE_MIN_VERSION=22
PORTABLE_NODE_VERSION="v22.14.0"
VITE_PORT="${VITE_PORT:-5174}"
LAN_PORT=8787
NPM_MIRROR="https://registry.npmmirror.com"
NPM_OFFICIAL="https://registry.npmjs.org"
ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
NODE_MIRROR="https://npmmirror.com/mirrors/node/"
NODE_OFFICIAL="https://nodejs.org/dist/"
RUNTIME_DIR="$PWD/.runtime"
PORTABLE_NODE_DIR="$RUNTIME_DIR/node"

fail() {
  echo ""
  echo "  [失败] $1"
  echo "  排查指引:"
  echo "    1. 检查网络连接（国内网络请确认可访问 npmmirror.com）"
  echo "    2. 依赖问题: 重新运行本脚本（会自动重装）"
  echo "    3. 端口问题: 见上一步端口冲突检测"
  exit 1
}

echo "============================================================"
echo "  $APP_NAME - 快速启动脚本"
echo "============================================================"
echo ""

# ================= [1/7] 环境检测 =================
echo "[1/7] 环境检测..."
OS_NAME="$(uname -s)"
case "$OS_NAME" in
  Darwin) echo "  操作系统: macOS $(sw_vers -productVersion 2>/dev/null || echo 未知)" ;;
  Linux)
    echo "  操作系统: Linux"
    if [ -r /etc/os-release ]; then
      . /etc/os-release
      echo "  发行版: ${PRETTY_NAME:-未知}"
    fi
    for pm in apt dnf pacman; do
      if command -v "$pm" >/dev/null 2>&1; then
        echo "  包管理器: $pm [仅报告，安装走便携方案]"
      fi
    done
    ;;
  *) echo "  操作系统: $OS_NAME [未适配，尝试继续]" ;;
esac

NODE_VERSION="未检测到"
NODE_OK=false
if command -v node >/dev/null 2>&1; then
  NODE_VERSION="$(node --version)"
  NODE_MAJOR="${NODE_VERSION#v}"
  NODE_MAJOR="${NODE_MAJOR%%.*}"
  if [ "$NODE_MAJOR" -ge "$NODE_MIN_VERSION" ] 2>/dev/null; then NODE_OK=true; fi
fi
if [ "$NODE_OK" = true ]; then
  echo "  Node.js: $NODE_VERSION [OK]"
else
  echo "  Node.js: $NODE_VERSION [低于 v$NODE_MIN_VERSION 或未安装]"
fi
if command -v npm >/dev/null 2>&1; then
  echo "  npm: $(npm --version)"
else
  echo "  npm: 未检测到"
fi
if command -v python3 >/dev/null 2>&1; then
  echo "  Python: $(python3 --version 2>&1) [可选，非必需]"
elif command -v python >/dev/null 2>&1; then
  echo "  Python: $(python --version 2>&1) [可选，非必需]"
else
  echo "  Python: 未检测到 [可选，非必需]"
fi
if command -v java >/dev/null 2>&1; then
  echo "  Java: $(java -version 2>&1 | head -1) [可选，非必需]"
else
  echo "  Java: 未检测到 [可选，非必需]"
fi

# ================= [2/7] 运行时准备（便携 Node 自动安装） =================
echo ""
echo "[2/7] 运行时准备..."
if [ "$NODE_OK" = true ]; then
  echo "  Node.js 就绪: $NODE_VERSION"
else
  if [ -x "$PORTABLE_NODE_DIR/bin/node" ]; then
    echo "  [便携运行时] 复用已有 $PORTABLE_NODE_DIR"
  else
    # 平台与架构 → 官方发行包名
    case "$OS_NAME" in
      Darwin)
        case "$(uname -m)" in
          arm64)  NODE_TARGET="darwin-arm64" ;;
          x86_64) NODE_TARGET="darwin-x64" ;;
          *) fail "不支持的 macOS 架构: $(uname -m)" ;;
        esac ;;
      Linux)
        case "$(uname -m)" in
          x86_64)  NODE_TARGET="linux-x64" ;;
          aarch64) NODE_TARGET="linux-arm64" ;;
          *) fail "不支持的 Linux 架构: $(uname -m)" ;;
        esac ;;
      *) fail "未适配的操作系统: $OS_NAME" ;;
    esac
    NODE_PKG="node-${PORTABLE_NODE_VERSION}-${NODE_TARGET}.tar.xz"
    echo "  [自动安装] 从镜像下载 Node.js ${PORTABLE_NODE_VERSION} 便携版（${NODE_TARGET}）..."
    mkdir -p "$RUNTIME_DIR"
    DL_OK=false
    for URL in "$NODE_MIRROR$PORTABLE_NODE_VERSION/$NODE_PKG" "$NODE_OFFICIAL$PORTABLE_NODE_VERSION/$NODE_PKG"; do
      echo "  下载源: $URL"
      if curl -fL --retry 3 --retry-delay 2 --max-time 300 -o "$RUNTIME_DIR/$NODE_PKG" "$URL" >/dev/null 2>&1; then
        DL_OK=true
        break
      fi
      echo "  [镜像不可达] 切换下一下载源..."
    done
    [ "$DL_OK" = true ] || fail "Node.js 便携版自动下载失败。请手动下载解压到 $PORTABLE_NODE_DIR ：国内 $NODE_MIRROR$PORTABLE_NODE_VERSION/$NODE_PKG 或官方 https://nodejs.org/zh-cn/download"
    echo "  [解压] 解压到 .runtime/node ..."
    mkdir -p "$PORTABLE_NODE_DIR"
    tar -xJf "$RUNTIME_DIR/$NODE_PKG" -C "$PORTABLE_NODE_DIR" --strip-components 1
    rm -f "$RUNTIME_DIR/$NODE_PKG"
    [ -x "$PORTABLE_NODE_DIR/bin/node" ] || fail "解压未完成，请检查 .runtime 目录空间与权限"
  fi
  export PATH="$PORTABLE_NODE_DIR/bin:$PATH"
  echo "  [便携运行时] 已启用 $PORTABLE_NODE_DIR （$(node --version)）"
fi

# ================= [3/7] 镜像可用性验证 =================
echo ""
echo "[3/7] 镜像可用性验证..."
NPM_REGISTRY="$NPM_MIRROR"
if curl -sI --max-time 5 "$NPM_MIRROR" >/dev/null 2>&1; then
  echo "  npm 镜像: $NPM_REGISTRY [可用]"
else
  echo "  npm 镜像不可达，切换官方源..."
  NPM_REGISTRY="$NPM_OFFICIAL"
  echo "  npm 源: $NPM_REGISTRY [官方]"
fi
if curl -sI --max-time 5 "$ELECTRON_MIRROR" >/dev/null 2>&1; then
  echo "  Electron 镜像: $ELECTRON_MIRROR [可用]"
  export ELECTRON_MIRROR
else
  echo "  Electron 镜像不可达，回退官方 GitHub 下载..."
fi

# ================= [4/7] 依赖智能安装 =================
echo ""
echo "[4/7] 依赖检查与安装..."
if [ -f "node_modules/.package-lock.json" ]; then
  echo "  依赖: 已安装，跳过"
else
  echo "  [安装] npm ci 首次安装依赖（纯 JS 包，原生模块稍后单独处理）..."
  if ! npm ci --registry "$NPM_REGISTRY" --no-audit --no-fund --ignore-scripts; then
    echo "  [回退] npm ci 失败，自动改用 npm install 自修复..."
    npm install --registry "$NPM_REGISTRY" --no-audit --no-fund --ignore-scripts \
      || fail "依赖安装失败。可手动删除 node_modules 后重试本脚本，或手动设置镜像: npm config set registry $NPM_MIRROR"
  fi
  echo "  依赖安装完成"
fi

case "$OS_NAME" in
  Darwin) ELE_BIN="node_modules/electron/dist/Electron.app/Contents/MacOS/Electron" ;;
  *)      ELE_BIN="node_modules/electron/dist/electron" ;;
esac
if [ -x "$ELE_BIN" ]; then
  echo "  Electron 二进制: [OK]"
else
  echo "  [安装] Electron 二进制缺失，带镜像重装..."
  rm -rf node_modules/electron
  npm install electron --save-dev --registry "$NPM_REGISTRY" --no-audit --no-fund
  if [ -x "$ELE_BIN" ]; then
    echo "  Electron 二进制: [OK]"
  else
    echo "  [警告] Electron 二进制安装失败，应用窗口可能无法打开。"
    echo "         排查: 检查网络后执行 npm install electron（已设 ELECTRON_MIRROR=${ELECTRON_MIRROR:-官方源}）"
  fi
fi

if [ -f "node_modules/better-sqlite3/build/Release/better_sqlite3.node" ]; then
  echo "  better-sqlite3 原生模块: [OK]"
else
  echo "  [重建] better-sqlite3 原生模块缺失，执行 electron-rebuild..."
  npm run rebuild:native
  if [ -f "node_modules/better-sqlite3/build/Release/better_sqlite3.node" ]; then
    echo "  better-sqlite3 原生模块: [OK]"
  else
    echo "  [警告] 原生模块重建失败，向量数据库功能可能受限。可稍后手动执行: npm run rebuild:native"
  fi
fi

# ================= [5/7] 目录初始化 =================
echo ""
echo "[5/7] 目录初始化（六区 + 便携运行时）..."
for d in appData appData/data database models data logs tmp .runtime; do
  if [ ! -d "$d" ]; then
    mkdir -p "$d"
    echo "  创建 $d"
  fi
done
echo "  目录初始化完成（已存在目录自动跳过）"

# ================= [6/7] 端口冲突检测 =================
echo ""
echo "[6/7] 端口冲突检测..."
port_pid() {
  # 优先 lsof，回退 ss
  if command -v lsof >/dev/null 2>&1; then
    lsof -ti TCP:"$1" -sTCP:LISTEN 2>/dev/null | head -1
  elif command -v ss >/dev/null 2>&1; then
    ss -tlnp 2>/dev/null | grep ":$1 " | grep -o 'pid=[0-9]*' | head -1 | cut -d= -f2
  fi
  return 0
}
PORT_BUSY=false
PID_VITE="$(port_pid "$VITE_PORT" || true)"
PID_LAN="$(port_pid "$LAN_PORT" || true)"
if [ -n "$PID_VITE" ]; then PORT_BUSY=true; fi
if [ -n "$PID_LAN" ]; then PORT_BUSY=true; fi
if [ "$PORT_BUSY" = true ]; then
  echo "  [冲突] 端口被占用:"
  if [ -n "$PID_VITE" ]; then echo "    端口 $VITE_PORT（vite 开发服务器）被 PID $PID_VITE 占用"; fi
  if [ -n "$PID_LAN" ]; then echo "    端口 $LAN_PORT（LAN API）被 PID $PID_LAN 占用"; fi
  echo ""
  echo "  处置指引（二选一）:"
  echo "    1. 结束占用进程: kill -9 对应PID"
  echo "    2. 换端口启动: 修改 vite.config.ts 的 server.port 后重试"
  exit 1
fi
echo "  端口 $VITE_PORT / $LAN_PORT 均可用 [OK]"

# ================= [7/7] 启动与成功验证 =================
echo ""
echo "[7/7] 启动 $APP_NAME ..."
echo "============================================================"
npm run dev >/dev/null 2>&1 &
DEV_PID=$!
ok=false
for i in $(seq 1 30); do
  sleep 2
  if curl -s -o /dev/null --max-time 2 "http://localhost:$VITE_PORT/"; then
    ok=true
    break
  fi
  kill -0 "$DEV_PID" 2>/dev/null || break
done
if [ "$ok" = true ]; then
  echo "============================================================"
  echo "  [成功] $APP_NAME 已启动"
  echo "  开发服务器: http://localhost:$VITE_PORT"
  echo "  LAN API:    http://localhost:$LAN_PORT"
  echo "  Electron 窗口即将自动打开（后台进程 PID $DEV_PID，Ctrl+C 退出本脚本不会关闭服务）"
  echo "============================================================"
  exit 0
else
  fail "60 秒内开发服务器未监听端口 $VITE_PORT，且启动进程已退出。请检查上方报错（可手动执行 npm run dev 查看完整输出）"
fi
