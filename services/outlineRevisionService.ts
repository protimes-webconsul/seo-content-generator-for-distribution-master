// 構成案AI修正サービス
// 現在の構成案 + 修正指示 → 修正済み構成案を返す

import { GoogleGenerativeAI } from "@google/generative-ai";
import type { SeoOutlineV2 } from "../types";

const API_KEY =
  import.meta.env.VITE_GEMINI_API_KEY || process.env.GEMINI_API_KEY;

/**
 * 現在の構成案に修正指示を適用して、修正済みの SeoOutlineV2 を返す
 */
export async function reviseOutlineV2(
  currentOutline: SeoOutlineV2,
  keyword: string,
  revisionInstruction: string
): Promise<SeoOutlineV2> {
  if (!API_KEY) {
    throw new Error("GEMINI_API_KEY が設定されていません");
  }

  const genAI = new GoogleGenerativeAI(API_KEY);
  const model = genAI.getGenerativeModel({
    model: "gemini-2.5-pro",
    generationConfig: {
      temperature: 0.4,
      maxOutputTokens: 16000,
      responseMimeType: "application/json",
    },
  });

  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().getMonth() + 1;

  const currentOutlineJson = JSON.stringify(currentOutline, null, 2);

  const prompt = `あなたはSEOに精通したコンテンツプランナーです。
現在は${currentYear}年${currentMonth}月です。

以下の「${keyword}」に関する構成案を、ユーザーの修正指示に従って修正してください。

【修正指示】
${revisionInstruction}

【修正の範囲について】
- 「全体を作り直して」「全部変えて」「最初から作って」などの指示があれば、構成全体を大胆に再設計してください
- 特定のセクションや要素への指示であれば、該当箇所のみを修正し、他は維持してください
- ユーザーの意図を汲み取り、柔軟に対応してください

【現在の構成案（JSON）】
${currentOutlineJson}

【絶対厳守ルール（どんな修正でも必ず守ること）】
- タイトル文字数: 29〜35文字（32文字前後が理想）
- タイトルに自社サービス名を含めない
- タイトルに【】などの記号で囲まない（冒頭に限り使用可）
- H2見出しに【】等の記号を使わない
- 「○選」「○つ」型H2のH3はその数と同数・通し番号付き
- H2ごとにH3は0個か2個以上（1個は禁止）
- まとめセクションのH3は必ず0個
- 最後の順序: FAQ（あれば）→ 自社サービス訴求 → まとめ
- 自社サービス訴求セクションはまとめの直前に必須
- まとめの形式: 「まとめ：[キーワードを含む総括的なサブタイトル]」
- 記事全体の文字数目標: 5,000〜6,000字（各セクションのcharacterCountの合計がこの範囲に収まること）

【出力形式】
修正後の構成案を、入力と同じJSONスキーマで返してください。
JSON以外のテキストは一切含めないこと。

必要なJSONフィールド:
- title（文字列）
- metaDescription（文字列）
- introductions（オブジェクト: pattern1, pattern2を含む）
- targetAudience（文字列）
- outline（配列: heading, subheadings, imageSuggestion, writingNoteを含む）
- conclusion（文字列）
- keywords（文字列配列）
- characterCountAnalysis（オブジェクト）
- competitorComparison（オブジェクト）
- searchIntent（オブジェクト: primary, secondaryを含む）
- freshnessData（オブジェクト）`;

  console.log("🔄 構成案AI修正中...");

  const result = await model.generateContent(prompt);
  let responseText = result.response.text();

  // JSONの前後の不要な文字を削除
  responseText = responseText.replace(/^```json\s*/i, "").replace(/\s*```$/i, "");
  responseText = responseText.trim();

  let revisedData: SeoOutlineV2;
  try {
    revisedData = JSON.parse(responseText);
  } catch (parseError) {
    console.error("JSONパースエラー:", parseError);
    console.error("Response:", responseText.substring(0, 300));
    throw new Error("修正後の構成案のJSONパースに失敗しました");
  }

  // 必須フィールドのフォールバック（念のため元データで補完）
  if (!revisedData.characterCountAnalysis && currentOutline.characterCountAnalysis) {
    revisedData.characterCountAnalysis = currentOutline.characterCountAnalysis;
  }
  if (!revisedData.freshnessData && currentOutline.freshnessData) {
    revisedData.freshnessData = currentOutline.freshnessData;
  }

  console.log("✅ 構成案AI修正完了");
  return revisedData;
}
