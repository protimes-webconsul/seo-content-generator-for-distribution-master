// マルチエージェント オーケストレーター（MoA + ParallelSearch + SelfEval 統合版）
import { ProperNounsAgent } from "./ProperNounsAgent";
import { NumbersStatsAgent } from "./NumbersStatsAgent";
import { DatesTimelineAgent } from "./DatesTimelineAgent";
import { FactsCasesAgent } from "./FactsCasesAgent";
import { CompanyAgent } from "./CompanyAgent";
import { CitationsAgent } from "./CitationsAgent";
import { TechnicalAgent } from "./TechnicalAgent";
import { LegalAgent } from "./LegalAgent";
import { SourceRequirementAgent } from "./SourceRequirementAgent";
import { SourceEnhancementAgent } from "./SourceEnhancementAgent";
import { IntegrationAgent } from "./IntegrationAgent";
import { MixtureOfAgentsVerifier } from "./MixtureOfAgentsVerifier";
import type { CitationVerificationResult } from "./MixtureOfAgentsVerifier";
import { SelfEvaluationLoop } from "./SelfEvaluationLoop";
import type { AgentResult, IntegrationResult, Issue } from "./types";

export interface MultiAgentConfig {
  enableLegalCheck?: boolean;
  disableCompanyAgent?: boolean;
  timeout?: number;
  parallel?: boolean;
  onProgress?: (message: string, progress: number) => void;
  // ─── 新機能フラグ ───
  enableMoA?: boolean;            // Mixture-of-Agents相互検証（デフォルト: true）
  enableCitationVerification?: boolean; // 出典正確性検証（デフォルト: true）
  enableSelfEvaluation?: boolean; // 自己評価ループ（デフォルト: true）
  selfEvalMaxIterations?: number; // 自己評価の最大イテレーション数（デフォルト: 2）
}

export class MultiAgentOrchestrator {
  private phaseOneAgents: any[] = [];
  private phaseTwoAgents: any[] = [];
  private integrationAgent: IntegrationAgent;
  private moaVerifier: MixtureOfAgentsVerifier | null = null;
  private selfEvaluator: SelfEvaluationLoop | null = null;

  constructor(private config: MultiAgentConfig = {}) {
    // フェーズ1：検証エージェント（並列実行）
    this.phaseOneAgents = [
      new ProperNounsAgent(),
      new NumbersStatsAgent(),
      new DatesTimelineAgent(),
      new FactsCasesAgent(),
      new TechnicalAgent(),
    ];

    if (!config.disableCompanyAgent) {
      this.phaseOneAgents.push(new CompanyAgent());
    }

    if (config.enableLegalCheck) {
      this.phaseOneAgents.push(new LegalAgent());
    }

    // フェーズ2：出典処理エージェント（順次実行）
    this.phaseTwoAgents = [
      new SourceRequirementAgent(),
      new SourceEnhancementAgent(),
      new CitationsAgent(),
    ];

    this.integrationAgent = new IntegrationAgent();

    // ─── MoA検証エンジン初期化 ───
    const enableMoA = config.enableMoA !== false; // デフォルトtrue
    if (enableMoA) {
      this.moaVerifier = new MixtureOfAgentsVerifier();
      const models = this.moaVerifier.getAvailableModels();
      if (models.length < 2) {
        console.log("⚠️ MoA: 利用可能モデルが2未満のため無効化");
        this.moaVerifier = null;
      }
    }

    // ─── 自己評価ループ初期化 ───
    const enableSelfEval = config.enableSelfEvaluation !== false; // デフォルトtrue
    if (enableSelfEval) {
      const maxIter = config.selfEvalMaxIterations || 2;
      this.selfEvaluator = new SelfEvaluationLoop(maxIter);
      if (!this.selfEvaluator.isAvailable()) {
        console.log("⚠️ SelfEval: 利用不可のため無効化");
        this.selfEvaluator = null;
      }
    }
  }

