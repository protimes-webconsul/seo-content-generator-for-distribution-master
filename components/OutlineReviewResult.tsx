import React, { useState } from 'react';
import type { OutlineReviewResult, ReviewItem } from '../services/outlineReviewService';
import type { SeoOutlineV2 } from '../types';

interface OutlineReviewResultProps {
  result: OutlineReviewResult;
  originalOutline: SeoOutlineV2;
  onAdopt: (revisedOutline: SeoOutlineV2) => void;
  onClose: () => void;
}

const statusIcon = (status: ReviewItem['status']) => {
  if (status === 'ok') return '✅';
  if (status === 'warning') return '⚠️';
  return '❌';
};

const statusColor = (status: ReviewItem['status']) => {
  if (status === 'ok') return 'bg-green-50 border-green-200 text-green-800';
  if (status === 'warning') return 'bg-yellow-50 border-yellow-200 text-yellow-800';
  return 'bg-red-50 border-red-200 text-red-800';
};

const OutlineReviewResultComponent: React.FC<OutlineReviewResultProps> = ({
  result,
  originalOutline,
  onAdopt,
  onClose
}) => {
  const [showRevised, setShowRevised] = useState(false);

  const okCount = result.reviewItems.filter(function(i) { return i.status === 'ok'; }).length;
  const warnCount = result.reviewItems.filter(function(i) { return i.status === 'warning'; }).length;
  const ngCount = result.reviewItems.filter(function(i) { return i.status === 'ng'; }).length;

  return (
    <div className="mt-6 border border-indigo-200 rounded-xl overflow-hidden shadow-md">
      {/* ヘッダー */}
      <div className="bg-indigo-600 text-white px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-xl">🔍</span>
          <h2 className="text-lg font-bold">構成案チェック結果</h2>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <span className="bg-green-500 text-white px-2 py-0.5 rounded-full">✅ {okCount}</span>
          <span className="bg-yellow-400 text-white px-2 py-0.5 rounded-full">⚠️ {warnCount}</span>
          <span className="bg-red-500 text-white px-2 py-0.5 rounded-full">❌ {ngCount}</span>
          <button
            onClick={onClose}
            className="ml-2 text-white hover:text-indigo-200 text-lg font-bold"
          >✕</button>
        </div>
      </div>

      <div className="p-6 bg-white space-y-6">
        {/* 全体コメント */}
        <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-4">
          <p className="text-sm font-semibold text-indigo-700 mb-1">📋 総評</p>
          <p className="text-sm text-indigo-900">{result.overallComment}</p>
        </div>

        {/* 10項目チェック結果 */}
        <div className="space-y-2">
          <h3 className="text-sm font-bold text-gray-700">10項目チェック</h3>
          {result.reviewItems.map(function(item) {
            return (
              <div
                key={item.number}
                className={'border rounded-lg px-4 py-3 ' + statusColor(item.status)}
              >
                <div className="flex items-start gap-2">
                  <span className="text-base mt-0.5">{statusIcon(item.status)}</span>
                  <div>
                    <span className="text-sm font-semibold">
                      {item.number}. {item.title}
                    </span>
                    <p className="text-xs mt-0.5 leading-relaxed">{item.comment}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* 並列表示トグル */}
        <div className="flex gap-3 pt-2 border-t border-gray-200">
          <button
            onClick={function() { setShowRevised(!showRevised); }}
            className="flex-1 py-2.5 bg-indigo-600 text-white rounded-lg font-semibold hover:bg-indigo-700 transition-all text-sm"
          >
            {showRevised ? '▲ 改善案を閉じる' : '▼ 改善済み構成案を表示する'}
          </button>
          {showRevised && (
            <button
              onClick={function() { onAdopt(result.revisedOutline); }}
              className="flex-1 py-2.5 bg-emerald-600 text-white rounded-lg font-semibold hover:bg-emerald-700 transition-all text-sm"
            >
              ✅ この改善案を採用する
            </button>
          )}
        </div>

        {/* 並列表示エリア */}
        {showRevised && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-2">
            {/* 元の構成案 */}
            <div className="border border-gray-200 rounded-xl overflow-hidden">
              <div className="bg-gray-100 px-4 py-2.5 text-sm font-bold text-gray-600">
                📄 元の構成案
              </div>
              <div className="p-4 space-y-3 text-sm text-gray-700 max-h-[600px] overflow-y-auto">
                <p className="font-semibold text-gray-900">{originalOutline.title}</p>
                {originalOutline.outline.map(function(section, i) {
                  return (
                    <div key={i} className="border-l-2 border-gray-300 pl-3">
                      <p className="font-semibold text-gray-800">H2-{i + 1}：{section.heading}</p>
                      {section.writingNote && (
                        <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{section.writingNote}</p>
                      )}
                      {section.subheadings && section.subheadings.length > 0 && (
                        <ul className="mt-1 space-y-0.5">
                          {section.subheadings.map(function(sub, j) {
                            const subText = typeof sub === 'string' ? sub : sub.text;
                            return (
                              <li key={j} className="text-xs text-gray-600 pl-2">
                                └ {subText}
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* 改善済み構成案 */}
            <div className="border border-emerald-200 rounded-xl overflow-hidden">
              <div className="bg-emerald-50 px-4 py-2.5 text-sm font-bold text-emerald-700">
                ✨ 改善済み構成案
              </div>
              <div className="p-4 space-y-3 text-sm text-gray-700 max-h-[600px] overflow-y-auto">
                <p className="font-semibold text-gray-900">{result.revisedOutline.title}</p>
                {result.revisedOutline.outline.map(function(section, i) {
                  return (
                    <div key={i} className="border-l-2 border-emerald-300 pl-3">
                      <p className="font-semibold text-gray-800">H2-{i + 1}：{section.heading}</p>
                      {section.writingNote && (
                        <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{section.writingNote}</p>
                      )}
                      {section.subheadings && section.subheadings.length > 0 && (
                        <ul className="mt-1 space-y-0.5">
                          {section.subheadings.map(function(sub, j) {
                            const subText = typeof sub === 'string' ? sub : sub.text;
                            return (
                              <li key={j} className="text-xs text-gray-600 pl-2">
                                └ {subText}
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default OutlineReviewResultComponent;
