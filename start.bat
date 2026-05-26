@echo off
chcp 65001 >nul

set "SCRIPT_DIR=%~dp0"
cd /d "%SCRIPT_DIR%"

set "APP_NAME=Creative Cafe"
set "APP_VERSION=1.0.1"
set "NODE_MIN_VERSION=18"
set "NPM_REGISTRY=https://registry.npmmirror.com"
set "MAX_RETRIES=3"
set "RETRY_DELAY=3"

set "LOGS_DIR=%SCRIPT_DIR%logs"
set "LOG_FILE=%LOGS_DIR%\install.log"
set "APPDATA_DIR=%APPDATA%\%APP_NAME%"

if not exist "%LOGS_DIR%" mkdir "%LOGS_DIR%" 2>nul

echo ============================================================
echo   %APP_NAME% v%APP_VERSION% - Startup Script
echo ============================================================
echo.

echo [DEBUG] SCRIPT_DIR=%SCRIPT_DIR%
echo [DEBUG] LOG_FILE=%LOG_FILE%
echo [DEBUG] APPDATA_DIR=%APPDATA_DIR%
echo [DEBUG] CD=%CD%
echo.

echo [1/7] Checking Node.js environment...

where node >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Node.js not found in PATH
    echo.
    echo Please install Node.js from https://nodejs.org/
    echo.
    pause
    exit /b 1
)

for /f "tokens=*" %%i in ('node --version') do set "NODE_VERSION=%%i"
echo [OK] Node.js: %NODE_VERSION%

where npm >nul 2>nul
if errorlevel 1 (
    echo [ERROR] npm not found
    pause
    exit /b 1
)

for /f "tokens=*" %%i in ('npm --version') do set "NPM_VERSION=%%i"
echo [OK] npm: %NPM_VERSION%

echo.
echo [2/7] Configuring npm registry (China mirror)...

call npm config set registry %NPM_REGISTRY%
if errorlevel 1 (
    echo [WARN] Failed to set registry globally
    set "NPM_FLAGS=--registry %NPM_REGISTRY%"
) else (
    set "NPM_FLAGS="
)

for /f "tokens=*" %%i in ('npm config get registry') do set "CURRENT_REGISTRY=%%i"
echo [OK] Registry configured: %CURRENT_REGISTRY%

echo.
echo [3/7] Checking and installing dependencies...

if not exist "node_modules" (
    echo Installing dependencies...
    call npm install %NPM_FLAGS% --no-audit --no-fund --progress=true
    if errorlevel 1 (
        echo [ERROR] Installation failed
        echo Please check network connection and try again.
        pause
        exit /b 1
    )
    echo [OK] Dependencies installed
) else (
    echo [OK] Dependencies: already installed
)

echo.

:deps_installed

echo.
echo [4/7] Checking Vite...
if exist "node_modules\vite" (
    echo [OK] Vite: installed
) else (
    echo [INSTALL] Vite not found, installing...
    call npm install vite --save-dev %NPM_FLAGS% --no-audit --no-fund
    if exist "node_modules\vite" (
        echo [OK] Vite: installed
    ) else (
        echo [ERROR] Vite installation failed
        pause
        exit /b 1
    )
)

echo.
echo [5/7] Checking Electron...
set "ELECTRON_OK=false"
if exist "node_modules\electron\dist\electron.exe" set "ELECTRON_OK=true"

if "%ELECTRON_OK%"=="false" (
    echo [WARN] Electron not installed correctly, reinstalling...
    if exist "node_modules\electron" rmdir /s /q "node_modules\electron" 2>nul
    call npm install electron --save-dev %NPM_FLAGS% --no-audit --no-fund
    if exist "node_modules\electron\dist\electron.exe" (
        echo [OK] Electron: installed
    ) else (
        echo [ERROR] Electron installation failed
        pause
        exit /b 1
    )
) else (
    echo [OK] Electron: installed
)

if exist "node_modules\@xenova\transformers" (
    echo [OK] @xenova/transformers: installed
) else (
    echo [WARN] @xenova/transformers: not installed (optional)
)

if exist "node_modules\lru-cache" (
    echo [OK] lru-cache: installed
) else (
    echo [WARN] lru-cache: not installed (optional)
)

echo.
echo [6/7] Initializing project directories...

if not exist "%APPDATA_DIR%" (
    mkdir "%APPDATA_DIR%" 2>nul
    echo [OK] AppData directory created
) else (
    echo [OK] AppData directory exists
)

set "APPDATA_DATA_DIR=%APPDATA_DIR%\data"
if not exist "%APPDATA_DATA_DIR%" mkdir "%APPDATA_DATA_DIR%" 2>nul
set "APPDATA_CACHE_DIR=%APPDATA_DIR%\cache"
if not exist "%APPDATA_CACHE_DIR%" mkdir "%APPDATA_CACHE_DIR%" 2>nul
echo [OK] Project initialization complete

echo.
echo [7/7] Starting %APP_NAME%...
echo ============================================================
echo   %APP_NAME% is starting...
echo ============================================================
echo.

call npm run dev

echo.
echo Done.
pause
pause
exit /b %errorlevel%