  async execute(content: string, context?: any): Promise<IntegrationResult> {
    console.log("🤖 マルチエージェント校閲開始（強化版：MoA + ParallelSearch + SelfEval）");
    console.log("📊 デバッグ情報:");
    console.log("  - コンテンツ長:", content.length);
    console.log("  - フェーズ1エージェント数:", this.phaseOneAgents.length);
    console.log("  - フェーズ2エージェント数:", this.phaseTwoAgents.length);
    console.log("  - MoA検証:", this.moaVerifier ? "有効" : "無効");
    console.log("  - 出典正確性検証:", (this.moaVerifier && this.config.enableCitationVerification !== false) ? "有効" : "無効");
    console.log("  - 自己評価:", this.selfEvaluator ? "有効" : "無効");

    const startTime = Date.now();
    const progressCb = this.config.onProgress;

    try {
      // ============================================================
      // フェーズ1: 基礎検証エージェント（並列実行）— GPT-5
      // ============================================================
      if (progressCb) progressCb("フェーズ1: 基礎検証（並列）", 10);

      console.log("📋 フェーズ1: 基礎検証開始");
      this.phaseOneAgents.forEach((agent, index) => {
        console.log(`  ${index + 1}. ${agent.name} (${agent.type})`);
      });

      const phaseOneResults = await this.executePhaseOne(content, context);

      console.log(`✅ フェーズ1完了: ${phaseOneResults.length}個のエージェント実行`);
      phaseOneResults.forEach((result, index) => {
        console.log(
          `  ${index + 1}. ${result.agentName}: ${result.status} (${result.executionTime}ms, スコア: ${result.score})`
        );
      });

      // ============================================================
      // フェーズ1.3: 出典正確性検証（Citation Verification via MoA）
      // ============================================================
      let citationVerificationResults: CitationVerificationResult[] = [];

      const enableCitationCheck = this.config.enableCitationVerification !== false; // デフォルトtrue
      if (enableCitationCheck && this.moaVerifier) {
        if (progressCb) progressCb("フェーズ1.3: 出典正確性検証", 20);

        console.log("\n📎 フェーズ1.3: 出典正確性検証（Citation Verification）開始");

        try {
          citationVerificationResults = await this.moaVerifier.verifyCitations(
            content,
            progressCb
          );

          if (citationVerificationResults.length > 0) {
            const incorrectCitations = citationVerificationResults.filter(
              (r) => r.consensus === "incorrect"
            );
            const uncertainCitations = citationVerificationResults.filter(
              (r) => r.consensus === "uncertain"
            );

            console.log(`📎 出典検証結果:`);
            console.log(`  検証した出典数: ${citationVerificationResults.length}`);
            console.log(`  不正確な出典: ${incorrectCitations.length}件`);
            console.log(`  確認不能な出典: ${uncertainCitations.length}件`);

            // 不正確な出典をIssueとしてPhase1結果に追加
            if (incorrectCitations.length > 0) {
              const citationIssues: Issue[] = incorrectCitations.map((cr) => {
                const correctionParts: string[] = [];
                if (cr.correctInfo.title) {
                  correctionParts.push("正しい文書名: " + cr.correctInfo.title);
                }
                if (cr.correctInfo.year) {
                  correctionParts.push("正しい発行年: " + cr.correctInfo.year);
                }
                if (cr.correctInfo.organization) {
                  correctionParts.push("正しい発行元: " + cr.correctInfo.organization);
                }
                const correctionText = correctionParts.length > 0
                  ? correctionParts.join("、")
                  : "出典情報を再確認してください";

                // 具体的な問題点を記述
                const problemParts: string[] = [];
                if (!cr.titleCorrect) problemParts.push("文書タイトルの誤り");
                if (!cr.yearCorrect) problemParts.push("発行年の誤り");
                if (!cr.sourceMatchesClaim) problemParts.push("出典と主張の不一致");
                const problemDesc = problemParts.length > 0
                  ? problemParts.join("、")
                  : "出典情報に誤りの可能性";

                return {
                  type: "factual-error" as const,
                  severity: "critical" as const,
                  location: cr.citation.location,
                  description: `出典の誤り（${problemDesc}）: 「${cr.citation.documentTitle}」（${cr.citation.organization}・${cr.citation.year}）`,
                  original: cr.citation.citationText,
                  suggestion: correctionText,
                  confidence: cr.confidence,
                };
              });

              // Phase1結果にcitation-verificationの結果を追加
              const citationAgentResult: AgentResult = {
                agentName: "出典正確性検証エージェント",
                agentType: "citation-verification",
                executionTime: 0,
                score: Math.max(0, 100 - incorrectCitations.length * 20),
                issues: citationIssues,
                suggestions: [],
                confidence: 85,
                status: "success",
              };

              phaseOneResults.push(citationAgentResult);
              console.log(`  📌 ${citationIssues.length}件の出典問題をPhase1結果に追加`);
            }

            // contextに出典検証結果を保存
            if (!context) context = {};
            context.citationVerification = citationVerificationResults;
          } else {
            console.log("📎 出典検証: 記事内に出典が見つからないか、検証対象なし");
          }
        } catch (citationError) {
          console.error("📎 出典検証でエラーが発生しました:", citationError);
        }
      }

      // ============================================================
      // フェーズ1.5: MoA相互検証（GPT-5 × Gemini × Claude）
      // ============================================================
      let moaEnhancedResults = phaseOneResults;

      if (this.moaVerifier) {
        if (progressCb) progressCb("フェーズ1.5: MoA相互検証", 30);

        console.log("\n🔀 フェーズ1.5: Mixture-of-Agents 相互検証開始");

        // Phase1で検出された全イシューを収集
        const allPhaseOneIssues: Issue[] = [];
        for (const result of phaseOneResults) {
          if (result.issues && result.issues.length > 0) {
            allPhaseOneIssues.push(...result.issues);
          }
        }

        console.log(`  検出されたイシュー合計: ${allPhaseOneIssues.length}件`);
        const criticalMajor = allPhaseOneIssues.filter(
          (i) => i.severity === "critical" || i.severity === "major"
        );
        console.log(`  うちcritical/major: ${criticalMajor.length}件 → MoA検証対象`);

        if (criticalMajor.length > 0) {
          const moaResult = await this.moaVerifier.crossVerify(
            allPhaseOneIssues,
            content,
            progressCb
          );

          // MoA結果でイシューを更新（誤検出を除外、信頼度を更新）
          moaEnhancedResults = this.applyMoAResults(phaseOneResults, moaResult);

          console.log(`🔀 MoA検証結果:`);
          console.log(`  確認済み: ${moaResult.summary.confirmedIssues}件`);
          console.log(`  却下（誤検出）: ${moaResult.summary.dismissedIssues}件`);
          console.log(`  要レビュー: ${moaResult.summary.needsReview}件`);
          console.log(`  使用モデル: ${moaResult.summary.modelsUsed.join(", ")}`);

          // MoA結果をcontextに追加（後のフェーズで参照可能）
          if (!context) context = {};
          context.moaResult = moaResult;
        } else {
          console.log("  critical/majorのイシューなし → MoAスキップ");
        }
      }

      // ============================================================
      // フェーズ1.8: 自己評価ループ（Reflection）
      // ============================================================
      if (this.selfEvaluator) {
        if (progressCb) progressCb("フェーズ1.8: 自己評価ループ", 45);

        console.log("\n🔄 フェーズ1.8: 自己評価ループ開始");

        const moaResultForEval = context && context.moaResult ? context.moaResult : null;
        const selfEvalResult = await this.selfEvaluator.evaluate(
          content,
          moaEnhancedResults,
          moaResultForEval,
          progressCb
        );

        console.log(`🔄 自己評価結果:`);
        console.log(`  イテレーション数: ${selfEvalResult.iterations.length}`);
        console.log(`  発見した見落とし: ${selfEvalResult.totalGapsFound}件`);
        console.log(`  改善スコア: ${selfEvalResult.improvementScore}`);

        // 自己評価で見つかった見落としをcontextに追加
        if (!context) context = {};
        context.selfEvaluation = selfEvalResult;

        // 見落としが見つかった場合、再チェック対象をログ出力
        if (selfEvalResult.totalGapsFound > 0) {
          console.log("  📝 発見された見落とし:");
          for (const iteration of selfEvalResult.iterations) {
            for (const gap of iteration.gaps) {
              console.log(`    - [${gap.severity}] ${gap.description}`);
            }
          }
        }
      }

      // ============================================================
      // フェーズ1の結果を構造化
      // ============================================================
      const phaseOneContext = this.structurePhaseOneResults(moaEnhancedResults);

      // ============================================================
      // フェーズ2: 出典処理（順次実行）
      // ============================================================
      if (progressCb) progressCb("フェーズ2: 出典処理", 60);

      console.log("\n📚 フェーズ2: 出典処理開始");
      this.phaseTwoAgents.forEach((agent, index) => {
        console.log(`  ${index + 1}. ${agent.name} (${agent.type})`);
      });

      const phaseTwoResults = await this.executePhaseTwo(content, {
        ...context,
        phaseOneResults: phaseOneContext,
      });

      console.log(`✅ フェーズ2完了: ${phaseTwoResults.length}個のエージェント実行`);
      phaseTwoResults.forEach((result, index) => {
        console.log(
          `  ${index + 1}. ${result.agentName}: ${result.status} (${result.executionTime}ms, スコア: ${result.score})`
        );
      });

      // ============================================================
      // フェーズ3: 統合
      // ============================================================
      if (progressCb) progressCb("フェーズ3: 結果統合", 85);

      const allResults = [...moaEnhancedResults, ...phaseTwoResults];
      console.log("\n📊 全エージェント結果統合:");
      console.log(`  - 総エージェント数: ${allResults.length}`);
      console.log(`  - 成功: ${allResults.filter((r) => r.status === "success").length}`);
      console.log(`  - エラー: ${allResults.filter((r) => r.status === "error").length}`);
      console.log(`  - タイムアウト: ${allResults.filter((r) => r.status === "timeout").length}`);

      console.log("📊 結果を統合中...");
      const integrationResult = await this.integrationAgent.integrate(allResults);

      // ─── 強化レポートを追記 ───
      integrationResult.detailedReport = this.appendEnhancedReport(
        integrationResult.detailedReport,
        context
      );

      const executionTime = Date.now() - startTime;
      console.log(`\n✅ マルチエージェント校閲完了（${(executionTime / 1000).toFixed(1)}秒）`);
      console.log(`📈 総合スコア: ${integrationResult.overallScore}/100点`);

      if (progressCb) progressCb("完了", 100);

      return integrationResult;
    } catch (error) {
      console.error("❌ マルチエージェント実行エラー:", error);
      console.error(
        "❌ エラースタック:",
        error instanceof Error ? error.stack : "スタックなし"
      );
      throw error;
    }
  }

