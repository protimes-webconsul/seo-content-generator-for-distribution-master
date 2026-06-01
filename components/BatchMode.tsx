import React, { useState, useRef } from 'react';
import type { BatchQueueItem } from '../services/batchService';
import { fetchBatchQueue, updateBatchRow, formatNow } from '../services/batchService';
import { fetchSavedArticleById } from '../services/articleStorageService';
import { downloadExportFile, generateExportMarkdown } from '../services/articleExportService';

// ────────────────────────────────────────────────
// File System Access API 型宣言（ブラウザネイティブ / @types 未収録）
// ────────────────────────────────────────────────
interface FSFileHandle {
  createWritable(): Promise<FSWritable>;
}
interface FSWritable {
  write(data: string): Promise<void>;
  close(): Promise<void>;
}
interface FSDirHandle {
  name: string;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FSFileHandle>;
}

// ────────────────────────────────────────────────
// localStorage 履歴 型定義
// ────────────────────────────────────────────────
export interface BatchHistoryItem {
  keyword: string;
  clientName: string;
  status: 'done' | 'error';
  articleId?: string;      // UUID → fetchSavedArticleById で再取得可能
  savedFileName?: string;  // 保存済みファイル名（表示用）
  errorMessage?: string;
}

export interface BatchSession {
  sessionId: string;
  date: string;          // YYYYMMDD
  startedAt: string;     // ISO
  completedAt?: string;  // ISO
  doneCount: number;
  errorCount: number;
  items: BatchHistoryItem[];
}

const HISTORY_KEY = 'batch_session_history';
const MAX_HISTORY = 50;

function loadHistory(): BatchSession[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as BatchSession[];
  } catch (e) {
    return [];
  }
}

function persistHistory(sessions: BatchSession[]): void {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(sessions.slice(0, MAX_HISTORY)));
  } catch (e) {
    console.warn('⚠️ 履歴保存失敗:', e);
  }
}

