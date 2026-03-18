// ============================================================
// Mixture-of-Agents (MoA) 検証エンジン
// GPT-5 + Gemini + Claude による多角的ファクトチェック
// + 出典正確性検証（Citation Verification）
// + ParallelSearchEngine統合
// ============================================================
import OpenAI from "openai";
import { GoogleGenerativeAI } from "@google/generative-ai";
import Anthropic from "@anthropic-ai/sdk";
import type { Issue } from "./types";
import { ParallelSearchEngine } from "./ParallelSearchEngine";
import type { AggregatedSearchResult } from "./ParallelSearchEngine";

// ─── 型定義 ───────────────────────────────

export interface ClaimToVerify {
  claim: string;           // 検証対象の記述（例：「市場規模は5000億円」）
  location: string;        // 記事内の位置（H2/H3名）
  originalIssue: Issue;    // 元のIssue（GPT-5が検出した問題）
  category: "proper-noun" | "number" | "date" | "fact" | "technical";
}

export interface ModelVerdict {
  model: string;           // モデル名（GPT-5 / Gemini / Claude）
  verdict: "correct" | "incorrect" | "uncertain";
  confidence: number;      // 0-100
  evidence: string;        // 判断根拠
  correction: string;      // 修正案（incorrectの場合）
  searchUsed: boolean;     // Web検索を使用したか
}

export interface ConsensusResult {
  claim: string;
  location: string;
  originalIssue: Issue;
  verdicts: ModelVerdict[];
  consensus: "confirmed-issue" | "dismissed" | "needs-review";
  consensusConfidence: number;  // 0-100
  finalCorrection: string;     // 最終的な修正案
  method: "unanimous" | "majority" | "weighted";
}

export interface MoAResult {
  verifiedIssues: ConsensusResult[];
  citationResults?: CitationVerificationResult[];
  summary: {
    totalClaims: number;
    confirmedIssues: number;
    dismissedIssues: number;
    needsReview: number;
    modelsUsed: string[];
    executionTime: number;
    citationsChecked?: number;
    citationsIncorrect?: number;
  };
}

// ─── 出典検証 型定義 ───────────────────────

export interface CitationToVerify {
  citationText: string;     // Full citation text
  claimText: string;        // The claim/paragraph this citation supports
  documentTitle: string;    // Extracted document title
  organization: string;     // Extracted organization
  year: string;             // Extracted year
  location: string;         // H2/H3 location in article
}

export interface CitationVerificationResult {
  citation: CitationToVerify;
  verdicts: ModelVerdict[];
  titleCorrect: boolean;
  yearCorrect: boolean;
  sourceMatchesClaim: boolean;
  correctInfo: {
    title?: string;
    year?: string;
    organization?: string;
  };
  consensus: "correct" | "incorrect" | "uncertain";
  confidence: number;
}

// ─── Gemini 検証器 ────────────────────────

class GeminiFactChecker {
  private genAI: GoogleGenerativeAI | null = null;

  constructor() {
    const apiKey =
      (typeof import.meta !== "undefined" &&
        import.meta.env &&
        import.meta.env.VITE_GEMINI_API_KEY) ||
      process.env.GEMINI_API_KEY;

    if (apiKey) {
      this.genAI = new GoogleGenerativeAI(apiKey);
      console.log("✅ MoA-Gemini: 初期化成功");
    } else {
      console.log("⚠️ MoA-Gemini: APIキーなし（スキップ）");
    }
  }

  isAvailable(): boolean {
    return this.genAI !== null;
  }

  async verify(claim: ClaimToVerify, articleExcerpt: string, preCollectedEvidence?: string): Promise<ModelVerdict> {
    if (!this.genAI) {
      throw new Error("Gemini APIが利用できません");
    }

    const model = this.genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 2048,
        responseMimeType: "application/json",
      },
      tools: [
        {
          googleSearch: {},  // Google検索グラウンディング
        } as any,
      ],
    });

    const evidenceSection = preCollectedEvidence
      ? `\n【事前収集エビデンス（ParallelSearch）】\n${preCollectedEvidence}\n`
      : "";

    const prompt = `あなたはファクトチェックの専門家です。
以下の記述が事実として正確かどうかを、Google検索を使って検証してください。
${evidenceSection}
【検証対象の記述】
「${claim.claim}」

【記述の文脈】
${articleExcerpt.slice(0, 1000)}

【別のAIモデルの指摘】
${claim.originalIssue.description}
修正案: ${claim.originalIssue.suggestion || "なし"}

【検証指示】
1. この記述が事実として正確かを判定
2. Web検索結果に基づいてエビデンスを提示
3. 事前収集エビデンスがある場合はそれも参考にする
4. 不正確な場合は正しい情報を提示

【JSON出力形式】
{
  "verdict": "correct" | "incorrect" | "uncertain",
  "confidence": 0-100の数値,
  "evidence": "判断根拠を具体的に記述",
  "correction": "incorrectの場合の正しい情報（correctの場合は空文字）"
}`;

    try {
      const result = await model.generateContent(prompt);
      const text = result.response.text();
      const parsed = JSON.parse(text);

      return {
        model: "Gemini 2.5 Flash",
        verdict: parsed.verdict || "uncertain",
        confidence: parsed.confidence || 50,
        evidence: parsed.evidence || "検証結果なし",
        correction: parsed.correction || "",
        searchUsed: true,
      };
    } catch (error) {
      console.error("MoA-Gemini検証エラー:", error);
      return {
        model: "Gemini 2.5 Flash",
        verdict: "uncertain",
        confidence: 30,
        evidence: "検証中にエラーが発生しました",
        correction: "",
        searchUsed: false,
      };
    }
  }

  async verifyCitation(citation: CitationToVerify): Promise<ModelVerdict> {
    if (!this.genAI) {
      throw new Error("Gemini APIが利用できません");
    }

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

    const prompt = `あなたは出典・引用の正確性を検証する専門家です。
以下の出典情報が正確かどうかを、Google検索を使って厳密に検証してください。

【検証対象の出典】
出典テキスト: 「${citation.citationText}」
文書タイトル: 「${citation.documentTitle}」
発行元: 「${citation.organization}」
発行年: 「${citation.year}」

【この出典が付けられている主張】
「${citation.claimText.slice(0, 500)}」

【記事内の位置】
${citation.location}

【検証ポイント - 以下を全て確認してください】
1. 文書タイトルは正確ですか？（正式名称と一致するか）
2. 発行元（組織名）は正確ですか？
3. 発行年は正確ですか？（調査実施年と報告書発行年を混同していないか要注意）
4. この出典は本当にこの主張の根拠として適切ですか？文書名、発行年、発行元は正確ですか？
5. この文書に本当に上記の主張を裏付ける内容が含まれていますか？

【よくあるエラーパターン】
- 調査実施年と報告書発行年の混同（例：2017年調査→2018年発行）
- 類似名称の文書との取り違え
- 省庁再編前後の組織名の誤り
- 文書は存在するが、主張の根拠としては不適切

【JSON出力形式】
{
  "verdict": "correct"（全て正確）/ "incorrect"（いずれかに誤り）/ "uncertain"（確認不能）,
  "confidence": 0-100の数値,
  "evidence": "検証結果の詳細（何を確認し、何が正確/不正確だったか）",
  "correction": "incorrectの場合: 正しい文書名、発行年、発行元を記載。correctの場合は空文字",
  "titleCorrect": true/false,
  "yearCorrect": true/false,
  "sourceMatchesClaim": true/false,
  "correctTitle": "正しい文書タイトル（誤りの場合）",
  "correctYear": "正しい発行年（誤りの場合）",
  "correctOrganization": "正しい組織名（誤りの場合）"
}`;

    try {
      const result = await model.generateContent(prompt);
      const text = result.response.text();
      const parsed = JSON.parse(text);

      return {
        model: "Gemini 2.5 Flash",
        verdict: parsed.verdict || "uncertain",
        confidence: parsed.confidence || 50,
        evidence: parsed.evidence || "検証結果なし",
        correction: parsed.correction || "",
        searchUsed: true,
      };
    } catch (error) {
      console.error("MoA-Gemini出典検証エラー:", error);
      return {
        model: "Gemini 2.5 Flash",
        verdict: "uncertain",
        confidence: 30,
        evidence: "出典検証中にエラーが発生しました",
        correction: "",
        searchUsed: false,
      };
    }
  }
}