  /**
   * MoA結果を適用してPhase1結果を更新
   * - confirmed-issue → イシューを残す（信頼度を強化）
   * - dismissed → イシューを除外（誤検出として記録）
   * - needs-review → イシューを残すがseverityをminorに下げる
   */
  private applyMoAResults(
    phaseOneResults: AgentResult[],
    moaResult: any
  ): AgentResult[] {
    if (!moaResult || !moaResult.verifiedIssues) {
      return phaseOneResults;
    }

    const verifiedMap = new Map<string, any>();
    for (const vi of moaResult.verifiedIssues) {
      // originalIssueのdescriptionをキーとして使用
      const key = vi.originalIssue && vi.originalIssue.description
        ? vi.originalIssue.description
        : vi.claim;
      verifiedMap.set(key, vi);
    }

    let dismissedCount = 0;
    let confirmedCount = 0;

    return phaseOneResults.map((result) => {
      if (!result.issues || result.issues.length === 0) {
        return result;
      }

      const updatedIssues = result.issues.filter((issue) => {
        const moaVerdict = verifiedMap.get(issue.description);
        if (!moaVerdict) return true; // MoA対象外 → 維持

        if (moaVerdict.consensus === "dismissed") {
          dismissedCount++;
          console.log(`  🚫 誤検出を除外: 「${issue.description.slice(0, 40)}...」`);
          return false; // 除外
        }

        if (moaVerdict.consensus === "confirmed-issue") {
          confirmedCount++;
          // 修正案をMoAの結論で上書き
          if (moaVerdict.finalCorrection) {
            issue.suggestion = moaVerdict.finalCorrection;
          }
          return true; // 維持
        }

        // needs-review → severityをminorに下げる
        issue.severity = "minor";
        return true;
      });

      // スコアを調整（誤検出が除外された分、スコアを上げる）
      const originalIssueCount = result.issues.length;
      const removedCount = originalIssueCount - updatedIssues.length;
      const scoreBoost = removedCount > 0 ? Math.min(removedCount * 5, 15) : 0;

      return {
        ...result,
        issues: updatedIssues,
        score: Math.min(100, result.score + scoreBoost),
      };
    });
  }

