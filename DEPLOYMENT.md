# 🚀 デプロイガイド

このドキュメントは、SEOコンテンツ生成ツールを社内で安全にデプロイするためのガイドです。

## ⚠️ デプロイ前の必須チェックリスト

以下の項目を**すべて**完了してからデプロイしてください：

- [ ] `INTERNAL_API_KEY`を生成して`.env`に設定した
- [ ] 本番環境のドメインを`.env`の`PRODUCTION_DOMAIN`に設定した
- [ ] 全てのAPIキーが環境変数に設定されている
- [ ] `.env`ファイルがGitにコミットされていないことを確認した
- [ ] `NODE_ENV=production`を設定した
- [ ] HTTPS通信が有効になっている
- [ ] ファイアウォールで3010ポートへのアクセスを制限した

## 📋 セットアップ手順

### 1. INTERNAL_API_KEYの生成

APIを保護するための認証キーを生成します：

```bash
# ランダムなAPIキーを生成
openssl rand -hex 32
```

生成されたキーを`.env`ファイルに追加：

```bash
INTERNAL_API_KEY=生成されたキー
```

### 2. 環境変数の設定

`.env.example`をコピーして`.env`を作成し、以下を設定：

```bash
# 必須項目
GEMINI_API_KEY=your_actual_gemini_api_key
INTERNAL_API_KEY=your_generated_random_key
PRODUCTION_DOMAIN=https://your-production-domain.com
NODE_ENV=production

# オプション項目
GOOGLE_API_KEY=your_google_api_key
OPENAI_API_KEY=your_openai_api_key
VITE_SLACK_WEBHOOK_URL=your_slack_webhook
```

### 3. 依存関係のインストール

```bash
# メインアプリ
npm install

# サーバー
cd server
npm install
cd ..
```

### 4. ビルド

```bash
# フロントエンドのビルド
npm run build
```

### 5. サーバー起動

```bash
# サーバーをバックグラウンドで起動
cd server
NODE_ENV=production node scraping-server.js &
```

### 6. フロントエンドの配信

ビルドされた`dist`フォルダをWebサーバー（Nginx、Apache等）で配信します。

## 🔧 Nginx設定例

```nginx
server {
    listen 443 ssl http2;
    server_name your-domain.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    # フロントエンド
    location / {
        root /path/to/dist;
        try_files $uri $uri/ /index.html;
    }

    # APIサーバーへのプロキシ
    location /api/ {
        proxy_pass http://localhost:3010;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

## 🔐 セキュリティ設定

### 1. ファイアウォール設定

```bash
# ポート3010への外部アクセスをブロック
sudo ufw deny 3010

# HTTPSのみ許可
sudo ufw allow 443/tcp

# SSH（管理用）
sudo ufw allow 22/tcp

# ファイアウォールを有効化
sudo ufw enable
```

### 2. プロセス管理（PM2推奨）

```bash
# PM2をインストール
npm install -g pm2

# サーバーをPM2で起動
cd server
pm2 start scraping-server.js --name seo-api

# 自動起動設定
pm2 startup
pm2 save
```

### 3. ログ管理

```bash
# PM2のログを確認
pm2 logs seo-api

# ログローテーション設定
pm2 install pm2-logrotate
```

## 🌐 フロントエンドの設定

フロントエンドからAPIを呼び出す際、`x-api-key`ヘッダーを送信する必要があります。

### サービスファイルの修正例

各サービスファイル（`slackNotificationService.ts`等）で以下のように修正：

```typescript
const response = await fetch('http://localhost:3010/api/slack-notify', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-api-key': import.meta.env.VITE_INTERNAL_API_KEY // 環境変数から取得
  },
  body: JSON.stringify({ message }),
});
```

**注意**: `VITE_INTERNAL_API_KEY`は`.env`に追加し、フロントエンドからサーバーに認証情報を送信します。

## 🧪 デプロイ後の動作確認

### 1. ヘルスチェック

```bash
curl https://your-domain.com/api/health
```

期待される応答：
```json
{
  "status": "ok",
  "message": "スクレイピングサーバーは正常に動作しています"
}
```

### 2. 認証のテスト

```bash
# 認証なしでリクエスト（401エラーになるはず）
curl -X POST https://your-domain.com/api/scrape \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com"}'

# 期待される応答: {"error":"Unauthorized"}
```

```bash
# 認証ありでリクエスト（成功するはず）
curl -X POST https://your-domain.com/api/scrape \
  -H "Content-Type: application/json" \
  -H "x-api-key: your_internal_api_key" \
  -d '{"url": "https://example.com"}'
```

## 🛡️ セキュリティベストプラクティス

### 1. APIキーのローテーション

定期的（3ヶ月ごと）にAPIキーを更新してください：

```bash
# 新しいキーを生成
openssl rand -hex 32

# .envファイルを更新
# サーバーを再起動
pm2 restart seo-api
```

### 2. アクセスログの監視

```bash
# 不正なアクセス試行を確認
pm2 logs seo-api | grep "認証失敗"
```

### 3. HTTPS証明書の更新

Let's Encryptを使用する場合：

```bash
# 証明書の自動更新
sudo certbot renew --dry-run
```

## 🆘 トラブルシューティング

### サーバーが起動しない

```bash
# ログを確認
pm2 logs seo-api

# 環境変数を確認
pm2 env 0
```

### CORS エラー

`.env`の`PRODUCTION_DOMAIN`が正しく設定されているか確認してください。

### 認証エラー

1. `INTERNAL_API_KEY`が`.env`に設定されているか確認
2. フロントエンドから正しいヘッダーが送信されているか確認

## 📞 サポート

問題が解決しない場合は、以下を確認してください：

1. サーバーログ: `pm2 logs seo-api`
2. Nginxログ: `/var/log/nginx/error.log`
3. 環境変数: `pm2 env 0`

---

このガイドに従えば、セキュアにデプロイできます！🎉
