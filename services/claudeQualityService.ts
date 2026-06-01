/**
 * Claude品質チェック＆加工サービス（テスト用）
 * - 既存の writingCheckerV3.ts / writingAgentV3.ts は変更しない
 * - ハルシネーション除去・AI文体チェック・品質向上を1回のClause呼び出しで実行
 * - モデル: claude-sonnet-4-6
 */
import Anthropic from '@anthropic-ai/sdk';
import type { ClientProfile, FactEntry } from '../types';
import { fetchClientFacts } from './clientDataService';

// ────────────────────────────────────────────────
// 型定義
// ────────────────────────────────────────────────

export interface ClaudeQualityRequest {
  article: string;              // 記事HTML
  keyword: string;
  title?: string;               // 記事タイトル
  metaDescription?: string;     // メタディスクリプション
  clientProfile?: ClientProfile; // 取引先情報（会社名・ルール・FactDB）
}

export interface ClaudeQualityResult {
  checkReport: string;   // チェックレポート（マークダウン）
  revisedHtml: string;   // 修正済み記事HTML
  rawResponse: string;   // 生レスポンス全文
}

// ────────────────────────────────────────────────
// 取引先コンテキストの構築
// ────────────────────────────────────────────────

function buildClientContext(clientProfile: ClientProfile, facts: FactEntry[]): string {
  const lines: string[] = [];

  // 会社名
  if (clientProfile.companyNameRule) {
    lines.push('会社名（正式）：' + clientProfile.companyNameRule.fullName);
    lines.push('会社名（略称）：' + clientProfile.companyNameRule.titleName);
  } else {
    lines.push('会社名：' + clientProfile.name);
  }

  // 自社固有情報
  if (clientProfile.uniqueInfo) {
    const info = clientProfile.uniqueInfo;
    if (info.achievements) { lines.push('実績：' + info.achievements); }
    if (info.certifications) { lines.push('資格：' + info.certifications); }
    if (info.staffInfo) { lines.push('スタッフ：' + info.staffInfo); }
    if (info.serviceArea) { lines.push('対応エリア：' + info.serviceArea); }
    if (info.specialties) { lines.push('独自工法・特徴：' + info.specialties); }
    if (info.awards) { lines.push('受賞・認定：' + info.awards); }
  }

  // NGワード（禁止カテゴリ）
  const ngRules = clientProfile.writingRules.filter(function(r) {
    return r.category === '禁止';
  });
  if (ngRules.length > 0) {
    lines.push('NGワード・禁止表現：');
    ngRules.forEach(function(r) {
      lines.push('  - ' + r.ruleContent);
    });
  }

  // ライティングルール（禁止以外）
  const otherRules = clientProfile.writingRules.filter(function(r) {
    return r.category !== '禁止';
  });
  if (otherRules.length > 0) {
    lines.push('ライティングルール：');
    otherRules.forEach(function(r) {
      lines.push('  [' + r.category + '] ' + r.ruleContent);
    });
  }

  // 表記統一ルール
  if (clientProfile.terminologyRules.length > 0) {
    lines.push('表記統一ルール：');
    clientProfile.terminologyRules.forEach(function(r) {
      lines.push('  ' + r.wrongTerms.join('/') + ' → ' + r.correctTerm);
    });
  }

  // FactDB（自社固有データ）
  if (facts.length > 0) {
    lines.push('【自社固有データ（外部検証対象外・記載値をそのまま使用）】');
    facts.forEach(function(f) {
      lines.push('  [' + f.category + '] ' + f.item + '：' + f.content);
    });
  }

  return lines.join('\n');
}

// ────────────────────────────────────────────────
// システムプロンプト
// ────────────────────────────────────────────────