  /**
   * 強化レポートを追記（MoA結果 + 自己評価結果）
   */
  private appendEnhancedReport(existingReport: string, context: any): string {
    let enhanced = existingReport;

    // MoA結果を追記
    if (context && context.moaResult) {
      const moa = context.moaResult;
      enhanced += `\n\n## 🔀 Mixture-of-Agents 相互検証
- 使用モデル: ${moa.summary.modelsUsed.join(", ")}
- 検証対象: ${moa.summary.totalClaims}件のcritical/majorイシュー
- 確認済み問題: ${moa.summary.confirmedIssues}件（複数モデルが一致）
- 却下（誤検出）: ${moa.summary.dismissedIssues}件（GPT-5の過剰検出を排除）
- 要レビュー: ${moa.summary.needsReview}件（モデル間で意見が分かれた）
- 実行時間: ${(moa.summary.executionTime / 1000).toFixed(1)}秒`;

      // 各検証の詳細
      if (moa.verifiedIssues && moa.verifiedIssues.length > 0) {
        enhanced += "\n\n### 検証詳細";
        for (const vi of moa.verifiedIssues) {
          const icon = vi.consensus === "confirmed-issue" ? "❌"
            : vi.consensus === "dismissed" ? "✅"
            : "❓";
          enhanced += `\n${icon} 「${vi.claim.slice(0, 60)}」→ ${vi.consensus} (${vi.method}, confidence: ${vi.consensusConfidence})`;

          if (vi.verdicts && vi.verdicts.length > 0) {
            for (const v of vi.verdicts) {
              enhanced += `\n   - ${v.model}: ${v.verdict} (${v.confidence}%) ${v.searchUsed ? "🔍" : ""}`;
            }
          }
        }
      }
    }

    // 出典検証結果を追記
    if (context && context.citationVerification) {
      const cvResults: CitationVerificationResult[] = context.citationVerification;
      const incorrectCount = cvResults.filter((r) => r.consensus === "incorrect").length;
      const correctCount = cvResults.filter((r) => r.consensus === "correct").length;
      const uncertainCount = cvResults.filter((r) => r.consensus === "uncertain").length;

      enhanced += `\n\n## 📎 出典正確性検証（Citation Verification）
- 検証した出典数: ${cvResults.length}
- 正確: ${correctCount}件
- 不正確: ${incorrectCount}件
- 確認不能: ${uncertainCount}件`;

      if (cvResults.length > 0) {
        enhanced += "\n\n### 出典検証詳細";
        for (const cr of cvResults) {
          const icon = cr.consensus === "correct" ? "✅"
            : cr.consensus === "incorrect" ? "❌"
            : "❓";
          enhanced += `\n${icon} 「${cr.citation.documentTitle}」（${cr.citation.organization}・${cr.citation.year}）`;
          enhanced += `\n   判定: ${cr.consensus} (confidence: ${cr.confidence})`;
          enhanced += `\n   位置: ${cr.citation.location}`;

          if (!cr.titleCorrect) enhanced += "\n   ⚠ 文書タイトルに誤りの可能性";
          if (!cr.yearCorrect) enhanced += "\n   ⚠ 発行年に誤りの可能性";
          if (!cr.sourceMatchesClaim) enhanced += "\n   ⚠ 出典と主張内容の不一致の可能性";

          if (cr.correctInfo.title) enhanced += `\n   → 正しいタイトル: ${cr.correctInfo.title}`;
          if (cr.correctInfo.year) enhanced += `\n   → 正しい発行年: ${cr.correctInfo.year}`;
          if (cr.correctInfo.organization) enhanced += `\n   → 正しい発行元: ${cr.correctInfo.organization}`;

          if (cr.verdicts && cr.verdicts.length > 0) {
            for (const v of cr.verdicts) {
              enhanced += `\n   - ${v.model}: ${v.verdict} (${v.confidence}%) ${v.searchUsed ? "🔍" : ""}`;
            }
          }
        }
      }
    }

    // 自己評価結果を追記
    if (context && context.selfEvaluation) {
      const se = context.selfEvaluation;
      enhanced += `\n\n## 🔄 自己評価ループ
- イテレーション数: ${se.iterations.length}
- 発見した見落とし: ${se.totalGapsFound}件
- 改善スコア: ${se.improvementScore}
- 最終評価: ${se.finalAssessment}`;

      if (se.iterations && se.iterations.length > 0) {
        for (const iter of se.iterations) {
          if (iter.gaps && iter.gaps.length > 0) {
            enhanced += `\n\n### イテレーション${iter.iteration}の見落とし`;
            for (const gap of iter.gaps) {
              enhanced += `\n- [${gap.severity}] ${gap.description}`;
              enhanced += `\n  → ${gap.suggestedAction}`;
            }
          }
        }
      }
    }

    return enhanced;
  }

