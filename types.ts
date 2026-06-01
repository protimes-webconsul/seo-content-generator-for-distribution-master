/** 構成案生成モード */
export type OutlineMode = 'standard' | 'siteData';

// 見出し構造の階層を表現
export interface HeadingStructure {
  h1: string;
  h2Items: Array<{
    text: string;
    h3Items: string[];
  }>;
}

// 個別記事の詳細分析結果
export interface ArticleAnalysis {
  rank: number;
  url: string;
  title: string;
  summary: string;
  characterCount: number;
  headingStructure: HeadingStructure;
  isArticle: boolean; // コラム記事かどうか
  excludeReason?: string; // 除外理由（ショッピング、PDF等）
}

// 頻出単語の情報
export interface FrequencyWord {
  word: string;
  count: number;
  articleCount: number; // 何記事で使われているか
  articles: number[]; // 使用している記事のランク番号
}

// 競合分析の全体結果
export interface CompetitorResearchResult {
  keyword: string;
  analyzedAt: string;
  totalArticlesScanned: number;
  validArticles: ArticleAnalysis[];
  excludedCount: number;
  commonTopics: string[];
  recommendedWordCount: {
    min: number;
    max: number;
    optimal: number;
  };
  frequencyWords?: FrequencyWord[]; // 頻出単語リスト
}

export interface SubheadingWithNote {
  text: string;
  writingNote?: string; // H3ごとの執筆メモ
}

// Ver.2用の型定義
export interface IntroductionPatterns {
  conclusionFirst: string; // 結論先行型
  empathy: string; // 共感型
}

export interface OutlineSectionV2 {
  heading: string;
  subheadings: SubheadingWithNote[];
  imageSuggestion: string; // 具体的な画像提案（被写体・構図まで）
  writingNote: string; // H2ごとの執筆メモ（最大200字）
}

export interface CompetitorComparisonSummary {
  averageH2Count: number;
  averageH3Count: number;
  ourH2Count: number;
  ourH3Count: number;
  freshnessRisks: string[]; // 競合の古い箇所
  differentiators: string[]; // 差分ポイント3点
}

export interface SeoOutlineV2 {
  title: string; // 32文字以内
  metaDescription: string; // 100文字以内、KW含む
  introductions: IntroductionPatterns; // 2パターンの導入文
  targetAudience: string;
  outline: OutlineSectionV2[];
  conclusion: string;
  /** 検索意図3軸分析（統合版プロンプトで生成） */
  searchIntentAnalysis?: {
    problem: string;        // 読者が抱えている具体的な問題
    information: string;    // 問題解決に必要な情報
    desiredOutcome: string; // 読後に読者がなりたい状態
  } | null;
  /** 記事の目的・課題解決ストーリー（統合版プロンプトで生成） */
  articlePurpose?: string;
  /** 記事全体の流れ（サイトデータモードで生成） */
  articleFlow?: string;
  keywords: string[];
  characterCountAnalysis?: {
    average: number;
    median: number;
    min: number;
    max: number;
    analyzedArticles: number;
  };
  competitorComparison: CompetitorComparisonSummary;
  searchIntent: {
    primary: string; // 主意図（KNOW/DO/NAV/LOCAL）
    secondary?: string; // 副意図
  };
  freshnessData?: {
    lastUpdated?: string;
    hasOutdatedInfo: boolean;
    outdatedSections?: string[];
  };
}

// 構成チェック結果
export interface OutlineCheckResult {
  isValid: boolean;
  errors: {
    field: string;
    message: string;
    severity: 'error' | 'warning';
  }[];
  suggestions: string[];
}

export interface OutlineSection {
  heading: string;
  subheadings: string[] | SubheadingWithNote[]; // 文字列配列または詳細オブジェクト配列
  imageSuggestion?: string;
  writingNote?: string; // H2全体の執筆メモ
}

export interface CharacterCountAnalysis {
  average: number;
  median: number;
  min: number;
  max: number;
  analyzedArticles: number;
}

