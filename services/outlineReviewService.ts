// 構成案チェック・改善サービス
// 10項目の修正方針に基づいてチェック→修正済み構成案を返す

import { GoogleGenAI } from "@google/genai";
import type { SeoOutlineV2, OutlineSectionV2, IntroductionPatterns, CompetitorComparisonSummary } from '../types';

const apiKey = import.meta.env.VITE_GEMINI_API_KEY || process.env.GEMINI_API_KEY;
if (!apiKey) {
  throw new Error("GEMINI_API_KEY not set.");
}
const genAI = new GoogleGenAI({ apiKey });

// チェック1項目の結果
export interface ReviewItem {
  number: number;
  title: string;
  status: 'ok' | 'warning' | 'ng';
  comment: string;
}

// チェック・改善の全体結果
export interface OutlineReviewResult {
  reviewItems: ReviewItem[];
  overallComment: string;
  revisedOutline: SeoOutlineV2;
}

// 構成案をテキスト形式に変換（プロンプト用）
function outlineToText(outline: SeoOutlineV2): string {
  let text = 'タイトル：' + outline.title + '\n';
  text += 'メタディスクリプション：' + outline.metaDescription + '\n';
  text += 'ターゲット読者：' + outline.targetAudience + '\n';
  if (outline.articleFlow) {
    text += '記事の流れ：' + outline.articleFlow + '\n';
  }
  text += '\n【構成案】\n';
  for (let i = 0; i < outline.outline.length; i++) {
    const section = outline.outline[i];
    text += 'H2-' + (i + 1) + '：' + section.heading + '\n';
    if (section.writingNote) {
      text += '  執筆メモ：' + section.writingNote + '\n';
    }
    if (section.subheadings && section.subheadings.length > 0) {
      for (let j = 0; j < section.subheadings.length; j++) {
        const sub = section.subheadings[j];
        const subText = typeof sub === 'string' ? sub : sub.text;
        const subNote = typeof sub === 'string' ? '' : (sub.writingNote || '');
        text += '  H3-' + (j + 1) + '：' + subText + '\n';
        if (subNote) {
          text += '    執筆メモ：' + subNote + '\n';
        }
      }
    }
  }
  text += '\nまとめ：' + outline.conclusion + '\n';
  return text;
}