// ─── Claude 検証器 ────────────────────────

class ClaudeFactChecker {
  private client: Anthropic | null = null;

  constructor() {
    const apiKey =
      (typeof import.meta !== "undefined" &&
        import.meta.env &&
        import.meta.env.VITE_ANTHROPIC_API_KEY) ||
      process.env.ANTHROPIC_API_KEY;

    if (apiKey) {
      this.client = new Anthropic({
        apiKey,
        dangerouslyAllowBrowser: true,
      });
      console.log("✅ MoA-Claude: 初期化成功");
    } else {
      console.log("⚠️ MoA-Claude: APIキーなし（スキップ）");
    }
  }

  isAvailable(): boolean {
    return this.client !== null;
  }

  async verify(claim: ClaimToVerify, articleExcerpt: string, preCollectedEvidence?: string): Promise<ModelVerdict> {
    if (!this.client) {
      throw new Error("Claude APIが利用できません");
    }

    const evidenceSection = preCollectedEvidence
      ? `\n【事前収集エビデンス（ParallelSearch）】\n${preCollectedEvidence}\n`
      : "";

    const prompt = `あなたはファクトチェックの専門家です。
以下の記述が事実として正確かどうかを検証してください。
${evidenceSection}
【検証対象の記述】
「${claim.claim}」

【記述の文脈】
${articleExcerpt.slice(0, 1000)}

【別のAIモデルの指摘】
${claim.originalIssue.description}
修正案: ${claim.originalIssue.suggestion || "なし"}

【検証指示】
1. この記述が事実として正確かを判定
2. あなたの知識に基づいてエビデンスを提示
3. 事前収集エビデンスがある場合はそれも参考にする
4. 不正確な場合は正しい情報を提示

以下のJSON形式のみで回答してください（他のテキストは不要）：
{
  "verdict": "correct" または "incorrect" または "uncertain",
  "confidence": 0から100の数値,
  "evidence": "判断根拠を具体的に記述",
  "correction": "incorrectの場合の正しい情報（correctの場合は空文字）"
}`;

    try {
      const message = await this.client.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 2048,
        messages: [{ role: "user", content: prompt }],
      });

      // レスポンスからテキストを取得
      let text = "";
      if (message.content && message.content.length > 0) {
        const firstBlock = message.content[0];
        if (firstBlock && firstBlock.type === "text") {
          text = firstBlock.text;
        }
      }

      // JSONを抽出
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error("JSON形式のレスポンスが見つかりません");
      }

      const parsed = JSON.parse(jsonMatch[0]);

      return {
        model: "Claude Sonnet",
        verdict: parsed.verdict || "uncertain",
        confidence: parsed.confidence || 50,
        evidence: parsed.evidence || "検証結果なし",
        correction: parsed.correction || "",
        searchUsed: false,
      };
    } catch (error) {
      console.error("MoA-Claude検証エラー:", error);
      return {
        model: "Claude Sonnet",
        verdict: "uncertain",
        confidence: 30,
        evidence: "検証中にエラーが発生しました",
        correction: "",
        searchUsed: false,
      };
    }
  }

  async verifyCitation(citation: CitationToVerify): Promise<ModelVerdict> {
    if (!this.client) {
      throw new Error("Claude APIが利用できません");
    }

    const prompt = `あなたは出典・引用の正確性を検証する専門家です。
以下の出典情報が正確かどうかを、あなたの知識に基づいて厳密に検証してください。

【検証対象の出典】
出典テキスト: 「${citation.citationText}」
文書タイトル: 「${citation.documentTitle}」
発行元: 「${citation.organization}」
発行年: 「${citation.year}」

【この出典が付けられている主張】
「${citation.claimText.slice(0, 500)}」

【記事内の位置】
${citation.location}

【検証ポイント】
1. 文書タイトルは正確ですか？（正式名称と一致するか）
2. 発行元（組織名）は正確ですか？
3. 発行年は正確ですか？（調査実施年と報告書発行年を混同していないか要注意）
4. この出典は本当にこの主張の根拠として適切ですか？
5. この文書に本当に上記の主張を裏付ける内容が含まれていますか？

【よくあるエラーパターン】
- 調査実施年と報告書発行年の混同（例：2017年調査→2018年発行）
- 類似名称の文書との取り違え
- 省庁再編前後の組織名の誤り

以下のJSON形式のみで回答してください：
{
  "verdict": "correct" または "incorrect" または "uncertain",
  "confidence": 0から100の数値,
  "evidence": "検証結果の詳細",
  "correction": "incorrectの場合の正しい情報（correctの場合は空文字）",
  "titleCorrect": true または false,
  "yearCorrect": true または false,
  "sourceMatchesClaim": true または false,
  "correctTitle": "正しい文書タイトル（誤りの場合のみ）",
  "correctYear": "正しい発行年（誤りの場合のみ）",
  "correctOrganization": "正しい組織名（誤りの場合のみ）"
}`;

    try {
      const message = await this.client.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 2048,
        messages: [{ role: "user", content: prompt }],
      });

      let text = "";
      if (message.content && message.content.length > 0) {
        const firstBlock = message.content[0];
        if (firstBlock && firstBlock.type === "text") {
          text = firstBlock.text;
        }
      }

      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error("JSON形式のレスポンスが見つかりません");
      }

      const parsed = JSON.parse(jsonMatch[0]);

      return {
        model: "Claude Sonnet",
        verdict: parsed.verdict || "uncertain",
        confidence: parsed.confidence || 50,
        evidence: parsed.evidence || "検証結果なし",
        correction: parsed.correction || "",
        searchUsed: false,
      };
    } catch (error) {
      console.error("MoA-Claude出典検証エラー:", error);
      return {
        model: "Claude Sonnet",
        verdict: "uncertain",
        confidence: 30,
        evidence: "出典検証中にエラーが発生しました",
        correction: "",
        searchUsed: false,
      };
    }
  }
}

