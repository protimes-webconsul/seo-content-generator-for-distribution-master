// 構成案生成サービス Ver.2
// SEO構成ワークフローに基づいた新しい構成案生成

import { GoogleGenAI } from "@google/genai";
import type { 
  SeoOutlineV2, 
  CompetitorResearchResult, 
  ArticleAnalysis,
  FrequencyWord,
  OutlineSectionV2,
  IntroductionPatterns,
  CompetitorComparisonSummary
} from '../types';
import { countCharacters, truncateToLength } from '../utils/characterCounter';
import { generateTitleHook, generateFullTitle } from '../utils/titleHookGenerator';
// 自社サービス関連のimportは汎用化のため削除
// import { getCompanyInfo, generateCompanyContext } from './companyService';
// import { curriculumDataService } from './curriculumDataService';
import { getContextForKeywords, isSupabaseAvailable } from './primaryDataService';
import type { ClientProfile } from '../types';
import { buildClientPromptContext } from './clientDataService';

const apiKey = import.meta.env.VITE_GEMINI_API_KEY || process.env.GEMINI_API_KEY;
if (!apiKey) {
    throw new Error("GEMINI_API_KEY not set.");
}
const genAI = new GoogleGenAI({ apiKey });

/**
 * キーワードをスマート分割
 *
 * 1. スペースで分割
 * 2. ノイズワード（「生成AI」「AI」など）を除外
 * 3. 重複排除
 * 4. フォールバック: 空配列なら元キーワードをそのまま返す
 */
function smartSplitKeywords(keyword: string): string[] {
  // ノイズワード定義（大文字小文字・全角半角を正規化して比較）
  const noiseWords = ['生成AI', '生成ai', 'AI', 'ai', 'ＡＩ'];

  // 正規化関数（全角→半角、大文字→小文字）
  const normalize = (str: string) =>
    str.replace(/[Ａ-Ｚａ-ｚ０-９]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xFEE0))
       .toLowerCase();

  // スペースで分割
  const words = keyword.split(/\s+/)
    .map(w => w.trim())
    .filter(Boolean); // 空文字除去

  // スペースで分割できなかった場合（日本語キーワード等）
  if (words.length === 0 || (words.length === 1 && words[0] === keyword)) {
    console.log(`[smartSplitKeywords] スペース分割不可 → 元キーワードで検索: "${keyword}"`);
    return [keyword];
  }

  // ノイズワード除外（正規化して比較）
  const normalizedNoiseWords = noiseWords.map(normalize);
  const filtered = words.filter(w => {
    const normalized = normalize(w);
    return !normalizedNoiseWords.includes(normalized);
  });

  // 重複除去
  const unique = [...new Set(filtered)];

  // フォールバック: 全てノイズワードだった場合
  if (unique.length === 0) {
    console.log(`[smartSplitKeywords] 全てノイズワード → 元キーワードで検索: "${keyword}"`);
    return [keyword];
  }

  console.log(`[smartSplitKeywords] "${keyword}" → ${JSON.stringify(unique)}`);
  return unique;
}

// 競合記事のFAQ有無を判定
function detectCompetitorFAQ(articles: ArticleAnalysis[]): {
  hasFAQ: boolean;
  faqCount: number;
  faqPercentage: number;
} {
  const faqPatterns = /FAQ|よくある質問|Q&A|疑問|質問と回答|お問い合わせ/i;
  
  const articlesWithFAQ = articles.filter(article => {
    return article.headingStructure.h2Items.some(h2 => 
      faqPatterns.test(h2.text)
    );
  });
  
  const faqCount = articlesWithFAQ.length;
  const faqPercentage = (faqCount / articles.length) * 100;
  
  // 60%以上の記事がFAQを含む場合のみFAQありと判定（優先度：弱）
  const hasFAQ = faqPercentage >= 60;
  
  console.log(`📊 FAQ分析: ${faqCount}/${articles.length}記事 (${faqPercentage.toFixed(0)}%) がFAQを含む`);
  console.log(`   判定: ${hasFAQ ? 'FAQ必要' : 'FAQ不要'}`);
  
  return {
    hasFAQ,
    faqCount,
    faqPercentage
  };
}

// ノイズ記事を除外して平均値を計算（FAQ調整付き）
function calculateAveragesExcludingNoise(
  articles: ArticleAnalysis[],
  keyword: string
): {
  averageH2Count: number;
  averageH3Count: number;
  averageCharCount: number;
  excludedArticles: number[];
  originalAverageH2: number;
  originalAverageH3: number;
  filteredArticles: ArticleAnalysis[];
  faqDetection: { hasFAQ: boolean; faqCount: number; faqPercentage: number };
  adjustedH2Count: number;  // 調整後のH2数
  adjustedH3Count: number;  // 調整後のH3数
} {
  // Step 1: 全記事での平均値を計算（除外前）
  const originalH2Avg = articles.reduce((sum, a) => sum + a.headingStructure.h2Items.length, 0) / articles.length;
  const originalH3Avg = articles.reduce((sum, a) => 
    sum + a.headingStructure.h2Items.reduce((h3Sum, h2) => h3Sum + h2.h3Items.length, 0), 0
  ) / articles.length;
  const originalCharAvg = articles.reduce((sum, a) => sum + a.characterCount, 0) / articles.length;
  
  // Step 2: 閾値を設定（平均の30%以下をノイズとする）
  const h2Threshold = originalH2Avg * 0.3;
  const h3Threshold = originalH3Avg * 0.3;
  const charThreshold = originalCharAvg * 0.2; // 文字数は20%以下を除外
  
  // Step 3: ノイズ記事を除外
  const excludedIndices: number[] = [];
  const filteredArticles = articles.filter((article, index) => {
    const h2Count = article.headingStructure.h2Items.length;
    const h3Count = article.headingStructure.h2Items.reduce((sum, h2) => sum + h2.h3Items.length, 0);
    const charCount = article.characterCount;
    
    // 除外条件：H2またはH3が閾値以下、または文字数が極端に少ない
    const shouldExclude = h2Count < h2Threshold || h3Count < h3Threshold || charCount < charThreshold;
    
    if (shouldExclude) {
      excludedIndices.push(index + 1); // 順位（1-based）
      console.log(`🚫 ノイズとして除外: ${index + 1}位 ${article.title}`);
      console.log(`   理由: H2=${h2Count}個(閾値${h2Threshold.toFixed(1)}), H3=${h3Count}個(閾値${h3Threshold.toFixed(1)}), 文字数=${charCount}(閾値${charThreshold.toFixed(0)})`);
    }
    
    return !shouldExclude;
  });
  
  // Step 4: フィルタ後の記事を最大10記事に制限（良質な記事を十分確保）
  const maxArticlesForAnalysis = 10;
  const finalArticles = filteredArticles.slice(0, maxArticlesForAnalysis);
  
  // Step 5: 最終的な平均値を計算
  const averageH2Count = Math.round(
    finalArticles.reduce((sum, a) => sum + a.headingStructure.h2Items.length, 0) / finalArticles.length
  );
  const averageH3Count = Math.round(
    finalArticles.reduce((sum, a) => 
      sum + a.headingStructure.h2Items.reduce((h3Sum, h2) => h3Sum + h2.h3Items.length, 0), 0
    ) / finalArticles.length
  );
  const averageCharCount = Math.round(
    finalArticles.reduce((sum, a) => sum + a.characterCount, 0) / finalArticles.length
  );
  
  // ログ出力
  console.log(`\n📊 ノイズ除外による平均値の変化（${keyword}）:`);
  console.log(`   初期対象: ${articles.length}記事（上位15記事まで）`);
  console.log(`   ノイズ除外後: ${filteredArticles.length}記事（${excludedIndices.length}記事除外）`);
  console.log(`   最終分析対象: ${finalArticles.length}記事（最大10記事に制限）`);
  console.log(`   H2平均: ${originalH2Avg.toFixed(1)}個 → ${averageH2Count}個`);
  console.log(`   H3平均: ${originalH3Avg.toFixed(1)}個 → ${averageH3Count}個`);
  console.log(`   文字数平均: ${originalCharAvg.toFixed(0)}文字 → ${averageCharCount}文字`);
  if (excludedIndices.length > 0) {
    console.log(`   除外記事: ${excludedIndices.join(', ')}位`);
  }
  
  // Step 6: FAQ検出
  const faqDetection = detectCompetitorFAQ(finalArticles);

  // Step 7: 調整後の数を計算
  // FAQは競合の状況に応じて追加
  const faqH2Addition = faqDetection.hasFAQ ? 0 : 0; // FAQは競合にある場合は平均に含まれているので追加しない
  const faqH3Addition = faqDetection.hasFAQ ? 0 : 0; // FAQのH3も同様

  const adjustedH2Count = averageH2Count + faqH2Addition;
  const adjustedH3Count = averageH3Count + faqH3Addition;

  console.log(`\n📊 最終調整後の目標値:`);
  console.log(`   基本H2数: ${averageH2Count}個`);
  console.log(`   + FAQ調整: ${faqH2Addition}個`);
  console.log(`   = 調整後H2数: ${adjustedH2Count}個`);
  console.log(`   基本H3数: ${averageH3Count}個`);
  console.log(`   = 調整後H3数: ${adjustedH3Count}個`)
  console.log('');
  
  return {
    averageH2Count,
    averageH3Count,
    averageCharCount,
    excludedArticles: excludedIndices,
    originalAverageH2: originalH2Avg,
    originalAverageH3: originalH3Avg,
    filteredArticles: finalArticles,  // 最大10記事に制限した最終的な記事リスト
    faqDetection,
    adjustedH2Count,
    adjustedH3Count
  };
}

