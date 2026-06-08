import React, { useState, useMemo, useRef } from "react";
import type { SeoOutline } from "../types";
import { generateFaqSchemaFromArticle } from "../utils/faqSchemaGenerator";
import { reviseArticle } from "../services/articleRevisionService";
import { runMarketingCheck, extractConclusionAndCta } from "../services/marketingCheckService";
import type { MarketingCheckResult } from "../services/marketingCheckService";
import MarketingCheckResultComponent from "./MarketingCheckResult";

interface ArticleDisplayProps {
  article: {
    title: string;
    metaDescription: string;
    htmlContent: string;
    plainText: string;
  };
  keyword: string;
  outline: SeoOutline | null;
  onEditClick?: () => void;
  onOpenImageAgent?: (articleData: {
    title: string;
    content: string;
    keyword: string;
    autoMode?: boolean;
  }) => void;
  onArticleUpdate?: (htmlContent: string) => void;
  onSave?: () => Promise<void>;
  isSaved?: boolean;
  onExportForCheck?: () => void;
  onImportChecked?: (file: File) => void;
  clientProfile?: import('../types').ClientProfile | null;
  targetAudience?: string;
}

// ────────────────────────────────────────────────
// H2セクション分割ユーティリティ
// ────────────────────────────────────────────────
interface ArticleSection {
  heading: string | null;
  content: string;
  sectionIndex: number; // -1: H2前、0以上: H2セクション番号
}

function parseArticleSections(html: string): ArticleSection[] {
  const sections: ArticleSection[] = [];
  const h2Regex = /<h2[^>]*>[\s\S]*?<\/h2>/gi;
  const matches: Array<{ index: number; match: string }> = [];

  let m = h2Regex.exec(html);
  while (m !== null) {
    matches.push({ index: m.index, match: m[0] });
    m = h2Regex.exec(html);
  }

  if (matches.length === 0) {
    return [{ heading: null, content: html, sectionIndex: -1 }];
  }

  // H2前のコンテンツ
  const firstIndex = matches[0].index;
  if (firstIndex > 0) {
    sections.push({ heading: null, content: html.slice(0, firstIndex), sectionIndex: -1 });
  }

  // 各H2セクション
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index;
    const end = i < matches.length - 1 ? matches[i + 1].index : html.length;
    const sectionHtml = html.slice(start, end);
    const headingText = matches[i].match.replace(/<[^>]+>/g, '').trim();
    sections.push({ heading: headingText, content: sectionHtml, sectionIndex: i });
  }

  return sections;
}

