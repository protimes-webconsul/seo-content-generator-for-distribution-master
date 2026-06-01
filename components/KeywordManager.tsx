/**
 * KeywordManager.tsx
 * Spreadsheetとキーワード+店舗名を連携して構成案をバッチ生成するUI
 *
 * 機能:
 *  1. Spreadsheet ID を入力して「同期」→ キーワード管理シートから一覧取得
 *  2. チェックボックスで対象行を選択し「構成案を生成」→ 順次生成してSheetに書き戻し
 *  3. タブ名が付いた行の「読み込む」→ SheetからJSONを取得してアウトライン表示に渡す
 */

import React, { useState, useEffect, useCallback } from 'react';
import type { SeoOutlineV2, ClientProfile } from '../types';
import { generateCompetitorResearch } from '../services/competitorResearchWithWebFetch';
import { generateOutlineV2 } from '../services/outlineGeneratorV2';
import { checkAndFixOutline } from '../services/outlineCheckerV2';

// ─────────────────────────────────────────────────────────
// 型定義
// ─────────────────────────────────────────────────────────

interface KeywordItem {
  rowIndex: number;
  keyword: string;
  storeName: string;
  status: string;
  tabName: string;
  memo: string;
}

interface KeywordManagerProps {
  /** Sheetから読み込んだ構成案をメインツールに渡す */
  onOutlineLoaded: (outline: SeoOutlineV2, keyword: string) => void;
  /** 取引先プロフィール（構成案生成ルール適用用） */
  clientProfile?: ClientProfile | null;
}

// ─────────────────────────────────────────────────────────
// ローカルストレージキー
// ─────────────────────────────────────────────────────────

const LS_KEY_SPREADSHEET_ID = 'keywordManager_spreadsheetId';

// ─────────────────────────────────────────────────────────
// API認証ヘッダー（batchService.ts と同じパターン）
// ─────────────────────────────────────────────────────────

const API_KEY = (import.meta as any).env.VITE_INTERNAL_API_KEY || '';

function getHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'x-api-key': API_KEY,
  };
}

// ─────────────────────────────────────────────────────────
// API呼び出しヘルパー
// ─────────────────────────────────────────────────────────

const API_BASE = '/api/outline-batch';

/** レスポンスを安全にJSONパースし、空/非JSONの場合は分かりやすいエラーを投げる */
async function safeJson(res: Response, label: string): Promise<any> {
  const text = await res.text();
  if (!text || text.trim() === '') {
    throw new Error(
      label + ' でサーバーがエラー（HTTP ' + res.status + '、空レスポンス）を返しました。\n' +
      'サーバーログ（ターミナル）でエラー詳細を確認してください。'
    );
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(
      label + ' でサーバーが不正なレスポンス（HTTP ' + res.status + '）を返しました。\n' +
      'サーバーログを確認してください。先頭100文字: ' + text.slice(0, 100)
    );
  }
}

async function apiSync(spreadsheetId: string): Promise<KeywordItem[]> {
  const res = await fetch(
    API_BASE + '/sync?spreadsheetId=' + encodeURIComponent(spreadsheetId),
    { headers: getHeaders() }
  );
  const data = await safeJson(res, '同期');
  if (!res.ok) throw new Error(data.error || '同期に失敗しました（HTTP ' + res.status + '）');
  return data.items as KeywordItem[];
}

async function apiWriteBack(
  spreadsheetId: string,
  keyword: string,
  storeName: string,
  rowIndex: number,
  outline: SeoOutlineV2
): Promise<string> {
  const res = await fetch(API_BASE + '/write-back', {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({ spreadsheetId, keyword, storeName, rowIndex, outline }),
  });
  const data = await safeJson(res, '書き込み');
  if (!res.ok) throw new Error(data.error || '書き込みに失敗しました（HTTP ' + res.status + '）');
  return data.tabName as string;
}

async function apiReadOutline(spreadsheetId: string, tabName: string): Promise<SeoOutlineV2> {
  const res = await fetch(
    API_BASE + '/read-outline?spreadsheetId=' + encodeURIComponent(spreadsheetId) +
    '&tabName=' + encodeURIComponent(tabName),
    { headers: getHeaders() }
  );
  const data = await safeJson(res, '読み込み');
  if (!res.ok) throw new Error(data.error || '読み込みに失敗しました（HTTP ' + res.status + '）');
  return data.outline as SeoOutlineV2;
}

// ─────────────────────────────────────────────────────────
// メインコンポーネント
// ─────────────────────────────────────────────────────────

