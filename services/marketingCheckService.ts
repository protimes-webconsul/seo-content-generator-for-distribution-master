// マーケティングチェックサービス
// CTA・まとめセクションをコピーライティング観点で評価・改善する

import { GoogleGenAI } from "@google/genai";
import type { ClientProfile } from '../types';
import { buildClientPromptContext } from './clientDataService';

const apiKey = import.meta.env.VITE_GEMINI_API_KEY || process.env.GEMINI_API_KEY;
if (!apiKey) {
  throw new Error("GEMINI_API_KEY not set.");
}
const genAI = new GoogleGenAI({ apiKey });

// 5軸スコア
export interface MarketingAxisScore {
  axis: string;
  label: string;
  score: 'ok' | 'warning' | 'ng';
  reason: string;
}

// マーケティングチェック結果
export interface MarketingCheckResult {
  axisScores: MarketingAxisScore[];
  improvedHtml: string;      // 改善済みHTML（まとめ・CTAセクションのみ）
  topImprovement: string;    // 今回最も効いた改善点
  nextPromptSuggestion: string; // 次回プロンプトへの追加案
}

// 記事HTMLからまとめ・CTAセクションを抽出
export function extractConclusionAndCta(htmlContent: string): string {
  // 最後のH2（まとめ）以降を抽出
  const h2Matches = [...htmlContent.matchAll(/<h2[^>]*>/gi)];
  if (h2Matches.length === 0) return htmlContent;

  const lastH2Match = h2Matches[h2Matches.length - 1];
  const lastH2Index = lastH2Match.index || 0;

  // 最後のH2の2つ前から（自社訴求 + まとめ）を取得
  let startIndex = lastH2Index;
  if (h2Matches.length >= 2) {
    const secondLastH2Match = h2Matches[h2Matches.length - 2];
    startIndex = secondLastH2Match.index || lastH2Index;
  }

  return htmlContent.slice(startIndex);
}