function buildSystemPrompt(clientContext: string): string {
  return `# ブログ品質チェック＆改善プロジェクト

## あなたの役割

このプロジェクトでは、AI生成ブログ記事の品質チェックと改善を行います。
記事が貼られたら、以下の3つを必ず実行してください。

---

## 必須実行：3つのチェック

### 1. ハルシネーションチェック

記事内のすべての「事実の主張」を洗い出し、以下を確認する。

**出典がある場合：**
- URLに実際にアクセスして、機関名・年度・文書名・内容が記事の記述と一致するかを確認する
- URLの存在だけで「正しい」と判断しない

**よくある誤りパターン（特に注意）：**
- 機関名の取り違え（例：「国土技術政策総合研究所」と「土木研究所」は別組織）
- 年度の誤り（AI生成で頻発。論文が2007年なのに「2026年」と記載など）
- 出典の内容が記事の主張を裏付けていない（用途外引用）
- 「〜の多くで確認されています」「〜のケースが報告されています」など出典なし断言

**判定ラベル：**
- 🔴 ハルシネーション（必ず修正）
- 🟡 要注意（修正推奨）
- ✅ 問題なし

---

### 2. AI文体チェック

以下の表現を記事全体でスキャンして、出現数とともに報告する。

| 検出ワード | 許容数 | 対処 |
|---|---|---|
| 〜ことが可能です | 0回 | 「〜できます」に変更 |
| 〜ことが重要です | 1回まで | 超えた分を削除 |
| 〜ことが大切です | 1回まで | 超えた分を削除 |
| 〜ことが不可欠です | 1回まで | 削除 or 「欠かせません」 |
| 〜ことが期待できます | 1回まで | 削除 |
| 非常に / 確実に / 著しく | 各2回まで | 超えた分を削除 |

以下の汎用締め文は**原則削除**：
- 「〜は、タイミングと業者選びで結果が大きく変わります」
- 「本記事で解説したように〜」
- 「読み終える頃には〜明確になるはずです」

---

### 3. 品質向上（4軸）

以下の4軸で評価し、修正記事に反映する。

**① 読みやすさ・文章リズム**
- 「〜ます。〜ます。〜ます。」が4回以上連続する箇所をほぐす
- 体言止め・倒置・接続詞でリズムに変化をつける

**② SEO**
- H2見出しにキーワードが含まれているかを確認する
- 冒頭200字にメインキーワードが入っているかを確認する

**③ 読者への訴求力・CTA**
- 冒頭：読者の悩みを具体的に言語化できているか
- 末尾CTA：「お気軽にご相談ください」だけでなく、何ができるか・何が無料かを明示する

**④ 専門性・信頼感**
- 「多い」「高い」などの曖昧表現を具体的な数値・条件に置き換える
- 専門用語の初出に簡単な説明を加える

---

## 出力フォーマット

修正ありで出力してください。チェックレポートを出力した後、以下のデリミタを挟んで修正済み記事HTMLを出力してください。

===REVISED_ARTICLE_START===
（修正済み記事HTML全文）
===REVISED_ARTICLE_END===

その後、プロンプト改善メモを出力してください。

### チェックレポートの形式

ハルシネーションチェック
🔴 [問題箇所と修正方法]
🟡 [要注意箇所]
✅ [問題なし項目]

AI文体チェック
[検出一覧と修正案]

品質スコア（現状）
読みやすさ：★★★☆☆
SEO：★★★★☆
訴求力：★★☆☆☆
専門性：★★★☆☆

---

## 🛠️ プロンプト改善メモ（毎回必ず出力）

### ルール不足・曖昧だった箇所
[今回のチェック中に「現行ルールでは判定できなかった」「ルールが曖昧で迷った」箇所を具体的に記載]
該当なしの場合は「なし」と記載

### 今回うまく機能したルール
[精度よく検出・修正できたルールを1〜2個記載]

### プロンプトへの変更案
[追加・修正・削除すべき箇所を「現行 → 変更案」の形式で記載]
該当なしの場合は「なし」と記載

---

## 会社情報（固有情報として扱う）

以下は自社固有情報のため、外部検証の対象外です。記事に記載の値はそのまま使用してください。

${clientContext}`;
}

// ────────────────────────────────────────────────
// メイン関数
// ────────────────────────────────────────────────

export async function runClaudeQualityCheck(
  request: ClaudeQualityRequest
): Promise<ClaudeQualityResult> {
  const apiKey = (import.meta as any).env.VITE_ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('VITE_ANTHROPIC_API_KEY が設定されていません。.env を確認してください。');
  }

  const client = new Anthropic({ apiKey: apiKey, dangerouslyAllowBrowser: true });

  // FactDB取得
  let facts: FactEntry[] = [];
  if (request.clientProfile && request.clientProfile.factSheetName) {
    try {
      facts = await fetchClientFacts(request.clientProfile.factSheetName);
      console.log('📊 FactDB取得完了:', facts.length + '件');
    } catch (e) {
      console.warn('⚠️ FactDB取得失敗（スキップ）:', e);
    }
  }

  // コンテキスト構築
  const clientContext = request.clientProfile
    ? buildClientContext(request.clientProfile, facts)
    : '取引先情報なし';

  const systemPrompt = buildSystemPrompt(clientContext);

  // 取引先名を解決
  const clientName = request.clientProfile
    ? (request.clientProfile.companyNameRule
        ? request.clientProfile.companyNameRule.fullName
        : request.clientProfile.name)
    : '（未設定）';

  const articleInfo = [
    '## 記事情報',
    '- **キーワード**: ' + request.keyword,
    '- **取引先名**: ' + clientName,
    '- **タイトル**: ' + (request.title || '（未設定）'),
    '- **メタディスクリプション**: ' + (request.metaDescription || '（未設定）'),
  ].join('\n');

  const userMessage = articleInfo + '\n\n以下の記事をチェック・改善してください。\n\n' + request.article;

  console.log('🧠 Claude品質チェック開始（claude-sonnet-4-6）');

  const response = await (client as any).messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 16000,
    tools: [{ type: 'web_search_20250305' }],
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
  });

  // テキストブロックを結合
  let fullText = '';
  if (response.content && Array.isArray(response.content)) {
    for (let i = 0; i < response.content.length; i++) {
      const block = response.content[i];
      if (block.type === 'text') {
        fullText += block.text;
      }
    }
  }

  console.log('✅ Claude品質チェック完了（' + fullText.length + '文字）');

  // デリミタでチェックレポートと修正済み記事を分離
  const START_MARKER = '===REVISED_ARTICLE_START===';
  const END_MARKER = '===REVISED_ARTICLE_END===';
  const startIdx = fullText.indexOf(START_MARKER);
  const endIdx = fullText.indexOf(END_MARKER);

  let checkReport = fullText;
  let revisedHtml = '';

  if (startIdx !== -1 && endIdx !== -1) {
    checkReport = fullText.substring(0, startIdx).trim();
    revisedHtml = fullText.substring(startIdx + START_MARKER.length, endIdx).trim();
  } else if (startIdx !== -1) {
    checkReport = fullText.substring(0, startIdx).trim();
    revisedHtml = fullText.substring(startIdx + START_MARKER.length).trim();
  }

  if (!revisedHtml) {
    console.warn('⚠️ 修正済み記事が取得できませんでした。デリミタが出力されなかった可能性があります。');
  }

  return {
    checkReport: checkReport,
    revisedHtml: revisedHtml,
    rawResponse: fullText,
  };
}
