import React, { useState } from "react";
import { SearchIcon } from "./icons";

interface KeywordInputFormProps {
  onGenerate: (keyword: string, includeImages: boolean) => void;
  onGenerateV2?: (keyword: string, includeImages: boolean) => void;
  onGenerateV2WithoutResearch?: (keyword: string, includeImages: boolean) => void;
  isLoading: boolean;
  apiUsageToday?: number;
  apiUsageWarning?: string | null;
  onOpenImageAgent?: (articleData: {
    title: string;
    content: string;
    keyword: string;
    autoMode?: boolean;
  }) => void;
}

const KeywordInputForm: React.FC<KeywordInputFormProps> = ({
  onGenerate,
  onGenerateV2,
  onGenerateV2WithoutResearch,
  isLoading,
  apiUsageToday = 0,
  apiUsageWarning,
  onOpenImageAgent,
}) => {
  const [keyword, setKeyword] = useState("");
  const [includeImages, setIncludeImages] = useState(true);
  const [activeButton, setActiveButton] = useState<'with' | 'without' | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onGenerate(keyword, includeImages);
  };

  const handleSubmitV2 = (e: React.FormEvent) => {
    e.preventDefault();
    if (onGenerateV2) {
      setActiveButton('with');
      onGenerateV2(keyword, includeImages);
    }
  };

  const handleSubmitV2WithoutResearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (onGenerateV2WithoutResearch) {
      setActiveButton('without');
      onGenerateV2WithoutResearch(keyword, includeImages);
    }
  };

  // ロード完了時にactiveButtonをリセット
  React.useEffect(function() {
    if (!isLoading) {
      setActiveButton(null);
    }
  }, [isLoading]);

  return (
    <div className="space-y-4">
      {/* キーワード入力フォーム */}
      <form
        onSubmit={handleSubmitV2}
        className="flex flex-col sm:flex-row items-center gap-4"
      >
        <div className="relative w-full">
          <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
            <SearchIcon className="h-5 w-5 text-gray-400" />
          </div>
          <input
            type="text"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="例: 「React パフォーマンス最適化」"
            className="w-full pl-11 pr-4 py-3.5 bg-white border border-gray-200 rounded-xl text-gray-800 placeholder-gray-400 focus:ring-2 focus:ring-blue-400 focus:border-blue-400 transition duration-200 ease-in-out shadow-sm"
            disabled={isLoading}
          />
          {/* API使用回数の表示 */}
          <div className="absolute -bottom-6 left-0 text-xs text-gray-500">
            本日のCustom Search APIの無料利用分 あと
            {Math.max(0, 50 - apiUsageToday)}回
            {apiUsageToday >= 50 && (
              <span className="text-orange-500 ml-2">
                （以降は従量課金：約1.5円/回）
              </span>
            )}
          </div>
        </div>
        {onGenerateV2 && (
          <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
            <button
              type="submit"
              disabled={isLoading}
              className="flex items-center justify-center px-4 py-3.5 font-bold rounded-xl focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-white transition-all duration-200 ease-in-out disabled:cursor-not-allowed transform hover:scale-105 disabled:scale-100 shadow-md whitespace-nowrap text-sm bg-gradient-to-r from-blue-500 to-blue-600 text-white hover:from-blue-600 hover:to-blue-700 focus:ring-blue-500 disabled:from-blue-300 disabled:to-blue-300"
            >
              {isLoading && activeButton === 'with' ? (
                <>
                  <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  分析中...
                </>
              ) : (
                <>🔍 競合調査あり</>
              )}
            </button>
            {onGenerateV2WithoutResearch && (
              <button
                type="button"
                onClick={handleSubmitV2WithoutResearch}
                disabled={isLoading}
                className="flex items-center justify-center px-4 py-3.5 font-bold rounded-xl focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-white transition-all duration-200 ease-in-out disabled:cursor-not-allowed transform hover:scale-105 disabled:scale-100 shadow-md whitespace-nowrap text-sm bg-gradient-to-r from-emerald-500 to-emerald-600 text-white hover:from-emerald-600 hover:to-emerald-700 focus:ring-emerald-500 disabled:from-emerald-300 disabled:to-emerald-300"
              >
                {isLoading && activeButton === 'without' ? (
                  <>
                    <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    生成中...
                  </>
                ) : (
                  <>📝 競合調査なし</>
                )}
              </button>
            )}
          </div>
        )}
      </form>

      {/* 無料枠超過警告の表示 */}
      {apiUsageWarning && (
        <div className="mt-2 p-3 bg-amber-50 border border-amber-200 rounded-xl">
          <p className="text-sm text-amber-700">{apiUsageWarning}</p>
        </div>
      )}

{/* 開発用テストボタン - コメントアウト
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
        <h3 className="text-amber-700 font-semibold mb-2">開発用テスト</h3>
        <button
          onClick={() => {
            const testArticleData = {
              title: `【2025年最新】${keyword || "テストキーワード"}完全ガイド | 初心者から上級者まで徹底解説`,
              htmlContent: `<h1>${keyword || "テストキーワード"}完全ガイド</h1>...`,
              metaDescription: `${keyword || "テストキーワード"}について、基礎から応用まで幅広くカバーした完全ガイドです。`,
              keyword: keyword || "テストキーワード",
              slug: "test-article-for-image-generation",
              isTestMode: true,
            };
            console.log("🧪 テスト用記事データで画像生成エージェントを起動");
            localStorage.setItem("articleDataForImageGen_5176", JSON.stringify(testArticleData));
            if (onOpenImageAgent) {
              onOpenImageAgent({
                title: testArticleData.title,
                content: testArticleData.htmlContent,
                keyword: testArticleData.keyword,
                autoMode: false,
                metaDescription: testArticleData.metaDescription,
                slug: testArticleData.slug,
                isTestMode: true,
              });
            } else {
              const imageGenUrl = import.meta.env.VITE_IMAGE_GEN_URL || "http://localhost:5177";
              const newWindow = window.open(imageGenUrl, "_blank");
              if (newWindow) {
                setTimeout(() => {
                  newWindow.postMessage({ type: "ARTICLE_DATA", data: testArticleData }, imageGenUrl);
                }, 2000);
              }
            }
          }}
          disabled={isLoading}
          className="w-full px-4 py-2 bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded-lg hover:from-amber-600 hover:to-orange-600 focus:outline-none focus:ring-2 focus:ring-amber-400 transition-all duration-200 ease-in-out disabled:bg-gray-300 disabled:cursor-not-allowed font-medium"
        >
          画像生成テスト（記事作成なし）
        </button>
        <p className="text-xs text-gray-500 mt-2">
          記事作成をスキップして、テスト用データで画像生成エージェントを直接起動します
        </p>
      </div>
      */}
    </div>
  );
};

export default KeywordInputForm;