  // ─── 以下は既存メソッド（変更なし） ───

  private async executePhaseOne(
    content: string,
    context?: any
  ): Promise<AgentResult[]> {
    console.log("⚡ フェーズ1: 並列実行");
    console.log(`⚡ 実行予定エージェント数: ${this.phaseOneAgents.length}`);

    const promises = this.phaseOneAgents.map((agent, index) => {
      console.log(`⚡ エージェント${index + 1}を開始: ${agent.name}`);
      return this.executeWithTimeout(agent, content, context);
    });

    console.log(`⚡ ${promises.length}個のPromiseを並列実行開始`);
    const results = await Promise.all(promises);
    console.log(`⚡ 並列実行完了: ${results.length}個の結果を取得`);

    return results;
  }

  private async executePhaseTwo(
    content: string,
    context?: any
  ): Promise<AgentResult[]> {
    console.log("📝 フェーズ2: 順次実行");
    const results: AgentResult[] = [];

    const requirementAgent = this.phaseTwoAgents[0];
    console.log("🔍 出典必要性を判定中...");
    const requirementResult = await this.executeWithTimeout(
      requirementAgent,
      content,
      context
    );
    results.push(requirementResult);

    const requirements = (requirementResult as any).requirements || [];
    const parsedElements = (requirementResult as any).parsedElements || [];

    console.log(`📋 解析済み要素数: ${parsedElements.length}`);
    console.log(`🎯 出典必要箇所: ${requirements.length}`);

    const searchAgent = this.phaseTwoAgents[1];
    console.log(`🔎 ${requirements.length}箇所の出典を検索中...`);
    const searchResult = await this.executeWithTimeout(searchAgent, content, {
      ...context,
      requirements,
      parsedElements,
    });
    results.push(searchResult);

    const verifyAgent = this.phaseTwoAgents[2];
    console.log("✅ 出典を検証中...");
    const verifyResult = await this.executeWithTimeout(verifyAgent, content, {
      ...context,
      sourceEnhancement: searchResult,
    });
    results.push(verifyResult);

    return results;
  }

