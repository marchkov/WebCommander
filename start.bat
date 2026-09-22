@echo off
echo.
echo  🚀 Starting WebCommander...
echo.

REM Check if node is installed
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo  ❌ Node.js is not installed. Please install Node.js 18+ first.
    pause
    exit /b 1
)

REM Check if dependencies are installed
if not exist "node_modules" (
    echo  📦 Installing dependencies...
    call npm install
)

REM Build frontend if not exists
if not exist "dist" (
    echo  🔨 Building frontend...
    call npm run build
)

echo.
echo  ✅ Starting server...
echo  📂 Check config.json for settings
echo  🌐 Open http://localhost:3001 in your browser
echo.

set NODE_ENV=production
node server/index.js
pause