export async function reviewAndReviseOutline(
  outline: SeoOutlineV2,
  keyword: string
): Promise<OutlineReviewResult> {

  const outlineText = outlineToText(outline);

  const prompt = `
あなたはSEO記事の構成案チェック・改善の専門家です。

以下の【構成案】を【10項目のチェック基準】に基づいて審査し、
審査結果と改善済み構成案をJSONで出力してください。

【キーワード】
${keyword}

【構成案】
${outlineText}

【10項目のチェック基準】

1. 検索意図に沿った章の順番
   読者が知りたい順番に章が並んでいるか。店舗が伝えたいことより、検索者が求める情報を優先しているか。

2. 章ごとの役割の重複
   複数の章で同じような内容を説明していないか。役割がかぶっている章は統合・整理されているか。

3. 章数の適切さ
   情報量に対して章数が多すぎ・少なすぎないか。1章に複数の役割が詰め込まれていないか。

4. 「書く内容」の情報量
   各章の執筆メモが情報過多になっていないか。その章で本当に必要な情報に絞られているか。

5. 章タイトルと書く内容の整合性
   章タイトルと執筆メモの内容が一致しているか。タイトルと書く内容にズレがないか。

6. 店舗紹介・相談導線の扱い
   店舗紹介が独立した大きな章になりすぎていないか。相談導線が自然な流れで組み込まれているか。

7. 読者が置き去りにならない流れ
   前章から次章への流れが自然か。どの読者層も次のステップへ進みやすい構成になっているか。

8. 自己確認と専門家確認の分離
   読者が自分で確認できることと、専門業者に確認してもらうことが適切に分けられているか。

9. 問い合わせまでの流れ
   情報の網羅ではなく、読者が相談・問い合わせに進むための流れが作れているか。

10. ライター向け指示の具体性
    執筆メモがライターにとって迷わない具体的な内容になっているか。章の意図と範囲が明確か。

【出力JSON形式（変更禁止）】
{
  "reviewItems": [
    {
      "number": 1,
      "title": "検索意図に沿った章の順番",
      "status": "ok" | "warning" | "ng",
      "comment": "具体的なコメント（OKの場合も理由を1文で記載）"
    }
    // 2〜10も同様
  ],
  "overallComment": "全体的な評価と改善のポイントを2〜3文で",
  "revisedOutline": {
    "title": "修正後タイトル（問題なければ元のまま）",
    "metaDescription": "修正後メタディスクリプション（問題なければ元のまま）",
    "targetAudience": "修正後ターゲット読者（問題なければ元のまま）",
    "articleFlow": "修正後の記事の流れ（問題なければ元のまま）",
    "outline": [
      {
        "heading": "H2見出し",
        "writingNote": "修正後執筆メモ（【伝えたい内容】/【書く内容】/【意図】/【参照】形式）",
        "subheadings": [
          {
            "text": "H3見出し",
            "writingNote": "H3執筆メモ"
          }
        ]
      }
    ],
    "conclusion": "まとめの要点（修正後）"
  }
}

【重要な修正ルール】
- statusが"ok"の項目は変更不要
- statusが"warning"または"ng"の項目は具体的に修正すること
- H3が1個になる場合は必ず0個に変換（1個禁止ルール）
- まとめ章は必ずH3 0個
- 修正は最小限にとどめ、問題のない部分は変えない
`;

  const result = await genAI.models.generateContent({
    model: "gemini-2.5-pro",
    contents: prompt,
    config: {
      temperature: 0.3,
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
    throw new Error('構成案チェックのJSON解析に失敗しました');
  }

  // reviewItems の整形
  const reviewItems: ReviewItem[] = (parsed.reviewItems || []).map(function(item: any) {
    return {
      number: item.number || 0,
      title: item.title || '',
      status: item.status || 'ok',
      comment: item.comment || ''
    };
  });

  // revisedOutline を SeoOutlineV2 に変換
  const raw = parsed.revisedOutline || {};

  const processedOutline: OutlineSectionV2[] = (raw.outline || []).map(function(section: any) {
    const isSummary = section.heading && (
      section.heading.includes('まとめ') ||
      section.heading.includes('最後に') ||
      section.heading.includes('おわりに')
    );
    const rawSubs: any[] = Array.isArray(section.subheadings) ? section.subheadings : [];
    let subheadings: OutlineSectionV2['subheadings'];

    if (isSummary) {
      subheadings = [];
    } else if (rawSubs.length === 1) {
      subheadings = []; // H3が1個の場合は0個に
    } else {
      subheadings = rawSubs.map(function(sub: any) {
        return {
          text: typeof sub === 'string' ? sub : (sub.text || ''),
          writingNote: typeof sub === 'string' ? '' : (sub.writingNote || '')
        };
      });
    }

    return {
      heading: section.heading || '',
      subheadings: subheadings,
      imageSuggestion: section.imageSuggestion || '',
      writingNote: section.writingNote || ''
    };
  });

  const introductions: IntroductionPatterns = {
    conclusionFirst: outline.introductions ? outline.introductions.conclusionFirst : '',
    empathy: outline.introductions ? outline.introductions.empathy : ''
  };

  const revisedOutline: SeoOutlineV2 = {
    title: raw.title || outline.title,
    metaDescription: raw.metaDescription || outline.metaDescription,
    introductions: introductions,
    targetAudience: raw.targetAudience || outline.targetAudience,
    outline: processedOutline,
    conclusion: raw.conclusion || outline.conclusion,
    searchIntentAnalysis: outline.searchIntentAnalysis || null,
    articlePurpose: outline.articlePurpose || '',
    articleFlow: raw.articleFlow || outline.articleFlow || '',
    keywords: outline.keywords,
    characterCountAnalysis: outline.characterCountAnalysis,
    competitorComparison: outline.competitorComparison,
    searchIntent: outline.searchIntent,
    freshnessData: outline.freshnessData
  };

  return {
    reviewItems,
    overallComment: parsed.overallComment || '',
    revisedOutline
  };
}