const KeywordManager: React.FC<KeywordManagerProps> = ({ onOutlineLoaded, clientProfile }) => {
  const [spreadsheetId, setSpreadsheetId] = useState<string>('');
  const [keywords, setKeywords] = useState<KeywordItem[]>([]);
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
  const [isSyncing, setIsSyncing] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatingKeyword, setGeneratingKeyword] = useState('');
  const [generatingStep, setGeneratingStep] = useState('');
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [syncError, setSyncError] = useState('');
  const [generateError, setGenerateError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [loadingTabName, setLoadingTabName] = useState('');

  // 起動時にSpreadsheet IDをlocalStorageから復元
  useEffect(function() {
    const saved = localStorage.getItem(LS_KEY_SPREADSHEET_ID);
    if (saved) setSpreadsheetId(saved);
  }, []);

  // Spreadsheet IDの変更をlocalStorageに保存
  const handleSpreadsheetIdChange = useCallback(function(value: string) {
    setSpreadsheetId(value);
    localStorage.setItem(LS_KEY_SPREADSHEET_ID, value);
  }, []);

  // ──────────────────────────────
  // 同期ボタン
  // ──────────────────────────────
  const handleSync = useCallback(async function() {
    if (!spreadsheetId.trim()) {
      setSyncError('Spreadsheet IDを入力してください。');
      return;
    }
    setIsSyncing(true);
    setSyncError('');
    setSuccessMessage('');
    try {
      const items = await apiSync(spreadsheetId.trim());
      setKeywords(items);
      setSelectedRows(new Set());
      if (items.length === 0) {
        setSuccessMessage('「キーワード管理」シートにデータがありません。A列にキーワード、B列に店舗名を入力してください。');
      } else {
        setSuccessMessage(items.length + '件のキーワードを同期しました。');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : '同期に失敗しました';
      setSyncError(msg);
    } finally {
      setIsSyncing(false);
    }
  }, [spreadsheetId]);

  // ──────────────────────────────
  // チェックボックス操作
  // ──────────────────────────────
  const toggleRow = useCallback(function(rowIndex: number) {
    setSelectedRows(function(prev) {
      const next = new Set(prev);
      if (next.has(rowIndex)) {
        next.delete(rowIndex);
      } else {
        next.add(rowIndex);
      }
      return next;
    });
  }, []);

  const toggleAll = useCallback(function() {
    if (selectedRows.size === keywords.length) {
      setSelectedRows(new Set());
    } else {
      setSelectedRows(new Set(keywords.map(function(k) { return k.rowIndex; })));
    }
  }, [keywords, selectedRows.size]);

  // ──────────────────────────────
  // 構成案の一括生成
  // ──────────────────────────────
  const handleGenerate = useCallback(async function() {
    if (selectedRows.size === 0) {
      setGenerateError('生成する行を選択してください。');
      return;
    }
    if (!spreadsheetId.trim()) {
      setGenerateError('Spreadsheet IDを入力してください。');
      return;
    }

    const targets = keywords.filter(function(k) { return selectedRows.has(k.rowIndex); });

    setIsGenerating(true);
    setGenerateError('');
    setSuccessMessage('');
    setProgress({ current: 0, total: targets.length });

    let successCount = 0;
    const errors: string[] = [];

    for (let i = 0; i < targets.length; i++) {
      const item = targets[i];
      setGeneratingKeyword(item.keyword + (item.storeName ? '（' + item.storeName + '）' : ''));
      setProgress({ current: i + 1, total: targets.length });

      try {
        // STEP 1: 競合調査
        setGeneratingStep('競合サイトを分析中...');
        const research = await generateCompetitorResearch(
          item.keyword,
          function() {},
          true
        );

        // STEP 2: 構成案生成
        setGeneratingStep('構成案を生成中...');
        const rawOutline = await generateOutlineV2(
          item.keyword,
          research,
          false,
          true, // 導入文2パターン
          undefined,
          clientProfile || undefined
        );

        // STEP 3: 構成チェック
        setGeneratingStep('構成をチェック中...');
        const { finalOutline } = await checkAndFixOutline(rawOutline, item.keyword, research);

        // STEP 4: Sheetに書き込み
        setGeneratingStep('Spreadsheetに書き込み中...');
        const tabName = await apiWriteBack(
          spreadsheetId.trim(),
          item.keyword,
          item.storeName,
          item.rowIndex,
          finalOutline
        );

        // ローカル状態を更新
        setKeywords(function(prev) {
          return prev.map(function(k) {
            if (k.rowIndex === item.rowIndex) {
              return Object.assign({}, k, { status: '処理済み', tabName: tabName });
            }
            return k;
          });
        });

        successCount++;
        console.log('✅ 構成案生成完了:', item.keyword, '→ タブ:', tabName);
      } catch (err) {
        const msg = err instanceof Error ? err.message : '不明なエラー';
        errors.push(item.keyword + ': ' + msg);
        console.error('❌ 構成案生成失敗:', item.keyword, err);
      }
    }

    setIsGenerating(false);
    setGeneratingKeyword('');
    setGeneratingStep('');

    if (errors.length === 0) {
      setSuccessMessage(successCount + '件の構成案を生成してSpreadsheetに書き込みました。');
    } else {
      setSuccessMessage(successCount + '件成功。');
      setGenerateError('失敗: ' + errors.join(' / '));
    }
    setSelectedRows(new Set());
  }, [keywords, selectedRows, spreadsheetId, clientProfile]);

  // ──────────────────────────────
  // Sheetから構成案を読み込む
  // ──────────────────────────────
  const handleLoadFromSheet = useCallback(async function(item: KeywordItem) {
    if (!item.tabName) return;
    setLoadingTabName(item.tabName);
    setSyncError('');
    try {
      const outline = await apiReadOutline(spreadsheetId.trim(), item.tabName);
      onOutlineLoaded(outline, item.keyword);
      setSuccessMessage('「' + item.tabName + '」の構成案を読み込みました。「構成案」タブを確認してください。');
    } catch (err) {
      const msg = err instanceof Error ? err.message : '読み込みに失敗しました';
      setSyncError(msg);
    } finally {
      setLoadingTabName('');
    }
  }, [spreadsheetId, onOutlineLoaded]);

  // ─────────────────────────────────────────────────────────
  // レンダリング
  // ─────────────────────────────────────────────────────────

  const selectedCount = selectedRows.size;
  const unprocessedCount = keywords.filter(function(k) { return k.status !== '処理済み'; }).length;

  return (
    <div className="space-y-6">
      {/* ヘッダー */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
        <h2 className="text-xl font-bold text-gray-800 mb-1">📊 キーワード管理（Spreadsheet連携）</h2>
        <p className="text-sm text-gray-500">
          Googleスプレッドシートのキーワードリストをもとに構成案を一括生成し、結果を同じシートに書き戻します。
        </p>
      </div>

      {/* Spreadsheet ID入力 */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">🔗 Spreadsheet設定</h3>
        <div className="flex gap-3 items-start">
          <div className="flex-1">
            <label className="block text-xs text-gray-500 mb-1">
              SpreadsheetのID（URLの /d/ と /edit の間の部分）
            </label>
            <input
              type="text"
              value={spreadsheetId}
              onChange={function(e) { handleSpreadsheetIdChange(e.target.value); }}
              placeholder="例: 1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms"
              className="w-full border border-gray-300 rounded-lg px-4 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
            <p className="mt-1 text-xs text-gray-400">
              シート名「キーワード管理」が必要です（A: キーワード / B: 店舗名 / C: ステータス / D: タブ名 / E: メモ）
            </p>
          </div>
          <button
            onClick={handleSync}
            disabled={isSyncing || !spreadsheetId.trim()}
            className="mt-5 px-5 py-2 bg-blue-500 text-white rounded-lg font-semibold text-sm hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            {isSyncing ? '⏳ 同期中...' : '🔄 同期'}
          </button>
        </div>

        {syncError && (
          <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            ❌ {syncError}
          </div>
        )}
        {successMessage && (
          <div className="mt-3 p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700">
            ✅ {successMessage}
          </div>
        )}
      </div>

      {/* キーワード一覧 */}
      {keywords.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-gray-700">
              📋 キーワード一覧（{keywords.length}件 / 未処理: {unprocessedCount}件）
            </h3>
            <div className="flex gap-2">
              <button
                onClick={toggleAll}
                className="text-xs px-3 py-1.5 border border-gray-300 rounded hover:bg-gray-50 text-gray-600"
              >
                {selectedRows.size === keywords.length ? '全解除' : '全選択'}
              </button>
              <button
                onClick={handleGenerate}
                disabled={isGenerating || selectedCount === 0}
                className="px-4 py-1.5 bg-indigo-500 text-white rounded-lg font-semibold text-sm hover:bg-indigo-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                {isGenerating
                  ? '⏳ 生成中...'
                  : '🚀 構成案を生成 ' + (selectedCount > 0 ? '（' + selectedCount + '件）' : '')}
              </button>
            </div>
          </div>

          {/* 生成中プログレス */}
          {isGenerating && (
            <div className="mb-4 p-4 bg-indigo-50 border border-indigo-200 rounded-lg">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-semibold text-indigo-700">
                  {progress.current}/{progress.total} — {generatingKeyword}
                </span>
                <span className="text-xs text-indigo-500">{generatingStep}</span>
              </div>
              <div className="w-full bg-indigo-100 rounded-full h-2">
                <div
                  className="bg-indigo-500 h-2 rounded-full transition-all duration-500"
                  style={{ width: progress.total > 0 ? (progress.current / progress.total * 100) + '%' : '0%' }}
                />
              </div>
            </div>
          )}

          {generateError && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              ❌ {generateError}
            </div>
          )}

          {/* テーブル */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="text-left py-2 px-3 font-medium text-gray-600 w-10">
                    <input
                      type="checkbox"
                      checked={selectedRows.size === keywords.length && keywords.length > 0}
                      onChange={toggleAll}
                      className="rounded"
                    />
                  </th>
                  <th className="text-left py-2 px-3 font-medium text-gray-600">キーワード</th>
                  <th className="text-left py-2 px-3 font-medium text-gray-600">店舗名</th>
                  <th className="text-left py-2 px-3 font-medium text-gray-600">ステータス</th>
                  <th className="text-left py-2 px-3 font-medium text-gray-600">構成案タブ</th>
                  <th className="text-left py-2 px-3 font-medium text-gray-600">操作</th>
                </tr>
              </thead>
              <tbody>
                {keywords.map(function(item) {
                  const isSelected = selectedRows.has(item.rowIndex);
                  const isDone = item.status === '処理済み';
                  const isLoadingThis = loadingTabName === item.tabName && item.tabName !== '';

                  return (
                    <tr
                      key={item.rowIndex}
                      className={'border-b border-gray-100 hover:bg-gray-50 ' + (isSelected ? 'bg-blue-50' : '')}
                    >
                      <td className="py-2 px-3">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={function() { toggleRow(item.rowIndex); }}
                          className="rounded"
                        />
                      </td>
                      <td className="py-2 px-3 font-medium text-gray-800">{item.keyword}</td>
                      <td className="py-2 px-3 text-gray-600">{item.storeName || '—'}</td>
                      <td className="py-2 px-3">
                        <span className={
                          'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ' +
                          (isDone
                            ? 'bg-green-100 text-green-700'
                            : item.status === '処理中'
                            ? 'bg-yellow-100 text-yellow-700'
                            : 'bg-gray-100 text-gray-600')
                        }>
                          {isDone ? '✅ ' : item.status === '処理中' ? '⏳ ' : '○ '}
                          {item.status}
                        </span>
                      </td>
                      <td className="py-2 px-3 text-xs text-gray-500 font-mono">
                        {item.tabName || '—'}
                      </td>
                      <td className="py-2 px-3">
                        {item.tabName ? (
                          <button
                            onClick={function() { handleLoadFromSheet(item); }}
                            disabled={isLoadingThis || isGenerating}
                            className="px-3 py-1 bg-emerald-500 text-white rounded text-xs font-medium hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                          >
                            {isLoadingThis ? '⏳ 読込中...' : '📥 読み込む'}
                          </button>
                        ) : (
                          <span className="text-xs text-gray-400">未生成</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 使い方ガイド */}
      {keywords.length === 0 && !isSyncing && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-6">
          <h3 className="text-sm font-semibold text-amber-800 mb-3">📖 使い方</h3>
          <ol className="space-y-2 text-sm text-amber-700 list-decimal list-inside">
            <li>
              GoogleスプレッドシートにシートTAB「<strong>キーワード管理</strong>」を作成
            </li>
            <li>
              1行目にヘッダー（A: キーワード / B: 店舗名 / C: ステータス / D: タブ名 / E: メモ）
            </li>
            <li>2行目以降にキーワードと店舗名を入力</li>
            <li>上の入力欄にSpreadsheet IDを貼り付けて「🔄 同期」をクリック</li>
            <li>生成したい行にチェックを入れて「🚀 構成案を生成」をクリック</li>
            <li>生成完了後、同じSpreadsheetに新規タブとして構成案が書き込まれます</li>
            <li>SpreadsheetでテキストをDirect編集後、「📥 読み込む」でツールに反映できます</li>
          </ol>
          <div className="mt-4 p-3 bg-amber-100 rounded-lg text-xs text-amber-700">
            <strong>📌 注意:</strong> SpreadsheetはサービスアカウントまたはgcloudのADC認証で
            閲覧・編集権限が必要です。サーバーログで認証エラーが出る場合は
            <code className="mx-1 font-mono bg-amber-200 px-1 rounded">gcloud auth application-default login</code>
            を再実行してください。
          </div>
        </div>
      )}
    </div>
  );
};

export default KeywordManager;