// ─── GPT-5 検証器（既存のOpenAI接続を再利用） ──────

class GPT5FactChecker {
  private openai: OpenAI | null = null;

  constructor() {
    const apiKey =
      (typeof import.meta !== "undefined" &&
        import.meta.env &&
        import.meta.env.VITE_OPENAI_API_KEY) ||
      process.env.OPENAI_API_KEY;

    if (apiKey) {
      this.openai = new OpenAI({
        apiKey,
        dangerouslyAllowBrowser: true,
        timeout: 300000,
        maxRetries: 3,
      });
      console.log("✅ MoA-GPT5: 初期化成功");
    } else {
      console.log("⚠️ MoA-GPT5: APIキーなし（スキップ）");
    }
  }

  isAvailable(): boolean {
    return this.openai !== null;
  }

  async verify(claim: ClaimToVerify, articleExcerpt: string, preCollectedEvidence?: string): Promise<ModelVerdict> {
    if (!this.openai) {
      throw new Error("OpenAI APIが利用できません");
    }

    const evidenceSection = preCollectedEvidence
      ? `\n【事前収集エビデンス（ParallelSearch）】\n${preCollectedEvidence}\n`
      : "";

    const prompt = `あなたはファクトチェックの専門家です。
以下の記述が事実として正確かどうかを、Web検索を使って検証してください。
${evidenceSection}
【検証対象の記述】
「${claim.claim}」

【記述の文脈】
${articleExcerpt.slice(0, 1000)}

【検証指示】
1. この記述が事実として正確かを判定
2. Web検索結果に基づいてエビデンスを提示
3. 事前収集エビデンスがある場合はそれも参考にする
4. 不正確な場合は正しい情報を提示

以下のJSON形式で回答してください：
{
  "verdict": "correct" または "incorrect" または "uncertain",
  "confidence": 0から100の数値,
  "evidence": "判断根拠を具体的に記述",
  "correction": "incorrectの場合の正しい情報（correctの場合は空文字）"
}`;

    try {
      const response = await (this.openai as any).responses.create({
        model: "gpt-5-mini",
        input: prompt,
        tools: [{ type: "web_search" }],
        reasoning: { effort: "medium" },
      });

      // レスポンスからテキストを取得
      let resultText = "";
      if (typeof response.output_text === "string") {
        resultText = response.output_text;
      } else if (typeof response.output === "string") {
        resultText = response.output;
      } else if (response.output && response.output.text) {
        resultText = response.output.text;
      }

      // JSONを抽出
      const jsonMatch = resultText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error("JSON形式のレスポンスが見つかりません");
      }

      const parsed = JSON.parse(jsonMatch[0]);

      return {
        model: "GPT-5 Mini",
        verdict: parsed.verdict || "uncertain",
        confidence: parsed.confidence || 50,
        evidence: parsed.evidence || "検証結果なし",
        correction: parsed.correction || "",
        searchUsed: true,
      };
    } catch (error) {
      console.error("MoA-GPT5検証エラー:", error);
      return {
        model: "GPT-5 Mini",
        verdict: "uncertain",
        confidence: 30,
        evidence: "検証中にエラーが発生しました",
        correction: "",
        searchUsed: false,
      };
    }
  }

  async verifyCitation(citation: CitationToVerify): Promise<ModelVerdict> {
    if (!this.openai) {
      throw new Error("OpenAI APIが利用できません");
    }

    const prompt = `あなたは出典・引用の正確性を検証する専門家です。
以下の出典情報が正確かどうかを、Web検索を使って厳密に検証してください。

【検証対象の出典】
出典テキスト: 「${citation.citationText}」
文書タイトル: 「${citation.documentTitle}」
発行元: 「${citation.organization}」
発行年: 「${citation.year}」

【この出典が付けられている主張】
「${citation.claimText.slice(0, 500)}」

【記事内の位置】
${citation.location}

【検証ポイント】
1. 文書タイトルは正確ですか？（正式名称と一致するか）
2. 発行元（組織名）は正確ですか？
3. 発行年は正確ですか？（調査実施年と報告書発行年を混同していないか要注意）
4. この出典は本当にこの主張の根拠として適切ですか？文書名、発行年、発行元は正確ですか？
5. この文書に本当に上記の主張を裏付ける内容が含まれていますか？

【よくあるエラーパターン】
- 調査実施年と報告書発行年の混同（例：2017年調査→2018年発行）
- 類似名称の文書との取り違え
- 省庁再編前後の組織名の誤り

以下のJSON形式で回答してください：
{
  "verdict": "correct" または "incorrect" または "uncertain",
  "confidence": 0から100の数値,
  "evidence": "検証結果の詳細",
  "correction": "incorrectの場合の正しい情報（correctの場合は空文字）",
  "titleCorrect": true または false,
  "yearCorrect": true または false,
  "sourceMatchesClaim": true または false,
  "correctTitle": "正しい文書タイトル（誤りの場合のみ）",
  "correctYear": "正しい発行年（誤りの場合のみ）",
  "correctOrganization": "正しい組織名（誤りの場合のみ）"
}`;

    try {
      const response = await (this.openai as any).responses.create({
        model: "gpt-5-mini",
        input: prompt,
        tools: [{ type: "web_search" }],
        reasoning: { effort: "high" },
      });

      let resultText = "";
      if (typeof response.output_text === "string") {
        resultText = response.output_text;
      } else if (typeof response.output === "string") {
        resultText = response.output;
      } else if (response.output && response.output.text) {
        resultText = response.output.text;
      }

      const jsonMatch = resultText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error("JSON形式のレスポンスが見つかりません");
      }

      const parsed = JSON.parse(jsonMatch[0]);

      return {
        model: "GPT-5 Mini",
        verdict: parsed.verdict || "uncertain",
        confidence: parsed.confidence || 50,
        evidence: parsed.evidence || "検証結果なし",
        correction: parsed.correction || "",
        searchUsed: true,
      };
    } catch (error) {
      console.error("MoA-GPT5出典検証エラー:", error);
      return {
        model: "GPT-5 Mini",
        verdict: "uncertain",
        confidence: 30,
        evidence: "出典検証中にエラーが発生しました",
        correction: "",
        searchUsed: false,
      };
    }
  }
}

