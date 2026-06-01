#!/bin/bash

# SEO Content Generator 起動スクリプト
# すべてのサービスを一括起動

echo "🚀 SEO Content Generator を起動します..."
echo ""

# 既存のプロセスをクリーンアップ
echo "🧹 既存のプロセスをクリーンアップ中..."
pkill -f "vite" 2>/dev/null
pkill -f "scraping-server.js" 2>/dev/null
sleep 1

# Puppeteerサーバーを起動
echo "📡 Puppeteerサーバーを起動中..."
cd server && node scraping-server.js &
SERVER_PID=$!
echo "   PID: $SERVER_PID"

# 少し待つ
sleep 2

# Viteサーバーを起動
echo "⚡ Viteサーバーを起動中..."
cd .. && npm run dev &
VITE_PID=$!
echo "   PID: $VITE_PID"

echo ""
echo "✅ すべてのサービスが起動しました！"
echo ""
echo "📌 アクセスURL:"
echo "   - アプリ: http://localhost:5176/"
echo "   - Puppeteerサーバー: http://localhost:3010/"
echo ""
echo "🛑 終了するには: Ctrl+C を押してください"
echo ""

# Ctrl+Cで両方のプロセスを終了
trap "echo ''; echo '👋 サービスを停止中...'; kill $SERVER_PID $VITE_PID 2>/dev/null; exit" INT

# プロセスが終了するまで待機
wait
