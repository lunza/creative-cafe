@echo off
set "SCRIPT_DIR=%~dp0"
cd /d "%SCRIPT_DIR%"

echo ============================================================
echo   Creative Cafe - Startup
echo ============================================================
echo.

rem Check Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js not found
    echo Please install from: https://nodejs.org/
    pause
    exit /b 1
)
for /f "tokens=*" %%i in ('node --version 2^>nul') do set "NODE_VERSION=%%i"
echo [OK] Node.js: %NODE_VERSION%

rem Check npm
where npm >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] npm not found
    pause
    exit /b 1
)
for /f "tokens=*" %%i in ('npm --version 2^>nul') do set "NPM_VERSION=%%i"
echo [OK] npm: %NPM_VERSION%

rem Check dependencies
if not exist "node_modules" (
    echo.
    echo Installing dependencies...
    call npm install
    if %errorlevel% neq 0 (
        echo [ERROR] Installation failed
        pause
        exit /b 1
    )
    echo [DONE] Dependencies installed
) else (
    echo [OK] Dependencies: installed
)

rem Check Vite
if not exist "node_modules\vite" (
    echo [ERROR] Vite not installed
    pause
    exit /b 1
)
echo [OK] Vite: installed

rem Check Electron
if not exist "node_modules\electron" (
    echo [ERROR] Electron not installed
    pause
    exit /b 1
)
echo [OK] Electron: installed

rem Check vector deps
if exist "node_modules\@xenova\transformers" (
    echo [OK] @xenova/transformers: installed
) else (
    echo [WARN] @xenova/transformers: not installed
)

if exist "node_modules\lru-cache" (
    echo [OK] lru-cache: installed
) else (
    echo [WARN] lru-cache: not installed
)

rem Start app
echo.
echo Starting Creative Cafe...
echo Press Ctrl+C to stop
echo.

call npm run dev

echo.
pause