// ─── コンセンサスエンジン ──────────────────

class ConsensusEngine {
  /**
   * 複数モデルの判定結果からコンセンサスを算出
   *
   * ルール：
   * 1. 全会一致（unanimous）: 全モデルが同じ判定 → 最高信頼度
   * 2. 多数決（majority）: 2/3以上が同じ判定 → 中信頼度
   * 3. 加重投票（weighted）: confidence値で重み付け → 低信頼度
   */
  static evaluate(verdicts: ModelVerdict[], originalIssue: Issue): {
    consensus: ConsensusResult["consensus"];
    confidence: number;
    correction: string;
    method: ConsensusResult["method"];
  } {
    // verdictが空の場合のフォールバック
    if (!verdicts || verdicts.length === 0) {
      return {
        consensus: "needs-review",
        confidence: 0,
        correction: originalIssue.suggestion || "",
        method: "weighted",
      };
    }

    // uncertain以外のverdictをカウント
    const incorrectVotes = verdicts.filter((v) => v.verdict === "incorrect");
    const correctVotes = verdicts.filter((v) => v.verdict === "correct");
    const uncertainVotes = verdicts.filter((v) => v.verdict === "uncertain");
    const totalVotes = verdicts.length;

    // 1. 全会一致チェック
    if (incorrectVotes.length === totalVotes) {
      // 全モデルが「incorrect」→ 問題確定
      const avgConfidence = this.weightedAverage(incorrectVotes);
      const correction = this.selectBestCorrection(incorrectVotes);
      return {
        consensus: "confirmed-issue",
        confidence: Math.min(avgConfidence + 10, 100),
        correction,
        method: "unanimous",
      };
    }

    if (correctVotes.length === totalVotes) {
      // 全モデルが「correct」→ 問題却下（GPT-5の誤検出）
      const avgConfidence = this.weightedAverage(correctVotes);
      return {
        consensus: "dismissed",
        confidence: Math.min(avgConfidence + 10, 100),
        correction: "",
        method: "unanimous",
      };
    }

    // 2. 多数決チェック（2/3以上）
    const majorityThreshold = Math.ceil(totalVotes * 2 / 3);

    if (incorrectVotes.length >= majorityThreshold) {
      const avgConfidence = this.weightedAverage(incorrectVotes);
      const correction = this.selectBestCorrection(incorrectVotes);
      return {
        consensus: "confirmed-issue",
        confidence: avgConfidence,
        correction,
        method: "majority",
      };
    }

    if (correctVotes.length >= majorityThreshold) {
      const avgConfidence = this.weightedAverage(correctVotes);
      return {
        consensus: "dismissed",
        confidence: avgConfidence,
        correction: "",
        method: "majority",
      };
    }

    // 3. 加重投票（意見が割れている場合）
    const incorrectWeight = this.totalWeight(incorrectVotes);
    const correctWeight = this.totalWeight(correctVotes);
    const uncertainWeight = this.totalWeight(uncertainVotes);

    // uncertainが多い場合はレビュー必要
    if (uncertainWeight > incorrectWeight && uncertainWeight > correctWeight) {
      return {
        consensus: "needs-review",
        confidence: 40,
        correction: originalIssue.suggestion || "",
        method: "weighted",
      };
    }

    if (incorrectWeight > correctWeight) {
      const correction = this.selectBestCorrection(incorrectVotes);
      return {
        consensus: "confirmed-issue",
        confidence: Math.round((incorrectWeight / (incorrectWeight + correctWeight + uncertainWeight)) * 100),
        correction,
        method: "weighted",
      };
    }

    // correctWeightが高い → 問題却下
    return {
      consensus: "dismissed",
      confidence: Math.round((correctWeight / (incorrectWeight + correctWeight + uncertainWeight)) * 100),
      correction: "",
      method: "weighted",
    };
  }

  /**
   * 出典検証用コンセンサス算出
   * verdict の correct/incorrect/uncertain を出典固有のロジックで評価
   */
  static evaluateCitation(verdicts: ModelVerdict[]): {
    consensus: "correct" | "incorrect" | "uncertain";
    confidence: number;
  } {
    if (!verdicts || verdicts.length === 0) {
      return { consensus: "uncertain", confidence: 0 };
    }

    const incorrectVotes = verdicts.filter((v) => v.verdict === "incorrect");
    const correctVotes = verdicts.filter((v) => v.verdict === "correct");
    const totalVotes = verdicts.length;

    // 全会一致
    if (incorrectVotes.length === totalVotes) {
      return {
        consensus: "incorrect",
        confidence: Math.min(this.weightedAverage(incorrectVotes) + 10, 100),
      };
    }

    if (correctVotes.length === totalVotes) {
      return {
        consensus: "correct",
        confidence: Math.min(this.weightedAverage(correctVotes) + 10, 100),
      };
    }

    // 多数決
    const majorityThreshold = Math.ceil(totalVotes * 2 / 3);

    if (incorrectVotes.length >= majorityThreshold) {
      return {
        consensus: "incorrect",
        confidence: this.weightedAverage(incorrectVotes),
      };
    }

    if (correctVotes.length >= majorityThreshold) {
      return {
        consensus: "correct",
        confidence: this.weightedAverage(correctVotes),
      };
    }

    // 意見が分かれている場合
    const incorrectWeight = this.totalWeight(incorrectVotes);
    const correctWeight = this.totalWeight(correctVotes);

    if (incorrectWeight > correctWeight) {
      return {
        consensus: "incorrect",
        confidence: Math.round((incorrectWeight / (incorrectWeight + correctWeight)) * 80),
      };
    }

    if (correctWeight > incorrectWeight) {
      return {
        consensus: "correct",
        confidence: Math.round((correctWeight / (incorrectWeight + correctWeight)) * 80),
      };
    }

    return { consensus: "uncertain", confidence: 40 };
  }

