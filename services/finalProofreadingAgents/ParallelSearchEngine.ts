// ============================================================
// AI Parallel Search エンジン
// 1つの主張に対して複数の検索クエリを同時生成・実行・統合
// ============================================================
import { GoogleGenerativeAI } from "@google/generative-ai";

// ─── 型定義 ───────────────────────────────

export interface SearchQuery {
  query: string;
  purpose: string;  // この検索の目的（例：「公式統計を確認」）
  language: "ja" | "en";
}

export interface SearchResult {
  query: string;
  source: string;   // 情報源（サイト名やURL）
  snippet: string;   // 検索結果の抜粋
  relevance: number; // 関連度 0-100
  isOfficial: boolean; // 公的機関・公式情報かどうか
}

export interface AggregatedSearchResult {
  claim: string;
  queries: SearchQuery[];
  results: SearchResult[];
  summary: string;          // 複数ソースの統合要約
  sourceCount: number;
  officialSourceCount: number;
  consensus: "supports" | "contradicts" | "mixed" | "insufficient";
  confidence: number;       // 0-100
}

// ─── Parallel Search Engine ────────────────

export class ParallelSearchEngine {
  private genAI: GoogleGenerativeAI | null = null;

  constructor() {
    const apiKey =
      (typeof import.meta !== "undefined" &&
        import.meta.env &&
        import.meta.env.VITE_GEMINI_API_KEY) ||
      process.env.GEMINI_API_KEY;

    if (apiKey) {
      this.genAI = new GoogleGenerativeAI(apiKey);
      console.log("✅ ParallelSearch: 初期化成功");
    } else {
      console.log("⚠️ ParallelSearch: Gemini APIキーなし");
    }
  }

  isAvailable(): boolean {
    return this.genAI !== null;
  }

