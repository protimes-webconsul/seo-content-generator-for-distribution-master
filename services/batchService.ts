/**
 * 夜間バッチ処理 フロントエンドサービス
 */

const API_BASE =
  (import.meta.env.VITE_API_URL
    ? import.meta.env.VITE_API_URL.replace('/api', '')
    : null) ||
  import.meta.env.VITE_BACKEND_URL ||
  'http://localhost:3010';

const API_KEY = import.meta.env.VITE_INTERNAL_API_KEY || '';

function getHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'x-api-key': API_KEY,
  };
}

export interface BatchQueueItem {
  rowIndex: number;
  keyword: string;
  clientName: string;
  status: string;
  memo: string;
}

export interface BatchRowUpdate {
  rowIndex: number;
  status: string;
  date?: string;
  fileName?: string;
  memo?: string;
}

/**
 * 「待機中」のキュー行を取得する
 */
export async function fetchBatchQueue(): Promise<BatchQueueItem[]> {
  const res = await fetch(API_BASE + '/api/batch/queue', {
    headers: getHeaders(),
  });
  if (!res.ok) {
    const data = await res.json().catch(function() { return {}; });
    throw new Error(data.error || 'キューの取得に失敗しました（' + res.status + '）');
  }
  const data = await res.json();
  return (data.items || []) as BatchQueueItem[];
}

/**
 * キュー行のステータス等を更新する
 */
export async function updateBatchRow(update: BatchRowUpdate): Promise<void> {
  const res = await fetch(API_BASE + '/api/batch/update-row', {
    method: 'PUT',
    headers: getHeaders(),
    body: JSON.stringify(update),
  });
  if (!res.ok) {
    const data = await res.json().catch(function() { return {}; });
    throw new Error(data.error || '行の更新に失敗しました（' + res.status + '）');
  }
}

/**
 * 現在日時を「YYYY/MM/DD HH:MM」形式で返す
 */
export function formatNow(): string {
  const now = new Date();
  return now.getFullYear() + '/' +
    String(now.getMonth() + 1).padStart(2, '0') + '/' +
    String(now.getDate()).padStart(2, '0') + ' ' +
    String(now.getHours()).padStart(2, '0') + ':' +
    String(now.getMinutes()).padStart(2, '0');
}
