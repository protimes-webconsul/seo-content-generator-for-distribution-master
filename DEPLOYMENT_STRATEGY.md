# デプロイ戦略ドキュメント

## 概要
本プロジェクトは、フロントエンド（React）とバックエンド（Node.js + Puppeteer）を分離したアーキテクチャを採用しており、コスト効率とスケーラビリティを考慮した**Vercel + Render.com**の組み合わせでデプロイする。

## 選定理由

### ❌ GCP単体デプロイの課題
- **高コスト**: 月額$100-150（約15,000円）
  - Compute Engine（Puppeteer用）: $60-80/月
  - Cloud Storage: $10/月
  - ネットワーク転送: $10-20/月
  - その他サービス: $20-40/月
- **管理の複雑さ**: インフラ管理が必要
- **無料枠の制限**: 3ヶ月のみ

### ✅ Vercel + Render.com選定の利点
- **完全無料運用が可能**
  - Vercel: 個人利用は無料
  - Render.com: 750時間/月の無料枠（月31日フル稼働可能）
- **デプロイの簡単さ**: GitHubとの連携で自動デプロイ
- **スケーラビリティ**: 必要に応じて有料プランへ移行可能

## アーキテクチャ構成

```
┌─────────────────────────────────────────────┐
│                  ユーザー                     │
└─────────────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────┐
│         Vercel（フロントエンド）              │
│  - React アプリケーション                     │
│  - 静的サイトホスティング                     │
│  - CDN配信                                   │
│  - 環境変数: VITE_OPENAI_API_KEY等           │
└─────────────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────┐
│       Render.com（バックエンド）              │
│  - Node.js サーバー                          │
│  - Puppeteer（スクレイピング）               │
│  - Google Custom Search API連携              │
│  - Slack通知プロキシ                         │
│  - 環境変数: OPENAI_API_KEY等                │
└─────────────────────────────────────────────┘
```

## デプロイ手順

### 1. Render.com（バックエンド）

#### 1.1 Dockerfileの作成
```dockerfile
FROM ghcr.io/puppeteer/puppeteer:21.5.2

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm ci --only=production
COPY . .

CMD ["node", "server.js"]
```

#### 1.2 render.yamlの設定
```yaml
services:
  - type: web
    name: seo-content-backend
    env: docker
    plan: free
    buildCommand: docker build -t seo-backend .
    startCommand: node server.js
    envVars:
      - key: NODE_ENV
        value: production
      - key: OPENAI_API_KEY
        sync: false
      - key: GOOGLE_API_KEY
        sync: false
      - key: GOOGLE_SEARCH_ENGINE_ID
        sync: false
      - key: SLACK_WEBHOOK_URL
        sync: false
```

#### 1.3 環境変数の設定
Render.comダッシュボードで以下を設定：
- `OPENAI_API_KEY`
- `GOOGLE_API_KEY`
- `GOOGLE_SEARCH_ENGINE_ID`
- `SLACK_WEBHOOK_URL`
- `PORT` (Render.comが自動設定)

### 2. Vercel（フロントエンド）

#### 2.1 vercel.jsonの設定
```json
{
  "buildCommand": "npm run build",
  "outputDirectory": "dist",
  "framework": "vite",
  "rewrites": [
    {
      "source": "/api/:path*",
      "destination": "https://your-backend.onrender.com/api/:path*"
    }
  ]
}
```

#### 2.2 環境変数の設定
Vercelダッシュボードで以下を設定：
- `VITE_OPENAI_API_KEY`
- `VITE_BACKEND_URL` (Render.comのURL)
- `VITE_SLACK_WEBHOOK_URL`（必要に応じて）

#### 2.3 ビルド設定
```bash
# package.jsonのscripts
{
  "build": "vite build",
  "preview": "vite preview"
}
```

## サービス間の通信

### CORSの設定（バックエンド側）
```javascript
// server.js
app.use(cors({
  origin: [
    'https://your-app.vercel.app',
    'http://localhost:5176',
    'http://localhost:5177'
  ],
  credentials: true
}));
```

### API通信の実装（フロントエンド側）
```typescript
// services/api.ts
const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3010';

export const api = {
  googleSearch: async (query: string) => {
    const response = await fetch(`${BACKEND_URL}/api/google-search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query })
    });
    return response.json();
  },

  scrape: async (url: string) => {
    const response = await fetch(`${BACKEND_URL}/api/scrape`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    });
    return response.json();
  }
};
```

## コスト分析

### 無料運用時
| サービス | プラン | コスト | 制限 |
|---------|--------|--------|------|
| Vercel | Hobby | ¥0 | 100GB帯域/月 |
| Render.com | Free | ¥0 | 750時間/月、512MB RAM |
| **合計** | - | **¥0** | - |

### スケールアップ時
| サービス | プラン | コスト | スペック |
|---------|--------|--------|----------|
| Vercel | Pro | $20/月 | 1TB帯域、チーム機能 |
| Render.com | Starter | $7/月 | 無制限稼働、512MB RAM |
| **合計** | - | **$27/月（約4,000円）** | - |

## 注意事項

### Puppeteerの制限
- Render.com無料プランは512MB RAMのため、重いページのスクレイピング時にメモリ不足の可能性
- 対策：
  - ヘッドレスモードの使用
  - 不要なリソース（画像、CSS）の読み込み制限
  - メモリリークの防止（ブラウザの適切なクローズ）

### 無料プランの制限
- **Render.com**: 15分間アクセスがないとスリープ（コールドスタート約30秒）
- **Vercel**: 商用利用は有料プラン必須

### セキュリティ考慮事項
- APIキーは環境変数で管理
- CORSの適切な設定
- Rate Limitingの実装推奨
- HTTPSの使用（両サービスとも自動）

## 移行タイムライン

1. **Phase 1**: バックエンドのRender.comデプロイ（1日）
2. **Phase 2**: フロントエンドのVercelデプロイ（1日）
3. **Phase 3**: 環境変数とCORS設定（半日）
4. **Phase 4**: テストと調整（1日）
5. **Phase 5**: DNS設定とカスタムドメイン（オプション）

## トラブルシューティング

### よくある問題と解決策

#### Puppeteerが動作しない
```javascript
// Render.com用の設定
const browser = await puppeteer.launch({
  headless: 'new',
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-accelerated-2d-canvas',
    '--no-first-run',
    '--no-zygote',
    '--single-process',
    '--disable-gpu'
  ]
});
```

#### CORSエラー
- Vercelのrewrites設定を確認
- バックエンドのCORS設定を確認
- 本番URLが正しく設定されているか確認

#### メモリ不足
- Puppeteerのページを使用後必ず閉じる
- 同時実行数を制限する
- 必要に応じて有料プランへアップグレード

## まとめ

Vercel + Render.comの組み合わせは、初期コストを抑えながら本格的なWebアプリケーションを運用できる最適なソリューション。特にPuppeteerを使用するプロジェクトでは、Render.comのDocker対応が大きな利点となる。

将来的な拡張性も確保されており、トラフィックや要求に応じて段階的にスケールアップが可能。