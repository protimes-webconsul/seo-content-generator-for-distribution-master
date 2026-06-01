/**
 * 執筆スタイルサンプル サービス（フロントエンド用）
 * /api/writing-styles エンドポイントを通してローカルファイルで管理
 */

import type { WritingStyleSample, WritingStyleEntry } from '../types';

const API_BASE = '/api';
const INTERNAL_API_KEY = import.meta.env.VITE_INTERNAL_API_KEY || '';

function buildHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'x-api-key': INTERNAL_API_KEY,
  };
}

// ────────────────────────────────────────────────
// 取引先のスタイルサンプル一覧を取得
// ────────────────────────────────────────────────
export async function fetchWritingStyle(clientId: string): Promise<WritingStyleSample | null> {
  if (!clientId) return null;

  const response = await fetch(API_BASE + '/writing-styles/' + encodeURIComponent(clientId), {
    headers: buildHeaders(),
  });

  if (response.status === 404) {
    return null; // 未登録は null
  }

  if (!response.ok) {
    const body = await response.json().catch(function() { return {}; });
    throw new Error((body && body.error) ? body.error : 'スタイルサンプルの取得に失敗しました。');
  }

  const data = await response.json();
  return data.sample as WritingStyleSample;
}

// ────────────────────────────────────────────────
// スタイルサンプル一覧を保存（新規・上書き共通）
// samples 配列をまるごと送信
// ────────────────────────────────────────────────
export interface SaveWritingStyleInput {
  clientId: string;
  clientName: string;
  samples: WritingStyleEntry[];
}

export async function saveWritingStyle(input: SaveWritingStyleInput): Promise<WritingStyleSample> {
  const response = await fetch(API_BASE + '/writing-styles/' + encodeURIComponent(input.clientId), {
    method: 'POST',
    headers: buildHeaders(),
    body: JSON.stringify({
      clientName: input.clientName,
      samples: input.samples,
    }),
  });

  if (!response.ok) {
    const body = await response.json().catch(function() { return {}; });
    throw new Error((body && body.error) ? body.error : 'スタイルサンプルの保存に失敗しました。');
  }

  const data = await response.json();
  return data.sample as WritingStyleSample;
}

// ────────────────────────────────────────────────
// スタイルサンプルをすべて削除
// ────────────────────────────────────────────────
export async function deleteWritingStyle(clientId: string): Promise<void> {
  const response = await fetch(API_BASE + '/writing-styles/' + encodeURIComponent(clientId), {
    method: 'DELETE',
    headers: buildHeaders(),
  });

  if (!response.ok) {
    const body = await response.json().catch(function() { return {}; });
    throw new Error((body && body.error) ? body.error : 'スタイルサンプルの削除に失敗しました。');
  }
}

// ────────────────────────────────────────────────
// 複数サンプルを1つの参考文章テキストに結合
// writingAgentV3 へ渡す際に使用
// ────────────────────────────────────────────────
export function buildCombinedStyleText(style: WritingStyleSample | null): string | undefined {
  if (!style || style.samples.length === 0) return undefined;
  if (style.samples.length === 1) {
    return style.samples[0].sampleText;
  }
  return style.samples.map(function(s, i) {
    const label = '【参考文章' + (i + 1) + '】' + (s.description ? '（' + s.description + '）' : '');
    return label + '\n' + s.sampleText;
  }).join('\n\n');
}
