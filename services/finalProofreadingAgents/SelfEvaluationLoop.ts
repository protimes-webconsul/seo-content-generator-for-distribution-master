// ============================================================
// 自己評価ループ（Reflection + Autopilot Agent）
// チェック結果を自己レビューし、見落としを再チェックする
// ============================================================
import { GoogleGenerativeAI } from "@google/generative-ai";
import type { Issue, AgentResult, IntegrationResult } from "./types";
import type { ConsensusResult, MoAResult } from "./MixtureOfAgentsVerifier";

// ─── 型定義 ───────────────────────────────

export interface ReflectionResult {
  gaps: GapItem[];                // 発見された見落とし・不足
  overallAssessment: string;      // 全体の評価コメント
  shouldRecheck: boolean;         // 再チェックが必要か
  recheckTargets: RecheckTarget[];// 再チェック対象
  iteration: number;              // 何回目のイテレーション
}

export interface GapItem {
  category: string;     // 見落としのカテゴリ
  description: string;  // 何が足りないか
  severity: "high" | "medium" | "low";
  suggestedAction: string;  // どうすれば改善できるか
}

export interface RecheckTarget {
  area: string;         // 再チェック対象の領域
  reason: string;       // 再チェックの理由
  specificClaims: string[]; // 具体的に確認すべき記述
}

export interface SelfEvaluationResult {
  iterations: ReflectionResult[];
  finalAssessment: string;
  totalGapsFound: number;
  totalGapsResolved: number;
  improvementScore: number;  // 改善量（0-100）
}

// ─── Self-Evaluation Loop ──────────────────

export class SelfEvaluationLoop {
  private genAI: GoogleGenerativeAI | null = null;
  private maxIterations: number;

  constructor(maxIterations: number = 2) {
    this.maxIterations = maxIterations;

    const apiKey =
      (typeof import.meta !== "undefined" &&
        import.meta.env &&
        import.meta.env.VITE_GEMINI_API_KEY) ||
      process.env.GEMINI_API_KEY;

    if (apiKey) {
      this.genAI = new GoogleGenerativeAI(apiKey);
      console.log(`✅ SelfEval: 初期化成功 (最大${maxIterations}イテレーション)`);
    } else {
      console.log("⚠️ SelfEval: Gemini APIキーなし");
    }
  }

  isAvailable(): boolean {
    return this.genAI !== null;
  }

  /**
   * ファクトチェック結果を自己評価し、見落としがあれば再チェック対象を特定
   *
   * @param articleContent - 記事全文
   * @param agentResults - Phase1の各エージェント結果
   * @param moaResult - MoA検証結果（あれば）
   * @param onProgress - 進捗コールバック
   */
  async evaluate(
    articleContent: string,
    agentResults: AgentResult[],
    moaResult: MoAResult | null,
    onProgress?: (message: string, progress: number) => void
  ): Promise<SelfEvaluationResult> {
    if (!this.genAI) {
      return {
        iterations: [],
        finalAssessment: "自己評価エンジンが利用できません",
        totalGapsFound: 0,
        totalGapsResolved: 0,
        improvementScore: 0,
      };
    }

    console.log("🔄 自己評価ループ開始");
    const iterations: ReflectionResult[] = [];
    let cumulativeGaps = 0;
    let resolvedGaps = 0;

    for (let i = 0; i < this.maxIterations; i++) {
      const iterNum = i + 1;
      console.log(`\n🪞 反省ステップ ${iterNum}/${this.maxIterations}`);

      if (onProgress) {
        onProgress(
          `自己評価 イテレーション ${iterNum}/${this.maxIterations}`,
          Math.round((i / this.maxIterations) * 100)
        );
      }

      // 反省を実行
      const reflection = await this.reflect(
        articleContent,
        agentResults,
        moaResult,
        iterations,
        iterNum
      );

      iterations.push(reflection);
      cumulativeGaps += reflection.gaps.length;

      console.log(`  📋 発見された見落とし: ${reflection.gaps.length}件`);
      console.log(`  🔁 再チェック必要: ${reflection.shouldRecheck ? "はい" : "いいえ"}`);

      // 再チェックが不要なら終了
      if (!reflection.shouldRecheck) {
        console.log("  ✅ 十分な品質に到達 → ループ終了");
        break;
      }

      // 最後のイテレーションでない場合は、見落とし分を解決済みとしてカウント
      if (i < this.maxIterations - 1) {
        resolvedGaps += reflection.gaps.length;
      }
    }

    // 最終評価
    const finalAssessment = this.generateFinalAssessment(iterations);
    const improvementScore = cumulativeGaps > 0
      ? Math.round((resolvedGaps / cumulativeGaps) * 100)
      : 100;

    console.log(`\n🔄 自己評価ループ完了`);
    console.log(`  イテレーション数: ${iterations.length}`);
    console.log(`  発見した見落とし合計: ${cumulativeGaps}件`);
    console.log(`  改善スコア: ${improvementScore}`);

    return {
      iterations,
      finalAssessment,
      totalGapsFound: cumulativeGaps,
      totalGapsResolved: resolvedGaps,
      improvementScore,
    };
  }

