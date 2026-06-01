import React, { useState, useCallback, useEffect, useRef } from "react";
import type {
  SeoOutline,
  SeoOutlineV2,
  GroundingChunk,
  CompetitorResearchResult,
  ClientProfile,
  ClientSummary,
  SavedArticle,
  WritingStyleSample,
  OutlineMode,
} from "./types";
import ClientManager from "./components/ClientManager";
import ArticleList from "./components/ArticleList";
import WritingStyleManager from "./components/WritingStyleManager";
import { fetchClients, fetchClientById } from "./services/clientDataService";
import {
  saveOutline,
  saveArticle,
  updateSavedArticle,
} from "./services/articleStorageService";
import { fetchWritingStyle, buildCombinedStyleText } from "./services/writingStyleService";
import { generateSeoOutline } from "./services/geminiServiceUpdated";
import { generateCompetitorResearch } from "./services/competitorResearchWithWebFetch";
import { generateOptimizedOutline } from "./services/outlineOptimizer";
import { generateOutlineV2 } from "./services/outlineGeneratorV2";
import { generateOutlineSiteDataMode } from "./services/outlineGeneratorSiteData";
import { checkAndFixOutline } from "./services/outlineCheckerV2";
import { reviseOutlineV2 } from "./services/outlineRevisionService";
// import { runQualityCheck } from './services/qualityCheckAgent';  // 一時的に無効化（キーワード削除問題）
import { getTestOutlineV2 } from "./utils/testDataGeneratorV2";
import KeywordInputForm from "./components/KeywordInputForm";
import OutlineDisplay from "./components/OutlineDisplay";
import OutlineDisplayOptimized from "./components/OutlineDisplayOptimized";
import OutlineDisplayV2 from "./components/OutlineDisplayV2";
import ArticleDisplay from "./components/ArticleDisplay";
import ArticleWriter from "./components/ArticleWriter";
import { CompetitorResearchWebFetch } from "./components/CompetitorResearchWebFetch";
import { FrequencyWordsTab } from "./components/FrequencyWordsTab";
import LoadingSpinner from "./components/LoadingSpinner";
import ErrorMessage from "./components/ErrorMessage";
import { LogoIcon, SparklesIcon } from "./components/icons";
import TextCheckPage from "./components/TextCheckPage";
import ReferenceMaterialManager from "./components/ReferenceMaterialManager";
import ReferenceMaterialSelector from "./components/ReferenceMaterialSelector";
import { buildPromptContext, analyzeForArticle } from "./services/referenceMaterialService";
import RevisionLogTab from "./components/RevisionLogTab";
import BatchMode from "./components/BatchMode";
import KeywordManager from "./components/KeywordManager";
import type { BatchQueueItem } from "./services/batchService";
import { generateArticleV3 } from "./services/writingAgentV3";
import FactCheckPage from "./components/FactCheckPage";
import ArticleRevisionForm from "./components/ArticleRevisionForm";
import { useImageAgent, type ArticleDataForImageAgent } from "./hooks/useImageAgent";
import { ImageGeneratorIframe } from "./components/ImageGeneratorIframe";
import { downloadExportFile } from "./services/articleExportService";
import { parseImportFile, readFileAsText } from "./services/articleImportService";
import { saveRevisionLog } from "./services/revisionLogService";