export interface SeoOutline {
  title: string;
  targetAudience: string;
  introduction: string;
  outline: OutlineSection[];
  conclusion: string;
  keywords: string[];
  characterCountAnalysis: CharacterCountAnalysis;
  competitorResearch?: CompetitorResearchResult; // 競合分析結果を追加
}

export interface GroundingChunk {
  web: {
    uri: string;
    title: string;
  };
}

// ===== 取引先管理 =====

// 汎用執筆ルール（1行1ルール）
export interface WritingRule {
  id: string;
  clientId: string;
  category: string; // 専門用語 / 文章構成 / 文体 / 禁止 / その他
  ruleContent: string;
}

// 表記統一ルール（誤→正ペア）
export interface TerminologyRule {
  id: string;
  clientId: string;
  wrongTerms: string[]; // 誤表記（複数可）
  correctTerm: string;  // 正表記
  note: string;
}

// 会社名ルール
export interface CompanyNameRule {
  id: string;
  clientId: string;
  fullName: string;      // 正式名称（例：株式会社カジワラリフォーム（プロタイムズ加古川北店））
  titleName: string;     // タイトル用省略名（例：株式会社カジワラリフォーム）
}

// 店舗独自情報の参照URL
export interface ReferenceUrl {
  id: string;
  clientId: string;
  url: string;
  description: string; // 用途説明（例：店舗価格・プラン情報）
}

// WordPress設定（認証情報なし）
export interface WordPressSettings {
  clientId: string;
  wpUrl: string;
  wpUsername: string;
  defaultCategoryId: number;
}

// 取引先独自情報（SEO/AIO強化用）
export interface ClientUniqueInfo {
  clientId: string;
  achievements: string;   // 実績数値（例：年間施工200件・累計1000件）
  certifications: string; // 保有資格（例：一級塗装技能士・外壁診断士）
  staffInfo: string;      // スタッフ構成（実名なし。例：職人8名・現場経験10年以上）
  serviceArea: string;    // 対応エリア（例：倉敷市・岡山市・総社市）
  specialties: string;    // 独自工法・特徴（例：〇〇工法採用・10年保証）
  awards: string;         // 受賞・認定（例：〇〇メーカー認定店・〇〇表彰）
}

// 取引先プロフィール（全情報統合）
export interface ClientProfile {
  id: string;
  name: string;
  industry: string;
  siteUrl: string;
  isActive: boolean;
  writingRules: WritingRule[];
  terminologyRules: TerminologyRule[];
  companyNameRule: CompanyNameRule | null;
  referenceUrls: ReferenceUrl[];
  wordpressSettings: WordPressSettings | null;
  uniqueInfo: ClientUniqueInfo | null;
  factSheetName?: string; // ファクトDB用スプレッドシートのシートタブ名
}

export interface FactEntry {
  category: string;
  item: string;
  content: string;
  sourceArticle: string;
}

// 保存済み記事の一覧表示用（軽量版）
export interface SavedArticleSummary {
  id: string;
  clientId: string;
  clientName: string;
  keyword: string;
  status: 'outline_only' | 'complete';
  createdAt: string;
  updatedAt: string;
  filename: string;
  title: string;
}

// 保存済み記事の全データ
export interface SavedArticle {
  id: string;
  clientId: string;
  clientName: string;
  keyword: string;
  status: 'outline_only' | 'complete';
  createdAt: string;
  updatedAt: string;
  filename: string;
  outline: import('./types').SeoOutlineV2 | null;
  article: {
    title: string;
    metaDescription: string;
    htmlContent: string;
    plainText: string;
  } | null;
}

// 取引先一覧用（軽量版）
export interface ClientSummary {
  id: string;
  name: string;
  industry: string;
  siteUrl: string;
  isActive: boolean;
}

// ===== 執筆スタイルサンプル =====
export interface WritingStyleEntry {
  id: string;
  description: string;  // メモ・用途説明（任意）
  sampleText: string;   // 参考文章（プレーンテキスト）
  createdAt: string;
  updatedAt: string;
}

export interface WritingStyleSample {
  clientId: string;
  clientName: string;
  samples: WritingStyleEntry[];  // 最大4件
  updatedAt: string;
}