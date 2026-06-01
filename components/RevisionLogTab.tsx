import React, { useState, useEffect } from "react";
import {
  getRevisionLogs,
  clearRevisionLogs,
  exportRevisionLogsCsv,
  type RevisionLogEntry,
} from "../services/revisionLogService";

const RevisionLogTab: React.FC = () => {
  const [logs, setLogs] = useState<RevisionLogEntry[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(function () {
    setLogs(getRevisionLogs());
  }, []);

  function handleClear() {
    if (!window.confirm("修正ログをすべて削除しますか？この操作は取り消せません。")) {
      return;
    }
    clearRevisionLogs();
    setLogs([]);
  }

  function handleExportCsv() {
    exportRevisionLogsCsv();
  }

  function toggleExpand(id: string) {
    setExpandedId(expandedId === id ? null : id);
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold text-gray-800">修正ログ</h2>
          <p className="text-sm text-gray-500 mt-1">
            ClaudeProject での最終チェック後にインポートした修正内容の履歴です。
            定期的に CSV エクスポートしてプロンプト改善の参考にしてください。
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleExportCsv}
            disabled={logs.length === 0}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm rounded-lg transition-colors disabled:opacity-40"
          >
            CSV エクスポート
          </button>
          <button
            onClick={handleClear}
            disabled={logs.length === 0}
            className="px-4 py-2 bg-red-100 hover:bg-red-200 text-red-700 text-sm rounded-lg transition-colors disabled:opacity-40"
          >
            全削除
          </button>
        </div>
      </div>

      {logs.length === 0 ? (
        <div className="text-center py-16 bg-gray-50 rounded-xl border-2 border-dashed border-gray-200">
          <p className="text-gray-400 text-lg">修正ログがありません</p>
          <p className="text-gray-400 text-sm mt-2">
            最終校閲完了後に「修正済み記事インポート」を行うとここに記録されます。
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-gray-500">{logs.length} 件のログ</p>
          {logs.map(function (entry) {
            const isExpanded = expandedId === entry.id;
            const dateStr = new Date(entry.date).toLocaleString("ja-JP", {
              timeZone: "Asia/Tokyo",
              year: "numeric",
              month: "2-digit",
              day: "2-digit",
              hour: "2-digit",
              minute: "2-digit",
            });
            return (
              <div
                key={entry.id}
                className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden"
              >
                <div
                  className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-gray-50"
                  onClick={function () {
                    toggleExpand(entry.id);
                  }}
                >
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-gray-400 w-36 shrink-0">
                      {dateStr}
                    </span>
                    <span className="font-medium text-gray-800 text-sm">
                      {entry.keyword}
                    </span>
                    {entry.clientName && (
                      <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded">
                        {entry.clientName}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <span
                      className={`text-xs font-semibold px-2 py-1 rounded-full ${
                        entry.modificationCount === 0
                          ? "bg-green-100 text-green-700"
                          : entry.modificationCount <= 3
                          ? "bg-amber-100 text-amber-700"
                          : "bg-red-100 text-red-700"
                      }`}
                    >
                      {entry.modificationCount} 件修正
                    </span>
                    <span className="text-gray-400 text-xs">
                      {isExpanded ? "▲" : "▼"}
                    </span>
                  </div>
                </div>
                {isExpanded && entry.reportText && (
                  <div className="px-4 pb-4 border-t border-gray-100">
                    <pre className="mt-3 text-xs text-gray-600 whitespace-pre-wrap bg-gray-50 rounded-lg p-3 leading-relaxed">
                      {entry.reportText}
                    </pre>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default RevisionLogTab;