export async function runMarketingCheck(
  htmlContent: string,
  keyword: string,
  clientProfile?: ClientProfile | null,
  targetAudience?: string
): Promise<MarketingCheckResult> {

  const ctaAndConclusionHtml = extractConclusionAndCta(htmlContent);
  const clientContext = clientProfile ? buildClientPromptContext(clientProfile) : '（取引先情報なし）';
  const companyFullName = clientProfile && clientProfile.companyNameRule
    ? clientProfile.companyNameRule.fullName
    : '（取引先名未設定）';

  const prompt = `
# コピーライティング品質チェック｜最後の一押し強化プロンプト

## あなたの役割
消費者心理と行動経済学に精通したコピーライティングの専門家として、
この記事の「まとめ」「CTAセクション（専門家相談・問い合わせ誘導）」を評価・改善してください。
ハルシネーションチェックやAI文体チェックはすでに完了済みです。
このプロンプトは**コピーの説得力だけ**に集中します。

## チェック対象
以下の2箇所のみを対象とします。
1. **CTAセクション**（「〜にご相談ください」等の問い合わせ誘導段落）
2. **まとめセクション**（最終H2以下の全文）
本文の他のセクションはチェック対象外です。

## 評価フレームワーク：5つの軸

### 軸1：WHY NOW（今すぐ動く理由）
- 放置コスト（後回しにすると費用・リスクが増える）が具体的に示されているか
- 季節・時期の限定性が使われているか
- 「今は〇〇だから動きやすい」という行動の理由があるか

判定基準：
- OK：放置した場合の具体的なコスト増が数値または事例で示されている
- WARNING：「適切なタイミングで」「早めに」など曖昧な表現にとどまっている
- NG：なぜ今動くべきかの理由が一切ない

### 軸2：COST OF INACTION（問い合わせしない場合のリスク）
- 「放置した場合の具体的な結末」が1文以上書かれているか
- その結末が「自分の話」として読めるか
- 読者の資産・収益・時間という3軸のうち少なくとも1つに言及しているか

判定基準：
- OK：「〜を放置した結果、〜万円の修繕が必要になった」等の具体的因果
- WARNING：「劣化が進む」「資産価値が下がる」等の抽象的なリスク言及のみ
- NG：リスクへの言及がまとめ・CTAに存在しない

### 軸3：OBJECTION HANDLING（心理的抵抗の除去）
以下の5つの典型的な抵抗のうち、いくつに対処しているかを数える：
1. 「まだ決めていないのに連絡して、しつこく営業されそう」
2. 「診断だけ頼んで断ったら悪いかな」
3. 「費用が高そうで怖い。見積もりを見せられたら断れない」
4. 「今は入居者がいるから工事の話をするのが申し訳ない」
5. 「今すぐじゃなくていい気がしている（緊急性を感じていない）」

判定基準：
- OK：3つ以上に明示的に対処
- WARNING：1〜2つに対処
- NG：対処ゼロ（「お気軽に」だけでは対処にならない）

### 軸4：SPECIFICITY（具体性と信頼感）
- 無料サービスの内容が行動単位で書かれているか
- 問い合わせ後の流れが最低2ステップ以上具体化されているか
- 「何も決めなくていい」等、低負荷であることが示されているか

判定基準：
- OK：読者が問い合わせ後の自分の行動を具体的にイメージできる
- WARNING：「無料で〇〇します」のみで手順・内容が不明
- NG：「お気軽にご相談ください」のみ

### 軸5：CLOSING HOOK（締めの一文の引力）
- 最後の1文は「お問い合わせください」以外で終わっているか
- 読者の「得たいもの」（安心・収益・安定等）を一言で言い表しているか
- 読者を主語にした文になっているか

判定基準：
- OK：読者が「これは自分のための記事だった」と感じる締め
- WARNING：「ご連絡をお待ちしております」等の業者目線で終わっている
- NG：箇条書きや事務的な連絡先案内で終わっている

## 会社情報
${clientContext}

## 記事情報
- **キーワード**: ${keyword}
- **取引先名**: ${companyFullName}
- **ターゲット読者**: ${targetAudience || '未設定'}

## チェック対象HTML
${ctaAndConclusionHtml}

## 出力形式（JSON・変更禁止）
以下のJSON形式で出力してください。

{
  "axisScores": [
    {
      "axis": "axis1",
      "label": "WHY NOW（今すぐ動く理由）",
      "score": "ok" | "warning" | "ng",
      "reason": "判定根拠（引用＋コメント1〜2文）"
    },
    {
      "axis": "axis2",
      "label": "COST OF INACTION（放置リスク）",
      "score": "ok" | "warning" | "ng",
      "reason": "判定根拠"
    },
    {
      "axis": "axis3",
      "label": "OBJECTION HANDLING（心理的抵抗の除去）",
      "score": "ok" | "warning" | "ng",
      "reason": "対処済み〇個（内容）。未対処：〇個"
    },
    {
      "axis": "axis4",
      "label": "SPECIFICITY（具体性と信頼感）",
      "score": "ok" | "warning" | "ng",
      "reason": "判定根拠"
    },
    {
      "axis": "axis5",
      "label": "CLOSING HOOK（締めの一文の引力）",
      "score": "ok" | "warning" | "ng",
      "reason": "判定根拠"
    }
  ],
  "improvedHtml": "改善済みHTMLをそのまま記載（まとめ・CTAセクションのみ。<!-- 改善：軸〇 -->コメント付き。proprietary-infoタグの内容は変更しない）",
  "topImprovement": "今回最も効いた改善点と根拠（1〜2文）",
  "nextPromptSuggestion": "次回の執筆プロンプトへの追加案（1〜2点）"
}

## 改善コピーの必須要素
1. 「今動く理由」が数値または季節性で示されていること
2. 心理的抵抗への対処が最低2パターン含まれていること
3. 締めの1文が読者を主語にした、感情的な着地になっていること
4. proprietary-infoタグの内容は変更しない
5. 元の文がOKの軸はそのまま流用してよい
`;

  const result = await genAI.models.generateContent({
    model: "gemini-2.5-pro",
    contents: prompt,
    config: {
      temperature: 0.5,
      maxOutputTokens: 16000,
      responseMimeType: "application/json"
    }
  });

  let responseText = result.text || '';
  responseText = responseText.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim();

  let parsed: any;
  try {
    parsed = JSON.parse(responseText);
  } catch (e) {
    throw new Error('マーケティングチェックのJSON解析に失敗しました');
  }

  return {
    axisScores: parsed.axisScores || [],
    improvedHtml: parsed.improvedHtml || '',
    topImprovement: parsed.topImprovement || '',
    nextPromptSuggestion: parsed.nextPromptSuggestion || ''
  };
}
