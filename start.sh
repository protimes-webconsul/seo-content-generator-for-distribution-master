#!/bin/bash

# SEO Content Generator 起動スクリプト
# PC再起動後にこのスクリプトを実行すると、全てのサーバーが起動します

echo "🚀 SEO Content Generator を起動します..."

# 既存のプロセスを確認
echo "📍 既存のプロセスを確認中..."
lsof -i :5176 > /dev/null 2>&1
if [ $? -eq 0 ]; then
    echo "⚠️  ポート5176が使用中です。既存のプロセスを終了します..."
    kill $(lsof -t -i:5176) 2>/dev/null
    sleep 2
fi

lsof -i :3010 > /dev/null 2>&1
if [ $? -eq 0 ]; then
    echo "⚠️  ポート3010が使用中です。既存のプロセスを終了します..."
    kill $(lsof -t -i:3010) 2>/dev/null
    sleep 2
fi

lsof -i :5177 > /dev/null 2>&1
if [ $? -eq 0 ]; then
    echo "⚠️  ポート5177が使用中です。既存のプロセスを終了します..."
    kill $(lsof -t -i:5177) 2>/dev/null
    sleep 2
fi

# スクレイピングサーバーを起動（SearchAPI + Puppeteer統合）
echo "🔍 スクレイピングサーバー（SearchAPI + Puppeteer）を起動中..."
node server/scraping-server.js &
SCRAPING_PID=$!
sleep 3

# メインアプリケーションを起動
echo "🌐 メインアプリケーションを起動中..."
npm run dev &
APP_PID=$!

# 画像生成エージェントを起動
echo "🎨 画像生成エージェントを起動中..."
cd ai-article-imager-for-wordpress && npm run dev &
IMAGE_PID=$!
cd ..

# 起動完了メッセージ
echo ""
echo "✅ 起動完了！"
echo "📍 メインアプリ: http://localhost:5176"
echo "📍 スクレイピングサーバー: http://localhost:3010"
echo "📍 画像生成エージェント: http://localhost:5177"
echo "   - Google Search API: /api/google-search"
echo "   - Puppeteer Scraping: /api/scrape"
echo ""
echo "終了するには Ctrl+C を押してください"
echo ""

# 終了処理を設定
trap "echo ''; echo '⏹️  シャットダウン中...'; kill $SCRAPING_PID $APP_PID $IMAGE_PID 2>/dev/null; exit" INT

# プロセスの監視
wait $APP_PID $SCRAPING_PID $IMAGE_PID