const ArticleDisplay: React.FC<ArticleDisplayProps> = ({
  article,
  keyword,
  outline,
  onEditClick,
  onOpenImageAgent,
  onArticleUpdate,
  onSave,
  isSaved,
  onExportForCheck,
  onImportChecked,
  clientProfile,
  targetAudience,
}) => {
  const importInputRef = useRef<HTMLInputElement>(null);
  const [viewMode, setViewMode] = useState<"preview" | "code">("preview");
  const [copyButtonText, setCopyButtonText] = useState("HTMLコピー");
  const [isSavingArticle, setIsSavingArticle] = useState(false);
  const [articleSaveMessage, setArticleSaveMessage] = useState('');

  // マーケティングチェック
  const [isMarketingChecking, setIsMarketingChecking] = useState(false);
  const [marketingCheckResult, setMarketingCheckResult] = useState<MarketingCheckResult | null>(null);
  const [marketingCheckError, setMarketingCheckError] = useState<string | null>(null);

  const handleMarketingCheck = async () => {
    setIsMarketingChecking(true);
    setMarketingCheckResult(null);
    setMarketingCheckError(null);
    try {
      const result = await runMarketingCheck(
        article.htmlContent,
        keyword,
        clientProfile || null,
        targetAudience || ''
      );
      setMarketingCheckResult(result);
    } catch (err) {
      setMarketingCheckError(
        'マーケティングチェックエラー: ' + (err instanceof Error ? err.message : String(err))
      );
    } finally {
      setIsMarketingChecking(false);
    }
  };

  const handleApplyMarketingImprovement = (improvedHtml: string) => {
    const originalCta = extractConclusionAndCta(article.htmlContent);
    const newHtml = article.htmlContent.replace(originalCta, improvedHtml);
    if (onArticleUpdate) {
      onArticleUpdate(newHtml);
    }
    setMarketingCheckResult(null);
  };

  const handleSaveArticle = async () => {
    if (!onSave) return;
    setIsSavingArticle(true);
    setArticleSaveMessage('');
    try {
      await onSave();
      setArticleSaveMessage('saved');
    } catch (err) {
      setArticleSaveMessage('error');
    } finally {
      setIsSavingArticle(false);
    }
  };
  const [highlightProprietary, setHighlightProprietary] = useState(false);

  // セクション別修正パネルの状態
  const [openRevisionIndex, setOpenRevisionIndex] = useState<number | null>(null);
  const [sectionInstruction, setSectionInstruction] = useState('');
  const [isRevising, setIsRevising] = useState(false);
  const [revisionError, setRevisionError] = useState('');
  const [revisionSuccess, setRevisionSuccess] = useState('');

  // H2セクションに分割（プレビューモード用）
  const articleSections = useMemo(
    function() { return parseArticleSections(article.htmlContent); },
    [article.htmlContent]
  );
  const hasH2Sections = articleSections.some(function(s) { return s.sectionIndex >= 0; });

  const handleOpenRevision = (index: number) => {
    if (openRevisionIndex === index) {
      setOpenRevisionIndex(null);
      setSectionInstruction('');
      setRevisionError('');
    } else {
      setOpenRevisionIndex(index);
      setSectionInstruction('');
      setRevisionError('');
      setRevisionSuccess('');
    }
  };

  const handleSectionRevise = async (sectionIndex: number, sectionHeading: string) => {
    if (!sectionInstruction.trim() || !onArticleUpdate) return;
    setIsRevising(true);
    setRevisionError('');
    setRevisionSuccess('');
    try {
      const contextualInstruction =
        '「' + sectionHeading + '」のセクションを修正してください。\n' + sectionInstruction.trim();
      const result = await reviseArticle(article.htmlContent, contextualInstruction);
      if (result.success && result.revised) {
        onArticleUpdate(result.revised);
        setRevisionSuccess('✅ 修正が完了しました');
        setSectionInstruction('');
        setOpenRevisionIndex(null);
      } else {
        setRevisionError(result.error || '修正に失敗しました');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : '修正に失敗しました';
      setRevisionError(msg);
    } finally {
      setIsRevising(false);
    }
  };

  // 独自情報ハイライト用スタイル
  const proprietaryStyle = highlightProprietary
    ? `.article-content .proprietary-info {
        background-color: #fef9c3;
        border-left: 3px solid #eab308;
        padding: 1px 4px;
        border-radius: 2px;
        font-weight: 500;
      }`
    : `.article-content .proprietary-info { /* ハイライトOFF */ }`;

  // ハイライトOFF時はタグを透過（スタイルのみ制御）
  const hasProprietaryInfo = article.htmlContent.includes('class="proprietary-info"');

  // FAQPage JSON-LD を生成
  var faqJsonLd = useMemo(function () {
    return generateFaqSchemaFromArticle(article.htmlContent);
  }, [article.htmlContent]);

  const handleCopyHtml = () => {
    var htmlWithSchema = faqJsonLd
      ? article.htmlContent + "\n\n" + faqJsonLd
      : article.htmlContent;
    navigator.clipboard
      .writeText(htmlWithSchema)
      .then(() => {
        setCopyButtonText("コピーしました！");
        setTimeout(() => {
          setCopyButtonText("HTMLコピー");
        }, 2000);
      })
      .catch((err) => {
        console.error("Failed to copy:", err);
        alert("コピーに失敗しました");
      });
  };

  const handleDownloadText = () => {
    const content = `タイトル: ${article.title}

メタディスクリプション: ${article.metaDescription}

---

${article.plainText}`;

    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${keyword.replace(/\s+/g, "_")}_article.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleDownloadHtml = () => {
    const fullHtml = `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="description" content="${article.metaDescription}">
  <title>${article.title}</title>
  <style>
    body { font-family: sans-serif; line-height: 1.8; max-width: 800px; margin: 0 auto; padding: 20px; color: #333; }
    h1 { color: #1e40af; border-bottom: 3px solid #0066cc; padding-bottom: 15px; font-size: 2em; margin-bottom: 30px; }
    h2 { color: #1e3a8a; margin-top: 40px; margin-bottom: 20px; font-size: 1.5em; font-weight: bold; padding-bottom: 10px; border-bottom: 2px solid #ddd; }
    h3 { color: #1d4ed8; margin-top: 30px; margin-bottom: 15px; font-size: 1.25em; font-weight: bold; }
    p { margin: 15px 0; }
    strong, b { color: #1e3a8a; font-weight: bold; }
    ul, ol { margin: 20px 0; padding-left: 30px; }
    li { margin: 8px 0; }
    .source-citation { font-size: 0.85em; color: #666; margin-top: 4px; margin-bottom: 16px; }
  </style>
  ${faqJsonLd}
</head>
<body>
  <h1>${article.title}</h1>
  ${article.htmlContent}
</body>
</html>`;

    const blob = new Blob([fullHtml], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${keyword.replace(/\s+/g, "_")}_article.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      {/* ヘッダー */}
      <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2">
            生成された記事
            <span className="text-sm text-gray-500">- {keyword}</span>
          </h2>
          <div className="flex gap-2">
            <button
              onClick={() => setViewMode("preview")}
              className={`px-4 py-2 rounded-lg ${
                viewMode === "preview"
                  ? "bg-blue-500 text-white"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200 border border-gray-200"
              }`}
            >
              プレビュー
            </button>
            <button
              onClick={() => setViewMode("code")}
              className={`px-4 py-2 rounded-lg ${
                viewMode === "code"
                  ? "bg-blue-500 text-white"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200 border border-gray-200"
              }`}
            >
              HTMLコード
            </button>
          </div>
        </div>

        {/* アクションボタン */}
        <div className="flex gap-2 justify-end flex-wrap">
          {onEditClick && (
            <button
              onClick={onEditClick}
              className="px-4 py-2 bg-indigo-500 hover:bg-indigo-600 text-white rounded-lg transition-colors flex items-center gap-2"
              title="記事編集モーダルを開く"
            >
              編集を再開
            </button>
          )}
          <button
            onClick={handleCopyHtml}
            className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg transition-colors border border-gray-200"
          >
            {copyButtonText}
          </button>
          <button
            onClick={handleDownloadText}
            className="px-4 py-2 bg-green-500 hover:bg-green-600 text-white rounded-lg transition-colors"
          >
            テキストDL
          </button>
          <button
            onClick={handleDownloadHtml}
            className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg transition-colors"
          >
            HTML DL
          </button>
          {onExportForCheck && (
            <button
              onClick={onExportForCheck}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-colors shadow-sm"
              title="ClaudeProjectへの最終チェック依頼用ファイルをダウンロード"
            >
              📤 チェック用DL
            </button>
          )}
          {onImportChecked && (
            <label
              className="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-lg transition-colors shadow-sm cursor-pointer"
              title="ClaudeProjectから返ってきた修正済みファイルを取り込む"
            >
              📥 修正済みDL
              <input
                ref={importInputRef}
                type="file"
                accept=".md,.txt"
                className="hidden"
                onChange={function(e) {
                  const file = e.target.files && e.target.files[0];
                  if (file) {
                    onImportChecked(file);
                  }
                  e.target.value = '';
                }}
              />
            </label>
          )}
          {onSave && (
            <button
              onClick={handleSaveArticle}
              disabled={isSavingArticle}
              className={`px-4 py-2 rounded-lg font-semibold text-sm transition-colors border ${
                isSaved || articleSaveMessage === 'saved'
                  ? 'bg-green-50 text-green-700 border-green-300 cursor-default'
                  : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
              } disabled:opacity-60`}
            >
              {isSavingArticle ? '保存中...' : (isSaved || articleSaveMessage === 'saved') ? '✅ 保存済み' : '💾 保存'}
            </button>
          )}
          <button
            onClick={handleMarketingCheck}
            disabled={isMarketingChecking}
            className="px-4 py-2 bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 disabled:from-gray-300 disabled:to-gray-300 text-white rounded-lg transition-all flex items-center gap-2 font-semibold shadow-sm text-sm"
            title="CTA・まとめのコピーライティング品質を5軸で診断・改善"
          >
            {isMarketingChecking ? (
              <>
                <span className="animate-pulse">📣</span>
                チェック中...
              </>
            ) : (
              <>📣 CTAチェック</>
            )}
          </button>
        </div>
      </div>

      {/* マーケティングチェックエラー */}
      {marketingCheckError && (
        <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          ❌ {marketingCheckError}
        </div>
      )}

      {/* マーケティングチェック結果 */}
      {marketingCheckResult && (
        <MarketingCheckResultComponent
          result={marketingCheckResult}
          onApply={handleApplyMarketingImprovement}
          onClose={function() { setMarketingCheckResult(null); }}
        />
      )}

      {/* 記事情報 */}
      <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
        <h3 className="text-lg font-semibold text-blue-600 mb-3">記事情報</h3>
        <div className="space-y-2">
          <div>
            <span className="text-gray-500">タイトル:</span>
            <p className="text-gray-800 mt-1">{article.title}</p>
          </div>
          <div>
            <span className="text-gray-500">メタディスクリプション:</span>
            <p className="text-gray-800 mt-1">{article.metaDescription}</p>
          </div>
          <div className="flex gap-4">
            <div>
              <span className="text-gray-500">文字数:</span>
              <span className="ml-2 text-gray-800">
                {article.plainText.length.toLocaleString()}文字
              </span>
            </div>
            {outline?.characterCountAnalysis && (
              <div>
                <span className="text-gray-500">推奨文字数:</span>
                <span className="ml-2 text-gray-800">
                  {outline.characterCountAnalysis.average.toLocaleString()}文字
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* FAQPage JSON-LD */}
      {faqJsonLd && (
        <div className="bg-green-50 p-4 rounded-xl border border-green-200 shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-green-800 flex items-center gap-2">
              <span>{"✅"}</span>
              FAQPage 構造化データ（JSON-LD）
            </h3>
            <button
              onClick={function () {
                navigator.clipboard.writeText(faqJsonLd).then(function () {
                  alert("JSON-LDをコピーしました");
                });
              }}
              className="px-3 py-1 text-xs bg-green-100 hover:bg-green-200 text-green-700 rounded-lg transition-colors border border-green-300"
            >
              コピー
            </button>
          </div>
          <p className="text-xs text-green-600 mb-2">
            HTMLコピー・HTML DLに自動で含まれます。WordPressのカスタムHTMLブロックに貼り付けても使えます。
          </p>
          <pre className="bg-white text-xs text-gray-700 p-3 rounded-lg overflow-auto max-h-40 border border-green-200">
            <code>{faqJsonLd}</code>
          </pre>
        </div>
      )}

      {/* コンテンツエリア */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        {viewMode === "preview" ? (
          // プレビューモード
          <div className="bg-white rounded-lg p-8 text-gray-900">
            <style dangerouslySetInnerHTML={{ __html: `
              .article-content .source-citation { font-size: 0.85em; color: #6b7280; margin-top: 4px; margin-bottom: 16px; }
              ${proprietaryStyle}
            `}} />
            {hasProprietaryInfo && (
              <div className="mb-4 flex items-center gap-3">
                <button
                  onClick={() => setHighlightProprietary(!highlightProprietary)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
                    highlightProprietary
                      ? 'bg-yellow-100 border-yellow-400 text-yellow-800'
                      : 'bg-gray-100 border-gray-300 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  <span>{highlightProprietary ? '🟡' : '⬜'}</span>
                  独自情報ハイライト {highlightProprietary ? 'ON' : 'OFF'}
                </button>
                {highlightProprietary && (
                  <span className="text-xs text-yellow-700 bg-yellow-50 border border-yellow-200 px-2 py-1 rounded">
                    黄色マーカー部分が取引先独自情報です（確認用・投稿には影響しません）
                  </span>
                )}
              </div>
            )}
            {revisionSuccess && (
              <div className="mb-4 px-4 py-2 bg-green-50 border border-green-300 rounded-lg text-sm text-green-700">
                {revisionSuccess}
              </div>
            )}
            <h1 className="text-3xl font-bold mb-6 pb-4 border-b-2 border-blue-600">
              {article.title}
            </h1>

            {/* H2セクションごとに分割してレンダリング（修正ボタン付き） */}
            {hasH2Sections && onArticleUpdate ? (
              <div className="article-content">
                {articleSections.map(function(section, idx) {
                  return (
                    <div key={idx}>
                      {/* セクション本文 */}
                      <div
                        className="prose prose-lg max-w-none
                          prose-h2:text-2xl prose-h2:font-bold prose-h2:text-blue-900 prose-h2:mt-8 prose-h2:mb-4 prose-h2:pb-2 prose-h2:border-b-2 prose-h2:border-blue-200
                          prose-h3:text-xl prose-h3:font-bold prose-h3:text-blue-700 prose-h3:mt-6 prose-h3:mb-3
                          prose-p:text-gray-700 prose-p:leading-relaxed
                          prose-strong:text-blue-900 prose-strong:font-bold
                          prose-ul:my-4 prose-li:my-1"
                        dangerouslySetInnerHTML={{ __html: section.content }}
                      />

                      {/* H2セクションのみ修正ボタンを表示 */}
                      {section.sectionIndex >= 0 && section.heading && (
                        <div className="my-3">
                          <button
                            onClick={function() { handleOpenRevision(section.sectionIndex); }}
                            disabled={isRevising}
                            className={`text-xs px-3 py-1.5 rounded-lg border transition-colors flex items-center gap-1 ${
                              openRevisionIndex === section.sectionIndex
                                ? 'bg-amber-100 border-amber-400 text-amber-800'
                                : 'bg-white border-gray-300 text-gray-500 hover:bg-amber-50 hover:border-amber-300 hover:text-amber-700'
                            }`}
                          >
                            <span>✏️</span>
                            {openRevisionIndex === section.sectionIndex ? 'パネルを閉じる' : 'このセクションを修正依頼'}
                          </button>

                          {openRevisionIndex === section.sectionIndex && (
                            <div className="mt-2 p-4 bg-amber-50 border border-amber-200 rounded-lg">
                              <p className="text-xs text-amber-700 mb-1 font-medium">
                                「{section.heading}」への修正指示
                              </p>
                              <p className="text-xs text-amber-600 mb-2">
                                例：「具体的な数値を追加して」「このセクションにH3を2つ追加して」「文章をもっと簡潔に」
                              </p>
                              <textarea
                                value={sectionInstruction}
                                onChange={function(e) { setSectionInstruction(e.target.value); }}
                                placeholder="修正内容を入力してください..."
                                className="w-full h-20 px-3 py-2 border border-amber-300 rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white"
                                disabled={isRevising}
                              />
                              {revisionError && openRevisionIndex === section.sectionIndex && (
                                <p className="text-xs text-red-600 mt-1">❌ {revisionError}</p>
                              )}
                              <div className="flex justify-end mt-2">
                                <button
                                  onClick={function() { handleSectionRevise(section.sectionIndex, section.heading || ''); }}
                                  disabled={isRevising || !sectionInstruction.trim()}
                                  className="px-4 py-1.5 bg-amber-500 text-white text-sm font-semibold rounded-lg hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                >
                                  {isRevising ? '✨ AI修正中...' : '✨ AI修正を実行'}
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              // onArticleUpdate未設定 or H2なし → 従来通り一括表示
              <div
                className="prose prose-lg max-w-none article-content
                  prose-h2:text-2xl prose-h2:font-bold prose-h2:text-blue-900 prose-h2:mt-8 prose-h2:mb-4 prose-h2:pb-2 prose-h2:border-b-2 prose-h2:border-blue-200
                  prose-h3:text-xl prose-h3:font-bold prose-h3:text-blue-700 prose-h3:mt-6 prose-h3:mb-3
                  prose-p:text-gray-700 prose-p:leading-relaxed
                  prose-strong:text-blue-900 prose-strong:font-bold
                  prose-ul:my-4 prose-li:my-1"
                dangerouslySetInnerHTML={{ __html: article.htmlContent }}
              />
            )}
          </div>
        ) : (
          // コードモード
          <div className="p-4">
            <pre className="bg-gray-50 text-gray-800 font-mono text-sm p-4 rounded-lg overflow-auto max-h-[600px] border border-gray-200">
              <code>{article.htmlContent}</code>
            </pre>
          </div>
        )}
      </div>
    </div>
  );
};

export default ArticleDisplay;
