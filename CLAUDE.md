# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## プロジェクト概要

SEO最適化された記事構成・記事本文を自動生成するツール。Gemini APIを軸に、競合調査・構成生成・執筆・校閲までをワンストップで処理。

---

## 開発コマンド

```bash
# フロントエンド（:5176）
npm run dev

# スクレイピングサーバー（:3010）
npm run server
# または: cd server && node scraping-server.js

# 両方同時起動（推奨）
bash ./start.sh

# ビルド
npm run build
```

> `npm run start` はバックグラウンド起動が不安定なため、`start.sh` か別ターミナルでの起動を推奨。

### 起動確認

```bash
curl http://localhost:3010/api/health
# 期待値: {"status":"ok","message":"スクレイピングサーバーは正常に動作しています"}
```

---

## ポート割り当て

| ポート | 用途 |
|--------|------|
| 5176 | メインアプリ（Vite） |
| 3010 | スクレイピングサーバー（Puppeteer） |
| 5177 | 画像生成エージェント（予約済み） |
| 5178 | 新規エージェント用（予約済み） |
| 3002 | 追加APIサーバー用（予約済み） |

---

## 環境変数（`.env`）

```
GEMINI_API_KEY          # Gemini API
GOOGLE_API_KEY          # Custom Search API
GOOGLE_SEARCH_ENGINE_ID # カスタム検索エンジンID
OPENAI_API_KEY          # GPT-5用（最終校閲エージェント）
COMPANY_DATA_FOLDER_ID  # Google DriveフォルダID
VITE_INTERNAL_API_KEY   # ブラウザ側内部API認証
VITE_API_URL            # APIのベースURL
```

`VITE_` プレフィックスのある変数のみブラウザ側で参照可能。`GEMINI_API_KEY` は Vite の `define` 設定で `process.env.GEMINI_API_KEY` としても注入している（`vite.config.ts` 参照）。

Vite のプロキシ設定により `/api/*` は `localhost:3010` へ転送される。

---

## アーキテクチャ概要

### 処理フロー（App.tsx が全体を統合）

```
キーワード入力
  ↓
競合調査 (competitorResearchWithWebFetch.ts)
  → スクレイピングサーバー (server/scraping-server.js) 経由で競合記事のH2/H3を取得
  ↓
構成生成 V2 (outlineGeneratorV2.ts)  →  構成チェック (outlineCheckerV2.ts)
  ↓
執筆エージェント (writingAgentV3.ts)
  → Gemini 2.5 Pro + Grounding（Google検索と連携）
  ↓
執筆チェック (writingCheckerV3.ts)
  ↓
最終校閲マルチエージェント (services/finalProofreadingAgents/)
  → 11エージェント並列・順次実行 → IntegrationAgent がスコア統合
  ↓
記事修正 (articleRevisionService.ts)  ← 人間が確認してボタンを押した場合のみ
```

### フロントエンド（React + Vite）

- `App.tsx`: タブ切り替えによる全ページ管理、各サービスの呼び出し
- `components/`: 各タブのUIコンポーネント
  - `OutlineDisplayV2.tsx`: 構成V2の表示
  - `ArticleWriter.tsx`: 執筆フロー全体（執筆・チェック・校閲）
  - `ArticleRevisionForm.tsx`: 修正指示UI
  - `CompetitorResearchWebFetch.tsx`: 競合調査UI
  - `FrequencyWordsTab.tsx`: 頻出単語分析

### バックエンド（Express.js）

- `server/scraping-server.js`: Puppeteerで競合記事をスクレイピング
  - 開発: `puppeteer`（Chromium付属）
  - 本番: `puppeteer-core` + `@sparticuz/chromium`
- `server/api/`: Google Drive, Supabase連携など補助エンドポイント

### サービス層（`services/`）

| ファイル | 役割 |
|----------|------|
| `geminiServiceUpdated.ts` | Gemini API呼び出し（構成V1） |
| `outlineGeneratorV2.ts` | 構成V2生成（ルール定義含む） |
| `outlineCheckerV2.ts` | 構成V2バリデーション |
| `writingAgentV3.ts` | 記事執筆（Gemini 2.5 Pro） |
| `writingCheckerV3.ts` | 執筆品質チェック（Gemini 2.5 Pro） |
| `articleRevisionService.ts` | 記事修正（Gemini 2.5 Pro） |
| `finalProofreadingAgent.ts` | 単体版最終校閲（旧） |
| `finalProofreadingAgents/` | マルチエージェント版最終校閲（現行） |
| `companyDataService.ts` | 自社実績データ取得 |
| `driveAutoAuth.cjs` | Google Drive ADC認証（CommonJS形式） |
| `competitorResearchWithWebFetch.ts` | 競合調査（現行） |