  private structurePhaseOneResults(results: AgentResult[]): any {
    const findIssues = (type: string): Issue[] => {
      const found = results.find((r) => r.agentType === type);
      return found && found.issues ? found.issues : [];
    };

    return {
      properNouns: findIssues("proper-nouns"),
      numbers: findIssues("numbers-stats"),
      dates: findIssues("dates-timeline"),
      facts: findIssues("facts-cases"),
      technical: findIssues("technical"),
      legal: findIssues("legal"),
      company: findIssues("company"),
    };
  }

  private async executeWithTimeout(
    agent: any,
    content: string,
    context?: any
  ): Promise<AgentResult> {
    console.log(`🔄 ${agent.name} 実行開始`);
    const startTime = Date.now();

    const timeout = this.getTimeoutForAgentType(agent.type);
    console.log(`⏰ ${agent.name} タイムアウト設定: ${timeout}ms`);

    if (agent.name === "出典検索エージェント") {
      console.log(`🔍 ${agent.name} 部分結果対応モードで実行`);
      return this.executeWithPartialResult(agent, content, context, timeout);
    }

    try {
      const result = await Promise.race([
        agent.execute(content, context),
        new Promise<AgentResult>((_, reject) => {
          setTimeout(() => {
            reject(
              new Error(`${agent.name}がタイムアウトしました（${timeout}ms）`)
            );
          }, timeout);
        }),
      ]);

      const executionTime = Date.now() - startTime;
      console.log(
        `✅ ${agent.name} 実行完了 (${executionTime}ms, スコア: ${result.score})`
      );
      return result;
    } catch (error: any) {
      const executionTime = Date.now() - startTime;
      console.warn(`⏱️ ${agent.name}: ${error.message} (${executionTime}ms)`);

      if (error.response) {
        console.error(
          `API Response Error for ${agent.name}:`,
          error.response.data
        );
      }
      if (error.stack) {
        console.error(`Stack trace for ${agent.name}:`, error.stack);
      }

      return {
        agentName: agent.name,
        agentType: agent.type,
        executionTime: executionTime,
        score: 0,
        issues: [],
        suggestions: [],
        confidence: 0,
        status: "error",
        error: error.message,
      };
    }
  }

