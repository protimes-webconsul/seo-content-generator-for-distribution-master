# 🚀 クイックスタートガイド

## 起動方法

### 方法1: シェルスクリプト（推奨）
```bash
./start.sh
```
これだけで全サービスが起動します！

### 方法2: npm script
```bash
npm start
```

### 方法3: 個別起動
```bash
# ターミナル1
cd server && node scraping-server.js

# ターミナル2
npm run dev
```

## 📌 アクセスURL

- **アプリ**: http://localhost:5176/
- **Puppeteerサーバー**: http://localhost:3010/

## 🛠 トラブルシューティング

### ポートが既に使用されている場合
```bash
# プロセスを確認
lsof -i :5176
lsof -i :3010

# プロセスを終了
pkill -f vite
pkill -f scraping-server.js
```

### 起動しない場合
```bash
# 依存関係をインストール
npm install
cd server && npm install
```

## 📝 必要な環境変数（.env）

```env
VITE_GEMINI_API_KEY=your_key_here
VITE_GOOGLE_API_KEY=your_key_here
VITE_GOOGLE_SEARCH_ENGINE_ID=your_id_here
```

## 🔧 開発のヒント

- `start.sh`を使えば一発で全サービスが起動
- Ctrl+Cで全サービスを一括停止
- サーバーは自動的に古いプロセスをクリーンアップ