// 検索意図の分類
function classifySearchIntent(keyword: string): { primary: string; secondary?: string } {
  const lowerKeyword = keyword.toLowerCase();
  
  // KNOW意図のパターン
  if (lowerKeyword.includes('とは') || lowerKeyword.includes('意味') || 
      lowerKeyword.includes('違い') || lowerKeyword.includes('理由')) {
    return { primary: 'KNOW' };
  }
  
  // DO意図のパターン
  if (lowerKeyword.includes('やり方') || lowerKeyword.includes('方法') || 
      lowerKeyword.includes('手順') || lowerKeyword.includes('使い方') ||
      lowerKeyword.includes('登録') || lowerKeyword.includes('料金')) {
    return { primary: 'DO' };
  }
  
  // NAV意図のパターン
  if (lowerKeyword.includes('公式') || lowerKeyword.includes('ログイン')) {
    return { primary: 'NAV' };
  }
  
  // LOCAL意図のパターン
  if (lowerKeyword.includes('近く') || lowerKeyword.includes('店舗') || 
      lowerKeyword.includes('営業時間')) {
    return { primary: 'LOCAL' };
  }
  
  // デフォルトはKNOW
  return { primary: 'KNOW' };
}

// FAQ見出しの生成（キーワードの種類に応じて適切な見出しを生成）
function generateFAQHeading(keyword: string): string {
  // キーワードの種類を判定
  const isProblematic = /問題|課題|リスク|デメリット|欠点|危険|懸念|注意/.test(keyword);
  const isComparison = /比較|違い|選び方|選定|検討/.test(keyword);
  const isBenefit = /メリット|効果|利点|価値|成果|効率/.test(keyword);
  const isImplementation = /導入|活用|実装|使い方|始め方|やり方/.test(keyword);
  const isBasic = /とは|基本|基礎|入門|初心者/.test(keyword);
  
  // 問題・課題系のキーワード
  if (isProblematic) {
    // キーワードから不要な部分を削除して整形
    const cleanKeyword = keyword.replace(/\s+/g, '').replace(/導入/, '');
    return `${cleanKeyword}に関するよくある質問`;
  }
  
  // 比較・選定系のキーワード
  if (isComparison) {
    return `${keyword}のよくある質問`;
  }
  
  // メリット・効果系のキーワード
  if (isBenefit) {
    return `${keyword}検討時のよくある質問`;
  }
  
  // 導入・活用系のキーワード（問題系でない場合のみ）
  if (isImplementation && !isProblematic) {
    return `${keyword}時のよくある質問`;
  }
  
  // 基本・入門系のキーワード
  if (isBasic) {
    // 問題系の場合は特別な処理
    if (isProblematic) {
      const cleanKeyword = keyword.replace(/\s+/g, '');
      return `${cleanKeyword}のよくある疑問を解決`;
    }
    return `${keyword}のよくある疑問を解決`;
  }
  
  // デフォルト（上記に該当しない場合）
  return `${keyword}に関するFAQ`;
}

// 上位3記事のH2順序の多数派を特定
function determineH2Order(topArticles: ArticleAnalysis[]): string[] {
  // 上位3記事を取得
  const top3 = topArticles.slice(0, 3);
  
  // H2のパターンを収集
  const h2Patterns: Map<string, number> = new Map();
  
  top3.forEach(article => {
    const h2Sequence = article.headingStructure.h2Items
      .map(item => {
        // 正規化（数字や記号を除去）
        return item.text
          .replace(/[0-9０-９①-⑩]/g, '')
          .replace(/【】「」『』\[\]/g, '')
          .replace(/^\d+\.\s*/, '')
          .trim();
      })
      .join(' → ');
    
    h2Patterns.set(h2Sequence, (h2Patterns.get(h2Sequence) || 0) + 1);
  });
  
  // 最も多いパターンを選択
  let maxCount = 0;
  let bestPattern = '';
  
  h2Patterns.forEach((count, pattern) => {
    if (count > maxCount) {
      maxCount = count;
      bestPattern = pattern;
    }
  });
  
  // パターンを個別のH2に分解
  return bestPattern.split(' → ').filter(h2 => h2.length > 0);
}