  /**
   * 1つの主張に対して複数検索を並列実行し統合結果を返す
   */
  async searchAndVerify(
    claim: string,
    context: string,
    category: string
  ): Promise<AggregatedSearchResult> {
    if (!this.genAI) {
      return this.createEmptyResult(claim);
    }

    const startTime = Date.now();
    console.log(`🔎 ParallelSearch: 「${claim.slice(0, 40)}...」`);

    try {
      // Step 1: 複数の検索クエリを生成
      const queries = await this.generateMultipleQueries(claim, context, category);
      console.log(`  📝 ${queries.length}件の検索クエリを生成`);

      // Step 2: 全クエリを並列でGemini+グラウンディングに投入
      const searchPromises = queries.map((q) =>
        this.executeSearchQuery(q, claim).catch((err) => {
          console.warn(`  ⚠️ 検索失敗 [${q.query.slice(0, 30)}]: ${err.message}`);
          return [] as SearchResult[];
        })
      );

      const allResults = await Promise.all(searchPromises);
      const flatResults = allResults.flat();

      // Step 3: 結果を統合・重複除去・ランキング
      const aggregated = await this.aggregateResults(claim, flatResults);

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`  ✅ ParallelSearch完了 (${elapsed}秒): ${flatResults.length}件のソース → ${aggregated.consensus}`);

      return {
        claim,
        queries,
        results: flatResults,
        summary: aggregated.summary,
        sourceCount: flatResults.length,
        officialSourceCount: flatResults.filter((r) => r.isOfficial).length,
        consensus: aggregated.consensus,
        confidence: aggregated.confidence,
      };
    } catch (error) {
      console.error("ParallelSearchエラー:", error);
      return this.createEmptyResult(claim);
    }
  }

  /**
   * Step 1: 1つの主張から複数の検索クエリを生成
   */
  private async generateMultipleQueries(
    claim: string,
    context: string,
    category: string
  ): Promise<SearchQuery[]> {
    if (!this.genAI) return [];

    const model = this.genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
      generationConfig: {
        temperature: 0.5,
        maxOutputTokens: 1024,
        responseMimeType: "application/json",
      },
    });

    const prompt = `以下の記述を検証するための検索クエリを3つ生成してください。
それぞれ異なるアプローチで情報を収集できるようにしてください。

【検証対象の記述】
「${claim}」

【カテゴリ】${category}

【文脈】
${context.slice(0, 500)}

【クエリ生成ルール】
1. 日本語クエリ：公式統計・省庁データを狙う
2. 日本語クエリ：業界レポート・専門メディアを狙う
3. 英語クエリ：海外ソース・グローバルデータを狙う

【JSON出力形式】
{
  "queries": [
    {
      "query": "検索クエリ文字列",
      "purpose": "このクエリの目的",
      "language": "ja" または "en"
    }
  ]
}`;

    try {
      const result = await model.generateContent(prompt);
      const text = result.response.text();
      const parsed = JSON.parse(text);
      return parsed.queries || [];
    } catch (error) {
      console.warn("クエリ生成失敗、デフォルトクエリを使用:", error);
      // フォールバック: 基本的なクエリを生成
      return [
        { query: claim, purpose: "直接検索", language: "ja" as const },
        { query: `${claim} 統計 公式`, purpose: "公式データ検索", language: "ja" as const },
        { query: `${claim} site:go.jp OR site:gov`, purpose: "政府系ソース", language: "ja" as const },
      ];
    }
  }

  /**
   * Step 2: 単一クエリをGeminiグラウンディングで実行
   */
  private async executeSearchQuery(
    query: SearchQuery,
    originalClaim: string
  ): Promise<SearchResult[]> {
    if (!this.genAI) return [];

    const model = this.genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 2048,
        responseMimeType: "application/json",
      },
      tools: [
        {
          googleSearch: {},
        } as any,
      ],
    });

    const prompt = `以下の検索クエリに基づいて、「${originalClaim}」の事実確認に役立つ情報を収集してください。

【検索クエリ】${query.query}
【検索目的】${query.purpose}

見つかった情報を以下のJSON形式で整理してください：
{
  "results": [
    {
      "source": "情報源（サイト名やURL）",
      "snippet": "関連する情報の抜粋（100文字以内）",
      "relevance": 0-100の関連度,
      "isOfficial": true/false（政府機関・公的機関・上場企業の公式情報ならtrue）
    }
  ]
}

情報が見つからない場合は空の配列を返してください。`;

    try {
      const result = await model.generateContent(prompt);
      const text = result.response.text();
      const parsed = JSON.parse(text);

      const results = parsed.results || [];
      return results.map((r: any) => ({
        query: query.query,
        source: r.source || "不明",
        snippet: r.snippet || "",
        relevance: r.relevance || 50,
        isOfficial: r.isOfficial || false,
      }));
    } catch (error) {
      console.warn(`検索実行エラー [${query.query.slice(0, 30)}]:`, error);
      return [];
    }
  }

  /**
   * Step 3: 複数ソースの結果を統合
   */
  private async aggregateResults(
    claim: string,
    results: SearchResult[]
  ): Promise<{ summary: string; consensus: AggregatedSearchResult["consensus"]; confidence: number }> {
    if (!this.genAI || results.length === 0) {
      return {
        summary: "検索結果が取得できませんでした",
        consensus: "insufficient",
        confidence: 20,
      };
    }

    const model = this.genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 1024,
        responseMimeType: "application/json",
      },
    });

    // 結果を関連度順にソート
    const sortedResults = [...results].sort((a, b) => b.relevance - a.relevance);
    const topResults = sortedResults.slice(0, 10);

    const resultsText = topResults
      .map((r, i) => `[${i + 1}] ${r.source}${r.isOfficial ? " (公式)" : ""}: ${r.snippet}`)
      .join("\n");

    const prompt = `以下の検索結果を統合して、主張の正確性を判定してください。

【検証対象の主張】
「${claim}」

【収集した検索結果（${results.length}件から上位${topResults.length}件）】
${resultsText}

【JSON出力形式】
{
  "summary": "複数ソースの情報を統合した要約（200字以内）",
  "consensus": "supports"（主張を支持）/ "contradicts"（主張と矛盾）/ "mixed"（情報が混在）/ "insufficient"（情報不足）,
  "confidence": 0-100の確信度
}`;

    try {
      const result = await model.generateContent(prompt);
      const text = result.response.text();
      return JSON.parse(text);
    } catch (error) {
      console.warn("統合分析エラー:", error);
      return {
        summary: `${results.length}件のソースを収集しましたが、統合分析に失敗しました`,
        consensus: "mixed" as const,
        confidence: 40,
      };
    }
  }

  private createEmptyResult(claim: string): AggregatedSearchResult {
    return {
      claim,
      queries: [],
      results: [],
      summary: "検索エンジンが利用できません",
      sourceCount: 0,
      officialSourceCount: 0,
      consensus: "insufficient",
      confidence: 0,
    };
  }
}
