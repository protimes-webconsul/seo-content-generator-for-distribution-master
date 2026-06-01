/**
 * レビュー依頼サービス（フロントエンド用）
 * /api/review/send を通してDrive保存・スプレッドシート追記を実行
 */

const API_BASE = '/api';
const INTERNAL_API_KEY = import.meta.env.VITE_INTERNAL_API_KEY || '';

function buildHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'x-api-key': INTERNAL_API_KEY,
  };
}

export interface SendReviewInput {
  clientName: string;
  keyword: string;
  type: '構成案' | '記事';
  htmlContent: string; // Drive に保存するHTML本文
}

export interface SendReviewResult {
  driveUrl: string;      // DriveファイルのURL
  reviewerCount: number; // 共有したレビュワー数
  fileName: string;      // 保存したファイル名
}

// ────────────────────────────────────────────────
// レビュー依頼を送付
// ────────────────────────────────────────────────
export async function sendReview(input: SendReviewInput): Promise<SendReviewResult> {
  const response = await fetch(API_BASE + '/review/send', {
    method: 'POST',
    headers: buildHeaders(),
    body: JSON.stringify({
      clientName: input.clientName,
      keyword: input.keyword,
      type: input.type,
      htmlContent: input.htmlContent,
    }),
  });

  if (!response.ok) {
    const body = await response.json().catch(function() { return {}; });
    throw new Error((body && body.error) ? body.error : 'レビュー依頼の送付に失敗しました。');
  }

  const data = await response.json();
  return {
    driveUrl: data.driveUrl || '',
    reviewerCount: data.reviewerCount || 0,
    fileName: data.fileName || '',
  };
}
