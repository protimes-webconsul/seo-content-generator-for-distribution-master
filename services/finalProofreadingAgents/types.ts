// マルチエージェント校閲システム - 共通型定義
export interface AgentResult {
  agentName: string;
  agentType: AgentType;
  executionTime: number;
  score: number;
  issues: Issue[];
  suggestions: Suggestion[];
  confidence: number;
  status: 'success' | 'error' | 'timeout' | 'partial-success';
  error?: string;
  verified_urls?: VerifiedUrl[];  // CitationsAgent用のカスタムフィールド
  partialData?: {
    completedItems: number;
    totalItems: number;
    message: string;
  };  // 部分成功時の詳細情報
}

export interface Issue {
  type: IssueType;
  severity: 'critical' | 'major' | 'minor' | 'info';
  location: string;
  description: string;
  original: string;
  suggestion?: string;
  confidence: number;
}

export interface Suggestion {
  type: string;
  description: string;
  implementation: string;
  priority: 'high' | 'medium' | 'low';
}

export type AgentType =
  | 'proper-nouns'        // 固有名詞校閲
  | 'numbers-stats'       // 数値・統計確認
  | 'dates-timeline'      // 日付・時系列検証
  | 'facts-cases'         // 事例・ファクト検証
  | 'company'            // 自社サービス専門
  | 'citations'          // 引用・出典検証
  | 'citation-verification' // 出典正確性検証（MoA）
  | 'technical'          // 技術仕様確認
  | 'legal'              // 法令・規制チェック
  | 'integration';       // 最終統合

export type IssueType = 
  | 'factual-error'      // 事実誤認
  | 'outdated-info'      // 古い情報
  | 'inconsistency'      // 不整合
  | 'missing-source'     // 出典不明
  | 'legal-risk'         // 法的リスク
  | 'brand-error'        // ブランド表記誤り
  | 'technical-error'    // 技術的誤り
  | 'style-issue';       // スタイル問題

// 基底エージェントインターフェース
export interface BaseAgent {
  name: string;
  type: AgentType;
  model: 'gpt-5' | 'gpt-5-mini' | 'gpt-5-nano';
  execute(content: string, context?: any): Promise<AgentResult>;
}

// 出典挿入用の構造化データ
export interface SourceInsertion {
  heading: string;        // HTML見出しタグ（例: "<h2>市場規模</h2>" or "<h3>1. 人材開発支援助成金</h3>"）
  url: string;           // 完全なURL（例: "https://example.com/page"）
  title: string;         // リンクテキスト（例: "経済産業省統計データ"）
  elementIndex?: number;  // 要素番号（要素番号ベース処理用）
  elementContent?: string; // 元のHTML要素（復元用）
}

// 統合結果
export interface IntegrationResult {
  overallScore: number;
  passed: boolean;
  passReason?: string;          // 合格理由（80点以上 or 10%改善）
  previousScore?: number;       // 前回スコア（改善率計算用）
  agentResults: AgentResult[];
  criticalIssues: Issue[];
  majorIssues: Issue[];
  minorIssues: Issue[];
  suggestions: Suggestion[];
  executionSummary: {
    totalTime: number;
    successfulAgents: number;
    failedAgents: number;
    timeoutAgents: number;
  };
  regulationScore: {
    factChecking: number;       // 45点満点（旧40点から+5点）
    reliability: number;        // 25点満点（旧20点から+5点）
    companyCompliance?: number;  // 自社サービス準拠（汎用版）
    structureRules: number;     // 18点満点（旧15点から+3点）
    legalCompliance: number;    // 7点満点（旧5点から+2点）
    overallQuality: number;     // 5点満点（変更なし）
    total: number;              // 100点満点
  };
  recommendation: 'publish' | 'revise' | 'reject';
  detailedReport: string;
  sourceInsertions?: SourceInsertion[];  // 構造化された出典挿入データ
}

// エージェント設定
export interface AgentConfig {
  timeout: number;
  enableWebSearch: boolean;
  maxRetries: number;
  temperature: number;
}

// ========== 新しい型定義 ==========

// 検証済みURL情報
export interface VerifiedUrl {
  url: string;
  location: string;
  h2: string;
  h3: string;
  claim: string;
  status: 'ok' | 'not_found' | 'error';
  confidence: number;
  title?: string;
}

// 部分結果（タイムアウト/エラー時の部分成功用）
export interface PartialResults {
  completedItems: number;
  totalItems: number;
  issues: Issue[];
  suggestions: Suggestion[];
  verified_urls: VerifiedUrl[];
}

// 出典要求（SourceRequirementAgent → SourceEnhancementAgent）
export interface SourceRequirement {
  claim: string;
  location?: string;
  h2: string;
  h3: string;
  searchKeywords?: string[];
  original?: string;
  description?: string;
}

// エージェント間のコンテキスト
export interface AgentContext {
  // SourceRequirementAgentからのデータ
  sourceRequirements?: SourceRequirement[];
  
  // SourceEnhancementAgentからのデータ
  sourceEnhancement?: {
    verified_urls: VerifiedUrl[];
    issues?: Issue[];
  };
  
  // その他のコンテキストデータ
  [key: string]: any;
}

// 拡張されたIssue（cautionNote対応）
export interface IssueWithCaution extends Issue {
  action?: 'add-source' | 'rephrase-with-caution';
  actionType?: 'add' | 'rephrase';
  cautionNote?: string;
  source_url?: string;
  h2?: string;
  h3?: string;
}