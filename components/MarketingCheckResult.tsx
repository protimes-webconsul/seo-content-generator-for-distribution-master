import React, { useState } from 'react';
import type { MarketingCheckResult, MarketingAxisScore } from '../services/marketingCheckService';

interface MarketingCheckResultProps {
  result: MarketingCheckResult;
  onApply: (improvedHtml: string) => void;
  onClose: () => void;
}

const scoreIcon = (score: MarketingAxisScore['score']) => {
  if (score === 'ok') return '✅';
  if (score === 'warning') return '🟡';
  return '🔴';
};

const scoreBg = (score: MarketingAxisScore['score']) => {
  if (score === 'ok') return 'bg-green-50 border-green-200';
  if (score === 'warning') return 'bg-yellow-50 border-yellow-200';
  return 'bg-red-50 border-red-200';
};

const MarketingCheckResultComponent: React.FC<MarketingCheckResultProps> = ({
  result,
  onApply,
  onClose
}) => {
  const [showImprovedHtml, setShowImprovedHtml] = useState(false);
  const [copied, setCopied] = useState(false);

  const okCount = result.axisScores.filter(function(s) { return s.score === 'ok'; }).length;
  const warnCount = result.axisScores.filter(function(s) { return s.score === 'warning'; }).length;
  const ngCount = result.axisScores.filter(function(s) { return s.score === 'ng'; }).length;

  const handleCopyHtml = () => {
    navigator.clipboard.writeText(result.improvedHtml);
    setCopied(true);
    setTimeout(function() { setCopied(false); }, 2000);
  };

  return (
    <div className="mt-6 border border-orange-200 rounded-xl overflow-hidden shadow-md">
      {/* ヘッダー */}
      <div className="bg-gradient-to-r from-orange-500 to-amber-500 text-white px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-xl">📣</span>
          <h2 className="text-lg font-bold">マーケティングチェック結果</h2>
          <span className="text-sm text-white/80">CTA・まとめの説得力診断</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="bg-green-500 text-white text-xs px-2 py-0.5 rounded-full">✅ {okCount}</span>
          <span className="bg-yellow-400 text-white text-xs px-2 py-0.5 rounded-full">🟡 {warnCount}</span>
          <span className="bg-red-500 text-white text-xs px-2 py-0.5 rounded-full">🔴 {ngCount}</span>
          <button onClick={onClose} className="text-white hover:text-orange-200 text-lg font-bold ml-2">✕</button>
        </div>
      </div>

      <div className="p-6 bg-white space-y-6">

        {/* 5軸スコア表 */}
        <div>
          <h3 className="text-sm font-bold text-gray-700 mb-3">5軸評価</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-gray-50">
                  <th className="text-left px-4 py-2 border border-gray-200 w-8">軸</th>
                  <th className="text-left px-4 py-2 border border-gray-200">評価項目</th>
                  <th className="text-center px-4 py-2 border border-gray-200 w-16">スコア</th>
                  <th className="text-left px-4 py-2 border border-gray-200">判定根拠</th>
                </tr>
              </thead>
              <tbody>
                {result.axisScores.map(function(item, i) {
                  return (
                    <tr key={item.axis} className={'border-b ' + scoreBg(item.score)}>
                      <td className="px-4 py-3 border border-gray-200 text-center text-gray-500 font-mono text-xs">{i + 1}</td>
                      <td className="px-4 py-3 border border-gray-200 font-semibold text-gray-800">{item.label}</td>
                      <td className="px-4 py-3 border border-gray-200 text-center text-lg">{scoreIcon(item.score)}</td>
                      <td className="px-4 py-3 border border-gray-200 text-gray-700 text-xs leading-relaxed">{item.reason}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* 改善メモ */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
            <p className="text-xs font-semibold text-orange-700 mb-1">💡 今回最も効いた改善点</p>
            <p className="text-sm text-orange-900 leading-relaxed">{result.topImprovement}</p>
          </div>
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <p className="text-xs font-semibold text-blue-700 mb-1">📝 次回プロンプトへの追加案</p>
            <p className="text-sm text-blue-900 leading-relaxed">{result.nextPromptSuggestion}</p>
          </div>
        </div>

        {/* 改善HTML */}
        <div className="border-t border-gray-200 pt-4">
          <div className="flex items-center gap-3 mb-3">
            <button
              onClick={function() { setShowImprovedHtml(!showImprovedHtml); }}
              className="flex-1 py-2.5 bg-orange-600 text-white rounded-lg font-semibold hover:bg-orange-700 transition-all text-sm"
            >
              {showImprovedHtml ? '▲ 改善コピーを閉じる' : '▼ 改善済みコピーを表示する（まとめ・CTAのみ）'}
            </button>
            {showImprovedHtml && (
              <>
                <button
                  onClick={handleCopyHtml}
                  className="px-4 py-2.5 bg-gray-600 text-white rounded-lg font-semibold hover:bg-gray-700 transition-all text-sm"
                >
                  {copied ? '✅ コピー済み' : '📋 HTMLコピー'}
                </button>
                <button
                  onClick={function() { onApply(result.improvedHtml); }}
                  className="px-4 py-2.5 bg-emerald-600 text-white rounded-lg font-semibold hover:bg-emerald-700 transition-all text-sm"
                >
                  ✅ 記事に反映する
                </button>
              </>
            )}
          </div>

          {showImprovedHtml && (
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
              <p className="text-xs text-gray-500 mb-2">
                ※ まとめ・CTAセクションのみの改善案です。「記事に反映する」を押すと該当セクションが差し替わります。
              </p>
              <pre className="text-xs text-gray-800 whitespace-pre-wrap overflow-x-auto max-h-96 leading-relaxed">
                {result.improvedHtml}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default MarketingCheckResultComponent;