  /**
   * 反省ステップ：現在のチェック結果を自己レビュー
   */
  private async reflect(
    articleContent: string,
    agentResults: AgentResult[],
    moaResult: MoAResult | null,
    previousIterations: ReflectionResult[],
    iteration: number
  ): Promise<ReflectionResult> {
    if (!this.genAI) {
      return {
        gaps: [],
        overallAssessment: "利用不可",
        shouldRecheck: false,
        recheckTargets: [],
        iteration,
      };
    }

    const model = this.genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
      generationConfig: {
        temperature: 0.4,
        maxOutputTokens: 4096,
        responseMimeType: "application/json",
      },
    });

    // チェック結果のサマリーを生成
    const checkSummary = this.buildCheckSummary(agentResults, moaResult);

    // 前回の反省結果
    const prevReflections = previousIterations.length > 0
      ? previousIterations.map((r) =>
          `イテレーション${r.iteration}: 見落とし${r.gaps.length}件（${r.gaps.map((g) => g.description).join("、")}）`
        ).join("\n")
      : "（初回）";

    const prompt = `あなたはファクトチェックの品質管理エキスパートです。
以下のファクトチェック結果を「反省」の視点でレビューしてください。

【記事内容（先頭3000文字）】
${articleContent.slice(0, 3000)}

【これまでのファクトチェック結果】
${checkSummary}

【前回の反省結果】
${prevReflections}

【反省の視点】
1. **見落としチェック**：記事内に検証されていない重要な事実主張はないか？
   - 数値・統計データが検証されずに残っていないか
   - 固有名詞（企業名、人名、地名）が未検証でないか
   - 「〜と言われている」「一般的に〜」など曖昧な主張がないか
   - 比較表現（No.1、最大、最安など）の根拠は確認されたか

2. **深さチェック**：検証の深さは十分か？
   - 表面的な検証で済ませている箇所はないか
   - 一次情報源まで辿っているか
   - 統計データの年度は最新か

3. **一貫性チェック**：記事内の情報に矛盾はないか？
   - 前半と後半で数値が食い違っていないか
   - 同じ事象に対して異なる表現をしていないか

【JSON出力形式】
{
  "gaps": [
    {
      "category": "未検証の数値" | "未検証の固有名詞" | "曖昧な主張" | "検証の浅さ" | "記事内の矛盾",
      "description": "見落としの具体的な説明",
      "severity": "high" | "medium" | "low",
      "suggestedAction": "どうすれば改善できるか"
    }
  ],
  "overallAssessment": "全体的な評価コメント（200字以内）",
  "shouldRecheck": true/false（再チェックが必要か。highのgapが1つ以上あればtrue）,
  "recheckTargets": [
    {
      "area": "再チェック対象の領域",
      "reason": "再チェックの理由",
      "specificClaims": ["具体的に確認すべき記述1", "記述2"]
    }
  ]
}`;

    try {
      const result = await model.generateContent(prompt);
      const text = result.response.text();
      const parsed = JSON.parse(text);

      return {
        gaps: parsed.gaps || [],
        overallAssessment: parsed.overallAssessment || "評価なし",
        shouldRecheck: parsed.shouldRecheck || false,
        recheckTargets: parsed.recheckTargets || [],
        iteration,
      };
    } catch (error) {
      console.error("反省ステップエラー:", error);
      return {
        gaps: [],
        overallAssessment: "反省ステップの実行中にエラーが発生しました",
        shouldRecheck: false,
        recheckTargets: [],
        iteration,
      };
    }
  }

  /**
   * チェック結果のサマリーを生成（プロンプト用）
   */
  private buildCheckSummary(
    agentResults: AgentResult[],
    moaResult: MoAResult | null
  ): string {
    let summary = "## エージェント別結果\n";

    for (const result of agentResults) {
      summary += `\n### ${result.agentName} (${result.status}, スコア: ${result.score})\n`;

      if (result.issues && result.issues.length > 0) {
        summary += "検出された問題:\n";
        result.issues.slice(0, 5).forEach((issue) => {
          summary += `- [${issue.severity}] ${issue.description}\n`;
        });
        if (result.issues.length > 5) {
          summary += `- ... 他${result.issues.length - 5}件\n`;
        }
      } else {
        summary += "問題なし\n";
      }
    }

    if (moaResult) {
      summary += "\n## MoA相互検証結果\n";
      summary += `確認済み問題: ${moaResult.summary.confirmedIssues}件\n`;
      summary += `却下（誤検出）: ${moaResult.summary.dismissedIssues}件\n`;
      summary += `要レビュー: ${moaResult.summary.needsReview}件\n`;

      if (moaResult.verifiedIssues.length > 0) {
        summary += "\n詳細:\n";
        moaResult.verifiedIssues.slice(0, 5).forEach((vi) => {
          summary += `- [${vi.consensus}] 「${vi.claim.slice(0, 40)}」 (confidence: ${vi.consensusConfidence})\n`;
        });
      }
    }

    return summary;
  }

  /**
   * 最終評価コメントを生成
   */
  private generateFinalAssessment(iterations: ReflectionResult[]): string {
    if (iterations.length === 0) {
      return "自己評価は実行されませんでした";
    }

    const totalGaps = iterations.reduce((sum, r) => sum + r.gaps.length, 0);
    const lastIteration = iterations[iterations.length - 1];

    if (totalGaps === 0) {
      return "全てのファクトチェック項目が十分にカバーされています。見落としは検出されませんでした。";
    }

    if (lastIteration && !lastIteration.shouldRecheck) {
      return `${iterations.length}回のイテレーションで${totalGaps}件の見落としを発見・対処しました。現在の品質は十分です。`;
    }

    return `${iterations.length}回のイテレーションで${totalGaps}件の見落としを発見しました。一部は追加検証が推奨されます。最終評価: ${lastIteration ? lastIteration.overallAssessment : "不明"}`;
  }
}
