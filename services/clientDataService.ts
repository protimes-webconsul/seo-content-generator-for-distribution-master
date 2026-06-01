/**
 * 取引先データサービス（フロントエンド用）
 * サーバーの /api/clients エンドポイントを呼び出してデータを取得・更新する
 */

import type {
  ClientProfile,
  ClientSummary,
  WritingRule,
  TerminologyRule,
  CompanyNameRule,
  ReferenceUrl,
  WordPressSettings,
  ClientUniqueInfo,
  FactEntry,
} from '../types';

const API_BASE = '/api';
const INTERNAL_API_KEY = import.meta.env.VITE_INTERNAL_API_KEY || '';

// ────────────────────────────────────────────────
// 共通ヘッダー
// ────────────────────────────────────────────────
function buildHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'x-api-key': INTERNAL_API_KEY,
  };
}

// ────────────────────────────────────────────────
// 取引先一覧（軽量版）
// ────────────────────────────────────────────────
export async function fetchClients(): Promise<ClientSummary[]> {
  const response = await fetch(API_BASE + '/clients', {
    headers: buildHeaders(),
  });

  if (!response.ok) {
    const body = await response.json().catch(function() { return {}; });
    throw new Error((body && body.error) ? body.error : '取引先一覧の取得に失敗しました。');
  }

  const data = await response.json();
  const clients: ClientSummary[] = Array.isArray(data.clients) ? data.clients : [];
  return clients;
}

// ────────────────────────────────────────────────
// 取引先プロフィール（全情報）
// ────────────────────────────────────────────────
export async function fetchClientById(id: string): Promise<ClientProfile> {
  const response = await fetch(API_BASE + '/clients/' + encodeURIComponent(id), {
    headers: buildHeaders(),
  });

  if (!response.ok) {
    const body = await response.json().catch(function() { return {}; });
    throw new Error((body && body.error) ? body.error : '取引先の取得に失敗しました。');
  }

  const data = await response.json();
  return data.client as ClientProfile;
}

// ────────────────────────────────────────────────
// 取引先新規登録
// ────────────────────────────────────────────────
export interface CreateClientInput {
  name: string;
  industry: string;
  siteUrl: string;
  factSheetName?: string;
  writingRules: Array<{ category: string; ruleContent: string }>;
  terminologyRules: Array<{ wrongTerms: string[]; correctTerm: string; note: string }>;
  companyNameRule: { fullName: string; titleName: string } | null;
  referenceUrls: Array<{ url: string; description: string }>;
  wordpressSettings: { wpUrl: string; wpUsername: string; defaultCategoryId: number } | null;
  uniqueInfo: ClientUniqueInfo | null;
}