  private static weightedAverage(verdicts: ModelVerdict[]): number {
    if (verdicts.length === 0) return 0;
    const sum = verdicts.reduce((acc, v) => acc + v.confidence, 0);
    return Math.round(sum / verdicts.length);
  }

  private static totalWeight(verdicts: ModelVerdict[]): number {
    return verdicts.reduce((acc, v) => acc + v.confidence, 0);
  }

  private static selectBestCorrection(verdicts: ModelVerdict[]): string {
    // confidence最高のモデルの修正案を採用
    const sorted = [...verdicts].sort((a, b) => b.confidence - a.confidence);
    for (const v of sorted) {
      if (v.correction && v.correction.length > 0) {
        return v.correction;
      }
    }
    return "";
  }
}

// ─── メイン：MoA検証クラス ──────────────────

export class MixtureOfAgentsVerifier {
  private gemini: GeminiFactChecker;
  private claude: ClaudeFactChecker;
  private gpt5: GPT5FactChecker;
  private parallelSearch: ParallelSearchEngine;

  constructor() {
    this.gemini = new GeminiFactChecker();
    this.claude = new ClaudeFactChecker();
    this.gpt5 = new GPT5FactChecker();
    this.parallelSearch = new ParallelSearchEngine();

    const models: string[] = [];
    if (this.gpt5.isAvailable()) models.push("GPT-5");
    if (this.gemini.isAvailable()) models.push("Gemini");
    if (this.claude.isAvailable()) models.push("Claude");

    console.log(`🔀 MoA検証エンジン初期化: ${models.length}モデル利用可能 [${models.join(", ")}]`);
    if (this.parallelSearch.isAvailable()) {
      console.log("🔎 ParallelSearchEngine: 有効");
    }
  }

  getAvailableModels(): string[] {
    const models: string[] = [];
    if (this.gpt5.isAvailable()) models.push("GPT-5");
    if (this.gemini.isAvailable()) models.push("Gemini");
    if (this.claude.isAvailable()) models.push("Claude");
    return models;
  }

  /**
   * critical/majorの問題をMoAで相互検証する
   * @param issues - Phase1で検出されたIssue配列
   * @param articleContent - 記事全文
   * @param onProgress - 進捗コールバック
   */
  async crossVerify(
    issues: Issue[],
    articleContent: string,
    onProgress?: (message: string, progress: number) => void
  ): Promise<MoAResult> {
    const startTime = Date.now();

    // critical / major のみを対象にする（minor はスキップ）
    const targetIssues = issues.filter(
      (i) => i.severity === "critical" || i.severity === "major"
    );

    if (targetIssues.length === 0) {
      console.log("🔀 MoA: 検証対象のcritical/majorイシューなし");
      return {
        verifiedIssues: [],
        summary: {
          totalClaims: 0,
          confirmedIssues: 0,
          dismissedIssues: 0,
          needsReview: 0,
          modelsUsed: this.getAvailableModels(),
          executionTime: Date.now() - startTime,
        },
      };
    }

    console.log(`🔀 MoA: ${targetIssues.length}件のイシューを相互検証開始`);

    // イシューをClaimに変換
    const claims: ClaimToVerify[] = targetIssues.map((issue) => ({
      claim: issue.original || issue.description,
      location: issue.location || "不明",
      originalIssue: issue,
      category: this.categorizeIssue(issue),
    }));

    // 各claimを並列で検証
    const results: ConsensusResult[] = [];
    const batchSize = 3; // 同時実行数を制限（APIレート制限対策）

    for (let i = 0; i < claims.length; i += batchSize) {
      const batch = claims.slice(i, i + batchSize);
      const batchNum = Math.floor(i / batchSize) + 1;
      const totalBatches = Math.ceil(claims.length / batchSize);

      if (onProgress) {
        onProgress(
          `MoA検証中... バッチ ${batchNum}/${totalBatches}`,
          Math.round((i / claims.length) * 100)
        );
      }

      console.log(`🔀 MoA: バッチ ${batchNum}/${totalBatches} (${batch.length}件)`);

      const batchResults = await Promise.all(
        batch.map((claim) => this.verifySingleClaim(claim, articleContent))
      );

      results.push(...batchResults);
    }

    // 集計
    const confirmedIssues = results.filter((r) => r.consensus === "confirmed-issue").length;
    const dismissedIssues = results.filter((r) => r.consensus === "dismissed").length;
    const needsReview = results.filter((r) => r.consensus === "needs-review").length;

    const executionTime = Date.now() - startTime;
    console.log(`🔀 MoA検証完了 (${(executionTime / 1000).toFixed(1)}秒)`);
    console.log(`  確認済み問題: ${confirmedIssues}件`);
    console.log(`  却下（誤検出）: ${dismissedIssues}件`);
    console.log(`  要レビュー: ${needsReview}件`);

    return {
      verifiedIssues: results,
      summary: {
        totalClaims: claims.length,
        confirmedIssues,
        dismissedIssues,
        needsReview,
        modelsUsed: this.getAvailableModels(),
        executionTime,
      },
    };
  }

