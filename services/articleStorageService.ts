/**
 * 記事保存サービス（フロントエンド用）
 * サーバーの /api/articles エンドポイントを通してローカルファイルに保存・取得する
 */

import type { SavedArticleSummary, SavedArticle, SeoOutlineV2 } from '../types';

const API_BASE = '/api';
const INTERNAL_API_KEY = import.meta.env.VITE_INTERNAL_API_KEY || '';

function buildHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'x-api-key': INTERNAL_API_KEY,
  };
}

// ────────────────────────────────────────────────
// 保存済み記事一覧を取得
// ────────────────────────────────────────────────
export async function fetchSavedArticles(clientId?: string): Promise<SavedArticleSummary[]> {
  const url = clientId
    ? API_BASE + '/articles?clientId=' + encodeURIComponent(clientId)
    : API_BASE + '/articles';

  const response = await fetch(url, { headers: buildHeaders() });

  if (!response.ok) {
    const body = await response.json().catch(function() { return {}; });
    throw new Error((body && body.error) ? body.error : '記事一覧の取得に失敗しました。');
  }

  const data = await response.json();
  return Array.isArray(data.articles) ? data.articles : [];
}

// ────────────────────────────────────────────────
// 保存済み記事を1件取得（全データ）
// ────────────────────────────────────────────────
export async function fetchSavedArticleById(id: string): Promise<SavedArticle> {
  const response = await fetch(API_BASE + '/articles/' + encodeURIComponent(id), {
    headers: buildHeaders(),
  });

  if (!response.ok) {
    const body = await response.json().catch(function() { return {}; });
    throw new Error((body && body.error) ? body.error : '記事の取得に失敗しました。');
  }

  const data = await response.json();
  return data.article as SavedArticle;
}

// ────────────────────────────────────────────────
// 構成案を新規保存
// ────────────────────────────────────────────────
export interface SaveOutlineInput {
  clientId: string;
  clientName: string;
  keyword: string;
  outline: SeoOutlineV2;
}

export async function saveOutline(input: SaveOutlineInput): Promise<string> {
  const response = await fetch(API_BASE + '/articles', {
    method: 'POST',
    headers: buildHeaders(),
    body: JSON.stringify({
      clientId: input.clientId,
      clientName: input.clientName,
      keyword: input.keyword,
      outline: input.outline,
      article: null,
    }),
  });

  if (!response.ok) {
    const body = await response.json().catch(function() { return {}; });
    throw new Error((body && body.error) ? body.error : '構成案の保存に失敗しました。');
  }

  const data = await response.json();
  return data.id as string;
}

// ────────────────────────────────────────────────
// 構成案＋記事を一括保存（執筆開始時に呼ぶ）
// ────────────────────────────────────────────────
export interface SaveArticleInput {
  clientId: string;
  clientName: string;
  keyword: string;
  outline: SeoOutlineV2 | null;
  article: {
    title: string;
    metaDescription: string;
    htmlContent: string;
    plainText: string;
  };
}

export async function saveArticle(input: SaveArticleInput): Promise<string> {
  const response = await fetch(API_BASE + '/articles', {
    method: 'POST',
    headers: buildHeaders(),
    body: JSON.stringify({
      clientId: input.clientId,
      clientName: input.clientName,
      keyword: input.keyword,
      outline: input.outline,
      article: input.article,
    }),
  });

  if (!response.ok) {
    const body = await response.json().catch(function() { return {}; });
    throw new Error((body && body.error) ? body.error : '記事の保存に失敗しました。');
  }

  const data = await response.json();
  return data.id as string;
}

// ────────────────────────────────────────────────
// 既存ファイルに記事を追記・上書き（IDがある場合）
// ────────────────────────────────────────────────
export async function updateSavedArticle(
  id: string,
  patch: {
    outline?: SeoOutlineV2 | null;
    article?: {
      title: string;
      metaDescription: string;
      htmlContent: string;
      plainText: string;
    } | null;
  }
): Promise<void> {
  const response = await fetch(API_BASE + '/articles/' + encodeURIComponent(id), {
    method: 'PUT',
    headers: buildHeaders(),
    body: JSON.stringify(patch),
  });

  if (!response.ok) {
    const body = await response.json().catch(function() { return {}; });
    throw new Error((body && body.error) ? body.error : '記事の更新に失敗しました。');
  }
}

// ────────────────────────────────────────────────
// 記事を削除
// ────────────────────────────────────────────────
export async function deleteSavedArticle(id: string): Promise<void> {
  const response = await fetch(API_BASE + '/articles/' + encodeURIComponent(id), {
    method: 'DELETE',
    headers: buildHeaders(),
  });

  if (!response.ok) {
    const body = await response.json().catch(function() { return {}; });
    throw new Error((body && body.error) ? body.error : '記事の削除に失敗しました。');
  }
}
