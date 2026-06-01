/**
 * 記事一覧コンポーネント
 * 保存済みの構成案・記事を一覧表示し、再編集・再執筆に呼び出せる
 */

import React, { useState, useEffect, useCallback } from 'react';
import type { SavedArticleSummary, SavedArticle, ClientSummary } from '../types';
import {
  fetchSavedArticles,
  fetchSavedArticleById,
  deleteSavedArticle,
} from '../services/articleStorageService';

interface ArticleListProps {
  clientSummaries: ClientSummary[];
  onRestoreOutline: (article: SavedArticle) => void;
  onRestoreArticle: (article: SavedArticle) => void;
}

const ArticleList: React.FC<ArticleListProps> = ({
  clientSummaries,
  onRestoreOutline,
  onRestoreArticle,
}) => {
  const [articles, setArticles] = useState<SavedArticleSummary[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filterClientId, setFilterClientId] = useState<string>('');
  const [filterStatus, setFilterStatus] = useState<string>('');
  const [searchKeyword, setSearchKeyword] = useState<string>('');
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const loadArticles = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await fetchSavedArticles(filterClientId || undefined);
      setArticles(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : '読み込みに失敗しました。');
    } finally {
      setIsLoading(false);
    }
  }, [filterClientId]);

  useEffect(function() {
    loadArticles();
  }, [loadArticles]);

  async function handleRestore(id: string, mode: 'outline' | 'article') {
    setLoadingId(id);
    try {
      const full = await fetchSavedArticleById(id);
      if (mode === 'outline') {
        onRestoreOutline(full);
      } else {
        onRestoreArticle(full);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '読み込みに失敗しました。');
    } finally {
      setLoadingId(null);
    }
  }

  async function handleDelete(id: string, filename: string) {
    if (!window.confirm('「' + filename + '」を削除しますか？この操作は元に戻せません。')) return;
    setDeletingId(id);
    try {
      await deleteSavedArticle(id);
      await loadArticles();
    } catch (err) {
      setError(err instanceof Error ? err.message : '削除に失敗しました。');
    } finally {
      setDeletingId(null);
    }
  }

  function formatDate(isoStr: string): string {
    if (!isoStr) return '';
    const d = new Date(isoStr);
    return d.getFullYear() + '/' +
      String(d.getMonth() + 1).padStart(2, '0') + '/' +
      String(d.getDate()).padStart(2, '0') + ' ' +
      String(d.getHours()).padStart(2, '0') + ':' +
      String(d.getMinutes()).padStart(2, '0');
  }

  const filtered = articles.filter(function(a) {
    if (filterStatus && a.status !== filterStatus) return false;
    if (searchKeyword && !a.keyword.includes(searchKeyword) && !a.title.includes(searchKeyword)) return false;
    return true;
  });

  return (
    <div className="space-y-4">
      {/* ヘッダー */}
      <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2">
            <span>📚</span> 保存済み記事一覧
          </h2>
          <button
            onClick={loadArticles}
            disabled={isLoading}
            className="px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-lg border border-gray-200 transition-colors"
          >
            {isLoading ? '読込中...' : '🔄 更新'}
          </button>
        </div>

        {/* フィルター */}
        <div className="flex flex-wrap gap-3">
          {/* 取引先フィルター */}
          <select
            value={filterClientId}
            onChange={function(e) { setFilterClientId(e.target.value); }}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
          >
            <option value="">すべての取引先</option>
            <option value="none">取引先なし</option>
            {clientSummaries.map(function(c) {
              return (
                <option key={c.id} value={c.id}>{c.name}</option>
              );
            })}
          </select>

          {/* ステータスフィルター */}
          <select
            value={filterStatus}
            onChange={function(e) { setFilterStatus(e.target.value); }}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
          >
            <option value="">すべてのステータス</option>
            <option value="outline_only">構成案のみ</option>
            <option value="complete">記事あり</option>
          </select>

          {/* キーワード検索 */}
          <input
            type="text"
            value={searchKeyword}
            onChange={function(e) { setSearchKeyword(e.target.value); }}
            placeholder="キーワード・タイトルで検索"
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm w-64"
          />
        </div>
      </div>

      {/* エラー */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
          ❌ {error}
        </div>
      )}

      {/* 一覧 */}
      {isLoading ? (
        <div className="bg-white p-8 rounded-xl border border-gray-200 text-center text-gray-500">
          読み込み中...
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white p-8 rounded-xl border border-gray-200 text-center text-gray-400">
          <div className="text-4xl mb-3">📭</div>
          <p className="text-sm">保存済みの記事がありません。</p>
          <p className="text-xs mt-1">構成案または記事を生成後、「💾 保存」ボタンで保存してください。</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(function(article) {
            const isProcessing = loadingId === article.id || deletingId === article.id;
            return (
              <div
                key={article.id}
                className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm hover:border-blue-200 transition-colors"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    {/* ステータスバッジ */}
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        article.status === 'complete'
                          ? 'bg-green-100 text-green-700'
                          : 'bg-yellow-100 text-yellow-700'
                      }`}>
                        {article.status === 'complete' ? '✅ 記事あり' : '📋 構成案のみ'}
                      </span>
                      <span className="text-xs text-gray-400">{article.clientName}</span>
                    </div>

                    {/* タイトル */}
                    <p className="font-semibold text-gray-800 text-sm truncate">
                      {article.title || '（タイトルなし）'}
                    </p>

                    {/* キーワード・日時 */}
                    <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                      <span>🔑 {article.keyword}</span>
                      <span>🕐 {formatDate(article.updatedAt)}</span>
                    </div>

                    {/* ファイル名 */}
                    <p className="text-xs text-gray-400 mt-0.5 truncate">
                      📄 {article.filename}
                    </p>
                  </div>

                  {/* アクションボタン */}
                  <div className="flex flex-col gap-2 shrink-0">
                    <button
                      onClick={function() { handleRestore(article.id, 'outline'); }}
                      disabled={isProcessing}
                      className="px-3 py-1.5 text-xs bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 rounded-lg transition-colors disabled:opacity-50 whitespace-nowrap"
                    >
                      {loadingId === article.id ? '読込中...' : '📋 構成案を開く'}
                    </button>

                    {article.status === 'complete' && (
                      <button
                        onClick={function() { handleRestore(article.id, 'article'); }}
                        disabled={isProcessing}
                        className="px-3 py-1.5 text-xs bg-green-50 hover:bg-green-100 text-green-700 border border-green-200 rounded-lg transition-colors disabled:opacity-50 whitespace-nowrap"
                      >
                        {loadingId === article.id ? '読込中...' : '📝 記事を開く'}
                      </button>
                    )}

                    <button
                      onClick={function() { handleDelete(article.id, article.filename); }}
                      disabled={isProcessing}
                      className="px-3 py-1.5 text-xs bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 rounded-lg transition-colors disabled:opacity-50 whitespace-nowrap"
                    >
                      {deletingId === article.id ? '削除中...' : '🗑️ 削除'}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 件数表示 */}
      {!isLoading && filtered.length > 0 && (
        <p className="text-xs text-gray-400 text-right">
          {filtered.length}件 表示中（全{articles.length}件）
        </p>
      )}
    </div>
  );
};

export default ArticleList;
