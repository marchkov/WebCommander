#!/bin/bash

# DockCommander Start Script

echo "🚀 Starting DockCommander..."
echo ""

# Check if node is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js 18+ first."
    exit 1
fi

# Check if dependencies are installed
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm install
fi

# Build frontend if not exists
if [ ! -d "dist" ]; then
    echo "🔨 Building frontend..."
    npm run build
fi

# Start server
echo ""
echo "✅ Starting server..."
echo "📂 Check config.json for settings"
echo "🌐 Open http://localhost:3001 in your browser"
echo ""

NODE_ENV=production node server/index.js
