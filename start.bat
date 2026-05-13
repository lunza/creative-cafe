@echo off
chcp 65001 >nul
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
    call npm install --no-audit --no-fund
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
    echo.
    echo [WARN] Vite not found, installing...
    call npm install vite --save-dev --no-audit --no-fund
    if %errorlevel% neq 0 (
        echo [ERROR] Vite installation failed
        echo Try running: npm install
        pause
        exit /b 1
    )
    echo [OK] Vite: installed
) else (
    echo [OK] Vite: installed
)

rem Check Electron
set "ELECTRON_OK=false"
if exist "node_modules\electron\dist\electron.exe" set "ELECTRON_OK=true"
if exist "node_modules\electron\dist\Electron.app" set "ELECTRON_OK=true"
if exist "node_modules\electron\dist\electron" set "ELECTRON_OK=true"

if "%ELECTRON_OK%"=="false" (
    echo.
    echo [ERROR] Electron not installed correctly
    echo Reinstalling Electron...
    echo.
    if exist "node_modules\electron" rmdir /s /q "node_modules\electron"
    call npm install electron --save-dev --no-audit --no-fund
    if %errorlevel% neq 0 (
        echo [ERROR] Electron installation failed
        echo Try running: npm install electron --force
        pause
        exit /b 1
    )
    rem Verify again
    if exist "node_modules\electron\dist\electron.exe" (
        echo [OK] Electron: installed
    ) else (
        echo [ERROR] Electron installation still failed
        echo Try: Delete node_modules and run npm install
        pause
        exit /b 1
    )
) else (
    echo [OK] Electron: installed
)

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
