@echo off
setlocal
cd /d "%~dp0"
echo.
echo   Starting WebCommander...
echo.

REM Check if node is installed
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo   Node.js is not installed. Please install Node.js 18+ first.
    pause
    exit /b 1
)

REM Check if dependencies are installed
if not exist "node_modules" (
    echo   Installing dependencies...
    call npm install
    if errorlevel 1 exit /b 1
)

REM Build frontend if not exists
if not exist "dist" (
    echo   Building frontend...
    call npm run build
    if errorlevel 1 exit /b 1
)

echo.
echo   Starting server...
echo   Check config.json for settings
echo   Open http://localhost:3001 in your browser
echo.

REM Local launch uses development defaults; production validation remains explicit.
if not defined NODE_ENV set "NODE_ENV=development"
if /i "%~1"=="production" set "NODE_ENV=production"
if not defined WC_HOST set "WC_HOST=127.0.0.1"
set "WC_SERVE_STATIC=true"
echo  Mode: %NODE_ENV% / Bind address: %WC_HOST%
node server/index.js
pause