### AIモデル構成（現行）

| エージェント | モデル |
|-------------|--------|
| 執筆 (writingAgentV3) | `gemini-2.5-pro` |
| 執筆チェック (writingCheckerV3) | `gemini-2.5-pro` |
| 記事修正 (articleRevisionService) | `gemini-2.5-pro` |
| 最終校閲マルチエージェント群 | `gpt-5-nano` / `gpt-5-mini`（OpenAI Responses API） |

### 最終校閲マルチエージェント実行フロー

```
フェーズ1（並列）: ProperNounsAgent, NumbersStatsAgent, DatesTimelineAgent,
                    FactsCasesAgent, TechnicalAgent, CompanyAgent, LegalAgent（オプション）
フェーズ2（順次）: SourceRequirementAgent → SourceEnhancementAgent → CitationsAgent
フェーズ3（統合）: IntegrationAgent（100点満点スコア算出、75点以上で合格）
```

修正は自動適用せず、**人間がボタンを押した場合のみ**実行。

---

## 重要なコーディングルール

### Optional Chaining 禁止

`?.` 演算子は使用しない（Claude Code クラッシュの原因）。代わりに段階的な null チェックを実装。

```typescript
// ❌
const name = obj?.user?.name;
// ✅
const name = obj && obj.user ? obj.user.name : undefined;
```

Google Drive 関連の Node.js スクリプトは `.cjs` 拡張子で CommonJS 形式で記述。

### 技術仕様の勝手な変更禁止

ユーザーが指定したモデル名・ライブラリ・バージョンを「存在しない」「利用できない」と判断して勝手に変更しない。GPT-5・Responses API 等は指定通り実装する。変更が必要な場合は必ず提案として明示し、承認を得てから実装する。

### コミットは明示的に指示された時のみ

---

## OpenAI Responses API 仕様（GPT-5用）

```typescript
const response = await (openai as any).responses.create({
  model: 'gpt-5-mini',       // gpt-5 / gpt-5-mini / gpt-5-nano
  input: userInput,           // messages ではなく input
  tools: [{ type: 'web_search' }],  // シンプルな形式
  reasoning: { effort: 'high' },    // low/medium/high（lowはweb_search不可）
  max_completion_tokens: 4000        // max_tokens ではない
});
// temperature は GPT-5 では 1.0 固定（変更不可）
```

---

## 構成 Ver.2 ルール（絶対厳守）

### タイトル
- 文字数: **29〜35文字**（32文字前後が理想）
- 自社サービス名を含めない
- 【】などの記号で囲まない

### H2見出し
- 記号（【】等）で囲まない
- 「○選」「○つ」等の数字があれば、H3は**その数と同数**作成し**通し番号**を付ける

### H3配分
- H2ごとに「0個」または「2個以上」（1個は禁止）
- まとめセクションは必ず0個

### 最後3つのH2（固定順序）
1. FAQ・よくある質問（ある場合）
2. **自社サービス訴求**（まとめの直前、必須）— H3 2〜3個、サービス名を含める
3. **まとめ**（最後、必須）— フォーマット: `まとめ：[キーワード]を含む総括的なサブタイトル`

### 関連ファイル
- `services/outlineGeneratorV2.ts` — ルール定義
- `services/outlineCheckerV2.ts` — チェッカー
- `utils/testDataGeneratorV2.ts` — テストデータ

テスト確認: http://localhost:5176 → 「🎓 テスト構成」ボタン

---

## Google Drive ADC認証

初回セットアップ（1回のみ）:
```bash
gcloud auth application-default login \
  --scopes=https://www.googleapis.com/auth/cloud-platform,https://www.googleapis.com/auth/drive.readonly
```

認証フロー: ADC認証（優先）→ 失敗時は API Key 認証にフォールバック

関連ファイル: `services/driveAutoAuth.cjs`, `server/api/company-data.js`

ADC認証が失敗する場合: `gcloud auth application-default login --force`

---

## 執筆レギュレーション要点

- 文体: です・ます調
- 対象読者: 法人の決裁者・推進担当・現場マネジャー
- リード文: 200〜350字（悩み代弁→解決策→ベネフィット→読み進め促し）
- 段落: 1段落2〜4文、平均文長40〜60字
- 強調: `<b>` タグ（1見出し1〜3箇所）
- 禁止: 同型文末3連続、抽象的な一般論の羅列、【】等記号見出し、誇大広告（No.1等）
