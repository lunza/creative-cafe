@echo off
setlocal enabledelayedexpansion

set "SCRIPT_DIR=%~dp0"
cd /d "%SCRIPT_DIR%"

rem ================= 配置 =================
set "APP_NAME=Creative Cafe"
set "NODE_MIN_VERSION=22"
set "PORTABLE_NODE_VERSION=v22.14.0"
set "VITE_PORT=5174"
set "LAN_PORT=8787"
set "NPM_MIRROR=https://registry.npmmirror.com"
set "NPM_OFFICIAL=https://registry.npmjs.org"
set "ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/"
set "NODE_MIRROR=https://npmmirror.com/mirrors/node/"
set "NODE_OFFICIAL=https://nodejs.org/dist/"
set "RUNTIME_DIR=%SCRIPT_DIR%.runtime"
set "NODE_EXTRACT_DIR=node-v%PORTABLE_NODE_VERSION:~1%-win-x64"
set "NODE_ZIP_NAME=node-v%PORTABLE_NODE_VERSION:~1%-win-x64.zip"
set "PORTABLE_NODE_DIR=%RUNTIME_DIR%\node"

echo ============================================================
echo   %APP_NAME% - 快速启动脚本
echo ============================================================
echo.

rem ================= [1/7] 环境检测 =================
echo [1/7] 环境检测...
for /f "tokens=6 delims=[]" %%v in ('ver') do set "OS_VERSION=%%v"
echo   操作系统: %OS_VERSION%

set "NODE_MAJOR=0"
set "NODE_OK=false"
set "NODE_VERSION=未检测到"
where node >nul 2>nul
if %errorlevel% equ 0 for /f "tokens=*" %%i in ('node --version') do (
    set "NODE_VERSION=%%i"
    for /f "tokens=1 delims=v." %%n in ("%%i") do set "NODE_MAJOR=%%n"
)
if %NODE_MAJOR% GEQ %NODE_MIN_VERSION% set "NODE_OK=true"
if "%NODE_OK%"=="true" (echo   Node.js: %NODE_VERSION% [OK]) else (echo   Node.js: %NODE_VERSION% [低于 v%NODE_MIN_VERSION% 或未安装])

set "NPM_VERSION=未检测到"
where npm >nul 2>nul && for /f "tokens=*" %%i in ('npm --version') do set "NPM_VERSION=%%i"
echo   npm: %NPM_VERSION%

set "PYTHON_VER="
where python >nul 2>nul && for /f "tokens=*" %%i in ('python --version 2^>^&1') do set "PYTHON_VER=%%i"
if defined PYTHON_VER (echo   Python: %PYTHON_VER% [可选，非必需]) else (echo   Python: 未检测到 [可选，非必需])

set "JAVA_VER="
where java >nul 2>nul && for /f "tokens=3" %%i in ('java -version 2^>^&1') do if not defined JAVA_VER set "JAVA_VER=%%i"
if defined JAVA_VER (echo   Java: !JAVA_VER! [可选，非必需]) else (echo   Java: 未检测到 [可选，非必需])