  /**
   * 記事内の全出典を抽出し、MoAで正確性を検証する
   * @param articleContent - 記事全文（HTML）
   * @param onProgress - 進捗コールバック
   */
  async verifyCitations(
    articleContent: string,
    onProgress?: (message: string, progress: number) => void
  ): Promise<CitationVerificationResult[]> {
    const citations = MixtureOfAgentsVerifier.extractCitationsFromArticle(articleContent);

    if (citations.length === 0) {
      console.log("📎 出典検証: 記事内に出典が見つかりませんでした");
      return [];
    }

    console.log(`📎 出典検証: ${citations.length}件の出典を検証開始`);

    const results: CitationVerificationResult[] = [];
    const batchSize = 2; // 出典検証は重いので同時2件まで

    for (let i = 0; i < citations.length; i += batchSize) {
      const batch = citations.slice(i, i + batchSize);
      const batchNum = Math.floor(i / batchSize) + 1;
      const totalBatches = Math.ceil(citations.length / batchSize);

      if (onProgress) {
        onProgress(
          `出典検証中... ${batchNum}/${totalBatches}`,
          Math.round((i / citations.length) * 100)
        );
      }

      console.log(`📎 出典検証: バッチ ${batchNum}/${totalBatches}`);

      const batchResults = await Promise.all(
        batch.map((citation) => this.verifySingleCitation(citation))
      );

      results.push(...batchResults);
    }

    // サマリーログ
    const incorrectCount = results.filter((r) => r.consensus === "incorrect").length;
    const correctCount = results.filter((r) => r.consensus === "correct").length;
    const uncertainCount = results.filter((r) => r.consensus === "uncertain").length;

    console.log(`📎 出典検証完了:`);
    console.log(`  正確: ${correctCount}件`);
    console.log(`  不正確: ${incorrectCount}件`);
    console.log(`  不明: ${uncertainCount}件`);

    return results;
  }

  /**
   * 単一の出典を全モデルで検証
   */
  private async verifySingleCitation(
    citation: CitationToVerify
  ): Promise<CitationVerificationResult> {
    console.log(`  📎 出典検証中: 「${citation.documentTitle.slice(0, 40)}...」(${citation.organization}, ${citation.year})`);

    const verificationPromises: Promise<ModelVerdict>[] = [];

    if (this.gemini.isAvailable()) {
      verificationPromises.push(
        this.gemini.verifyCitation(citation).catch((err) => {
          console.warn("Gemini出典検証失敗:", err);
          return {
            model: "Gemini 2.5 Flash",
            verdict: "uncertain" as const,
            confidence: 20,
            evidence: "検証失敗",
            correction: "",
            searchUsed: false,
          };
        })
      );
    }

    if (this.claude.isAvailable()) {
      verificationPromises.push(
        this.claude.verifyCitation(citation).catch((err) => {
          console.warn("Claude出典検証失敗:", err);
          return {
            model: "Claude Sonnet",
            verdict: "uncertain" as const,
            confidence: 20,
            evidence: "検証失敗",
            correction: "",
            searchUsed: false,
          };
        })
      );
    }

    if (this.gpt5.isAvailable()) {
      verificationPromises.push(
        this.gpt5.verifyCitation(citation).catch((err) => {
          console.warn("GPT-5出典検証失敗:", err);
          return {
            model: "GPT-5 Mini",
            verdict: "uncertain" as const,
            confidence: 20,
            evidence: "検証失敗",
            correction: "",
            searchUsed: false,
          };
        })
      );
    }

    const verdicts = await Promise.all(verificationPromises);

    // 各モデルの結果をログ出力
    verdicts.forEach((v) => {
      const icon = v.verdict === "correct" ? "✅" : v.verdict === "incorrect" ? "❌" : "❓";
      console.log(`    ${icon} ${v.model}: ${v.verdict} (confidence: ${v.confidence})`);
    });

    // コンセンサス算出
    const consensusResult = ConsensusEngine.evaluateCitation(verdicts);

    // 各モデルのJSON応答から詳細情報を集約
    const detailInfo = this.extractCitationDetails(verdicts);

    console.log(`    📊 出典コンセンサス: ${consensusResult.consensus} (confidence: ${consensusResult.confidence})`);

    return {
      citation,
      verdicts,
      titleCorrect: detailInfo.titleCorrect,
      yearCorrect: detailInfo.yearCorrect,
      sourceMatchesClaim: detailInfo.sourceMatchesClaim,
      correctInfo: detailInfo.correctInfo,
      consensus: consensusResult.consensus,
      confidence: consensusResult.confidence,
    };
  }

  /**
   * 複数モデルの出典検証結果から詳細情報を集約
   */
  private extractCitationDetails(verdicts: ModelVerdict[]): {
    titleCorrect: boolean;
    yearCorrect: boolean;
    sourceMatchesClaim: boolean;
    correctInfo: { title?: string; year?: string; organization?: string };
  } {
    // デフォルト: 確認できない場合はtrueとする（保守的）
    let titleCorrectCount = 0;
    let titleIncorrectCount = 0;
    let yearCorrectCount = 0;
    let yearIncorrectCount = 0;
    let sourceMatchCount = 0;
    let sourceNoMatchCount = 0;
    const correctInfo: { title?: string; year?: string; organization?: string } = {};

    for (const v of verdicts) {
      // evidenceからJSON情報を再パースしてみる
      // （各モデルのcorrectionフィールドに補正情報が含まれる可能性）
      try {
        // correctionフィールドからの情報抽出を試みる
        const corrText = v.correction || "";

        // verdict が incorrect の場合のみカウント
        if (v.verdict === "incorrect") {
          // タイトル関連のキーワードチェック
          if (corrText.indexOf("タイトル") >= 0 || corrText.indexOf("文書名") >= 0 || corrText.indexOf("名称") >= 0) {
            titleIncorrectCount++;
          }
          if (corrText.indexOf("年") >= 0 || corrText.indexOf("発行") >= 0) {
            yearIncorrectCount++;
          }

          // 修正情報を保存（最も信頼度が高いモデルの情報を使用）
          if (corrText.length > 0 && !correctInfo.title) {
            // 正しいタイトルの抽出を試みる
            const titleMatch = corrText.match(/正しい[^\s]*タイトル[：:]\s*(.+?)(?:\s|$|、|。)/);
            if (titleMatch) {
              correctInfo.title = titleMatch[1];
            }
            const yearMatch = corrText.match(/正しい[^\s]*(?:発行)?年[：:]\s*(\d{4})/);
            if (yearMatch) {
              correctInfo.year = yearMatch[1];
            }
            const orgMatch = corrText.match(/正しい[^\s]*(?:発行元|組織)[：:]\s*(.+?)(?:\s|$|、|。)/);
            if (orgMatch) {
              correctInfo.organization = orgMatch[1];
            }
          }
        } else if (v.verdict === "correct") {
          titleCorrectCount++;
          yearCorrectCount++;
          sourceMatchCount++;
        }
      } catch (_e) {
        // パース失敗は無視
      }
    }

    // 多数決で判定
    const totalVotes = verdicts.length;
    const halfThreshold = totalVotes > 0 ? Math.ceil(totalVotes / 2) : 1;

    return {
      titleCorrect: titleIncorrectCount < halfThreshold,
      yearCorrect: yearIncorrectCount < halfThreshold,
      sourceMatchesClaim: sourceNoMatchCount < halfThreshold,
      correctInfo,
    };
  }