const App: React.FC = () => {
  const [currentPage, setCurrentPage] = useState<
    "main" | "textcheck" | "factcheck" | "revision"
  >("main");
  const [keyword, setKeyword] = useState<string>("");
  const [outline, setOutline] = useState<SeoOutline | null>(null);
  const [outlineV2, setOutlineV2] = useState<SeoOutlineV2 | null>(null);
  const [competitorResearch, setCompetitorResearch] =
    useState<CompetitorResearchResult | null>(null);
  const [sources, setSources] = useState<GroundingChunk[] | undefined>(
    undefined
  );
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<
    "research" | "frequency" | "outline" | "article" | "references" | "clients" | "articleList" | "writingStyle" | "batch" | "keywordManager" | "revisionLog"
  >("research");

  // 記事保存管理
  const [savedArticleId, setSavedArticleId] = useState<string | null>(null);
  const [isOutlineSaved, setIsOutlineSaved] = useState(false);
  const [isArticleSaved, setIsArticleSaved] = useState(false);

  // 取引先管理
  const [clientSummaries, setClientSummaries] = useState<ClientSummary[]>([]);
  const [selectedClientId, setSelectedClientId] = useState<string>("");
  const [clientProfile, setClientProfile] = useState<ClientProfile | null>(null);

  // 執筆スタイルサンプル
  const [writingStyleSample, setWritingStyleSample] = useState<WritingStyleSample | null>(null);

  // 参考資料の選択状態
  const [selectedRefMaterialIds, setSelectedRefMaterialIds] = useState<string[]>([]);
  const [refMaterialContext, setRefMaterialContext] = useState<string>("");
  const [analysisProgress, setAnalysisProgress] = useState<{
    current: number;
    total: number;
  } | null>(null);
  const [showWriterDirectly, setShowWriterDirectly] = useState<boolean>(false);
  const [apiUsageWarning, setApiUsageWarning] = useState<string | null>(null);
  const [generatedArticle, setGeneratedArticle] = useState<{
    title: string;
    metaDescription: string;
    htmlContent: string;
    plainText: string;
  } | null>(null);
  const [showArticleWriter, setShowArticleWriter] = useState(false);
  const [writingMode, setWritingMode] = useState<"v2" | "v3">("v3");
  const [isV2Mode, setIsV2Mode] = useState<boolean>(false);
  const [outlineMode, setOutlineMode] = useState<OutlineMode>('siteData');



  // 取引先一覧を起動時に読み込む
  useEffect(() => {
    fetchClients()
      .then(function(list) {
        const activeList = list.filter(function(c) { return c.isActive; });
        setClientSummaries(activeList);
      })
      .catch(function(err) {
        console.warn("⚠️ 取引先一覧の読み込みに失敗:", err.message);
      });
  }, []);

  // 取引先が選択されたらプロフィールを取得
  const handleClientSelect = useCallback(async (clientId: string) => {
    setSelectedClientId(clientId);
    if (!clientId) {
      setClientProfile(null);
      setWritingStyleSample(null);
      return;
    }
    try {
      const profile = await fetchClientById(clientId);
      setClientProfile(profile);
      console.log("✅ 取引先プロフィール読み込み完了:", profile.name);
    } catch (err) {
      console.warn("⚠️ 取引先プロフィールの取得に失敗:", err instanceof Error ? err.message : err);
      setClientProfile(null);
    }
    // 執筆スタイルサンプルを自動読み込み
    try {
      const style = await fetchWritingStyle(clientId);
      setWritingStyleSample(style);
      if (style) {
        console.log("✅ 執筆スタイルサンプル読み込み完了（件数:", style.samples.length, "件）");
      }
    } catch (err) {
      console.warn("⚠️ 執筆スタイルサンプルの取得に失敗:", err instanceof Error ? err.message : err);
      setWritingStyleSample(null);
    }
  }, []);

  // ────────────────────────────────────────────────
  // 記事保存ハンドラー
  // ────────────────────────────────────────────────

  const handleSaveOutline = async () => {
    if (!outlineV2) return;
    const id = await saveOutline({
      clientId: selectedClientId || 'none',
      clientName: clientProfile ? clientProfile.name : '未選択',
      keyword: keyword,
      outline: outlineV2,
    });
    setSavedArticleId(id);
    setIsOutlineSaved(true);
  };

  const handleSaveArticle = async () => {
    if (!generatedArticle) return;
    if (savedArticleId) {
      // 既存ファイルに記事を追記
      await updateSavedArticle(savedArticleId, { article: generatedArticle });
    } else {
      // 新規保存（構成案なしで記事のみ）
      const id = await saveArticle({
        clientId: selectedClientId || 'none',
        clientName: clientProfile ? clientProfile.name : '未選択',
        keyword: keyword,
        outline: outlineV2,
        article: generatedArticle,
      });
      setSavedArticleId(id);
    }
    setIsArticleSaved(true);
  };

  // ────────────────────────────────────────────────
  // チェック用エクスポート / 修正済みインポート
  // ────────────────────────────────────────────────

  const handleExportForCheck = () => {
    if (!generatedArticle) return;
    downloadExportFile({
      keyword: keyword,
      clientName: clientProfile ? clientProfile.name : undefined,
      articleTitle: generatedArticle.title,
      metaDescription: generatedArticle.metaDescription,
      articleHtml: generatedArticle.htmlContent,
    });
  };

  const handleImportChecked = async (file: File) => {
    try {
      const content = await readFileAsText(file);
      const result = parseImportFile(content);
      if (!result.success) {
        alert('インポートエラー:\n' + result.error);
        return;
      }
      setGeneratedArticle({
        title: generatedArticle ? generatedArticle.title : keyword,
        metaDescription: generatedArticle ? generatedArticle.metaDescription : '',
        htmlContent: result.articleHtml,
        plainText: result.articleHtml.replace(/<[^>]*>/g, ''),
      });
      setIsArticleSaved(false);
      saveRevisionLog({
        keyword: keyword,
        clientName: clientProfile ? clientProfile.name : '',
        modificationCount: result.modificationCount,
        reportText: result.reportText,
      });
      alert('修正済み記事を取り込みました。\n修正件数: ' + result.modificationCount + '件\n\n修正ログに保存されました。');
    } catch (e) {
      alert('ファイルの読み込みに失敗しました: ' + (e instanceof Error ? e.message : String(e)));
    }
  };

  // ────────────────────────────────────────────────
  // 記事一覧からの復元ハンドラー
  // ────────────────────────────────────────────────

  const handleRestoreOutline = (saved: SavedArticle) => {
    if (saved.outline) {
      setOutlineV2(saved.outline);
      setKeyword(saved.keyword);
      setIsV2Mode(true);
      setSavedArticleId(saved.id);
      setIsOutlineSaved(true);
      setIsArticleSaved(false);
      setGeneratedArticle(null);
      setActiveTab('outline');
    }
  };

  const handleRestoreArticle = (saved: SavedArticle) => {
    if (saved.outline) {
      setOutlineV2(saved.outline);
      setIsV2Mode(true);
    }
    if (saved.article) {
      setGeneratedArticle(saved.article);
      setActiveTab('article');
    }
    setKeyword(saved.keyword);
    setSavedArticleId(saved.id);
    setIsOutlineSaved(true);
    setIsArticleSaved(true);
  };


  // 画像生成エージェント用のフック
  const imageAgentCloseIframeRef = useRef<() => void>();
  const {
    embedState: imageAgentEmbedState,
    iframeRef: imageAgentIframeRef,
    openInIframe: openImageAgentInIframe,
    openInNewTab: openImageAgentInNewTab,
    closeIframe: closeImageAgentIframe,
    sendDataToIframe: sendDataToImageAgentIframe,
    reopenInNewTab: reopenImageAgentInNewTab,
    isLoading: isImageAgentLoading,
  } = useImageAgent({
    onIframeOpen: () => {
      console.log("🖼️ 画像生成エージェントiframeが開きました");
    },
    onIframeClose: () => {
      console.log("🚪 画像生成エージェントiframeが閉じました");
    },
    onError: (error) => {
      console.error("❌ 画像生成エージェントエラー:", error);
    },
    onComplete: (success, data) => {
      console.log("✅ 画像生成エージェント完了:", { success, data });
    },
    timeout: 20 * 60 * 1000, // 20分タイムアウト
  });

  // クローズ関数をrefに保存（useEffect内から参照するため）
  useEffect(() => {
    imageAgentCloseIframeRef.current = closeImageAgentIframe;
  }, [closeImageAgentIframe]);


  // テスト構成を使用
  const handleUseTestOutline = useCallback(
    (type: "whatIs" | "howTo" | "comprehensive" | "aiTraining") => {
      const testData = getTestOutlineV2(type);
      setOutlineV2(testData.outline);
      setOutline(null); // Ver.1の構成をクリア
      setKeyword(testData.keyword);
      setCompetitorResearch(testData.competitorResearch);
      setActiveTab("outline");
      setError(null);
      setIsV2Mode(true); // Ver.2モードに設定
    },
    []
  );

  // API使用回数の管理
  const getApiUsageToday = (): number => {
    const today = new Date().toDateString();
    const stored = localStorage.getItem("customSearchApiUsage");
    if (!stored) return 0;

    const data = JSON.parse(stored);
    if (data.date !== today) {
      // 日付が変わったらリセット
      localStorage.setItem(
        "customSearchApiUsage",
        JSON.stringify({ date: today, count: 0 })
      );
      return 0;
    }
    return data.count || 0;
  };

  const incrementApiUsage = (): void => {
    const today = new Date().toDateString();
    const currentCount = getApiUsageToday();
    localStorage.setItem(
      "customSearchApiUsage",
      JSON.stringify({
        date: today,
        count: currentCount + 1,
      })
    );
  };

  const handleGenerate = useCallback(
    async (newKeyword: string, includeImages: boolean) => {
      if (!newKeyword.trim()) {
        setError("キーワードを入力してください。");
        return;
      }

      setIsLoading(true);
      setError(null);
      setOutline(null);
      setOutlineV2(null);
      setCompetitorResearch(null);
      setSources(undefined);
      setKeyword(newKeyword);
      setIsV2Mode(false);
      setApiUsageWarning(null);
      // 新しい検索時に保存状態をリセット
      setSavedArticleId(null);
      setIsOutlineSaved(false);
      setIsArticleSaved(false);

      try {
        // API使用回数のチェックと警告
        const currentUsage = getApiUsageToday();
        if (currentUsage >= 50) {
          console.warn(
            "⚠️ Custom Search API無料枠を超過しています。以降は従量課金（約1.5円/回）が発生します。"
          );
          setApiUsageWarning(
            "無料枠超過中：従量課金（約1.5円/回）が発生しています"
          );
        }

        // まず競合分析を実行
        console.log("Starting competitor research for:", newKeyword);
        // 初期値として15を設定（実際の数は後で更新される）
        setAnalysisProgress({ current: 0, total: 15 });

        // Google Search APIはサーバー側で処理するため、クライアント側ではtrueを渡すだけ
        const useGoogleSearch = true; // サーバー側で設定を確認
        console.log("✅ Google Search API will be attempted (server-side)");

        const researchResult = await generateCompetitorResearch(
          newKeyword,
          (current, total) => {
            console.log(`Progress update: ${current}/${total}`);
            setAnalysisProgress({ current, total });
          },
          useGoogleSearch
        );
        setCompetitorResearch(researchResult);
        setAnalysisProgress(null);

        // API使用回数をインクリメント（成功時のみ）
        incrementApiUsage();

        // 次に構成案を生成（競合分析結果を渡す）
        console.log("Generating SEO outline with competitor insights...");

        // 競合分析データがあり、頻出単語も分析済みの場合は最適化版を使用
        if (
          researchResult &&
          researchResult.frequencyWords &&
          researchResult.frequencyWords.length > 0
        ) {
          console.log(
            "Using optimized outline generation with frequency words..."
          );
          const optimizedOutline = await generateOptimizedOutline(
            newKeyword,
            researchResult,
            includeImages
          );
          setOutline(optimizedOutline);
          setSources(undefined);
        } else {
          // 従来の構成案生成
          console.log("Using standard outline generation...");
          const { outline: generatedOutline, sources: generatedSources } =
            await generateSeoOutline(newKeyword, includeImages, researchResult);
          setOutline(generatedOutline);
          setSources(generatedSources);
        }
      } catch (err) {
        console.error(err);
        setError(
          err instanceof Error
            ? err.message
            : "分析中にエラーが発生しました。しばらくしてからもう一度お試しください。"
        );
      } finally {
        setIsLoading(false);
      }
    },
    []
  );

  // Ver.2の構成案生成
  const handleGenerateV2 = useCallback(
    async (newKeyword: string, includeImages: boolean) => {
      if (!newKeyword.trim()) {
        setError("キーワードを入力してください。");
        return;
      }

      setIsLoading(true);
      setError(null);
      setOutline(null);
      setOutlineV2(null);
      setCompetitorResearch(null);
      setSources(undefined);
      setKeyword(newKeyword);
      setIsV2Mode(true);
      setApiUsageWarning(null);

      try {
        // API使用回数のチェックと警告
        const currentUsage = getApiUsageToday();
        if (currentUsage >= 50) {
          console.warn(
            "⚠️ Custom Search API無料枠を超過しています。以降は従量課金（約1.5円/回）が発生します。"
          );
          setApiUsageWarning(
            "無料枠超過中：従量課金（約1.5円/回）が発生しています"
          );
        }

        // まず競合分析を実行
        console.log("Starting competitor research for Ver.2:", newKeyword);
        setAnalysisProgress({ current: 0, total: 15 });

        // Google Search APIはサーバー側で処理するため、クライアント側ではtrueを渡すだけ
        const useGoogleSearch = true; // サーバー側で設定を確認

        const researchResult = await generateCompetitorResearch(
          newKeyword,
          (current, total) => {
            setAnalysisProgress({ current, total });
          },
          useGoogleSearch
        );
        setCompetitorResearch(researchResult);
        setAnalysisProgress(null);

        // API使用回数をインクリメント（成功時のみ）
        incrementApiUsage();

        // 参考資料のAI分析（E-E-A-T強化用）
        let refContext = "";
        if (selectedRefMaterialIds.length > 0) {
          try {
            console.log("🔬 参考資料をAI分析中（E-E-A-T強化）...");
            refContext = await analyzeForArticle(selectedRefMaterialIds, newKeyword);
            setRefMaterialContext(refContext);
            console.log("✅ 参考資料AI分析完了:", refContext.length, "文字");
          } catch (err) {
            console.error("⚠️ 参考資料AI分析失敗:", err);
          }
        }

        // Ver.2構成案を生成（モードに応じて切り替え）
        console.log("Generating SEO outline Ver.2... mode=" + outlineMode);
        const v2Outline = outlineMode === 'siteData'
          ? await generateOutlineSiteDataMode(
              newKeyword,
              researchResult,
              includeImages,
              true,
              refContext || undefined,
              clientProfile || undefined
            )
          : await generateOutlineV2(
              newKeyword,
              researchResult,
              includeImages,
              true, // 導入文2パターン生成
              refContext || undefined, // 参考資料テキスト
              clientProfile || undefined // 取引先ルール
            );

        // 構成チェックと自動修正
        console.log("Checking and fixing outline...");
        const { finalOutline, checkResult, wasFixed } =
          await checkAndFixOutline(v2Outline, newKeyword, researchResult);

        if (wasFixed) {
          console.log("構成案が自動修正されました");
        }

        if (!checkResult.isValid) {
          console.warn("構成案にまだエラーが残っています:", checkResult.errors);
          // エラーの詳細をログ出力
          checkResult.errors.forEach((error) => {
            console.warn(
              `  - ${error.field}: ${error.message} (${error.severity})`
            );
          });
        }

        // 品質チェックエージェントをスキップ（キーワード削除問題のため一時的に無効化）
        console.log(
          "⚠️ 品質チェックエージェントをスキップ（キーワード削除問題のため）"
        );
        // const qualityCheckedOutline = await runQualityCheck(finalOutline, newKeyword);

        setOutlineV2(finalOutline);
        setActiveTab("outline");
      } catch (err) {
        console.error(err);
        setError(
          err instanceof Error
            ? err.message
            : "分析中にエラーが発生しました。しばらくしてからもう一度お試しください。"
        );
      } finally {
        setIsLoading(false);
      }
    },
    []
  );

  // ────────────────────────────────────────────────
  // キーワード管理: SheetからOutlineを読み込んで構成案タブに反映
  // ────────────────────────────────────────────────

  const handleOutlineLoadedFromSheet = useCallback((outline: SeoOutlineV2, kw: string) => {
    setOutlineV2(outline);
    setKeyword(kw);
    setIsV2Mode(true);
    setOutline(null);
    setSavedArticleId(null);
    setIsOutlineSaved(false);
    setIsArticleSaved(false);
    setGeneratedArticle(null);
    setActiveTab('outline');
  }, []);

  // ────────────────────────────────────────────────
  // 夜間バッチ処理ハンドラー
  // ────────────────────────────────────────────────

  // SeoOutlineV2をマークダウン文字列に変換するヘルパー
  const convertOutlineV2ToMarkdown = (outline: any, kw: string): string => {
    let md = '# ' + (outline.title || kw) + '\n\n';
    if (outline.outline && Array.isArray(outline.outline)) {
      outline.outline.forEach(function(section: any) {
        md += '## ' + section.heading + '\n';
        md += '文字数目標: ' + (section.characterCount || 1000) + '文字\n';
        if (section.notes) md += '執筆メモ: ' + section.notes + '\n';
        if (section.subheadings && Array.isArray(section.subheadings)) {
          section.subheadings.forEach(function(sub: any) {
            if (typeof sub === 'string') {
              md += '### ' + sub + '\n';
            } else if (sub.text) {
              md += '### ' + sub.text + '\n';
              if (sub.note) md += '執筆メモ: ' + sub.note + '\n';
            }
          });
        }
        md += '\n';
      });
    }
    return md;
  };

  const handleBatchProcessItem = async (item: BatchQueueItem): Promise<{ title: string; fileName: string }> => {
    console.log('🌙 バッチ処理開始:', item.keyword);

    // 取引先プロフィールを名前でマッチング
    let batchClientProfile = null;
    if (item.clientName) {
      const matched = clientSummaries.find(function(c) {
        return c.name === item.clientName || c.name.includes(item.clientName) || item.clientName.includes(c.name);
      });
      if (matched) {
        try {
          const { fetchClientById } = await import('./services/clientDataService');
          batchClientProfile = await fetchClientById(matched.id);
          console.log('✅ バッチ: 取引先プロフィール取得:', batchClientProfile.name);
        } catch (e) {
          console.warn('⚠️ バッチ: 取引先プロフィール取得失敗（続行）', e);
        }
      }
    }

    // 競合分析
    const { generateCompetitorResearch: gcr } = await import('./services/competitorResearchWithWebFetch');
    const research = await gcr(item.keyword, function() {}, true);

    // 構成案生成
    const { generateOutlineV2: gov2 } = await import('./services/outlineGeneratorV2');
    const { checkAndFixOutline: cafo } = await import('./services/outlineCheckerV2');
    const rawOutline = await gov2(item.keyword, research, false, false, undefined, batchClientProfile || undefined);
    const { finalOutline } = await cafo(rawOutline, item.keyword, research);

    // 構成案を保存
    const { saveOutline: so, updateSavedArticle: usa } = await import('./services/articleStorageService');
    const savedId = await so({
      clientId: batchClientProfile ? (batchClientProfile as any).id || 'none' : 'none',
      clientName: item.clientName || '未選択',
      keyword: item.keyword,
      outline: finalOutline,
    });

    // 記事執筆
    const outlineMarkdown = convertOutlineV2ToMarkdown(finalOutline, item.keyword);
    const articleHtml = await generateArticleV3({
      outline: outlineMarkdown,
      keyword: item.keyword,
      targetAudience: finalOutline.targetAudience || 'ビジネスパーソン',
      tone: 'professional',
      useGrounding: true,
      clientProfile: batchClientProfile || undefined,
      writingStyleSample: buildCombinedStyleText(writingStyleSample),
    });

    // 記事を保存
    const articleData = {
      title: finalOutline.title || item.keyword,
      metaDescription: finalOutline.metaDescription || '',
      htmlContent: articleHtml,
      plainText: articleHtml.replace(/<[^>]*>/g, ''),
    };
    await usa(savedId, { article: articleData });

    // savedId（UUID）をそのまま返す → BatchMode の fetchSavedArticleById で使用
    console.log('✅ バッチ処理完了:', item.keyword, '→ id:', savedId);
    return { title: articleData.title, fileName: savedId };
  };

  // ファクトチェックページを表示
  if (currentPage === "factcheck") {
    return <FactCheckPage />;
  }

  // 記事修正ページを表示
  if (currentPage === "revision") {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="p-4">
          <button
            onClick={() => setCurrentPage("main")}
            className="mb-4 px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-lg transition-all duration-200"
          >
            ← メインページに戻る
          </button>
        </div>
        <ArticleRevisionForm onClose={() => setCurrentPage("main")} />
      </div>
    );
  }

  // テキストチェックページを表示
  if (currentPage === "textcheck") {
    return (
      <div className="min-h-screen bg-gray-50 text-gray-800 font-sans">
        <div className="p-4">
          <button
            onClick={() => setCurrentPage("main")}
            className="mb-4 px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-lg transition-all duration-200"
          >
            ← 構成生成ページに戻る
          </button>
        </div>
        <TextCheckPage />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-gray-100 text-gray-800 font-sans flex flex-col items-center p-4 sm:p-6 lg:p-8">
      <header className="w-full max-w-5xl mb-8">
        {/* メインタイトル */}
        <div className="text-center mb-6">
          <div className="flex items-center justify-center gap-3 mb-3">
            <div className="p-2 bg-blue-100 rounded-xl">
              <LogoIcon className="h-8 w-8 text-blue-600" />
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-800">
              Content Creation Agents
            </h1>
          </div>
          <p className="text-gray-500 text-sm sm:text-base">
            競合サイトを分析し、検索上位を狙える記事構成案をAIが作成します
          </p>
        </div>
      </header>

      <main className="w-full max-w-5xl flex-grow">
        <div className="bg-white rounded-2xl shadow-lg p-6 sm:p-8 border border-gray-200">
          <KeywordInputForm
            onGenerate={handleGenerate}
            onGenerateV2={handleGenerateV2}
            isLoading={isLoading}
            apiUsageToday={getApiUsageToday()}
            apiUsageWarning={apiUsageWarning}
            onOpenImageAgent={openImageAgentInIframe}
          />

          {/* 取引先選択（常時表示） */}
          <div className="mt-4 flex items-center gap-3 p-3 bg-blue-50 rounded-lg border border-blue-100">
            <span className="text-sm font-medium text-blue-700 shrink-0">🏢 取引先：</span>
            {clientSummaries.length > 0 ? (
              <select
                value={selectedClientId}
                onChange={function(e) { handleClientSelect(e.target.value); }}
                className="flex-1 border border-blue-200 rounded px-3 py-1.5 text-sm bg-white text-gray-700"
              >
                <option value="">（取引先なし）</option>
                {clientSummaries.map(function(c) {
                  return (
                    <option key={c.id} value={c.id}>{c.name}{c.industry ? ' ／ ' + c.industry : ''}</option>
                  );
                })}
              </select>
            ) : (
              <span className="text-sm text-gray-400 flex-1">取引先が登録されていません</span>
            )}
            {clientProfile && (
              <span className="text-xs text-blue-600 shrink-0">✅ ルール適用中</span>
            )}
            <button
              onClick={function() { setActiveTab("clients"); }}
              className="text-xs px-3 py-1.5 bg-green-500 text-white rounded hover:bg-green-600 shrink-0"
            >
              取引先管理
            </button>
          </div>

          {/* 構成案モード選択 */}
          <div className="mt-3 flex items-center gap-3 p-3 bg-gray-50 rounded-lg border border-gray-200">
            <span className="text-sm font-medium text-gray-600 shrink-0">📋 構成モード：</span>
            <div className="flex gap-2 flex-wrap">
              {/* 標準モード（競合分析型）は一時的に非表示 — コードは保持
              <button
                onClick={function() { setOutlineMode('standard'); }}
                className={
                  'px-3 py-1.5 rounded-lg text-sm font-medium border transition-all ' +
                  (outlineMode === 'standard'
                    ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                    : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-100')
                }
              >
                標準モード（競合分析型）
              </button>
              */}
              <button
                onClick={function() { setOutlineMode('siteData'); }}
                className={
                  'px-3 py-1.5 rounded-lg text-sm font-medium border transition-all ' +
                  (outlineMode === 'siteData'
                    ? 'bg-emerald-600 text-white border-emerald-600 shadow-sm'
                    : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-100')
                }
              >
                サイトデータ型（事実ベース）
              </button>
            </div>
            <span className="text-xs text-gray-400 ml-auto shrink-0">
              {outlineMode === 'standard'
                ? '競合H2/H3分析・文字数制御'
                : '取引先情報基点・ハルシネーション抑制'}
            </span>
          </div>

          {/* 取引先管理画面（常時アクセス可能） */}
          {activeTab === "clients" && (
            <div className="mt-6">
              <ClientManager
                onClientListChanged={function() {
                  fetchClients()
                    .then(function(list) {
                      setClientSummaries(list.filter(function(c) { return c.isActive; }));
                    })
                    .catch(function() {});
                }}
              />
            </div>
          )}

          {/* 執筆スタイルサンプル管理（常時アクセス可能） */}
          {activeTab === "writingStyle" && (
            <div className="mt-6">
              <WritingStyleManager
                clientSummaries={clientSummaries}
                selectedClientId={selectedClientId}
                onStyleSaved={function(sample) {
                  setWritingStyleSample(sample);
                }}
              />
            </div>
          )}

          <div className="mt-8">

            {isLoading && (
              <div>
                <LoadingSpinner />
                {analysisProgress && (
                  <div className="mt-4 bg-blue-50 p-4 rounded-xl border border-blue-200">
                    <div className="text-center mb-2">
                      <span className="text-blue-700 font-semibold">
                        競合サイト分析中: {analysisProgress.current}/
                        {analysisProgress.total} サイト完了
                      </span>
                    </div>
                    <div className="w-full bg-blue-100 rounded-full h-2">
                      <div
                        className="bg-gradient-to-r from-blue-500 to-indigo-500 h-2 rounded-full transition-all duration-300"
                        style={{
                          width: `${
                            (analysisProgress.current /
                              analysisProgress.total) *
                            100
                          }%`,
                        }}
                      />
                    </div>
                    <div className="text-center mt-2 text-sm text-gray-500">
                      {analysisProgress.current < 5
                        ? "通常分析中..."
                        : analysisProgress.current % 5 === 0
                        ? "☕ 10秒の休憩中..."
                        : "通常分析中..."}
                    </div>
                  </div>
                )}
              </div>
            )}
            {error && <ErrorMessage message={error} />}

            {/* タブ切り替え */}
            {!isLoading && (
              <div className="flex gap-2 mb-6 flex-wrap">
                {/* 記事一覧は常時表示 */}
                <button
                  onClick={() => setActiveTab("articleList")}
                  className={`px-6 py-3 rounded-xl font-semibold transition-all duration-200 ${
                    activeTab === "articleList"
                      ? "bg-blue-500 text-white shadow-md"
                      : "bg-white text-gray-600 hover:bg-gray-50 border border-gray-200"
                  }`}
                >
                  📚 記事一覧
                </button>
                {(outline || outlineV2 || competitorResearch) && (
                <button
                  onClick={() => setActiveTab("research")}
                  className={`px-6 py-3 rounded-xl font-semibold transition-all duration-200 ${
                    activeTab === "research"
                      ? "bg-blue-500 text-white shadow-md"
                      : "bg-white text-gray-600 hover:bg-gray-50 border border-gray-200"
                  }`}
                >
                  競合分析
                </button>
                )}
                {competitorResearch?.frequencyWords && (
                  <button
                    onClick={() => setActiveTab("frequency")}
                    className={`px-6 py-3 rounded-xl font-semibold transition-all duration-200 ${
                      activeTab === "frequency"
                        ? "bg-blue-500 text-white shadow-md"
                        : "bg-white text-gray-600 hover:bg-gray-50 border border-gray-200"
                    }`}
                  >
                    頻出単語
                  </button>
                )}
                {(outline || outlineV2 || competitorResearch) && (
                  <>
                    <button
                      onClick={() => setActiveTab("outline")}
                      className={`px-6 py-3 rounded-xl font-semibold transition-all duration-200 ${
                        activeTab === "outline"
                          ? "bg-blue-500 text-white shadow-md"
                          : "bg-white text-gray-600 hover:bg-gray-50 border border-gray-200"
                      }`}
                    >
                      構成案
                    </button>
                    {generatedArticle && (
                      <button
                        onClick={() => setActiveTab("article")}
                        className={`px-6 py-3 rounded-xl font-semibold transition-all duration-200 ${
                          activeTab === "article"
                            ? "bg-gradient-to-r from-indigo-500 to-purple-500 text-white shadow-md"
                            : "bg-white text-gray-600 hover:bg-gray-50 border border-gray-200"
                        }`}
                      >
                        記事本文
                      </button>
                    )}
                  </>
                )}
                <button
                  onClick={() => setActiveTab("references")}
                  className={`px-6 py-3 rounded-xl font-semibold transition-all duration-200 ${
                    activeTab === "references"
                      ? "bg-amber-500 text-white shadow-md"
                      : "bg-white text-gray-600 hover:bg-gray-50 border border-gray-200"
                  }`}
                >
                  参考資料
                  {selectedRefMaterialIds.length > 0 && (
                    <span className="ml-1 px-1.5 py-0.5 text-xs bg-amber-600 text-white rounded-full">
                      {selectedRefMaterialIds.length}
                    </span>
                  )}
                </button>
                <button
                  onClick={() => setActiveTab("clients")}
                  className={`px-6 py-3 rounded-xl font-semibold transition-all duration-200 ${
                    activeTab === "clients"
                      ? "bg-green-500 text-white shadow-md"
                      : "bg-white text-gray-600 hover:bg-gray-50 border border-gray-200"
                  }`}
                >
                  🏢 取引先管理
                </button>
                <button
                  onClick={() => setActiveTab("writingStyle")}
                  className={`px-6 py-3 rounded-xl font-semibold transition-all duration-200 ${
                    activeTab === "writingStyle"
                      ? "bg-purple-500 text-white shadow-md"
                      : "bg-white text-gray-600 hover:bg-gray-50 border border-gray-200"
                  }`}
                >
                  ✍️ 執筆スタイル
                  {writingStyleSample && (
                    <span className="ml-1 px-1.5 py-0.5 text-xs bg-purple-600 text-white rounded-full">
                      ✅
                    </span>
                  )}
                </button>
                <button
                  onClick={() => setActiveTab("batch")}
                  className={`px-6 py-3 rounded-xl font-semibold transition-all duration-200 ${
                    activeTab === "batch"
                      ? "bg-indigo-500 text-white shadow-md"
                      : "bg-white text-gray-600 hover:bg-gray-50 border border-gray-200"
                  }`}
                >
                  📋 一斉作成
                </button>
                <button
                  onClick={() => setActiveTab("keywordManager")}
                  className={`px-6 py-3 rounded-xl font-semibold transition-all duration-200 ${
                    activeTab === "keywordManager"
                      ? "bg-emerald-500 text-white shadow-md"
                      : "bg-white text-gray-600 hover:bg-gray-50 border border-gray-200"
                  }`}
                >
                  📊 キーワード管理
                </button>
                <button
                  onClick={() => setActiveTab("revisionLog")}
                  className={`px-6 py-3 rounded-xl font-semibold transition-all duration-200 ${
                    activeTab === "revisionLog"
                      ? "bg-slate-600 text-white shadow-md"
                      : "bg-white text-gray-600 hover:bg-gray-50 border border-gray-200"
                  }`}
                >
                  📋 修正ログ
                </button>
              </div>
            )}

            {/* タブコンテンツ */}
            {activeTab === "research" && competitorResearch && !isLoading && (
              <CompetitorResearchWebFetch research={competitorResearch} />
            )}

            {activeTab === "frequency" &&
              competitorResearch?.frequencyWords &&
              !isLoading && (
                <FrequencyWordsTab
                  frequencyWords={competitorResearch.frequencyWords}
                  totalArticles={competitorResearch.validArticles.length}
                />
              )}

            {activeTab === "references" && !isLoading && (
              <ReferenceMaterialManager />
            )}

            {activeTab === "outline" && !isLoading && (
              <>
                {/* 参考資料選択ウィジェット */}
                <ReferenceMaterialSelector
                  selectedIds={selectedRefMaterialIds}
                  onSelectionChange={setSelectedRefMaterialIds}
                />

                {/* Ver.2の構成案表示 */}
                {outlineV2 && isV2Mode && (
                  <OutlineDisplayV2
                    outline={outlineV2}
                    keyword={keyword}
                    outlineMode={outlineMode}
                    onStartWritingV3={async () => {
                      // 構成案を自動保存してから執筆開始
                      if (!isOutlineSaved && outlineV2) {
                        try {
                          await handleSaveOutline();
                        } catch (e) {
                          console.warn('構成案の自動保存に失敗しました（続行）', e);
                        }
                      }
                      setWritingMode("v3");
                      setShowArticleWriter(true);
                    }}
                    onRevise={async (instruction: string) => {
                      const revised = await reviseOutlineV2(outlineV2, keyword, instruction);
                      setOutlineV2(revised);
                      // 修正後は保存済み状態をリセット（再保存を促す）
                      setIsOutlineSaved(false);
                    }}
                    onSave={handleSaveOutline}
                    isSaved={isOutlineSaved}
                  />
                )}

                {/* Ver.1の構成案表示 */}
                {outline &&
                  !isV2Mode &&
                  (outline.competitorResearch?.frequencyWords ? (
                    <OutlineDisplayOptimized
                      outline={outline}
                      keyword={keyword}
                      sources={sources}
                      onArticleGenerated={(article) => {
                        setGeneratedArticle(article);
                        setActiveTab("article");
                      }}
                    />
                  ) : (
                    <OutlineDisplay
                      outline={outline}
                      keyword={keyword}
                      sources={sources}
                      onArticleGenerated={(article) => {
                        setGeneratedArticle(article);
                        setActiveTab("article");
                      }}
                    />
                  ))}
              </>
            )}

            {activeTab === "article" && generatedArticle && !isLoading && (
              <ArticleDisplay
                article={generatedArticle}
                keyword={keyword}
                outline={outline}
                onEditClick={() => {
                  // 編集を再開するためArticleWriterを開く
                  if (outline || outlineV2) {
                    setShowArticleWriter(true);
                  }
                }}
                onOpenImageAgent={openImageAgentInIframe}
                onArticleUpdate={(html) => {
                  setGeneratedArticle({
                    title: generatedArticle.title,
                    metaDescription: generatedArticle.metaDescription,
                    htmlContent: html,
                    plainText: generatedArticle.plainText,
                  });
                  // 内容更新時は保存済み状態をリセット
                  setIsArticleSaved(false);
                }}
                onSave={handleSaveArticle}
                isSaved={isArticleSaved}
                onExportForCheck={handleExportForCheck}
                onImportChecked={handleImportChecked}
              />
            )}

            {activeTab === "articleList" && (
              <ArticleList
                clientSummaries={clientSummaries}
                onRestoreOutline={handleRestoreOutline}
                onRestoreArticle={handleRestoreArticle}
              />
            )}

            {activeTab === "batch" && (
              <BatchMode onProcessItem={handleBatchProcessItem} />
            )}

            {activeTab === "keywordManager" && (
              <KeywordManager
                onOutlineLoaded={handleOutlineLoadedFromSheet}
                clientProfile={clientProfile}
              />
            )}

            {activeTab === "revisionLog" && (
              <RevisionLogTab />
            )}

            {!isLoading && !error && !outline && !competitorResearch && !outlineV2 && activeTab !== "references" && (
              <div className="text-center py-16 px-6 bg-gray-50 rounded-lg border-2 border-dashed border-gray-300">
                <SparklesIcon className="mx-auto h-12 w-12 text-gray-400" />
                <h3 className="mt-4 text-xl font-semibold text-gray-700">
                  競合分析と構成案を待っています
                </h3>
                <p className="mt-1 text-gray-500">
                  上記にキーワードを入力して「構成案を作成」ボタンをクリックしてください。
                </p>
                <p className="mt-2 text-sm text-blue-500">
                  上位15サイトを分析し、最適な記事構成を提案します。
                </p>
                <button
                  onClick={() => setActiveTab("references")}
                  className="mt-4 text-sm text-amber-600 hover:text-amber-700 underline"
                >
                  参考資料を管理する
                </button>
              </div>
            )}

          </div>
        </div>
      </main>
      <footer className="w-full max-w-5xl mt-8 text-center text-gray-500 text-sm">
        <p>Powered by Google Gemini API</p>
      </footer>

      {/* 記事執筆モーダル */}
      {(showArticleWriter || showWriterDirectly) &&
        (outline || outlineV2) && (
          <ArticleWriter
            outline={outlineV2 || outline!}
            keyword={keyword}
            writingMode={writingMode}
            testMode={false} // テストモード強制無効化
            revisionTestMode={false} // 修正サービステストモード無効化
            isAutoMode={false}
            skipAutoGenerate={showArticleWriter && generatedArticle !== null} // 編集再開時は自動生成をスキップ
            referenceMaterialContext={refMaterialContext || undefined}
            clientProfile={clientProfile || undefined}
            writingStyleSample={buildCombinedStyleText(writingStyleSample)}
            onOpenImageAgent={openImageAgentInIframe}
            onClose={() => {
              setShowArticleWriter(false);
              setShowWriterDirectly(false);
            }}
            onArticleGenerated={(article) => {
              setGeneratedArticle(article);
              setActiveTab("article");
            }}
            onAutoRevisionStart={() => {
              console.log("🚀 自動修正開始");
            }}
            onAutoComplete={async () => {
              console.log("✅ 全工程完了（自動修正含む）");
            }}
          />
        )}

        {/* 画像生成エージェントiframe */}
        {imageAgentEmbedState && (
          <ImageGeneratorIframe
            embedState={imageAgentEmbedState}
            iframeRef={imageAgentIframeRef}
            onLoad={sendDataToImageAgentIframe}
            onError={(error) => {
              console.error("❌ 画像生成エージェントiframeエラー:", error);
              // エラー時は別タブで開き直すことを提案
            }}
            onClose={closeImageAgentIframe}
            onReopenInNewTab={reopenImageAgentInNewTab}
            height="calc(100vh - 120px)"
          />
        )}
    </div>
  );
};

export default App;