  private async executeWithPartialResult(
    agent: any,
    content: string,
    context: any,
    timeout: number
  ): Promise<AgentResult> {
    const startTime = Date.now();

    try {
      const result = await Promise.race([
        agent.execute(content, context),
        new Promise<AgentResult>((resolve) => {
          setTimeout(() => {
            const partialResult = agent.getPartialResults
              ? agent.getPartialResults()
              : null;

            if (partialResult && partialResult.completedItems > 0) {
              console.warn(
                `⚠️ ${agent.name}: タイムアウト - 部分成功として処理`
              );
              console.log(
                `✅ ${agent.name}: ${partialResult.completedItems}/${partialResult.totalItems}件の出典を取得（部分成功）`
              );

              resolve({
                agentName: agent.name,
                agentType: agent.type,
                executionTime: timeout,
                score: Math.round(
                  (partialResult.completedItems / partialResult.totalItems) * 100
                ),
                issues: partialResult.issues || [],
                suggestions: partialResult.suggestions || [],
                confidence: Math.round(
                  (partialResult.completedItems / partialResult.totalItems) * 100
                ),
                status: "partial-success",
                partialData: {
                  completedItems: partialResult.completedItems,
                  totalItems: partialResult.totalItems,
                  message: `${partialResult.completedItems}/${partialResult.totalItems}件の出典を取得（追加検索推奨）`,
                },
                verified_urls: partialResult.verified_urls || [],
              });
            } else {
              resolve({
                agentName: agent.name,
                agentType: agent.type,
                executionTime: timeout,
                score: 0,
                issues: [],
                suggestions: [],
                confidence: 0,
                status: "timeout",
                error: `${agent.name}がタイムアウトしました（${timeout}ms）`,
              });
            }
          }, timeout);
        }),
      ]);

      return result;
    } catch (error: any) {
      console.error(`❌ ${agent.name}: エラー発生`, error);
      return {
        agentName: agent.name,
        agentType: agent.type,
        executionTime: Date.now() - startTime,
        score: 0,
        issues: [],
        suggestions: [],
        confidence: 0,
        status: "error",
        error: error.message,
      };
    }
  }

  private getTimeoutForAgentType(type: string): number {
    switch (type) {
      case "source-requirement":
        return 1800000;
      case "source-enhancement":
        return 2400000;
      case "legal":
      case "facts-cases":
      case "technical":
        return 1200000;
      case "proper-nouns":
      case "numbers-stats":
        return 900000;
      case "dates-timeline":
        return 720000;
      case "citation-verification":
      case "citations":
      case "company":
        return 600000;
      default:
        return 900000;
    }
  }

  updateConfig(config: Partial<MultiAgentConfig>) {
    this.config = { ...this.config, ...config };
  }
}
