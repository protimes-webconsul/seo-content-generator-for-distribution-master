// 構成案生成サービス - サイトデータ型モード
// 事実ベース・ハルシネーション抑制重視のプロンプトを使用
// 出力は SeoOutlineV2 互換形式（パイプライン共通）

import { GoogleGenAI } from "@google/genai";
import type {
  SeoOutlineV2,
  CompetitorResearchResult,
  ArticleAnalysis,
  OutlineSectionV2,
  IntroductionPatterns,
  CompetitorComparisonSummary,
} from '../types';
import { countCharacters, truncateToLength } from '../utils/characterCounter';
import { generateTitleHook } from '../utils/titleHookGenerator';
import { getContextForKeywords, isSupabaseAvailable } from './primaryDataService';
import type { ClientProfile } from '../types';
import { buildClientPromptContext } from './clientDataService';

const apiKey = import.meta.env.VITE_GEMINI_API_KEY || process.env.GEMINI_API_KEY;
if (!apiKey) {
  throw new Error("GEMINI_API_KEY not set.");
}
const genAI = new GoogleGenAI({ apiKey });

/**
 * サイトデータ型モードで構成案を生成する
 *
 * 特徴:
 * - clientProfile（サイトデータ相当）と referenceMaterialContext を事実の基盤とする
 * - ハルシネーション抑制を最優先（提供データに存在する情報のみ使用）
 * - 章形式の思考で構成（第N章 → H2 に変換）
 * - 検索意図3点整理・想定読者・記事目的・流れを明示
 * - 競合データは検索意図の参考にのみ使用（構造の追従は行わない）
 */