export async function createClient(input: CreateClientInput): Promise<string> {
  const response = await fetch(API_BASE + '/clients', {
    method: 'POST',
    headers: buildHeaders(),
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    const body = await response.json().catch(function() { return {}; });
    throw new Error((body && body.error) ? body.error : '取引先の登録に失敗しました。');
  }

  const data = await response.json();
  return data.id as string;
}

// ────────────────────────────────────────────────
// 取引先更新
// ────────────────────────────────────────────────
export interface UpdateClientInput {
  name?: string;
  industry?: string;
  siteUrl?: string;
  isActive?: boolean;
  factSheetName?: string;
  writingRules?: Array<{ id?: string; category: string; ruleContent: string }>;
  terminologyRules?: Array<{ id?: string; wrongTerms: string[]; correctTerm: string; note: string }>;
  companyNameRule?: { fullName: string; titleName: string } | null;
  referenceUrls?: Array<{ id?: string; url: string; description: string }>;
  wordpressSettings?: { wpUrl: string; wpUsername: string; defaultCategoryId: number } | null;
  uniqueInfo?: ClientUniqueInfo | null;
}

export async function updateClient(id: string, input: UpdateClientInput): Promise<void> {
  const response = await fetch(API_BASE + '/clients/' + encodeURIComponent(id), {
    method: 'PUT',
    headers: buildHeaders(),
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    const body = await response.json().catch(function() { return {}; });
    throw new Error((body && body.error) ? body.error : '取引先の更新に失敗しました。');
  }
}

// ────────────────────────────────────────────────
// 取引先削除（isActive = false に変更）
// ────────────────────────────────────────────────
export async function deleteClient(id: string): Promise<void> {
  const response = await fetch(API_BASE + '/clients/' + encodeURIComponent(id), {
    method: 'DELETE',
    headers: buildHeaders(),
  });

  if (!response.ok) {
    const body = await response.json().catch(function() { return {}; });
    throw new Error((body && body.error) ? body.error : '取引先の削除に失敗しました。');
  }
}

// ────────────────────────────────────────────────
// WordPress 下書き保存
// ────────────────────────────────────────────────
export interface WordPressDraftInput {
  clientId: string;
  title: string;
  content: string;
  categoryId?: number;
}

export interface WordPressDraftResult {
  id: number;
  link: string;
  editLink: string;
}

export async function saveWordPressDraft(input: WordPressDraftInput): Promise<WordPressDraftResult> {
  const response = await fetch(API_BASE + '/wordpress/draft', {
    method: 'POST',
    headers: buildHeaders(),
    body: JSON.stringify({
      clientId: input.clientId,
      title: input.title,
      content: input.content,
      categoryId: input.categoryId || 0,
    }),
  });

  if (!response.ok) {
    const body = await response.json().catch(function() { return {}; });
    throw new Error((body && body.error) ? body.error : 'WordPress 下書きの保存に失敗しました。');
  }

  const data = await response.json();
  return {
    id: data.id as number,
    link: data.link as string,
    editLink: data.editLink as string,
  };
}

// ────────────────────────────────────────────────
// ファクトDB取得
// ────────────────────────────────────────────────
export async function fetchClientFacts(sheetName: string): Promise<FactEntry[]> {
  if (!sheetName || !sheetName.trim()) return [];

  const response = await fetch(
    API_BASE + '/client-facts?sheetName=' + encodeURIComponent(sheetName),
    { headers: buildHeaders() }
  );

  if (!response.ok) {
    console.warn('ファクトDB取得失敗（スキップ）:', sheetName);
    return [];
  }

  const data = await response.json();
  if (data.warning) {
    console.warn('ファクトDB警告:', data.warning);
  }
  return Array.isArray(data.facts) ? (data.facts as FactEntry[]) : [];
}

// ────────────────────────────────────────────────
// 取引先プロフィールを執筆プロンプト用テキストに変換
// ────────────────────────────────────────────────
export function buildClientPromptContext(profile: ClientProfile): string {
  const lines: string[] = [];

  lines.push('【取引先執筆ルール：' + profile.name + '】');
  lines.push('');

  // 表記統一ルール
  if (profile.terminologyRules && profile.terminologyRules.length > 0) {
    lines.push('■ 表記統一（必ず遵守）');
    for (let i = 0; i < profile.terminologyRules.length; i++) {
      const rule = profile.terminologyRules[i];
      const wrongStr = rule.wrongTerms.join('」「');
      const noteStr = rule.note ? '（' + rule.note + '）' : '';
      lines.push('- 「' + wrongStr + '」→「' + rule.correctTerm + '」' + noteStr);
    }
    lines.push('');
  }

  // 会社名ルール
  if (profile.companyNameRule && profile.companyNameRule.fullName) {
    lines.push('■ 会社名');
    lines.push('- 本文中：' + profile.companyNameRule.fullName);
    if (profile.companyNameRule.titleName) {
      lines.push('- タイトル中：' + profile.companyNameRule.titleName);
    }
    lines.push('');
  }

  // 汎用執筆ルール（カテゴリ別にグループ化）
  if (profile.writingRules && profile.writingRules.length > 0) {
    lines.push('■ 執筆ルール');
    for (let i = 0; i < profile.writingRules.length; i++) {
      const rule = profile.writingRules[i];
      lines.push('- ' + rule.ruleContent);
    }
    lines.push('');
  }

  // 店舗独自情報の参照URL
  if (profile.referenceUrls && profile.referenceUrls.length > 0) {
    lines.push('■ 店舗独自情報の参照先（必ず参照して独自情報を盛り込む）');
    for (let i = 0; i < profile.referenceUrls.length; i++) {
      const ref = profile.referenceUrls[i];
      lines.push('- ' + ref.description + '：' + ref.url);
    }
    lines.push('');
  }

  // SEO/AIO強化のための独自情報
  const ui = profile.uniqueInfo;
  if (ui) {
    const hasUniqueInfo = ui.achievements || ui.certifications || ui.staffInfo || ui.serviceArea || ui.specialties || ui.awards;
    if (hasUniqueInfo) {
      lines.push('■ 独自情報（SEO/AIO強化のため必ず記事に反映し、<span class="proprietary-info"> で囲むこと）');
      lines.push('  ※ この情報を使用した箇所は必ず <span class="proprietary-info">テキスト</span> で囲んでください');
      if (ui.achievements) {
        lines.push('- 【実績・数値】' + ui.achievements);
      }
      if (ui.certifications) {
        lines.push('- 【保有資格】' + ui.certifications);
      }
      if (ui.staffInfo) {
        lines.push('- 【スタッフ構成】' + ui.staffInfo);
      }
      if (ui.serviceArea) {
        lines.push('- 【対応エリア】' + ui.serviceArea);
      }
      if (ui.specialties) {
        lines.push('- 【独自工法・特徴】' + ui.specialties);
      }
      if (ui.awards) {
        lines.push('- 【受賞・認定】' + ui.awards);
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}