// 目標文字数5,000〜6,000字からH2・H3数を逆算（-10%ルール廃止）
function calculateH2H3FromCharCount(): {
  minH2Count: number;
  maxH2Count: number;
  idealH2Count: number;
  maxH3Total: number;
} {
  // リード(275字) + まとめ(350字) = 625字の固定費
  // 本文余白: 5,000 - 625 = 4,375字（最小）/ 6,000 - 625 = 5,375字（最大）
  // H2 1本あたり700〜900字として逆算
  //   最小: 4,375 ÷ 900 ≈ 4.9 → 5本
  //   最大: 5,375 ÷ 700 ≈ 7.7 → 7本
  // H3は1本あたり平均250字として、H2 6本 × 700字 = 4,200字使用後の残余で計算
  // 上限12個に設定（250字 × 12 = 3,000字、H2本文との合計で6,000字以内に収める）
  return {
    minH2Count: 5,    // 最低5本（まとめ・自社訴求含む）
    maxH2Count: 7,    // 最大7本（文字数上限から厳守）
    idealH2Count: 6,  // 理想6本
    maxH3Total: 12    // H3合計の上限（文字数オーバー防止）
  };
}

// H3の「0 or 2以上」ルールを適用
function adjustH3Count(h3Count: number): number {
  if (h3Count === 1) {
    return 0; // 1個の場合は0個にする
  }
  return h3Count;
}

// 鮮度判定
function checkFreshness(articles: ArticleAnalysis[]): {
  hasOutdatedInfo: boolean;
  outdatedSections: string[];
} {
  const currentYear = new Date().getFullYear();
  const outdatedSections: string[] = [];
  
  articles.forEach((article, index) => {
    // タイトルや内容に古い年号がある場合
    if (article.title.match(/20[12][0-9]/)) {
      const year = parseInt(article.title.match(/20[12][0-9]/)![0]);
      if (year < currentYear - 1) {
        outdatedSections.push(`記事${index + 1}: ${year}年の情報を含む`);
      }
    }
  });
  
  return {
    hasOutdatedInfo: outdatedSections.length > 0,
    outdatedSections
  };
}

// 具体的な画像提案を生成
function generateConcreteImageSuggestion(h2Title: string, searchIntent: string): string {
  const suggestions: { [key: string]: string } = {
    '基本': '3つの基本要素を示すベン図＋各要素に簡潔な説明テキスト',
    '種類': '各種類を比較する表形式のインフォグラフィック＋特徴アイコン',
    'メリット': 'メリットを示す上昇矢印グラフ＋数値データの注釈',
    'デメリット': '注意点を示すチェックリスト形式の図解＋対策方法の吹き出し',
    '手順': 'ステップバイステップのフローチャート＋各ステップの所要時間',
    '方法': '実践方法を示すスクリーンショット＋操作箇所への赤枠と番号',
    '事例': '成功事例のビフォーアフター比較図＋改善ポイントの強調',
    '比較': '競合比較表＋優位性を示す星評価とコメント',
    'ツール': 'ツール画面のスクリーンショット＋主要機能への注釈矢印',
    '費用': '料金プランの比較表＋おすすめプランのハイライト'
  };
  
  // キーワードに基づいて最適な提案を選択
  for (const [key, suggestion] of Object.entries(suggestions)) {
    if (h2Title.includes(key)) {
      return suggestion;
    }
  }
  
  // デフォルトの提案
  return `${h2Title}の概念を視覚的に説明する図解＋重要ポイント3つの注釈`;
}