rem ================= [2/7] 运行时准备（便携 Node 自动安装） =================
echo.
echo [2/7] 运行时准备...
if "%NODE_OK%"=="true" goto :node_ready
if exist "%PORTABLE_NODE_DIR%\node.exe" goto :use_portable
echo   [自动安装] 从镜像下载 Node.js %PORTABLE_NODE_VERSION% 便携版...
set "NODE_URL=%NODE_MIRROR%%PORTABLE_NODE_VERSION%\%NODE_ZIP_NAME%"
if not exist "%RUNTIME_DIR%" mkdir "%RUNTIME_DIR%"
set "DL_OK=false"
powershell -NoProfile -Command "Invoke-WebRequest -Uri '%NODE_URL%' -OutFile '%RUNTIME_DIR%\%NODE_ZIP_NAME%'" >nul 2>nul
if !errorlevel! equ 0 set "DL_OK=true"
if "!DL_OK!"=="false" (
    echo   [镜像不可达] 切换官方源 nodejs.org 重试...
    set "NODE_URL=%NODE_OFFICIAL%%PORTABLE_NODE_VERSION%\%NODE_ZIP_NAME%"
    powershell -NoProfile -Command "Invoke-WebRequest -Uri '%NODE_URL%' -OutFile '%RUNTIME_DIR%\%NODE_ZIP_NAME%'" >nul 2>nul
    if !errorlevel! equ 0 set "DL_OK=true"
)
if "!DL_OK!"=="false" (
    echo.
    echo   [失败] Node.js 便携版自动下载失败。请手动下载后解压到 %PORTABLE_NODE_DIR% ：
    echo     国内: %NODE_MIRROR%%PORTABLE_NODE_VERSION%\%NODE_ZIP_NAME%
    echo     官方: %NODE_OFFICIAL%%PORTABLE_NODE_VERSION%\%NODE_ZIP_NAME%
    echo   或访问 https://nodejs.org/zh-cn/download 安装 Node.js v%NODE_MIN_VERSION%+
    pause
    exit /b 1
)
echo   [解压] 解压到 .runtime\node ...
tar -xf "%RUNTIME_DIR%\%NODE_ZIP_NAME%" -C "%RUNTIME_DIR%" >nul 2>nul
if not exist "%RUNTIME_DIR%\%NODE_EXTRACT_DIR%\node.exe" (
    echo   [失败] 解压未完成，请检查 .runtime 目录空间与权限
    pause
    exit /b 1
)
if exist "%PORTABLE_NODE_DIR%" rmdir /s /q "%PORTABLE_NODE_DIR%" 2>nul
ren "%RUNTIME_DIR%\%NODE_EXTRACT_DIR%" "node"
del /q "%RUNTIME_DIR%\%NODE_ZIP_NAME%" 2>nul
:use_portable
set "PATH=%PORTABLE_NODE_DIR%;%PATH%"
for /f "tokens=*" %%i in ('node --version') do set "NODE_VERSION=%%i"
echo   [便携运行时] 已启用 %PORTABLE_NODE_DIR% （%NODE_VERSION%）
:node_ready
echo   Node.js 就绪: %NODE_VERSION%

rem ================= [3/7] 镜像可用性验证 =================
echo.
echo [3/7] 镜像可用性验证...
set "NPM_REGISTRY=%NPM_MIRROR%"
set "REG_OK=false"
where curl >nul 2>nul && curl -sI --max-time 5 %NPM_MIRROR% >nul 2>nul && set "REG_OK=true"
if "%REG_OK%"=="true" (
    echo   npm 镜像: %NPM_REGISTRY% [可用]
) else (
    echo   npm 镜像不可达，切换官方源...
    set "NPM_REGISTRY=%NPM_OFFICIAL%"
    echo   npm 源: %NPM_REGISTRY% [官方]
)
set "ELECTRON_MIRROR_ENV=%ELECTRON_MIRROR%"
set "ELE_OK=false"
where curl >nul 2>nul && curl -sI --max-time 5 %ELECTRON_MIRROR% >nul 2>nul && set "ELE_OK=true"
if "%ELE_OK%"=="true" (
    echo   Electron 镜像: %ELECTRON_MIRROR% [可用]
) else (
    echo   Electron 镜像不可达，回退官方 GitHub 下载...
    set "ELECTRON_MIRROR_ENV="
)
set "ELECTRON_MIRROR=%ELECTRON_MIRROR_ENV%"

rem ================= [4/7] 依赖智能安装 =================
echo.
echo [4/7] 依赖检查与安装...
set "DEPS_OK=false"
if exist "node_modules\.package-lock.json" set "DEPS_OK=true"
if "%DEPS_OK%"=="true" goto :deps_done
echo   [安装] npm ci 首次安装依赖（纯 JS 包，原生模块稍后单独处理）...
call npm ci --registry %NPM_REGISTRY% --no-audit --no-fund --ignore-scripts
if not errorlevel 1 goto :deps_done
echo   [回退] npm ci 失败，自动改用 npm install 自修复...
call npm install --registry %NPM_REGISTRY% --no-audit --no-fund --ignore-scripts
if not errorlevel 1 goto :deps_done
echo.
echo   [失败] 依赖安装失败。排查指引:
echo     1. 检查网络连接，或手动设置镜像: npm config set registry %NPM_MIRROR%
echo     2. 删除 node_modules 目录后重新运行本脚本
echo     3. 确认已用国内网络，或手动执行 npm install --ignore-scripts 后重跑本脚本
pause
exit /b 1
:deps_done
echo   依赖就绪