export async function generateOutlineSiteDataMode(
  keyword: string,
  competitorResearch: CompetitorResearchResult,
  includeImages: boolean = true,
  _generateTwoIntroductions: boolean = true,
  referenceMaterialContext?: string,
  clientProfile?: ClientProfile
): Promise<SeoOutlineV2> {
  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().getMonth() + 1;
  const validArticles = competitorResearch.validArticles;

  // 競合の基本数値（参考値のみ）
  const competitorH2Avg = validArticles.length > 0
    ? Math.round(validArticles.slice(0, 10).reduce((sum, a) => sum + a.headingStructure.h2Items.length, 0) / Math.min(10, validArticles.length))
    : 6;

  // 頻出キーワード（検索意図把握用）
  const mustIncludeWords = competitorResearch.frequencyWords
    ? competitorResearch.frequencyWords
        .filter(function(w) { return w.articleCount >= 8; })
        .map(function(w) { return w.word; })
        .slice(0, 10)
    : [];

  // Supabase 一次情報
  let primaryDataContext = '';
  if (isSupabaseAvailable()) {
    const searchKeywords = keyword.split(/\s+/).map(w => w.trim()).filter(Boolean);
    primaryDataContext = await getContextForKeywords(searchKeywords.length > 0 ? searchKeywords : [keyword], { limit: 10 });
  }

  // タイトルフック候補
  const competitorTitles = validArticles.slice(0, 10).map(function(a) { return a.title; });
  const titleHook = generateTitleHook(keyword, competitorTitles, []);

  // 競合の検索意図サマリ（上位5記事のH2を列挙して読者ニーズを把握させる）
  const competitorIntentSummary = validArticles.slice(0, 5).map(function(article, idx) {
    const h2List = article.headingStructure.h2Items.map(function(h2) { return h2.text; }).join('、');
    return (idx + 1) + '位「' + article.title + '」: ' + h2List;
  }).join('\n');

  // サイトデータ（clientProfile + referenceMaterial + primaryData）をまとめる
  const siteDataSection = buildSiteDataSection(clientProfile, referenceMaterialContext, primaryDataContext);

  const prompt = `
あなたは《戦略的SEOブログ代行サービスの構成作成AI》です。

以下の【基本情報】と【サイトデータ】（対象店舗・サービスの実際の情報）を読み込み、
キーワードに即した検索ニーズを踏まえつつ、
実際に提供している情報・強み・訴求ポイントのみを"事実ベース"で反映した構成案を作成してください。

このプロンプトの目的：
ハルシネーションを排除し、サイトデータに存在する情報だけを踏まえて構成案を作ること。

【基本情報】
- キーワード: ${keyword}
- 現在: ${currentYear}年${currentMonth}月
- 競合記事数: ${validArticles.length}件分析済み
- 競合の平均H2数（参考値）: ${competitorH2Avg}本

【検索意図の把握（競合記事より）】
上位競合が取り上げているトピック（参考のみ、構造を真似る必要はない）:
${competitorIntentSummary}

頻出キーワード（読者が求めている情報の手がかり）:
${mustIncludeWords.length > 0 ? mustIncludeWords.join('、') : '（データなし）'}

【サイトデータ】
${siteDataSection}

【タイトルのヒント】
推奨フック: ${titleHook}

【注意点（ハルシネーション抑制）】
- サイトデータを基本的な事実情報として扱い、記載内容の中心にする
- サイトデータに存在しない内容でも、一般的に正しい情報・業界慣習・法的に必須の説明は補足として記載して良い
  ただし、店舗が実施していないサービスを"実施しているように"書くことは禁止
- 具体的な数値（件数・%・年数等）はサイトデータに記載がある場合のみ使用すること
- サイトデータが不十分な場合は、一般的・定性的な表現（「豊富な実績」「地域密着」等）にとどめる
- 他社・競合の固有名詞は使用しない
- 読者が理解しやすい平易な表現を使う
- 専門用語は初心者向けに簡潔に説明する
- 「結論 → 理由 → 行動」の流れで書く

【費用・助成金に関するルール】
- 費用相場・助成金・補助金は、サイトデータに具体的な記載がある場合のみ主要H2として設定してよい
- サイトデータに記載がない場合は、費用・助成金・補助金について記事内で一切触れないこと（定性表現・1行言及も禁止）
- ただし、入力キーワード自体に「助成金」「補助金」「費用」「相場」「価格」「料金」等の文言が含まれる場合は、この制限を適用しない

【章設計の原則】
- 各章は「読者がどのような心理的ステップを踏むか」を基準に設計する
  例：悩みの共感 → 現状理解 → 判断基準の習得 → 行動（相談）
- 競合記事が取り上げているテーマを網羅することが目的ではない
- 競合データは「読者の検索意図を把握する」目的のみに使用する
- 競合が取り上げているH2テーマを構成にそのまま反映することを禁止する
- 構成の軸は「サイトデータ × 読者の意思決定プロセス」で設計すること

【参照URLのルール】
- 各章の参照情報は、必ずサイトデータ内のURLや情報から選ぶこと
- 競合記事のURLや「○位記事参照」「要調査」は使用禁止
- サイトデータに該当URLがない場合は「参照URLなし（一般情報として補足）」と記載する

【タイトル要件】
- 文字数: 29〜50文字（35文字前後が理想）
- キーワードを冒頭5〜10文字以内に含める
- 自社サービス名を含めない
- 【】を使う場合はタイトルの最初に配置

【メタディスクリプション要件】
- 文字数: 100〜150文字（125文字が理想）
- キーワードを必ず含める

【構成案の作り方】
以下の流れで思考し、JSONを出力してください。

① 【キーワードを検索した読者が知りたいこと】
   検索意図を3点に整理する（上の競合データと頻出KWを参照）

② 【想定読者】
   年齢層・悩み・動機を具体的に想定する

③ 【記事全体の目的】
   この記事で何を伝え、どのような行動を促すか
   （誤情報への注意喚起 + 信頼できる行動=相談・問い合わせへの流れを含める）

④ 【記事全体の流れ】
   「導入 → 本文 → まとめ」の最適なストーリー展開を設計する
   ※毎回このキーワードに最適な流れを考えること（固定文禁止）

⑤ 【各章の設計】
   上の①〜④を踏まえて章を設計する
   各章は「第N章: タイトル」形式で考え、JSONのH2に変換する

   各章の執筆メモには以下を含める:
   - 伝えたい内容（この章の核心）
   - 書く内容（具体的に書くこと）
   - 意図（この章が読者にもたらす効果）
   - 参照情報（サイトデータの該当箇所、または「一般情報として補足」）

【章数の目安】
- 5〜7章（H2）を目標とする
- 最終章の直前：自社サービス訴求（必須）
- 最終章：まとめ（必須、H3なし）
- H3は各章に0個または2個以上（1個禁止）
- まとめ章は必ずH3 0個

【JSON出力形式（変更禁止）】
{
  "title": "タイトル（29-50文字）",
  "metaDescription": "メタディスクリプション（100-150文字）",
  "searchIntentAnalysis": {
    "problem": "読者が抱えている具体的な問題（サイトデータを踏まえた記述）",
    "information": "問題解決に必要な情報（1〜2文）",
    "desiredOutcome": "読後に読者がなりたい状態（1文）"
  },
  "articlePurpose": "記事全体の目的（何を伝え、どのような行動を促すか。1段落）",
  "articleFlow": "記事全体の流れ（導入→本文→まとめのストーリー展開。2〜3文）",
  "targetAudience": "想定読者（年齢層・悩み・動機）",
  "introductions": {
    "empathy": "導入文（200〜350字。読者の悩みを代弁し、記事を読む動機を与える）"
  },
  "outline": [
    {
      "heading": "第1章のH2見出し",
      "subheadings": [
        {
          "text": "H3見出し（必要な場合のみ。0個またはの2個以上）",
          "writingNote": "このH3で伝えること・書く内容・意図（200字目安）"
        }
      ],
      "writingNote": "【伝えたい内容】○○ / 【書く内容】○○ / 【意図】○○ / 【参照】サイトデータの○○ページ or 一般情報として補足"
    }
  ],
  "conclusion": "まとめの要点（記事全体を3〜5点で総括）",
  "keywords": ["重要キーワード1", "重要キーワード2"],
  "differentiators": ["競合との差分1", "競合との差分2", "競合との差分3"]
}
`;

  const result = await genAI.models.generateContent({
    model: "gemini-3.1-pro-preview",
    contents: prompt,
    config: {
      temperature: 0.4,
      maxOutputTokens: 16000,
      responseMimeType: "application/json"
    }
  });

  let responseText = result.text || '';
  responseText = responseText.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim();

  let generatedData: any;
  try {
    generatedData = JSON.parse(responseText);
  } catch (parseError) {
    console.error('JSONパースエラー（サイトデータモード）:', parseError);
    throw new Error('構成案の生成でJSONパースに失敗しました（サイトデータモード）');
  }

  // ── タイトル処理 ──
  let processedTitle = generatedData.title || keyword + 'について';
  // 【】が途中にある場合は先頭に移動
  const bracketMatch = processedTitle.match(/(.+?)(【.+?】)(.+)/);
  if (bracketMatch) {
    const bracketContent = bracketMatch[2];
    const beforeBracket = bracketMatch[1].trim();
    const afterBracket = bracketMatch[3].trim();
    processedTitle = bracketContent + beforeBracket + afterBracket;
    console.log('[SiteData] タイトル【】位置修正: ' + processedTitle);
  }
  const adjustedTitle = truncateToLength(processedTitle, 50);

  // ── メタディスクリプション処理 ──
  let adjustedMeta = generatedData.metaDescription || '';
  if (countCharacters(adjustedMeta) < 100) {
    adjustedMeta = adjustedMeta + keyword + 'について詳しく解説します。';
  }
  adjustedMeta = truncateToLength(adjustedMeta, 150);

  // ── アウトライン処理 ──
  const rawOutline: any[] = Array.isArray(generatedData.outline) ? generatedData.outline : [];

  const processedOutline: OutlineSectionV2[] = rawOutline.map(function(section: any, index: number) {
    const isLastSection = index === rawOutline.length - 1;
    const isSummarySection = section.heading && (
      section.heading.includes('まとめ') ||
      section.heading.includes('最後に') ||
      section.heading.includes('おわりに')
    );

    const rawSubs: any[] = Array.isArray(section.subheadings) ? section.subheadings : [];
    let subheadings: OutlineSectionV2['subheadings'];

    if (isLastSection || isSummarySection) {
      subheadings = []; // まとめは必ずH3なし
    } else if (rawSubs.length === 1) {
      subheadings = []; // H3が1個の場合は0個に（ルール適用）
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
      imageSuggestion: includeImages ? section.imageSuggestion || '' : '',
      writingNote: section.writingNote || ''
    };
  });

  // ── H2数の上限チェック（7本まで）──
  let finalOutline = processedOutline;
  if (finalOutline.length > 7) {
    console.warn('[SiteData] H2数超過: ' + finalOutline.length + '本 → 7本に削減');
    const fixedTail = finalOutline.slice(-2);
    const contentSections = finalOutline.slice(0, -2).slice(0, 5);
    finalOutline = contentSections.concat(fixedTail);
  }

  const ourH3Count = finalOutline.reduce(function(sum, s) { return sum + s.subheadings.length; }, 0);

  // ── 競合比較サマリ ──
  const competitorComparison: CompetitorComparisonSummary = {
    averageH2Count: competitorH2Avg,
    averageH3Count: 0,
    ourH2Count: finalOutline.length,
    ourH3Count: ourH3Count,
    freshnessRisks: [],
    differentiators: generatedData.differentiators || [
      'サイト実績データに基づく独自コンテンツ',
      '事実ベースの信頼性の高い情報',
      'サービス訴求と読者課題解決を両立'
    ]
  };

  // ── 導入文 ──
  const introductions: IntroductionPatterns = {
    conclusionFirst: generatedData.introductions ? (generatedData.introductions.conclusionFirst || generatedData.introductions.empathy || '') : '',
    empathy: generatedData.introductions ? (generatedData.introductions.empathy || '') : ''
  };

  // ── ログ ──
  console.log('\n[SiteDataMode] 構成案生成完了');
  if (generatedData.searchIntentAnalysis) {
    const sia = generatedData.searchIntentAnalysis;
    console.log('  Problem: ' + (sia.problem || '—'));
    console.log('  Information: ' + (sia.information || '—'));
    console.log('  Desired Outcome: ' + (sia.desiredOutcome || '—'));
  }
  if (generatedData.articlePurpose) {
    console.log('  記事目的: ' + generatedData.articlePurpose);
  }
  if (generatedData.articleFlow) {
    console.log('  記事の流れ: ' + generatedData.articleFlow);
  }

  return {
    title: adjustedTitle,
    metaDescription: adjustedMeta,
    introductions,
    targetAudience: generatedData.targetAudience || '',
    outline: finalOutline,
    conclusion: generatedData.conclusion || '',
    searchIntentAnalysis: generatedData.searchIntentAnalysis || null,
    articlePurpose: generatedData.articlePurpose || '',
    articleFlow: generatedData.articleFlow || '',
    keywords: [...mustIncludeWords, ...(Array.isArray(generatedData.keywords) ? generatedData.keywords : [])].slice(0, 15),
    characterCountAnalysis: {
      average: competitorResearch.recommendedWordCount ? competitorResearch.recommendedWordCount.optimal : 5000,
      median: competitorResearch.recommendedWordCount ? competitorResearch.recommendedWordCount.optimal : 5000,
      min: competitorResearch.recommendedWordCount ? competitorResearch.recommendedWordCount.min : 3000,
      max: competitorResearch.recommendedWordCount ? competitorResearch.recommendedWordCount.max : 8000,
      analyzedArticles: validArticles.length
    },
    competitorComparison,
    searchIntent: { primary: 'KNOW' },
    freshnessData: { hasOutdatedInfo: false, outdatedSections: [] }
  };
}

/**
 * clientProfile・referenceMaterial・primaryData を「サイトデータ」セクションとしてまとめる
 */
function buildSiteDataSection(
  clientProfile?: ClientProfile,
  referenceMaterialContext?: string,
  primaryDataContext?: string
): string {
  const parts: string[] = [];

  if (clientProfile) {
    parts.push('【取引先プロフィール（サイトデータ相当）】');
    parts.push(buildClientPromptContext(clientProfile));
  }

  if (referenceMaterialContext && referenceMaterialContext.trim()) {
    parts.push('\n【参考資料・自社独自情報】');
    parts.push(referenceMaterialContext.trim());
    parts.push('※上記の参考資料に記載された情報のみ具体的数値として使用すること。');
  }

  if (primaryDataContext && primaryDataContext.trim()) {
    parts.push('\n【一次情報データベース（関連情報）】');
    parts.push(primaryDataContext.trim());
  }

  if (parts.length === 0) {
    return '（サイトデータなし：一般的な業界情報と検索意図のみを基に構成してください。具体的な数値・事例は使用しないこと）';
  }

  return parts.join('\n');
}