  /**
   * 単一のclaimを全モデルで検証（ParallelSearchEngine統合版）
   */
  private async verifySingleClaim(
    claim: ClaimToVerify,
    articleContent: string
  ): Promise<ConsensusResult> {
    console.log(`  🔍 検証中: 「${claim.claim.slice(0, 50)}...」`);

    // 記事内の該当箇所の前後を抽出（コンテキスト）
    const excerpt = this.extractExcerpt(articleContent, claim.claim);

    // ─── Step 1: ParallelSearchで事前エビデンスを収集 ───
    let preCollectedEvidence = "";

    if (this.parallelSearch.isAvailable()) {
      try {
        console.log(`    🔎 ParallelSearch: エビデンス事前収集中...`);
        const searchResult: AggregatedSearchResult = await this.parallelSearch.searchAndVerify(
          claim.claim,
          excerpt,
          claim.category
        );

        if (searchResult.results.length > 0) {
          // 収集したエビデンスをテキスト化
          const evidenceLines: string[] = [];
          evidenceLines.push(`検索ソース数: ${searchResult.sourceCount}件（公的機関: ${searchResult.officialSourceCount}件）`);
          evidenceLines.push(`検索結果の総合判定: ${searchResult.consensus} (信頼度: ${searchResult.confidence})`);
          evidenceLines.push(`要約: ${searchResult.summary}`);
          evidenceLines.push("");

          // 上位5件のソースを含める
          const topResults = searchResult.results
            .sort((a, b) => b.relevance - a.relevance)
            .slice(0, 5);

          for (let idx = 0; idx < topResults.length; idx++) {
            const r = topResults[idx];
            evidenceLines.push(`[ソース${idx + 1}] ${r.source}${r.isOfficial ? " (公式)" : ""}`);
            evidenceLines.push(`  内容: ${r.snippet}`);
            evidenceLines.push(`  関連度: ${r.relevance}`);
          }

          preCollectedEvidence = evidenceLines.join("\n");
          console.log(`    🔎 ParallelSearch: ${searchResult.results.length}件のエビデンスを収集完了`);
        } else {
          console.log("    🔎 ParallelSearch: エビデンスが見つかりませんでした");
        }
      } catch (searchError) {
        console.warn("    ⚠️ ParallelSearch失敗（スキップ）:", searchError);
      }
    }

    // ─── Step 2: 全モデルに並列でリクエスト（エビデンス付き） ───
    const verificationPromises: Promise<ModelVerdict>[] = [];

    if (this.gemini.isAvailable()) {
      verificationPromises.push(
        this.gemini.verify(claim, excerpt, preCollectedEvidence).catch((err) => {
          console.warn("Gemini検証失敗:", err);
          return {
            model: "Gemini 2.5 Flash",
            verdict: "uncertain" as const,
            confidence: 20,
            evidence: "検証失敗",
            correction: "",
            searchUsed: false,
          };
        })
      );
    }

    if (this.claude.isAvailable()) {
      verificationPromises.push(
        this.claude.verify(claim, excerpt, preCollectedEvidence).catch((err) => {
          console.warn("Claude検証失敗:", err);
          return {
            model: "Claude Sonnet",
            verdict: "uncertain" as const,
            confidence: 20,
            evidence: "検証失敗",
            correction: "",
            searchUsed: false,
          };
        })
      );
    }

    if (this.gpt5.isAvailable()) {
      verificationPromises.push(
        this.gpt5.verify(claim, excerpt, preCollectedEvidence).catch((err) => {
          console.warn("GPT-5検証失敗:", err);
          return {
            model: "GPT-5 Mini",
            verdict: "uncertain" as const,
            confidence: 20,
            evidence: "検証失敗",
            correction: "",
            searchUsed: false,
          };
        })
      );
    }

    // 全モデルの結果を待機
    const verdicts = await Promise.all(verificationPromises);

    // 各モデルの結果をログ出力
    verdicts.forEach((v) => {
      const icon = v.verdict === "correct" ? "✅" : v.verdict === "incorrect" ? "❌" : "❓";
      console.log(`    ${icon} ${v.model}: ${v.verdict} (confidence: ${v.confidence})`);
    });

    // コンセンサス算出
    const consensusResult = ConsensusEngine.evaluate(verdicts, claim.originalIssue);

    console.log(`    📊 コンセンサス: ${consensusResult.consensus} (${consensusResult.method}, confidence: ${consensusResult.confidence})`);

    return {
      claim: claim.claim,
      location: claim.location,
      originalIssue: claim.originalIssue,
      verdicts,
      consensus: consensusResult.consensus,
      consensusConfidence: consensusResult.confidence,
      finalCorrection: consensusResult.correction,
      method: consensusResult.method,
    };
  }