if exist "node_modules\electron\dist\electron.exe" (
    echo   Electron 二进制: [OK]
) else (
    echo   [安装] Electron 二进制缺失，带镜像重装...
    if exist "node_modules\electron" rmdir /s /q "node_modules\electron" 2>nul
    call npm install electron --save-dev --registry %NPM_REGISTRY% --no-audit --no-fund
    if exist "node_modules\electron\dist\electron.exe" (
        echo   Electron 二进制: [OK]
    ) else (
        echo   [警告] Electron 二进制安装失败，应用窗口可能无法打开。
        echo          排查: 检查网络后执行 npm install electron（已设 ELECTRON_MIRROR=%ELECTRON_MIRROR%）
    )
)

if exist "node_modules\better-sqlite3\build\Release\better_sqlite3.node" goto :bsql_ok
echo   [预编译] 部署仓库内置预编译二进制（无需 VS / 无需管理员）...
if exist "package\native-prebuilds\better-sqlite3-v11.10.0-electron-v130-win32-x64.tar.gz" tar -xzf "package\native-prebuilds\better-sqlite3-v11.10.0-electron-v130-win32-x64.tar.gz" -C "node_modules\better-sqlite3" >nul 2>nul
if exist "node_modules\better-sqlite3\build\Release\better_sqlite3.node" goto :bsql_ok
echo   [编译] 预编译包不适用（依赖版本可能已变更），执行 electron-rebuild...
call npm run rebuild:native
if exist "node_modules\better-sqlite3\build\Release\better_sqlite3.node" goto :bsql_ok
echo   [警告] 原生模块不可用，向量数据库功能受限。解决方案:
echo     安装 Visual Studio Build Tools 的 C++ 工作负载后重新运行本脚本，
echo     或手动执行: npm run rebuild:native
goto :bsql_end
:bsql_ok
echo   better-sqlite3 原生模块: [OK]
:bsql_end

rem ================= [5/7] 目录初始化 =================
echo.
echo [5/7] 目录初始化（六区 + 便携运行时）...
for %%d in (appData appData\data database models data logs tmp .runtime) do (
    if not exist "%%d" (
        mkdir "%%d" 2>nul
        echo   创建 %%d
    )
)
echo   目录初始化完成（已存在目录自动跳过）

rem ================= [6/7] 端口冲突检测 =================
echo.
echo [6/7] 端口冲突检测...
set "PORT_BUSY=false"
set "PID_VITE="
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":%VITE_PORT% " ^| findstr "LISTENING"') do set "PID_VITE=%%p"
if defined PID_VITE set "PORT_BUSY=true"
set "PID_LAN="
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":%LAN_PORT% " ^| findstr "LISTENING"') do set "PID_LAN=%%p"
if defined PID_LAN set "PORT_BUSY=true"
if "%PORT_BUSY%"=="false" goto :ports_free
echo   [冲突] 端口被占用:
if defined PID_VITE echo     端口 %VITE_PORT%（vite 开发服务器）被 PID !PID_VITE! 占用
if defined PID_LAN echo     端口 %LAN_PORT%（LAN API）被 PID !PID_LAN! 占用
echo.
echo   处置指引（二选一）:
echo     1. 结束占用进程: taskkill /F /PID 对应PID
echo     2. 换端口启动: 修改 vite.config.ts 的 server.port 后重试
pause
exit /b 1
:ports_free
echo   端口 %VITE_PORT% / %LAN_PORT% 均可用 [OK]

rem ================= [7/7] 启动与成功验证 =================
echo.
echo [7/7] 启动 %APP_NAME% ...
echo ============================================================
start "Creative-Cafe-Dev" cmd /c "npm run dev <nul"
set /a TRY=0
:poll_port
timeout /t 2 /nobreak >nul
netstat -ano | findstr ":%VITE_PORT% " | findstr "LISTENING" >nul
if %errorlevel% equ 0 goto :start_ok
set /a TRY+=1
if %TRY% LSS 30 goto :poll_port
echo.
echo   [失败] 60 秒内开发服务器未监听端口 %VITE_PORT%。
echo   排查指引:
echo     1. 查看上方弹出的 Creative-Cafe-Dev 窗口中的报错信息
echo     2. 依赖问题: 重新运行本脚本（会自动重装）
echo     3. 端口问题: 见上一步端口冲突检测
pause
exit /b 1
:start_ok
echo ============================================================
echo   [成功] %APP_NAME% 已启动
echo   开发服务器: http://localhost:%VITE_PORT%
echo   LAN API:    http://localhost:%LAN_PORT%
echo   Electron 窗口即将自动打开
echo ============================================================
endlocal
exit /b 0