function buildSafeFileName(date: string, clientName: string, keyword: string): string {
  const safeClient = (clientName || '未選択').replace(/[\s\/\\:*?"<>|]/g, '').slice(0, 20);
  const safeKw = (keyword || '').replace(/[\s\/\\:*?"<>|]/g, '').slice(0, 30);
  return date + '_' + safeClient + '_' + safeKw + '.md';
}

function generateSessionId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function todayStr(): string {
  const d = new Date();
  return d.getFullYear().toString()
    + String(d.getMonth() + 1).padStart(2, '0')
    + String(d.getDate()).padStart(2, '0');
}

// ────────────────────────────────────────────────
// コンポーネント型定義
// ────────────────────────────────────────────────
export interface BatchItemState extends BatchQueueItem {
  uiStatus: 'waiting' | 'running' | 'done' | 'error';
  resultFileName?: string;
  errorMessage?: string;
}

interface BatchModeProps {
  /** 1キーワードを処理するコールバック。完了時に{ title, fileName: UUID }を返す */
  onProcessItem: (item: BatchQueueItem) => Promise<{ title: string; fileName: string }>;
}

// ────────────────────────────────────────────────
// メインコンポーネント
// ────────────────────────────────────────────────
const BatchMode: React.FC<BatchModeProps> = ({ onProcessItem }) => {
  const [items, setItems] = useState<BatchItemState[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);
  const [isFetching, setIsFetching] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [completedCount, setCompletedCount] = useState(0);

  // フォルダ選択
  const isFSSupported = typeof (window as any).showDirectoryPicker === 'function';
  const [dirHandle, setDirHandle] = useState<FSDirHandle | null>(null);
  const [folderName, setFolderName] = useState<string>('');
  const [isSavingFiles, setIsSavingFiles] = useState(false);
  const [saveProgressCurrent, setSaveProgressCurrent] = useState(0);
  const [saveProgressTotal, setSaveProgressTotal] = useState(0);

  // 手動一括DL（フォルダ未選択時のフォールバック）
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);

  // 履歴
  const [history, setHistory] = useState<BatchSession[]>(function() { return loadHistory(); });
  const [expandedSessionId, setExpandedSessionId] = useState<string | null>(null);
  const [reDownloading, setReDownloading] = useState<string | null>(null);

  const shouldStopRef = useRef(false);

  // ────────────────────────────────────────────────
  // フォルダ選択
  // ────────────────────────────────────────────────
  const handleSelectFolder = async () => {
    try {
      const handle: FSDirHandle = await (window as any).showDirectoryPicker({ mode: 'readwrite' });
      setDirHandle(handle);
      setFolderName(handle.name);
    } catch (e) {
      if ((e as any).name !== 'AbortError') {
        console.error('フォルダ選択エラー:', e);
      }
    }
  };

  // ────────────────────────────────────────────────
  // フォルダへの1ファイル書き込み
  // ────────────────────────────────────────────────
  const writeFileToDir = async (handle: FSDirHandle, filename: string, content: string): Promise<void> => {
    const fileHandle = await handle.getFileHandle(filename, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(content);
    await writable.close();
  };

  // ────────────────────────────────────────────────
  // キューを取得して表示
  // ────────────────────────────────────────────────
  const handleFetchQueue = async () => {
    setIsFetching(true);
    setFetchError(null);
    try {
      const queueItems = await fetchBatchQueue();
      const states: BatchItemState[] = queueItems.map(function(item) {
        return Object.assign({}, item, { uiStatus: 'waiting' as const });
      });
      setItems(states);
      setCompletedCount(0);
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : 'キューの取得に失敗しました');
    } finally {
      setIsFetching(false);
    }
  };

  // ────────────────────────────────────────────────
  // 1件を処理するヘルパー（成功: articleId(UUID) / 失敗: null）
  // ────────────────────────────────────────────────
  const processOneItem = async (item: BatchItemState): Promise<string | null> => {
    setItems(function(prev) {
      return prev.map(function(it) {
        return it.rowIndex === item.rowIndex
          ? Object.assign({}, it, { uiStatus: 'running' as const, errorMessage: undefined })
          : it;
      });
    });

    try {
      await updateBatchRow({ rowIndex: item.rowIndex, status: '処理中' });
    } catch (err) {
      console.warn('⚠️ ステータス更新失敗（続行）:', err);
    }

    try {
      const result = await onProcessItem(item);
      const dateStr = formatNow();

      await updateBatchRow({
        rowIndex: item.rowIndex,
        status: '完了',
        date: dateStr,
        fileName: result.fileName,
      });

      setItems(function(prev) {
        return prev.map(function(it) {
          return it.rowIndex === item.rowIndex
            ? Object.assign({}, it, { uiStatus: 'done' as const, resultFileName: result.fileName })
            : it;
        });
      });

      setCompletedCount(function(c) { return c + 1; });
      console.log('✅ 完了:', item.keyword, '→ id:', result.fileName);
      return result.fileName; // UUID

    } catch (err) {
      const errMsg = err instanceof Error ? err.message : '不明なエラー';
      console.error('❌ エラー:', item.keyword, errMsg);

      try {
        await updateBatchRow({
          rowIndex: item.rowIndex,
          status: 'エラー',
          date: formatNow(),
          memo: errMsg.slice(0, 100),
        });
      } catch (updateErr) {
        console.warn('⚠️ エラーステータス更新失敗:', updateErr);
      }

      setItems(function(prev) {
        return prev.map(function(it) {
          return it.rowIndex === item.rowIndex
            ? Object.assign({}, it, { uiStatus: 'error' as const, errorMessage: errMsg })
            : it;
        });
      });

      return null;
    }
  };

  // ────────────────────────────────────────────────
  // バッチ開始
  // フェーズ1: 待機分処理
  // フェーズ2: エラー分リトライ（1回）
  // フェーズ3: フォルダへ自動保存
  // フェーズ4: localStorage に履歴保存
  // ────────────────────────────────────────────────
  const handleStart = async () => {
    if (items.length === 0) return;
    shouldStopRef.current = false;
    setIsRunning(true);
    setIsRetrying(false);
    setCompletedCount(0);

    const sessionId = generateSessionId();
    const dateStr = todayStr();
    const startedAt = new Date().toISOString();

    // ローカル追跡: rowIndex → { item, articleId | null, errorMessage }
    type LocalResult = { item: BatchItemState; articleId: string | null; errorMessage?: string };
    const localResults: Array<LocalResult> = [];

    // ── フェーズ1: 待機中アイテムを順番に処理 ──
    const waitingItems = items.filter(function(it) { return it.uiStatus === 'waiting'; });
    const failedItems: BatchItemState[] = [];

    for (let i = 0; i < waitingItems.length; i++) {
      if (shouldStopRef.current) {
        console.log('⏹ 一斉作成を中止しました');
        break;
      }

      const item = waitingItems[i];
      const articleId = await processOneItem(item);

      localResults.push({ item: item, articleId: articleId, errorMessage: articleId === null ? '処理エラー' : undefined });

      if (articleId === null) {
        failedItems.push(item);
      }

      if (i < waitingItems.length - 1 && !shouldStopRef.current) {
        await new Promise(function(resolve) { setTimeout(resolve, 3000); });
      }
    }

    // ── フェーズ2: エラー分を自動リトライ（1回のみ） ──
    if (failedItems.length > 0 && !shouldStopRef.current) {
      setIsRetrying(true);
      console.log('🔄 エラー分リトライ開始（' + failedItems.length + '件）。5秒後に再実行します...');

      await new Promise(function(resolve) { setTimeout(resolve, 5000); });

      for (let i = 0; i < failedItems.length; i++) {
        if (shouldStopRef.current) break;

        const item = failedItems[i];
        const articleId = await processOneItem(item);

        // localResults の該当エントリを上書き
        for (let j = 0; j < localResults.length; j++) {
          if (localResults[j].item.rowIndex === item.rowIndex) {
            localResults[j] = { item: item, articleId: articleId, errorMessage: articleId === null ? 'リトライ後もエラー' : undefined };
            break;
          }
        }

        if (i < failedItems.length - 1 && !shouldStopRef.current) {
          await new Promise(function(resolve) { setTimeout(resolve, 3000); });
        }
      }

      setIsRetrying(false);
      console.log('🔄 リトライ完了');
    }

    // ── フェーズ3: フォルダへの自動保存 ──
    const historyItems: BatchHistoryItem[] = [];
    const currentDirHandle = dirHandle; // クロージャで保持

    if (currentDirHandle && !shouldStopRef.current) {
      setIsSavingFiles(true);
      const doneResults = localResults.filter(function(r) { return r.articleId !== null; });
      setSaveProgressCurrent(0);
      setSaveProgressTotal(doneResults.length);

      for (let i = 0; i < doneResults.length; i++) {
        const r = doneResults[i];
        if (!r.articleId) continue;

        setSaveProgressCurrent(i + 1);
        let savedFileName: string | undefined = undefined;

        try {
          const savedArticle = await fetchSavedArticleById(r.articleId);
          if (savedArticle.article) {
            const mdContent = generateExportMarkdown({
              keyword: savedArticle.keyword,
              clientName: savedArticle.clientName || undefined,
              articleTitle: savedArticle.article.title,
              metaDescription: savedArticle.article.metaDescription || undefined,
              articleHtml: savedArticle.article.htmlContent,
            });
            const filename = buildSafeFileName(dateStr, r.item.clientName || '', r.item.keyword);
            await writeFileToDir(currentDirHandle, filename, mdContent);
            savedFileName = filename;
            console.log('📁 自動保存:', filename);
          }
        } catch (e) {
          console.warn('⚠️ 自動保存失敗:', r.item.keyword, e);
        }

        historyItems.push({
          keyword: r.item.keyword,
          clientName: r.item.clientName || '',
          status: 'done',
          articleId: r.articleId,
          savedFileName: savedFileName,
        });
      }

      // エラー分も履歴に追加
      const errorResults = localResults.filter(function(r) { return r.articleId === null; });
      for (let i = 0; i < errorResults.length; i++) {
        const r = errorResults[i];
        historyItems.push({
          keyword: r.item.keyword,
          clientName: r.item.clientName || '',
          status: 'error',
          errorMessage: r.errorMessage,
        });
      }

      setIsSavingFiles(false);

    } else {
      // フォルダ未選択でも履歴情報は保存
      for (let i = 0; i < localResults.length; i++) {
        const r = localResults[i];
        historyItems.push({
          keyword: r.item.keyword,
          clientName: r.item.clientName || '',
          status: r.articleId !== null ? 'done' : 'error',
          articleId: r.articleId || undefined,
          errorMessage: r.errorMessage,
        });
      }
    }

    // ── フェーズ4: localStorage に履歴保存 ──
    const doneCount = historyItems.filter(function(it) { return it.status === 'done'; }).length;
    const errorCount = historyItems.filter(function(it) { return it.status === 'error'; }).length;

    if (historyItems.length > 0) {
      const newSession: BatchSession = {
        sessionId: sessionId,
        date: dateStr,
        startedAt: startedAt,
        completedAt: new Date().toISOString(),
        doneCount: doneCount,
        errorCount: errorCount,
        items: historyItems,
      };

      setHistory(function(prev) {
        const updated = [newSession].concat(prev);
        persistHistory(updated);
        return updated;
      });
    }

    setIsRunning(false);
  };

  // ────────────────────────────────────────────────
  // 停止
  // ────────────────────────────────────────────────
  const handleStop = () => {
    shouldStopRef.current = true;
    console.log('⏹ 停止リクエスト送信（現在の処理完了後に停止）');
  };

  // ────────────────────────────────────────────────
  // 手動一括DL（フォルダ未選択時のフォールバック）
  // ────────────────────────────────────────────────
  const handleBulkDownload = async () => {
    const doneItems = items.filter(function(it) {
      return it.uiStatus === 'done' && it.resultFileName;
    });
    if (doneItems.length === 0) return;

    setIsDownloading(true);
    setDownloadProgress(0);

    for (let i = 0; i < doneItems.length; i++) {
      const item = doneItems[i];
      try {
        const savedArticle = await fetchSavedArticleById(item.resultFileName as string);
        if (savedArticle.article) {
          downloadExportFile({
            keyword: savedArticle.keyword,
            clientName: savedArticle.clientName || undefined,
            articleTitle: savedArticle.article.title,
            metaDescription: savedArticle.article.metaDescription || undefined,
            articleHtml: savedArticle.article.htmlContent,
          });
          await new Promise(function(resolve) { setTimeout(resolve, 600); });
        }
      } catch (err) {
        console.warn('⚠️ ダウンロード失敗:', item.keyword, err);
      }
      setDownloadProgress(i + 1);
    }

    setIsDownloading(false);
  };

  // ────────────────────────────────────────────────
  // 履歴セッションの再DL / 再保存
  // ────────────────────────────────────────────────
  const handleReDownloadSession = async (session: BatchSession) => {
    const doneItems = session.items.filter(function(it) {
      return it.status === 'done' && it.articleId;
    });
    if (doneItems.length === 0) return;

    setReDownloading(session.sessionId);

    for (let i = 0; i < doneItems.length; i++) {
      const histItem = doneItems[i];
      if (!histItem.articleId) continue;

      try {
        const savedArticle = await fetchSavedArticleById(histItem.articleId);
        if (savedArticle.article) {
          const mdContent = generateExportMarkdown({
            keyword: savedArticle.keyword,
            clientName: savedArticle.clientName || undefined,
            articleTitle: savedArticle.article.title,
            metaDescription: savedArticle.article.metaDescription || undefined,
            articleHtml: savedArticle.article.htmlContent,
          });

          if (dirHandle) {
            // フォルダ選択済み → 直接書き込み
            const filename = histItem.savedFileName || buildSafeFileName(session.date, histItem.clientName, histItem.keyword);
            await writeFileToDir(dirHandle, filename, mdContent);
            console.log('📁 再保存:', filename);
          } else {
            // フォルダ未選択 → ブラウザDL
            downloadExportFile({
              keyword: savedArticle.keyword,
              clientName: savedArticle.clientName || undefined,
              articleTitle: savedArticle.article.title,
              metaDescription: savedArticle.article.metaDescription || undefined,
              articleHtml: savedArticle.article.htmlContent,
            });
            await new Promise(function(resolve) { setTimeout(resolve, 600); });
          }
        }
      } catch (e) {
        console.warn('⚠️ 再DL失敗:', histItem.keyword, e);
      }
    }

    setReDownloading(null);
  };

  // ────────────────────────────────────────────────
  // ステータスバッジ
  // ────────────────────────────────────────────────
  const StatusBadge: React.FC<{ status: BatchItemState['uiStatus'] }> = ({ status }) => {
    if (status === 'waiting') {
      return <span className="text-xs px-2 py-0.5 bg-gray-100 text-gray-500 rounded-full">待機中</span>;
    }
    if (status === 'running') {
      return (
        <span className="text-xs px-2 py-0.5 bg-blue-100 text-blue-600 rounded-full flex items-center gap-1">
          <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          {isRetrying ? 'リトライ中' : '処理中'}
        </span>
      );
    }
    if (status === 'done') {
      return <span className="text-xs px-2 py-0.5 bg-green-100 text-green-600 rounded-full">✅ 完了</span>;
    }
    if (isRetrying) {
      return <span className="text-xs px-2 py-0.5 bg-orange-100 text-orange-600 rounded-full">🔄 リトライ待機</span>;
    }
    return <span className="text-xs px-2 py-0.5 bg-red-100 text-red-600 rounded-full">❌ エラー</span>;
  };

  // 集計
  const waitingCount = items.filter(function(it) { return it.uiStatus === 'waiting'; }).length;
  const doneCount    = items.filter(function(it) { return it.uiStatus === 'done'; }).length;
  const errorCount   = items.filter(function(it) { return it.uiStatus === 'error'; }).length;
  const totalCount   = items.length;

  return (
    <div className="mt-6 space-y-4">

      {/* ヘッダー */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-gray-800">📋 一斉作成</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            スプレッドシートの「記事生成キュー」シートから「待機中」の行を順番に処理します
          </p>
        </div>
        <button
          onClick={handleFetchQueue}
          disabled={isFetching || isRunning}
          className="px-4 py-2 text-sm bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg border border-gray-200 transition-all disabled:opacity-50"
        >
          {isFetching ? '取得中...' : '🔄 キューを取得'}
        </button>
      </div>

      {/* 保存フォルダ選択 */}
      {isFSSupported && (
        <div className={`flex items-center gap-3 p-3 rounded-xl border ${dirHandle ? 'bg-green-50 border-green-200' : 'bg-gray-50 border-gray-200'}`}>
          <div className="flex-1 min-w-0">
            {dirHandle ? (
              <p className="text-sm text-green-700 truncate">
                <span className="font-medium">📁 保存先：</span>{folderName}
                <span className="text-green-500 ml-2 text-xs">（完了時に自動保存・ファイル名: 日付_取引先名_キーワード.md）</span>
              </p>
            ) : (
              <p className="text-sm text-gray-500">
                📁 完了ファイルの自動保存先フォルダを選択してください（省略時はブラウザDL）
              </p>
            )}
          </div>
          <button
            onClick={handleSelectFolder}
            disabled={isRunning}
            className="px-3 py-1.5 text-sm bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 rounded-lg transition-all disabled:opacity-50 whitespace-nowrap"
          >
            {dirHandle ? '📂 変更' : '📂 フォルダを選択'}
          </button>
        </div>
      )}

      {fetchError && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">
          ❌ {fetchError}
        </div>
      )}

      {/* キュー一覧 */}
      {items.length > 0 && (
        <div className="border border-gray-200 rounded-xl overflow-hidden">

          {/* サマリーバー */}
          <div className="bg-gray-50 px-4 py-3 flex items-center justify-between border-b border-gray-200">
            <div className="flex items-center gap-4 text-sm">
              <span className="text-gray-600">合計 <strong>{totalCount}</strong> 件</span>
              {doneCount > 0 && <span className="text-green-600">✅ 完了 {doneCount}</span>}
              {errorCount > 0 && <span className="text-red-600">❌ エラー {errorCount}</span>}
              {waitingCount > 0 && <span className="text-gray-500">⬜ 待機中 {waitingCount}</span>}
            </div>

            {/* プログレス表示 */}
            {isRunning && totalCount > 0 && (
              <div className="flex items-center gap-2">
                {isSavingFiles ? (
                  <span className="text-xs text-indigo-600 font-medium animate-pulse">
                    💾 ファイル保存中... {saveProgressCurrent}/{saveProgressTotal}
                  </span>
                ) : isRetrying ? (
                  <span className="text-xs text-orange-600 font-medium animate-pulse">
                    🔄 エラー分リトライ中...
                  </span>
                ) : (
                  <>
                    <div className="w-32 bg-gray-200 rounded-full h-2">
                      <div
                        className="bg-blue-500 h-2 rounded-full transition-all duration-500"
                        style={{ width: ((doneCount + errorCount) / totalCount * 100) + '%' }}
                      />
                    </div>
                    <span className="text-xs text-gray-500">{doneCount + errorCount}/{totalCount}</span>
                  </>
                )}
              </div>
            )}
          </div>

          {/* 行リスト */}
          <div className="divide-y divide-gray-100 max-h-96 overflow-y-auto">
            {items.map(function(item) {
              return (
                <div key={item.rowIndex} className="px-4 py-3 flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm text-gray-800 truncate">{item.keyword}</span>
                      {item.clientName && (
                        <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded">{item.clientName}</span>
                      )}
                    </div>
                    {item.uiStatus === 'done' && (
                      <p className="text-xs text-green-600 mt-0.5">
                        {dirHandle ? '📁 フォルダに保存済み' : '✅ 保存済み（チェック用DLで取得可）'}
                      </p>
                    )}
                    {item.uiStatus === 'error' && item.errorMessage && (
                      <p className="text-xs text-red-500 mt-0.5">{item.errorMessage.slice(0, 80)}</p>
                    )}
                  </div>
                  <StatusBadge status={item.uiStatus} />
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* アクションボタン */}
      <div className="flex gap-3">
        {!isRunning ? (
          <button
            onClick={handleStart}
            disabled={waitingCount === 0 || isRunning}
            className="px-6 py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-xl transition-all disabled:opacity-40 disabled:cursor-not-allowed shadow-sm"
          >
            ▶ 一斉作成を開始
            {waitingCount > 0 && <span className="ml-2 text-indigo-200">（{waitingCount}件）</span>}
          </button>
        ) : (
          <button
            onClick={handleStop}
            className="px-6 py-3 bg-red-500 hover:bg-red-600 text-white font-semibold rounded-xl transition-all shadow-sm"
          >
            ⏹ 中止（現在の処理完了後に停止）
          </button>
        )}
        {items.length === 0 && !isFetching && (
          <p className="text-sm text-gray-400 flex items-center">
            ← まず「キューを取得」を押してください
          </p>
        )}
      </div>

      {/* 完了メッセージ */}
      {!isRunning && doneCount > 0 && waitingCount === 0 && (
        <div className={`p-4 border rounded-xl ${errorCount > 0 ? 'bg-yellow-50 border-yellow-200' : 'bg-green-50 border-green-200'}`}>
          <div className="flex items-center justify-between flex-wrap gap-3">
            <p className={`font-medium ${errorCount > 0 ? 'text-yellow-700' : 'text-green-700'}`}>
              {errorCount > 0
                ? '⚠️ 一斉作成完了（一部エラー残り）。成功 ' + doneCount + ' 件 ／ エラー ' + errorCount + ' 件'
                : '🎉 一斉作成が完了しました。' + doneCount + '件すべて生成しました。'
                  + (dirHandle ? '（フォルダに自動保存済み）' : '')
              }
            </p>
            {/* フォルダ未選択時のみ手動DLボタンを表示 */}
            {!dirHandle && (
              <button
                onClick={handleBulkDownload}
                disabled={isDownloading}
                className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-semibold rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 shadow-sm"
              >
                {isDownloading
                  ? '⏳ ダウンロード中... ' + downloadProgress + '/' + doneCount
                  : '⬇️ チェック用MD 一括DL（' + doneCount + '件）'}
              </button>
            )}
          </div>
        </div>
      )}

      {/* 処理中・途中完了分の手動DL（フォルダ未選択時のみ） */}
      {!dirHandle && doneCount > 0 && (isRunning || waitingCount > 0) && (
        <div className="flex justify-end">
          <button
            onClick={handleBulkDownload}
            disabled={isDownloading}
            className="px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white text-sm font-semibold rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isDownloading
              ? '⏳ ' + downloadProgress + '/' + doneCount
              : '⬇️ 完了分をチェック用MD DL（' + doneCount + '件）'}
          </button>
        </div>
      )}

      {/* ─────────────────────────────────────────── */}
      {/* 一斉作成 履歴                               */}
      {/* ─────────────────────────────────────────── */}
      {history.length > 0 && (
        <div className="mt-8 pt-6 border-t border-gray-200">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-base font-bold text-gray-700">🗂️ 一斉作成 履歴</h3>
            <span className="text-xs text-gray-400">{history.length}セッション（ブラウザに保存）</span>
          </div>

          <div className="space-y-2">
            {history.map(function(session) {
              const isExpanded = expandedSessionId === session.sessionId;
              const isReDownloadingThis = reDownloading === session.sessionId;
              const sessionDoneItems = session.items.filter(function(it) {
                return it.status === 'done' && it.articleId;
              });
              const displayDate = session.date.slice(0, 4) + '/' + session.date.slice(4, 6) + '/' + session.date.slice(6, 8);

              return (
                <div key={session.sessionId} className="border border-gray-200 rounded-xl overflow-hidden">

                  {/* セッション行（クリックで展開） */}
                  <div
                    className="flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 cursor-pointer transition-colors select-none"
                    onClick={function() { setExpandedSessionId(isExpanded ? null : session.sessionId); }}
                  >
                    <div className="flex items-center gap-3 flex-wrap">
                      <span className="text-sm font-semibold text-gray-700">{displayDate}</span>
                      <span className="text-xs text-green-700 bg-green-100 px-2 py-0.5 rounded-full">
                        ✅ {session.doneCount}件完了
                      </span>
                      {session.errorCount > 0 && (
                        <span className="text-xs text-red-600 bg-red-50 px-2 py-0.5 rounded-full">
                          ❌ {session.errorCount}件エラー
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      {sessionDoneItems.length > 0 && (
                        <button
                          onClick={function(e) {
                            e.stopPropagation();
                            handleReDownloadSession(session);
                          }}
                          disabled={isReDownloadingThis}
                          className="px-3 py-1 text-xs bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                        >
                          {isReDownloadingThis
                            ? '⏳ 処理中...'
                            : (dirHandle
                              ? '📁 再保存（' + sessionDoneItems.length + '件）'
                              : '⬇️ 再DL（' + sessionDoneItems.length + '件）')}
                        </button>
                      )}
                      <span className="text-gray-400 text-xs ml-1">{isExpanded ? '▲' : '▼'}</span>
                    </div>
                  </div>

                  {/* 展開：キーワード一覧 */}
                  {isExpanded && (
                    <div className="divide-y divide-gray-100">
                      {session.items.map(function(histItem, idx) {
                        return (
                          <div key={idx} className="px-4 py-2.5 flex items-center gap-3">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-sm text-gray-700 truncate">{histItem.keyword}</span>
                                {histItem.clientName && (
                                  <span className="text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">
                                    {histItem.clientName}
                                  </span>
                                )}
                              </div>
                              {histItem.savedFileName && (
                                <p className="text-xs text-gray-400 mt-0.5 truncate">📁 {histItem.savedFileName}</p>
                              )}
                              {histItem.status === 'error' && histItem.errorMessage && (
                                <p className="text-xs text-red-400 mt-0.5">{histItem.errorMessage.slice(0, 80)}</p>
                              )}
                            </div>
                            <span className={`text-xs px-2 py-0.5 rounded-full flex-shrink-0 ${histItem.status === 'done' ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-600'}`}>
                              {histItem.status === 'done' ? '✅ 完了' : '❌ エラー'}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

    </div>
  );
};

export default BatchMode;