  /**
   * 記事HTMLから全出典を抽出する
   *
   * 対象パターン：
   * 1. <p class="source-citation">...</p> 要素
   * 2. ※出典元：タイトル（組織名・年）の文字列パターン
   * 3. ※出典：タイトル（組織名、年） のバリエーション
   */
  static extractCitationsFromArticle(htmlContent: string): CitationToVerify[] {
    const citations: CitationToVerify[] = [];

    // ─── パターン1: <p class="source-citation"> 要素 ───
    const sourceCitationRegex = /<p\s+class\s*=\s*["']source-citation["'][^>]*>([\s\S]*?)<\/p>/gi;
    let match = sourceCitationRegex.exec(htmlContent);
    while (match !== null) {
      const citationHtml = match[1];
      // HTMLタグを除去してプレーンテキストに
      const citationText = citationHtml.replace(/<[^>]+>/g, "").trim();

      if (citationText.length > 0) {
        const parsed = MixtureOfAgentsVerifier.parseCitationText(citationText);
        const claimText = MixtureOfAgentsVerifier.findPrecedingClaim(htmlContent, match.index);
        const location = MixtureOfAgentsVerifier.findHeadingLocation(htmlContent, match.index);

        citations.push({
          citationText,
          claimText,
          documentTitle: parsed.title,
          organization: parsed.organization,
          year: parsed.year,
          location,
        });
      }

      match = sourceCitationRegex.exec(htmlContent);
    }

    // ─── パターン2: テキスト内の出典パターン ───
    // ※出典元：タイトル（組織名・年）
    // ※出典：タイトル（組織名、年）
    const textCitationRegex = /※出典[元]?[：:]\s*([^（(]+)[（(]([^）)]+)[）)]/g;
    let textMatch = textCitationRegex.exec(htmlContent);
    while (textMatch !== null) {
      const fullCitationText = textMatch[0];
      const title = textMatch[1].replace(/<[^>]+>/g, "").trim();
      const metaInfo = textMatch[2].replace(/<[^>]+>/g, "").trim();

      // 既にパターン1で抽出済みでないか確認
      const alreadyExtracted = citations.some((c) => c.citationText.indexOf(title) >= 0);
      if (!alreadyExtracted && title.length > 0) {
        const orgAndYear = MixtureOfAgentsVerifier.parseOrgAndYear(metaInfo);
        const claimText = MixtureOfAgentsVerifier.findPrecedingClaim(htmlContent, textMatch.index);
        const location = MixtureOfAgentsVerifier.findHeadingLocation(htmlContent, textMatch.index);

        citations.push({
          citationText: fullCitationText.replace(/<[^>]+>/g, ""),
          claimText,
          documentTitle: title,
          organization: orgAndYear.organization,
          year: orgAndYear.year,
          location,
        });
      }

      textMatch = textCitationRegex.exec(htmlContent);
    }

    console.log(`📎 出典抽出: ${citations.length}件の出典を検出`);
    return citations;
  }

  /**
   * 出典テキストからタイトル・組織名・年を解析する
   */
  private static parseCitationText(text: string): {
    title: string;
    organization: string;
    year: string;
  } {
    // パターン: 「タイトル（組織名・年）」or 「タイトル（組織名、年）」
    const fullPattern = /^[※]?出典[元]?[：:]?\s*(.+?)[（(](.+?)[）)]$/;
    const fullMatch = text.match(fullPattern);

    if (fullMatch) {
      const title = fullMatch[1].trim();
      const meta = fullMatch[2].trim();
      const orgAndYear = MixtureOfAgentsVerifier.parseOrgAndYear(meta);
      return {
        title,
        organization: orgAndYear.organization,
        year: orgAndYear.year,
      };
    }

    // パターン2: タイトルだけの場合
    const titleOnly = text.replace(/^[※]?出典[元]?[：:]\s*/, "").trim();

    // 年を探す
    const yearMatch = titleOnly.match(/(\d{4})\s*年/);
    const year = yearMatch ? yearMatch[1] : "";

    return {
      title: titleOnly,
      organization: "",
      year,
    };
  }

  /**
   * 「組織名・年」or「組織名、年」文字列からそれぞれを抽出
   */
  private static parseOrgAndYear(meta: string): {
    organization: string;
    year: string;
  } {
    // 年の抽出
    const yearMatch = meta.match(/(\d{4})\s*年?/);
    const year = yearMatch ? yearMatch[1] : "";

    // 年を除去して組織名を取得
    let organization = meta;
    if (yearMatch) {
      organization = meta.replace(yearMatch[0], "");
    }
    // 区切り文字を除去
    organization = organization.replace(/[・、,，\s]+$/, "").replace(/^[・、,，\s]+/, "").trim();

    return { organization, year };
  }

  /**
   * 出典の直前にある段落（主張テキスト）を見つける
   */
  private static findPrecedingClaim(htmlContent: string, citationIndex: number): string {
    // 出典の前の部分を取得
    const before = htmlContent.slice(Math.max(0, citationIndex - 2000), citationIndex);

    // 直前の<p>タグの内容を探す
    const pTagRegex = /<p[^>]*>([\s\S]*?)<\/p>/gi;
    let lastPContent = "";
    let pMatch = pTagRegex.exec(before);

    while (pMatch !== null) {
      const content = pMatch[1].replace(/<[^>]+>/g, "").trim();
      // source-citationでないp要素の内容を保存
      if (content.length > 0 && pMatch[0].indexOf("source-citation") < 0) {
        lastPContent = content;
      }
      pMatch = pTagRegex.exec(before);
    }

    if (lastPContent.length > 0) {
      return lastPContent;
    }

    // <p>が見つからない場合、直前のテキストブロックを返す
    const textBefore = before.replace(/<[^>]+>/g, "").trim();
    // 最後の200文字を返す
    return textBefore.slice(-200);
  }

  /**
   * 指定位置を含むH2/H3の見出しを見つける
   */
  private static findHeadingLocation(htmlContent: string, targetIndex: number): string {
    const before = htmlContent.slice(0, targetIndex);

    // 最後のH2を探す
    let lastH2 = "";
    const h2Regex = /<h2[^>]*>([\s\S]*?)<\/h2>/gi;
    let h2Match = h2Regex.exec(before);
    while (h2Match !== null) {
      lastH2 = h2Match[1].replace(/<[^>]+>/g, "").trim();
      h2Match = h2Regex.exec(before);
    }

    // 最後のH3を探す
    let lastH3 = "";
    const h3Regex = /<h3[^>]*>([\s\S]*?)<\/h3>/gi;
    let h3Match = h3Regex.exec(before);
    while (h3Match !== null) {
      lastH3 = h3Match[1].replace(/<[^>]+>/g, "").trim();
      h3Match = h3Regex.exec(before);
    }

    if (lastH2 && lastH3) {
      return `${lastH2} > ${lastH3}`;
    }
    if (lastH2) {
      return lastH2;
    }
    return "記事冒頭";
  }

  /**
   * 記事から該当箇所の前後コンテキストを抽出
   */
  private extractExcerpt(content: string, claim: string): string {
    const index = content.indexOf(claim);
    if (index === -1) {
      // 完全一致しない場合はclaimの一部で検索
      const shortClaim = claim.slice(0, 30);
      const shortIndex = content.indexOf(shortClaim);
      if (shortIndex === -1) {
        return content.slice(0, 1500);
      }
      const start = Math.max(0, shortIndex - 300);
      const end = Math.min(content.length, shortIndex + 700);
      return content.slice(start, end);
    }
    const start = Math.max(0, index - 300);
    const end = Math.min(content.length, index + 700);
    return content.slice(start, end);
  }

  /**
   * Issueのtypeからカテゴリを推定
   */
  private categorizeIssue(issue: Issue): ClaimToVerify["category"] {
    switch (issue.type) {
      case "brand-error":
        return "proper-noun";
      case "technical-error":
        return "technical";
      case "outdated-info":
        return "date";
      case "factual-error":
        return "fact";
      default:
        return "fact";
    }
  }
}
