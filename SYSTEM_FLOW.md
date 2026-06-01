# 🏗️ SEOコンテンツ生成システム アーキテクチャ

## 📋 目次
1. [システム概要](#システム概要)
2. [エージェントチェーン全体図](#エージェントチェーン全体図)
3. [各エージェント詳細](#各エージェント詳細)
4. [データフロー](#データフロー)
5. [技術スタック](#技術スタック)
6. [冗長性とフォールバック](#冗長性とフォールバック)

---

## システム概要

本システムは、SEO最適化された高品質な記事を自動生成する6段階のエージェントチェーンです。

### 🎯 主要な特徴
- **完全自動化**: キーワード入力から記事完成まで自動処理
- **品質保証**: 各段階でのチェック機構
- **実績データ活用**: Google Drive連携による自社事例の組み込み
- **冗長性設計**: 3段階のフォールバックシステム

---

## エージェントチェーン全体図

```
[キーワード入力]
    ↓
┌──────────────────────────────┐
│ 1. リサーチエージェント       │ → 競合15サイト分析
│   Gemini 2.0 Flash Exp       │   Google Search API
│                              │   3段階冗長性
└──────────────────────────────┘
    ↓ CompetitorResearchResult
┌──────────────────────────────┐
│ 2. 構成生成エージェント V2    │ → H2/H3構造生成
│   Gemini 2.0 Flash Exp       │   Google Drive API
│                              │   ノイズ除去(-10%ルール)
└──────────────────────────────┘
    ↓ SeoOutline
┌──────────────────────────────┐
│ 3. 構成チェックエージェント V2 │ → 自動修正
│   Gemini 2.0 Flash Exp       │   タイトル29-35文字
└──────────────────────────────┘
    ↓ CheckedOutline
┌──────────────────────────────┐
│ 4. 執筆エージェント V3        │ → 本文生成
│   Gemini 2.5 Pro             │   Google Drive API
│                              │   競合分析に基づく最適文字数
└──────────────────────────────┘
    ↓ Article
┌──────────────────────────────┐
│ 5. 執筆チェックエージェント V3 │ → 品質評価
│   Gemini 2.5 Pro             │   5項目100点評価
└──────────────────────────────┘
    ↓ CheckedArticle
┌──────────────────────────────┐
│ 6. 最終校閲エージェント V1.0  │ → ファクトチェック
│   GPT-5 + Responses API      │   Web検索で裏取り
│                              │   OpenAI Responses API
└──────────────────────────────┘
    ↓
[完成記事出力（WordPress HTML）]
```

---

## 各エージェント詳細

### 1️⃣ リサーチエージェント
**ファイル**: `services/competitorResearchWithWebFetch.ts`  
**モデル**: Gemini 2.0 Flash Exp  
**使用API**:
- **Google Custom Search API** - 上位15サイトのURL取得（必須）
- **Puppeteer Server** - 動的コンテンツスクレイピング（オプション）

**主要機能**:
- Google Custom Search APIで上位15サイト取得
- 3段階冗長性によるコンテンツ取得
- H2/H3見出し構造の抽出
- 頻出単語分析（TF-IDF）

**3段階冗長性システム**:
```
1. Puppeteerサーバー (最優先)
   ├─ 動的コンテンツ対応
   └─ 正確な構造抽出
   
2. WebFetch + Gemini (フォールバック1)
   ├─ Geminiでページ解析
   └─ レート制限対策済み
   
3. スニペット解析 (フォールバック2)
   ├─ 検索結果のみで推測
   └─ 最低限の情報確保
```

**出力データ構造**:
```typescript
{
  keyword: string,
  validArticles: ArticleAnalysis[],
  commonTopics: string[],
  frequencyWords: { word: string, count: number }[],
  recommendedWordCount: { min, max, optimal }
}
```

---

### 2️⃣ 構成生成エージェント Ver.2
**ファイル**: `services/outlineGeneratorV2.ts`  
**モデル**: Gemini 2.0 Flash Exp  
**使用API**:
- **Google Drive API** - 実績データ取得（サーバー経由）

**主要機能**:
- ノイズ除去アルゴリズム（-10%ルール）
- H3の0-or-2ルール適用
- 文字数配分の最適化
- サービス訴求セクション自動挿入

**ノイズ除去ロジック**:
```typescript
// -10%ルール: 出現率10%未満の見出しを除外
const threshold = maxCount * 0.1;
validH2s = h2s.filter(h2 => h2.count >= threshold);

// H3の0-or-2ルール
if (h3Count === 1) h3Count = 0;  // 1個なら0に
if (h3Count >= 2) h3Count = Math.min(h3Count, 3);  // 2個以上なら最大3
```

**構成ルール**:
- タイトル: 29-35文字（理想32文字）
- 最後3セクション固定: FAQ → サービス訴求 → まとめ
- H2: 8-12個、H3: 各H2に0個または2個以上

---

### 3️⃣ 構成チェックエージェント Ver.2
**ファイル**: `services/outlineCheckerV2.ts`  
**モデル**: Gemini 2.0 Flash Exp  
**使用API**: なし（Gemini APIのみ）

**主要機能**:
- タイトル文字数自動調整（29-50文字）
- メタディスクリプション最適化（100文字）
- H2/H3階層構造の検証
- 自動修正機能

**チェック項目**:
```
✓ タイトル文字数（29-50文字、32文字推奨）
✓ H2見出し数（8-12個）
✓ H3配分（0個または2個以上）
✓ 固定セクション順序
✓ キーワード含有率
```

---

### 4️⃣ 執筆エージェント Ver.3
**ファイル**: `services/writingAgentV3.ts`  
**モデル**: Gemini 2.5 Pro  
**使用API**:
- **Google Drive API** - 事例の動的取得（フォルダID: 環境変数で設定）

**主要機能**:
- 300行以上のカスタム指示
- 3段階セルフリファイン
- Google Drive実績データ統合
- セクション単位生成

**セルフリファインシステム**:
```
Phase 1: 初稿生成
  ├─ PREP法による論理構成
  └─ 頻出単語の自然配置

Phase 2: ファクトチェック
  ├─ fact_ledger作成
  ├─ citation_map構築
  └─ 数値・固有名詞検証

Phase 3: 最終調整
  ├─ 文字数調整（30,000文字目標）
  ├─ 事例挿入
  └─ CTA配置最適化
```

**Google Drive連携**:
- フォルダID: 環境変数で設定
- 実績企業データの自動取得
- 成功事例の文脈に応じた引用

---

### 5️⃣ 執筆チェックエージェント Ver.3
**ファイル**: `services/writingCheckerV3.ts`  
**モデル**: Gemini 2.5 Pro  
**使用API**: なし（Gemini APIのみ）

**主要機能**:
- 5項目100点満点評価
- 固有名詞・数値の正確性検証
- 改善提案の自動生成
- 競合比較分析

**評価項目**:
```typescript
{
  seo: 90,        // SEO最適化度
  readability: 85, // 読みやすさ
  accuracy: 88,   // 正確性（最重要）
  structure: 92,  // 構成の適切性
  value: 80       // 価値提供度
}
```

**重点チェック**:
- 🔴 固有名詞の正確性（企業名、サービス名）
- 🔴 数値データの妥当性（統計、金額、日付）
- キーワード密度（2-3%）
- サービス訴求の自然さ

---

### 6️⃣ 最終校閲エージェント Ver.1.0
**ファイル**: `services/finalProofreadingAgent.ts`  
**モデル**: GPT-5 + Responses API  
**使用API**:
- **OpenAI Responses API** - Web検索機能内蔵でリアルタイムファクトチェック

**主要機能**:
- Responses APIのWeb検索機能によるリアルタイムファクトチェック
- 固有名詞・数値の正確性検証（最重要）
- 自社情報の優先処理
- 変更履歴の詳細記録

**GPT-5モデル選択**:
```typescript
{
  FULL: 'gpt-5',      // $1.25/1M入力, $10/1M出力 - 最高精度
  MINI: 'gpt-5-mini', // $0.25/1M入力, $2/1M出力 - バランス
  NANO: 'gpt-5-nano'  // $0.05/1M入力, $0.40/1M出力 - 高速
}
```

**ファクトチェック優先順位**:
1. 自社一次情報（環境変数で設定した自社サービス）
2. 公式発表・仕様・法令・原典データ
3. 公的機関/標準化団体/査読論文
4. 大手報道/業界団体/専門メディア

**検証必須項目**:
- 固有名詞（企業/製品/モデル名/バージョン）
- 数値（性能/価格/シェア/確率）
- 日付/年号/期間
- ランキング/比較/最上級表現（No.1等）
- 法令名/条番号

---

## データフロー

### 主要データ型の流れ

```typescript
// 1. リサーチ結果
CompetitorResearchResult {
  validArticles: ArticleAnalysis[]
  frequencyWords: WordFrequency[]
  recommendedWordCount: { min, max, optimal }
}
    ↓
// 2. 構成案
SeoOutline {
  title: string (29-35文字)
  metaDescription: string (100文字)
  sections: Section[] {
    h2Title: string
    h3Items: H3Item[]
    targetWordCount: number
  }
}
    ↓
// 3. チェック済み構成
CheckedOutline extends SeoOutline {
  corrections: Correction[]
  validationScore: number
}
    ↓
// 4. 執筆記事
Article {
  htmlContent: string
  plainText: string
  actualWordCount: number
}
    ↓
// 5. チェック済み記事
CheckedArticle extends Article {
  overallScore: number
  issues: Issue[]
  improvements: Improvement[]
}
    ↓
// 6. 最終成果物
FinalArticle {
  title: string
  metaDescription: string
  htmlContent: string (WordPress対応)
  wordCount: number
  seoScore: number
}
```

---

## 技術スタック

### フロントエンド
- **React + TypeScript**
- **Vite** (ビルドツール)
- **Tailwind CSS**

### バックエンド
- **Node.js + Express**
- **Puppeteer** (スクレイピング)
- **Python** (Google Drive連携)

### AI/API
- **Gemini API** (2.5 Pro / 2.0 Flash Exp / 1.5 Flash)
- **Google Custom Search API**
- **Google Drive API**

### インフラ
- **ポート構成**:
  - 5176: Viteデベロップメントサーバー
  - 3010: Expressサーバー
  - 3002: Puppeteerサーバー

---

## 冗長性とフォールバック

### 🔄 システム全体の冗長性設計

1. **コンテンツ取得の3段階冗長性**
   - Primary: Puppeteer
   - Secondary: WebFetch + Gemini
   - Tertiary: スニペット解析

2. **API制限対策**
   - Google Search API: 100回/日制限の明示的エラー表示
   - Gemini API: レート制限対応（3秒間隔）

3. **エラーリカバリー**
   - 各エージェントで個別エラーハンドリング
   - 部分的失敗でも処理継続
   - フォールバックデータの活用

4. **データキャッシュ**
   - Google Driveデータのローカルキャッシュ
   - 実績企業情報のフォールバック

### 📊 パフォーマンス指標

- **処理時間**: 
  - リサーチ: 30-60秒
  - 構成生成: 10-15秒
  - 執筆: 60-120秒
  - 全体: 3-5分

- **成功率**:
  - Puppeteer使用時: 95%
  - WebFetch使用時: 85%
  - フォールバック時: 70%

---

## 運用上の注意点

### ⚠️ 制限事項
1. **Google Search API**: 1日100クエリ（午後4時リセット）
2. **Gemini API**: レート制限あり（モデルによる）
3. **文字数上限**: 1記事最大60,000文字

### 🔧 トラブルシューティング
1. **Puppeteerサーバーが起動しない**
   ```bash
   ./start.sh  # 自動クリーンアップ付き起動
   ```

2. **Google Search API制限**
   - 午後4時まで待つ
   - 別のAPIキーに変更
   - URLを直接入力

3. **メモリ不足**
   - セクション単位生成に切り替え
   - 文字数目標を下げる

---

## 今後の拡張予定

- [ ] GPT-4o対応（実装準備中）
- [ ] リアルタイムプレビュー
- [ ] バッチ処理対応
- [ ] 多言語対応
- [ ] A/Bテスト機能

---

最終更新: 2025-09-06