// メイン生成関数
export async function generateOutlineV2(
  keyword: string,
  competitorResearch: CompetitorResearchResult,
  includeImages: boolean = true,
  generateTwoIntroductions: boolean = true, // 導入文を2パターン生成するか
  referenceMaterialContext?: string, // 参考資料テキスト（任意）
  clientProfile?: ClientProfile // 取引先プロフィール（任意）
): Promise<SeoOutlineV2> {
  const searchIntent = classifySearchIntent(keyword);
  const validArticles = competitorResearch.validArticles;
  
  // 上位15記事から分析を開始（ノイズ除外後に良質な記事を十分確保）
  const top15Articles = validArticles.slice(0, Math.min(15, validArticles.length));
  const { 
    averageH2Count, 
    averageH3Count,
    averageCharCount,
    excludedArticles,
    filteredArticles,
    faqDetection,
    adjustedH2Count,
    adjustedH3Count
  } = calculateAveragesExcludingNoise(top15Articles, keyword);
  
  // 文字数5,000〜6,000字から逆算してH2・H3数を決定（最強優先）
  const { minH2Count, maxH2Count, idealH2Count, maxH3Total } = calculateH2H3FromCharCount();
  
  // H2順序の決定（上位3記事の多数派）
  const top3Articles = validArticles.slice(0, 3);
  const h2Order = determineH2Order(top3Articles);
  
  // 鮮度チェック
  const freshnessData = checkFreshness(validArticles);
  
  // 頻出単語から必須キーワードを抽出
  const mustIncludeWords = competitorResearch.frequencyWords
    ?.filter(w => w.articleCount >= 8)
    .map(w => w.word)
    .slice(0, 10) || [];
  
  // Geminiで構成案を生成
  // 現在の年を動的に取得
  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().getMonth() + 1;
  
  // 自社サービス情報は外部設定で管理（汎用版）
  
  // FAQ見出しを生成
  const faqHeading = generateFAQHeading(keyword);

  // Supabase一次情報を取得（補強目的）
  let primaryDataContext = '';
  if (isSupabaseAvailable()) {
    console.log('[OutlineV2] Supabaseから一次情報を取得中...');

    // キーワードをスマート分割（ノイズワード除外 + OR検索）
    const searchKeywords = smartSplitKeywords(keyword);
    console.log(`[OutlineV2] 検索キーワード: ${JSON.stringify(searchKeywords)}`);

    // キーワードから関連する一次情報を検索（最大10件）
    primaryDataContext = await getContextForKeywords(searchKeywords, { limit: 10 });
    if (primaryDataContext) {
      console.log('[OutlineV2] Supabase一次情報の取得成功');
    } else {
      console.log('[OutlineV2] 関連する一次情報が見つかりませんでした');
    }
  }

  // 競合URLリスト（執筆メモの根拠URL参照用）
  const competitorUrlList = validArticles.slice(0, 5).map((article, idx) => {
    const url = article.url || '';
    const title = article.title || '';
    return url ? `${idx + 1}位: ${title} (${url})` : `${idx + 1}位: ${title}`;
  }).filter(Boolean).join('\n');

  const prompt = `
あなたはSEOに精通したコンテンツプランナーです。
現在は${currentYear}年${currentMonth}月です。必ず最新の${currentYear}年の情報を基に構成を作成してください。
以下の要件に従って、「${keyword}」の記事構成案を作成してください。

【記事設計の前提思想】
構成を作る前に、以下の3軸で検索意図を整理してください。これが構成の「なぜ」を決めます。

① 解決したい問題（Problem）
  - このキーワードで検索する人が抱えている具体的な困りごとは何か？
  - 例：「外壁塗装 費用」→「想定より高額な見積りを提示されて判断できない」

② 知りたい情報（Information）
  - 上記の問題を解決するために、読者が必要とする情報は何か？
  - 例：「外壁塗装 費用」→「相場価格・費用の内訳・業者の選び方」

③ なりたい状態（Desired Outcome）
  - 記事を読み終えた後、読者にどういう状態になってほしいか？
  - 例：「外壁塗装 費用」→「適正価格を自分で判断でき、業者選びに自信を持てる」

この3軸の答えを土台に、「読者の課題解決ストーリー」として構成を設計してください。
単なる情報の羅列ではなく、「問題認識→原因理解→解決策習得→実行準備完了」という
読者の状態変化が自然に起きる流れを設計することが目的です。

【⚠️ 最重要：データ外の数値・事実を作ることを禁止 ⚠️】
以下のいずれにも含まれない具体的な数値・事例・固有名詞は、執筆メモに絶対に記載しないこと。
捏造してよい情報は存在しません。不確かな情報は「要確認」と明記するか、記載を省いてください。

使用可能なデータ源：
  1. 【競合分析データ】に含まれる統計・平均値
  2. 【補足：一次情報データベース】に含まれる情報（ある場合）
  3. 【自社独自情報（E-E-A-T強化用）】に含まれる情報（ある場合）
  4. 取引先プロフィール情報（ある場合）
  5. 競合記事の見出し構造から読み取れる一般的な論点（数値は使用不可）

⚠️ 特に注意：以下は捏造率が高いので執筆メモに含めないこと
  - 「市場規模○兆円」「普及率○%」「○社が導入」などの統計数値（提供データにない場合）
  - 「○年に制定」「○年から普及」などの歴史的事実（提供データにない場合）
  - 特定の企業名・製品名・事例（提供データにない場合）

【⚠️ SEO構造の絶対禁止事項 ⚠️】
制約条件:
  他社・競合業者の紹介コンテンツ禁止:
    - 他社・競合他社・競合サービスの名前を見出しや本文に列挙しない
    - 「おすすめ○選」「○社比較」型のH2を作る場合は、他社名ではなく「選び方の観点」「チェックポイント」「手法・アプローチ」をH3に列挙すること
    ❌悪い例:
      H2: "おすすめ外壁塗装業者12選"
      H3: ["1. ○○塗装", "2. △△工業", "3. □□リフォーム"]
    ✅良い例:
      H2: "外壁塗装業者を選ぶ12のポイント"
      H3: ["1. 地元密着かどうか", "2. 施工実績の件数", "3. アフターフォローの内容"]
    理由: "自社サービス訴求を最後に行うため、競合他社を記事内で紹介することは目的に反する"

  H2への番号付け禁止（以下のルール）:
    - H2に順序番号（1. 2. 3.）を付けない
    - 例外: 「○選」「○つのポイント」型のH2のみ番号OK
    ❌悪い例: "1. 生成AIとは？" "2. 導入方法"
    ✅良い例: "生成AIとは？" "おすすめツール12選"
    
  H2_H3関係の絶対禁止パターン:
    - pattern: "H2が質問形 → H3が定義・概要"
      ❌悪い例:
        H2: "生成AIとは？"
        H3: ["生成AIの定義", "生成AIの概要", "生成AIについて"]
      ✅良い例:
        H2: "生成AIとは？"
        H3: ["基本的な仕組み", "主な種類と特徴", "従来のAIとの違い"]
    
    - pattern: "H2とH3が同じ意味"
      ❌悪い例:
        H2: "メリット"
        H3: ["利点", "良い点", "メリット1"]
      ✅良い例:
        H2: "メリット"
        H3: ["業務効率化", "コスト削減", "品質向上"]
    
    - pattern: "H2の言い換えをH3にする"
      ❌悪い例:
        H2: "実施方法"
        H3: ["やり方", "方法", "手法"]
      ✅良い例:
        H2: "実施方法"
        H3: ["事前準備", "環境構築", "実行手順"]

【✅ 正しいJSON構造の例】
以下のようにH2には番号を付けず、H3の関係を明確に分離してください：
{
  "outline": [
    {
      "heading": "SEO対策とは？基本から理解する",  // ← 番号なし
      "subheadings": [
        { "text": "検索エンジンの仕組みと役割" },
        { "text": "Googleアルゴリズムの評価基準" },
        { "text": "オーガニック検索と有料広告の違い" }
      ]
    },
    {
      "heading": "おすすめSEOツール5選",  // ← 「○選」型は番号なしでOK
      "subheadings": [
        { "text": "1. Google Search Console" },  // ← H3には通し番号
        { "text": "2. Ahrefs" },
        { "text": "3. SEMrush" },
        { "text": "4. Moz Pro" },
        { "text": "5. Ubersuggest" }
      ]
    }
  ]
}
※H2には順序番号を付けない。「○選」型のH3のみ通し番号

【重要な注意事項】
- 現在は${currentYear}年です。情報の鮮度が重要な場合のみ「${currentYear}年」を含めてください
- 古い情報や${currentYear - 1}年以前の情報は使用しないでください

【競合分析データ】
- 上位10記事の平均H2数（ノイズ除外後）: ${averageH2Count}
- 上位10記事の平均H3数（ノイズ除外後）: ${averageH3Count}
- 調整後のH2数: ${adjustedH2Count}
- 調整後のH3数: ${adjustedH3Count}
- H2数（文字数逆算）: 最小${minH2Count}本・最大${maxH2Count}本・理想${idealH2Count}本
- H3総数上限（文字数逆算）: ${maxH3Total}個
- FAQ判定: ${faqDetection.hasFAQ ? `推奨（${faqDetection.faqPercentage.toFixed(0)}%の記事が含む）` : '不要（競合での採用率が低い）'}
- 上位3記事のH2順序パターン: ${h2Order.join(' → ')}
- 頻出キーワード: ${mustIncludeWords.join(', ')}
- 除外されたノイズ記事数: ${excludedArticles.length}

【競合記事URL（執筆時の参照先）】
執筆者が内容を深堀りする際に参照できる競合記事です。
執筆メモに「参照：○位記事」と記載して、ライターへのヒントにしてください。
${competitorUrlList}

【重要：上位10記事の実際の見出し構造】
${validArticles.slice(0, 10).map((article, idx) => `
${idx + 1}位：${article.title}
${article.headingStructure.h2Items.map((h2, h2Idx) => {
  const h3Count = h2.h3Items?.length || 0;
  const h3Preview = h3Count > 0 
    ? `\n    → H3: ${h2.h3Items.slice(0, 3).map(h3 => h3).join(', ')}${h3Count > 3 ? ` 他${h3Count - 3}個` : ''}`
    : '';
  return `  H2[${h2Idx + 1}]: ${h2.text}（H3: ${h3Count}個）${h3Preview}`;
}).join('\n')}
`).join('\n')}

【分析のポイント】
${(() => {
  // 「おすすめ○選」パターンの検出（上位10記事から）
  const recommendPatterns = validArticles.slice(0, 10).flatMap(article =>
    article.headingStructure.h2Items.filter(h2 =>
      h2.text.match(/おすすめ|選|比較|ランキング|厳選/)
    )
  );

  if (recommendPatterns.length > 0) {
    const numbers = recommendPatterns.map(h2 => {
      const match = h2.text.match(/(\d+)[選個社つ]/);
      return match ? parseInt(match[1]) : null;
    }).filter(n => n !== null);

    const avgNumber = numbers.length > 0
      ? Math.round(numbers.reduce((a, b) => a + b, 0) / numbers.length)
      : 10;

    return `- 競合は「おすすめ${avgNumber}選」のような形式を使っていますが、他社・他業者名の列挙は禁止です
- 代わりに「選び方の${avgNumber}のポイント」「失敗しない${avgNumber}の確認項目」のように、観点・チェックポイント・手法をH3に列挙してください
- H3には選定基準・チェック観点・比較軸など、読者が自分で判断できる情報を入れること
- 絶対禁止：競合他社名・他業者名・他サービス名の列挙`;
  }

  return '- 競合の見出し構造を参考に、読者の課題解決に直結するトピック構成にしてください';
})()}

【タイトルフックの指示】
${(() => {
  // 競合タイトルを取得（上位10記事）
  const competitorTitles = validArticles.slice(0, 10).map(a => a.title);
  // フックを生成
  const hook = generateTitleHook(keyword, competitorTitles, []);
  return `- 推奨フック: ${hook}
- 検索意図と競合分析に基づいて適切なフックを選択してください
- 情報の鮮度が重要な場合のみ「${currentYear}年」を含めてください`;
})()}


${primaryDataContext ? `
【補足：一次情報データベースからの関連情報】
以下は、社内データベースから取得した関連情報です。構成案に組み込める場合は活用してください（必須ではありません）：

${primaryDataContext}

注意事項：
- 上記の一次情報は信頼できる社内データですが、SEO検索意図を最優先してください
- 関連性が低い場合は無理に使用せず、検索意図に沿った構成を優先
- 使用する場合は、H2やH3の執筆メモに「一次情報より」と明記
` : ''}

${clientProfile ? `
${buildClientPromptContext(clientProfile)}

※上記の取引先執筆ルールは構成案にも反映してください。
- 表記統一ルールは見出し・執筆メモに適用
- 会社名ルールは自社訴求セクションの見出し・メモに反映
- 独自情報は構成案の執筆メモへ積極的に組み込む
` : ''}

${referenceMaterialContext ? `
【自社独自情報（E-E-A-T強化用）】
以下は自社の参考資料をAIで分析し、記事テーマとの関連情報を構造化したものです。
この情報を構成案に積極的に組み込み、競合記事にはない独自性・専門性を出してください。

${referenceMaterialContext}

構成案への反映ルール：
1. 「独自データ・統計」がある場合 → 関連するH2の執筆メモに「自社調査データを根拠として引用」と明記
2. 「導入事例・成功体験」がある場合 → 事例紹介のH2またはH3を構成に含め、執筆メモにBefore/After数値を記載
3. 「専門的知見・ノウハウ」がある場合 → 解説系H2の執筆メモに独自の実務ポイントとして反映
4. 「FAQ・よくある課題」がある場合 → FAQセクションのH3に反映
5. 「記事への活用提案」の内容を参考に、自然な構成を設計
6. 検索意図を最優先とし、文脈に合わない情報は無理に使用しない
7. 執筆メモに反映する際は「自社資料より」と出典を明記
8. 近隣のオススメ業者の紹介をしない
9. 締めは自社サービスへの相談やお問い合わせにて締めくくる
` : ''}

【要件】
構成要件:
  タイトル:
    文字数:
      min: 29
      max: 50
      ideal: 35
    キーワード位置: "冒頭5-10文字以内"
    禁止: ["自社サービス名"]
    隅付き括弧【】ルール:
      - "【】を使用する場合は、必ずタイトルの最初に配置"
      - "タイトルの途中や最後での【】使用は禁止"
      - "良い例：【2025年版】AI研修の導入ガイド"
      - "悪い例：AI研修の【2025年版】導入ガイド"
    読みやすさルール:
      - "漢字の単語同士が直接つながらないよう、適切な助詞（の、を、で、と等）を使用"
      - "悪い例：生成AI活用事例紹介、業務効率化実現方法"
      - "良い例：生成AIの活用事例を紹介、業務効率化を実現する方法"
      - "漢字が4文字以上連続しないよう配慮する"

    クリック率向上テクニック（以下6つのうち、キーワードの性質に合うものを2-3つ組み合わせてタイトルを作成すること）:
      テクニック1_読者像の明示:
        説明: "具体的な読者像を示し『自分向けの記事だ』と認識させる"
        使い方: "「初心者向け」「オーナー必見」「管理会社が知るべき」等の属性ワードをタイトルに含める"
        良い例: ["初心者でも失敗しない外壁塗装の選び方", "マンションオーナー必見！修繕費を抑える方法"]
        適用場面: "ターゲット読者が明確なキーワード（初心者向け、法人向け等）"
      テクニック2_数字で具体性:
        説明: "数字を入れることで情報の具体性と視認性を高める"
        使い方: "「○選」「○つのポイント」「○%」「○分でわかる」等の数字表現を活用"
        良い例: ["外壁塗装の費用相場と5つの節約ポイント", "90%が見落とす大規模修繕の注意点"]
        適用場面: "比較・選び方・ポイント系のキーワード"
      テクニック3_簡単さ・安心感:
        説明: "記事を読めば簡単に理解・実践できると伝え、読者のハードルを下げる"
        使い方: "「わかりやすく解説」「図解あり」「初めてでも安心」等の安心ワードを活用"
        良い例: ["大規模修繕の流れをわかりやすく解説", "【図解あり】屋上防水工事の種類と選び方"]
        適用場面: "専門的・技術的なキーワード"
      テクニック4_ネガティブ感情への訴求:
        説明: "失敗・後悔を避けたい心理に訴え、読者を強く惹きつける"
        使い方: "「失敗しない」「知らないと損する」「よくある落とし穴」等の損失回避ワードを活用"
        良い例: ["知らないと損する外壁塗装の見積りチェックポイント", "大規模修繕で失敗しないための業者選び"]
        適用場面: "選び方・注意点・トラブル系のキーワード"
        注意: "記事内容と乖離しない範囲で使用。過度な煽りは禁止"
      テクニック5_得られる情報の明示:
        説明: "記事を読むと何が得られるかを具体的に伝える"
        使い方: "「費用相場がわかる」「手順を紹介」「チェックリスト付き」等の具体的ベネフィットを明示"
        良い例: ["修繕積立金の相場と適正額がわかる完全ガイド", "外壁劣化の見分け方と対処法を徹底解説"]
        適用場面: "情報収集・調査系のキーワード"
      テクニック6_疑問の代弁:
        説明: "読者が抱く疑問をそのままタイトルに使い『答えが気になる』心理を引き出す"
        使い方: "「〜とは？」「なぜ〜？」「どちらがいい？」等の疑問形を活用"
        良い例: ["大規模修繕はなぜ必要？時期・費用・進め方を解説", "外壁塗装と外壁カバー工法はどちらがいい？"]
        適用場面: "「とは」「違い」「比較」「なぜ」系のキーワード"

      組み合わせ例:
        - "テクニック2+4: 「90%が見落とす大規模修繕の5つの落とし穴」"
        - "テクニック1+3: 「初めてのオーナー向け｜外壁塗装の流れをわかりやすく解説」"
        - "テクニック5+6: 「修繕積立金は足りている？適正額の計算方法と見直しポイント」"
    
  メタディスクリプション:
    文字数:
      min: 100
      max: 150
      target: 125
    必須: ["キーワード含有"]
    
  【⚠️ 文字数目標：最重要】
  記事全体の目標文字数: 5,000〜6,000字（HTMLタグ除く本文のみ）
  - リード文: 200〜350字
  - H2セクション1つあたり平均: 700〜900字（H3なし）
  - H3セクション1つあたり平均: 200〜350字
  - まとめ: 300〜400字
  - この目標を達成するため、H2・H3の数を調整して過剰にならないようにすること
  - 5,000字を下回らず、6,000字を超えないよう見出し数を設計すること
  - H2の「文字数目標」の合計が5,000〜6,000字の範囲に収まるよう各セクションに配分すること

  H2数:
    min: ${minH2Count}
    max: ${maxH2Count}
    ideal: ${idealH2Count}
    根拠: "5,000〜6,000字逆算ルール（競合平均${averageH2Count}本は参考値のみ）"
    特殊ルール: "まとめH2は必須、H3は0個"
    重要: "文字数5,000〜6,000字を最優先。H2を増やすと文字数が増えるため、max${maxH2Count}本を厳守すること"

  H3総数:
    上限: ${maxH3Total}個（文字数5,000〜6,000字厳守のための絶対上限）
    競合H3数（${averageH3Count}個）は参考値のみ。文字数を最優先にH3数を調整すること
    配分ルール:
      - "各H2: 0個 or 2個以上（1個禁止）"
      - "重要H2: 2〜3個"
      - "標準H2: 0個または2個"
      - "まとめH2: 必ず0個（絶対厳守）"
    重要: "H3が増えると文字数が増えるため、合計${maxH3Total}個以内に収めること。まとめは例外なくH3を0個にすること。"
その他のルール:
  見出しの重複禁止:
    - "同じ意図の見出しを別のH2/H3で繰り返さない"
    - "H2とその配下のH3で意味が重複しないよう注意"
    
  H2順序: "上位3記事の多数派順序を優先（最後2つは固定）"

  キーワード含有:
    方針: "自然に置き換え可能な場合のみH2に含める"
    優先度: "SEO効果と自然さのバランス重視"

  執筆メモ（最重要ルール）:
    H2の執筆メモ: "最大200字。そのH2が記事全体の『課題解決ストーリー』のどの段階に対応するかを1文で明示すること（例：「読者が自社の外壁状態を自己診断できるようになる段階」）"
    H3の執筆メモ: "200-300字目安。以下の順で記述：①このH3で読者が理解すべきこと1点 ②具体的な情報・論点（提供データに基づくものは出典明記） ③参照推奨記事（「参照：○位記事」形式、URLがある場合のみ）"
    ハルシネーション防止: "具体的な数値・事例・固有名詞は、提供されたデータに存在するもののみ記載。不明な場合は『（要調査）』と明記"
  固定順序:
    最後2つ: ["FAQ（ある場合）", "まとめ"]
    FAQ:
      位置: "まとめの前（ある場合のみ）"
      見出し形式: "キーワードを含めた具体的な見出し（15-25文字程度）"
      推奨見出し: "${faqHeading}"
      重要: "上記の推奨見出しを使用してください。これはキーワードの種類に応じて最適化されています"

      注意事項:
        - 「問題点」や「リスク」を含むキーワードに「導入」を付けない
        - キーワードの意味を理解して自然な日本語にする
        - 機械的な結合を避ける

      H3数: "3-5個（具体的な質問形式）"
    まとめ:
      フォーマット: "まとめ：${keyword}を含むサブタイトル"
      H3数: 0
      writingNote: "記事要点を3-5点で総括し、最後に記事テーマに関連する地域の専門業者（取引先情報が提供されている場合は取引先名、ない場合は『地域の専門業者』等の一般表現）への相談を自然に案内する。※本部名（アステックペイント／プロタイムズ本部）を呼びかけ主語にしない。※施工件数・創業年数などの具体数値は提供データに記載がある場合のみ記載し、記載がない場合は『豊富な施工実績』『地域密着』等の定性表現を使用する"
      
  数字付き見出し:
    条件: "「○選」「○つのポイント」など内容として数を示す場合のみ"
    禁止: "単なる順序番号（1. 2. 3.）をH2に付けること"
    正しい例: "おすすめ生成AIツール12選【2025年最新】"
    間違い例: "1. 生成AIとは？"
    ルール:
      - "「○選」型のH2の場合、H3には通し番号必須（例：1. Jasper、2. Copy.ai）"
      - "H3数とH2タイトルの数字を一致させる"
      - "通常のH2には番号を付けない"

【JSON形式で出力】
重要: outline配列内のsubheadingsの総数は${maxH3Total}個以下にしてください（文字数5,000〜6,000字厳守）。
重要: outline配列の要素数（H2数）は${maxH2Count}個以下にしてください。
注意: H2とH3で意味が重複しないよう、H3は具体的な要素分解にすること。

{
  "title": "タイトル",
  "metaDescription": "メタディスクリプション",
  "searchIntentAnalysis": {
    "problem": "読者が抱えている具体的な問題（1〜2文）",
    "information": "問題解決に必要な情報（1〜2文）",
    "desiredOutcome": "読後に読者がなりたい状態（1文）"
  },
  "articlePurpose": "この記事の目的・読者の状態変化ストーリーを1段落で説明（例：外壁塗装の費用が不安な施主が、相場と仕組みを理解し、業者選びに自信を持てるようになる記事）",
  "introductions": {
    "empathy": "共感型の導入文（searchIntentAnalysis.problemを反映した、読者の悩みを代弁する書き出し）"
  },
  "targetAudience": "ターゲット読者（searchIntentAnalysis.problemを抱える具体的な人物像）",
  "outline": [
    {
      "heading": "SEO対策とは？基本から理解する",
      "subheadings": [
        { "text": "検索エンジンの仕組みと役割", "writingNote": "クローラー、インデックス、ランキングアルゴリズムの解説" },
        { "text": "Googleアルゴリズムの評価基準", "writingNote": "E-E-A-T、Core Web Vitals等の主要指標" },
        { "text": "オーガニック検索と有料広告の違い", "writingNote": "SEOとSEMの比較、それぞれのメリット" },
        { "text": "モバイルファーストインデックスの重要性", "writingNote": "スマホ対応が必須な理由と影響" },
        { "text": "ローカルSEOと音声検索への対応", "writingNote": "地域ビジネスと新しい検索形態" }
      ],
      "writingNote": "SEOの概念を要素分解して説明。「とは」の答えとなる具体的な仕組みや特徴を各H3で展開"
    },
    {
      "heading": "効果的なSEO対策の実践方法",
      "subheadings": [
        { "text": "キーワード選定の基本戦略", "writingNote": "検索ボリューム、競合性、関連性の分析方法" },
        { "text": "コンテンツ最適化のポイント", "writingNote": "タイトル、見出し、本文の最適化手法" },
        { "text": "内部リンク構造の設計", "writingNote": "サイト構造とリンクジュースの流れ" },
        { "text": "ページスピードの改善手法", "writingNote": "Core Web Vitalsの改善方法" },
        { "text": "モバイルユーザビリティの向上", "writingNote": "レスポンシブデザインとUX改善" }
      ],
      "writingNote": "実践的な対策方法を具体的に解説。各H3で異なる施策を説明"
    }
    // 他のH2も同様に、H2の問いや主題に対する具体的な要素をH3で展開
  ],
  "conclusion": "まとめの内容",
  "keywords": ["キーワード1", "キーワード2"],
  "differentiators": ["差分1", "差分2", "差分3"]
}`;

  try {
    const result = await genAI.models.generateContent({
      model: "gemini-3.1-pro-preview",
      contents: prompt,
      config: {
        temperature: 0.5, // バランス重視（創造性と正確性）
        maxOutputTokens: 16000, // トークン数を増やして詳細な構成を生成可能に
        responseMimeType: "application/json"
      }
    });
    let responseText = result.text || '';
    
    // JSONの前後の不要な文字を削除
    responseText = responseText.replace(/^```json\s*/i, '').replace(/\s*```$/i, '');
    responseText = responseText.trim();
    
    // JSONパースを試みる
    let generatedData;
    try {
      generatedData = JSON.parse(responseText);
    } catch (parseError) {
      console.error('JSONパースエラー:', parseError);
      console.error('Response text:', responseText.substring(0, 500));
      throw new Error('構成案の生成でJSONパースに失敗しました');
    }
    
    // タイトルの隅付き括弧【】の位置を修正
    let processedTitle = generatedData.title;
    
    // タイトル中央や最後にある【】を検出して修正
    const bracketMatch = processedTitle.match(/(.+?)(【.+?】)(.+)/);
    if (bracketMatch) {
      // 【】が途中にある場合、先頭に移動
      console.log(`⚠️ タイトルの【】位置を修正: ${processedTitle}`);
      
      // 【】を先頭に移動し、適切な接続を判断
      const bracketContent = bracketMatch[2];
      const beforeBracket = bracketMatch[1].trim();
      const afterBracket = bracketMatch[3].trim();
      
      // 文脈に応じて最適な接続を選択
      let connector = '';
      
      // 後続が「解説」「紹介」「説明」の場合は「を」
      if (afterBracket.match(/^(解説|紹介|説明|徹底解説|詳細説明|完全解説)/)) {
        connector = 'を';
      }
      // 後続が「比較」の場合は「の」
      else if (afterBracket.match(/^(比較|違い|メリット|デメリット|特徴|ポイント)/)) {
        connector = 'の';
      }
      // 後続が動詞的な名詞の場合は「で」
      else if (afterBracket.match(/^(実現|達成|成功|改善|向上|効率化)/)) {
        connector = 'で';
      }
      // 並列関係の場合は「と」
      else if (beforeBracket.match(/\d+[選個つ]$/) && afterBracket.match(/^(導入|活用|実践|選び方|使い方)/)) {
        connector = 'と';
      }
      // 前後が名詞で並列の場合は「・」
      else if (beforeBracket.match(/方法$|手法$|事例$/) && afterBracket.match(/^(注意点|ポイント|コツ)/)) {
        connector = '・';
      }
      // デフォルトは接続なし（文脈で自然に繋がる場合）
      else {
        // 漢字が連続する場合のみ「の」を追加
        const lastCharBefore = beforeBracket.slice(-1);
        const firstCharAfter = afterBracket.slice(0, 1);
        if (lastCharBefore.match(/[\u4e00-\u9faf]/) && firstCharAfter.match(/[\u4e00-\u9faf]/)) {
          connector = 'の';
        }
      }
      
      // タイトルを再構成
      processedTitle = `${bracketContent}${beforeBracket}${connector}${afterBracket}`;
      console.log(`✅ 修正後: ${processedTitle}`);
    }
    
    // タイトルとメタディスクリプションの文字数調整
    const adjustedTitle = truncateToLength(processedTitle, 50);  // 32→50に変更（最大50文字まで許容）
    
    // メタディスクリプションの文字数チェックと調整
    let adjustedMetaDescription = generatedData.metaDescription;
    const metaDescLength = countCharacters(adjustedMetaDescription);
    
    if (metaDescLength < 100) {
      console.warn(`⚠️ メタディスクリプションが短すぎます: ${metaDescLength}文字`);
      // キーワードを追加して100文字以上にする
      const additionalText = `${keyword}について詳しく解説します。`;
      adjustedMetaDescription = adjustedMetaDescription + additionalText;
    }
    
    // 150文字を超える場合は切り捨て
    adjustedMetaDescription = truncateToLength(adjustedMetaDescription, 150);
    
    // 最終的な文字数をログ出力（切り捨て後）
    const finalLength = countCharacters(adjustedMetaDescription);
    if (metaDescLength < 100) {
      console.log(`✅ 補完・調整後: ${finalLength}文字（100-150文字の範囲内）`);
    }
    
    // 導入文の処理（後方互換性を保つため、conclusionFirstも含める）
    const rawIntroductions = generatedData.introductions || {};
    const introductions: IntroductionPatterns = {
      conclusionFirst: rawIntroductions.conclusionFirst || rawIntroductions.empathy || '',
      empathy: rawIntroductions.empathy || ''
    };
    
    // H3の「0 or 2以上」ルールを適用（1個の場合は0個にする）
    const adjustedOutline: OutlineSectionV2[] = generatedData.outline.map((section: any, index: number) => {
      const h3Count = section.subheadings?.length || 0;
      
      // まとめ見出しの判定（最後の見出し、または「まとめ」を含む）
      const isLastSection = index === generatedData.outline.length - 1;
      const isSummarySection = section.heading.includes('まとめ') || 
                              section.heading.includes('最後に') || 
                              section.heading.includes('おわりに');
      
      // まとめ見出しの場合はH3を0個に、それ以外は1個の場合のみ0個にする
      let adjustedSubheadings;
      if (isLastSection || isSummarySection) {
        adjustedSubheadings = []; // まとめ見出しは必ずH3なし
      } else {
        adjustedSubheadings = h3Count === 1 ? [] : (section.subheadings || []);
      }
      
      // 画像提案を具体化
      const imageSuggestion = includeImages 
        ? generateConcreteImageSuggestion(section.heading, searchIntent.primary)
        : '';
      
      return {
        heading: section.heading,
        subheadings: adjustedSubheadings,
        imageSuggestion,
        writingNote: section.writingNote || ''
      };
    });
    
    // ── コード強制①：H2数の上限を7本に絞る（文字数最優先）──
    let finalOutline = adjustedOutline;
    if (finalOutline.length > maxH2Count) {
      console.warn(`⚠️ H2数超過: ${finalOutline.length}本 → ${maxH2Count}本に削減（文字数優先）`);
      // 末尾2本（まとめ・自社訴求）は必ず保護
      const fixedTail = finalOutline.slice(-2);
      const contentSections = finalOutline.slice(0, -2);

      // FAQセクションがあれば保護してから削減
      const faqIdx = contentSections.findIndex(s => /FAQ|よくある質問/.test(s.heading));
      const trimTarget = maxH2Count - 2; // まとめ・自社訴求の2本分を引く

      if (faqIdx !== -1) {
        const faqSection = contentSections[faqIdx];
        const others = contentSections.filter(function(_, i) { return i !== faqIdx; });
        const trimmedOthers = others.slice(0, trimTarget - 1);
        finalOutline = trimmedOthers.concat([faqSection]).concat(fixedTail);
      } else {
        finalOutline = contentSections.slice(0, trimTarget).concat(fixedTail);
      }
      console.log(`✅ H2数調整完了: ${finalOutline.length}本`);
    }

    // ── コード強制②：H3総数の上限を12個に絞る（文字数最優先）──
    let currentH3Total = finalOutline.reduce((sum, section) => sum + section.subheadings.length, 0);
    if (currentH3Total > maxH3Total) {
      console.warn(`⚠️ H3数超過: ${currentH3Total}個 → ${maxH3Total}個に削減（文字数優先）`);
      // まとめ・自社訴求（末尾2本）以外のセクションからH3を削減
      let remaining = maxH3Total;
      finalOutline = finalOutline.map(function(section, index) {
        const isFixedTail = index >= finalOutline.length - 2;
        if (isFixedTail) {
          // まとめ・自社訴求はそのまま（まとめは0個、自社訴求は2〜3個）
          remaining -= section.subheadings.length;
          return section;
        }
        // コンテンツセクションのH3を余裕に応じて配分（最大3個）
        const cap = Math.min(3, remaining > 0 ? remaining : 0);
        const trimmedSubs = section.subheadings.length <= cap
          ? section.subheadings
          : section.subheadings.slice(0, cap === 1 ? 0 : cap); // 1個になる場合は0個に
        remaining -= trimmedSubs.length;
        return {
          heading: section.heading,
          subheadings: trimmedSubs,
          imageSuggestion: section.imageSuggestion,
          writingNote: section.writingNote
        };
      });
      currentH3Total = finalOutline.reduce((sum, section) => sum + section.subheadings.length, 0);
      console.log(`✅ H3数調整完了: ${currentH3Total}個`);
    }

    // ── コード強制③：「○選」「○つ」型H2の見出し数字を実際のH3数に揃える ──
    // H3を削った結果、「5つのコツ」なのにH3が3つ、のような不整合を防ぐ
    finalOutline = finalOutline.map(function(section) {
      const numPattern = /(\d+)(選|つ|個|点|社|本|か所|箇所)/;
      const match = section.heading.match(numPattern);
      if (!match) return section; // 数字パターンなし → そのまま

      const declaredNum = parseInt(match[1]);
      const actualNum = section.subheadings.length;

      if (actualNum === 0 || declaredNum === actualNum) return section; // 一致 or H3なし → そのまま

      // 数字を実際のH3数に更新
      const newHeading = section.heading.replace(numPattern, actualNum + match[2]);
      console.log(`🔄 H2見出し数字を修正: 「${section.heading}」→「${newHeading}」`);
      return {
        heading: newHeading,
        subheadings: section.subheadings,
        imageSuggestion: section.imageSuggestion,
        writingNote: section.writingNote
      };
    });

    // 競合比較サマリの作成
    const competitorComparison: CompetitorComparisonSummary = {
      averageH2Count,
      averageH3Count,
      ourH2Count: finalOutline.length,
      ourH3Count: currentH3Total,
      freshnessRisks: freshnessData.outdatedSections,
      differentiators: generatedData.differentiators || [
        `最新の${currentYear}年情報を反映`,
        '競合より詳細な実践手順を提供',
        '独自の成功事例を3件追加'
      ]
    };

    // searchIntentAnalysis と articlePurpose をログで確認
    if (generatedData.searchIntentAnalysis) {
      const sia = generatedData.searchIntentAnalysis;
      console.log('\n📐 検索意図3軸分析:');
      console.log(`   Problem: ${sia.problem || '—'}`);
      console.log(`   Information: ${sia.information || '—'}`);
      console.log(`   Desired Outcome: ${sia.desiredOutcome || '—'}`);
    }
    if (generatedData.articlePurpose) {
      console.log(`\n🎯 記事の目的: ${generatedData.articlePurpose}`);
    }

    return {
      title: adjustedTitle,
      metaDescription: adjustedMetaDescription,
      introductions,
      targetAudience: generatedData.targetAudience,
      outline: finalOutline,
      conclusion: generatedData.conclusion,
      searchIntentAnalysis: generatedData.searchIntentAnalysis || null,
      articlePurpose: generatedData.articlePurpose || '',
      keywords: [...mustIncludeWords, ...(Array.isArray(generatedData.keywords) ? generatedData.keywords : [])].slice(0, 15),
      characterCountAnalysis: {
        average: averageCharCount || (competitorResearch.recommendedWordCount ? competitorResearch.recommendedWordCount.optimal : 5000) || 5000,
        median: averageCharCount || (competitorResearch.recommendedWordCount ? competitorResearch.recommendedWordCount.optimal : 5000) || 5000,
        min: competitorResearch.recommendedWordCount ? competitorResearch.recommendedWordCount.min : 3000,
        max: competitorResearch.recommendedWordCount ? competitorResearch.recommendedWordCount.max : 8000,
        analyzedArticles: validArticles.length || 10
      },
      competitorComparison,
      searchIntent,
      freshnessData: {
        hasOutdatedInfo: freshnessData.hasOutdatedInfo,
        outdatedSections: freshnessData.outdatedSections
      }
    };
    
  } catch (error) {
    console.error('構成案生成エラー:', error);
    throw new Error('構成案の生成に失敗しました');
  }
}