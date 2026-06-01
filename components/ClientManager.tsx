/**
 * 取引先管理コンポーネント
 * 取引先一覧・登録・編集・削除 UI
 */

import React, { useState, useEffect, useCallback } from 'react';
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
import {
  fetchClients,
  fetchClientById,
  createClient,
  updateClient,
  deleteClient,
  fetchClientFacts,
} from '../services/clientDataService';

// ────────────────────────────────────────────────
// 型定義（フォーム用）
// ────────────────────────────────────────────────

interface WritingRuleForm {
  id: string;
  category: string;
  ruleContent: string;
}

interface TerminologyRuleForm {
  id: string;
  wrongTermsRaw: string; // カンマ区切り文字列
  correctTerm: string;
  note: string;
}

interface ClientFormState {
  name: string;
  industry: string;
  siteUrl: string;
  factSheetName: string;
  isActive: boolean;
  writingRules: WritingRuleForm[];
  terminologyRules: TerminologyRuleForm[];
  companyNameFullName: string;
  companyNameTitleName: string;
  referenceUrls: Array<{ id: string; url: string; description: string }>;
  wpUrl: string;
  wpUsername: string;
  wpDefaultCategoryId: string;
  // 独自情報（SEO/AIO強化）
  uiAchievements: string;
  uiCertifications: string;
  uiStaffInfo: string;
  uiServiceArea: string;
  uiSpecialties: string;
  uiAwards: string;
}

const WRITING_CATEGORIES = [
  '専門用語',
  '文章構成',
  '文体',
  '会社名',
  '写真・画像',
  '店舗独自情報',
  '品質チェック',
  '禁止',
  'その他',
];

const emptyForm = (): ClientFormState => ({
  name: '',
  industry: '',
  siteUrl: '',
  factSheetName: '',
  isActive: true,
  writingRules: [],
  terminologyRules: [],
  companyNameFullName: '',
  companyNameTitleName: '',
  referenceUrls: [],
  wpUrl: '',
  wpUsername: '',
  wpDefaultCategoryId: '0',
  uiAchievements: '',
  uiCertifications: '',
  uiStaffInfo: '',
  uiServiceArea: '',
  uiSpecialties: '',
  uiAwards: '',
});

function generateTempId(): string {
  return 'tmp_' + Date.now() + '_' + Math.random().toString(36).slice(2);
}

// ────────────────────────────────────────────────
// ClientManager コンポーネント
// ────────────────────────────────────────────────

interface ClientManagerProps {
  onClientListChanged?: () => void;
}

const ClientManager: React.FC<ClientManagerProps> = ({ onClientListChanged }) => {
  const [clients, setClients] = useState<ClientSummary[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // 表示モード: list | edit | new
  const [mode, setMode] = useState<'list' | 'edit' | 'new'>('list');
  const [editingClientId, setEditingClientId] = useState<string | null>(null);
  const [formState, setFormState] = useState<ClientFormState>(emptyForm());
  const [isSaving, setIsSaving] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showInactive, setShowInactive] = useState(false);

  // ファクトDBプレビュー
  const [factPreview, setFactPreview] = useState<FactEntry[] | null>(null);
  const [isLoadingFacts, setIsLoadingFacts] = useState(false);

  // ────────────────────────────────────────────────
  // 一覧読み込み
  // ────────────────────────────────────────────────
  const loadClients = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const list = await fetchClients();
      setClients(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : '取引先の読み込みに失敗しました。');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(function() {
    loadClients();
  }, [loadClients]);

  const showSuccess = (msg: string) => {
    setSuccessMessage(msg);
    setTimeout(function() { setSuccessMessage(null); }, 3000);
  };

  // ────────────────────────────────────────────────
  // プロフィールをフォームに変換
  // ────────────────────────────────────────────────
  function profileToForm(profile: ClientProfile): ClientFormState {
    const wrForms: WritingRuleForm[] = profile.writingRules.map(function(r) {
      return { id: r.id, category: r.category, ruleContent: r.ruleContent };
    });

    const trForms: TerminologyRuleForm[] = profile.terminologyRules.map(function(r) {
      return {
        id: r.id,
        wrongTermsRaw: r.wrongTerms.join(', '),
        correctTerm: r.correctTerm,
        note: r.note,
      };
    });

    const refForms = profile.referenceUrls.map(function(r) {
      return { id: r.id, url: r.url, description: r.description };
    });

    const companyNameRule = profile.companyNameRule;
    const wp = profile.wordpressSettings;
    const ui = profile.uniqueInfo;

    return {
      name: profile.name,
      industry: profile.industry,
      siteUrl: profile.siteUrl,
      factSheetName: profile.factSheetName || '',
      isActive: profile.isActive,
      writingRules: wrForms,
      terminologyRules: trForms,
      companyNameFullName: companyNameRule ? companyNameRule.fullName : '',
      companyNameTitleName: companyNameRule ? companyNameRule.titleName : '',
      referenceUrls: refForms,
      wpUrl: wp ? wp.wpUrl : '',
      wpUsername: wp ? wp.wpUsername : '',
      wpDefaultCategoryId: wp ? String(wp.defaultCategoryId) : '0',
      uiAchievements: ui ? ui.achievements : '',
      uiCertifications: ui ? ui.certifications : '',
      uiStaffInfo: ui ? ui.staffInfo : '',
      uiServiceArea: ui ? ui.serviceArea : '',
      uiSpecialties: ui ? ui.specialties : '',
      uiAwards: ui ? ui.awards : '',
    };
  }

  // ────────────────────────────────────────────────
  // 編集モードに移行
  // ────────────────────────────────────────────────
  async function handleEditClient(clientId: string) {
    setIsLoading(true);
    setError(null);
    try {
      const profile = await fetchClientById(clientId);
      setFormState(profileToForm(profile));
      setEditingClientId(clientId);
      setMode('edit');
    } catch (err) {
      setError(err instanceof Error ? err.message : '取引先の読み込みに失敗しました。');
    } finally {
      setIsLoading(false);
    }
  }

  // ────────────────────────────────────────────────
  // 新規モードに移行
  // ────────────────────────────────────────────────
  function handleNewClient() {
    setFormState(emptyForm());
    setEditingClientId(null);
    setMode('new');
    setError(null);
  }

  // ────────────────────────────────────────────────
  // ファクトDBプレビュー
  // ────────────────────────────────────────────────
  async function handlePreviewFacts() {
    const sheetName = formState.factSheetName.trim();
    if (!sheetName) {
      alert('シートタブ名を入力してください。');
      return;
    }
    setIsLoadingFacts(true);
    setFactPreview(null);
    try {
      const facts = await fetchClientFacts(sheetName);
      setFactPreview(facts);
    } catch (e) {
      alert('ファクトDBの取得に失敗しました。FACT_SHEET_IDの設定とシート名を確認してください。');
    } finally {
      setIsLoadingFacts(false);
    }
  }

  // ────────────────────────────────────────────────
  // 保存（新規 or 更新）
  // ────────────────────────────────────────────────
  async function handleSave() {
    if (!formState.name.trim()) {
      setError('会社名は必須です。');
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      const writingRules = formState.writingRules
        .filter(function(r) { return r.ruleContent.trim(); })
        .map(function(r) { return { id: r.id, category: r.category, ruleContent: r.ruleContent }; });

      const terminologyRules = formState.terminologyRules
        .filter(function(r) { return r.correctTerm.trim(); })
        .map(function(r) {
          const wrongTerms = r.wrongTermsRaw
            .split(',')
            .map(function(t) { return t.trim(); })
            .filter(function(t) { return t.length > 0; });
          return { id: r.id, wrongTerms: wrongTerms, correctTerm: r.correctTerm, note: r.note };
        });

      const companyNameRule = formState.companyNameFullName.trim()
        ? { fullName: formState.companyNameFullName, titleName: formState.companyNameTitleName }
        : null;

      const referenceUrls = formState.referenceUrls
        .filter(function(r) { return r.url.trim(); })
        .map(function(r) { return { id: r.id, url: r.url, description: r.description }; });

      const wordpressSettings = formState.wpUrl.trim()
        ? {
            wpUrl: formState.wpUrl,
            wpUsername: formState.wpUsername,
            defaultCategoryId: parseInt(formState.wpDefaultCategoryId, 10) || 0,
          }
        : null;

      const uniqueInfo: ClientUniqueInfo | null =
        (formState.uiAchievements || formState.uiCertifications || formState.uiStaffInfo ||
         formState.uiServiceArea || formState.uiSpecialties || formState.uiAwards)
          ? {
              clientId: editingClientId || '',
              achievements: formState.uiAchievements,
              certifications: formState.uiCertifications,
              staffInfo: formState.uiStaffInfo,
              serviceArea: formState.uiServiceArea,
              specialties: formState.uiSpecialties,
              awards: formState.uiAwards,
            }
          : null;

      if (mode === 'new') {
        await createClient({
          name: formState.name,
          industry: formState.industry,
          siteUrl: formState.siteUrl,
          factSheetName: formState.factSheetName.trim(),
          writingRules: writingRules,
          terminologyRules: terminologyRules,
          companyNameRule: companyNameRule,
          referenceUrls: referenceUrls,
          wordpressSettings: wordpressSettings,
          uniqueInfo: uniqueInfo,
        });
        showSuccess('取引先を登録しました。');
      } else if (editingClientId) {
        await updateClient(editingClientId, {
          name: formState.name,
          industry: formState.industry,
          siteUrl: formState.siteUrl,
          isActive: formState.isActive,
          factSheetName: formState.factSheetName.trim(),
          writingRules: writingRules,
          terminologyRules: terminologyRules,
          companyNameRule: companyNameRule,
          referenceUrls: referenceUrls,
          wordpressSettings: wordpressSettings,
          uniqueInfo: uniqueInfo,
        });
        showSuccess('取引先を更新しました。');
      }

      await loadClients();
      if (onClientListChanged) onClientListChanged();
      setMode('list');
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存に失敗しました。');
    } finally {
      setIsSaving(false);
    }
  }

  // ────────────────────────────────────────────────
  // 削除（無効化）
  // ────────────────────────────────────────────────
  async function handleDelete(clientId: string, clientName: string) {
    if (!window.confirm('「' + clientName + '」を無効化しますか？')) return;

    setIsLoading(true);
    setError(null);
    try {
      await deleteClient(clientId);
      showSuccess('取引先を無効化しました。');
      await loadClients();
      if (onClientListChanged) onClientListChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : '削除に失敗しました。');
    } finally {
      setIsLoading(false);
    }
  }

  // ────────────────────────────────────────────────
  // フォーム操作ヘルパー
  // ────────────────────────────────────────────────
  function updateField<K extends keyof ClientFormState>(key: K, value: ClientFormState[K]) {
    setFormState(function(prev) {
      const next = Object.assign({}, prev);
      next[key] = value;
      return next;
    });
  }

  function addWritingRule() {
    setFormState(function(prev) {
      return Object.assign({}, prev, {
        writingRules: prev.writingRules.concat([{
          id: generateTempId(),
          category: 'その他',
          ruleContent: '',
        }]),
      });
    });
  }

  function updateWritingRule(index: number, field: keyof WritingRuleForm, value: string) {
    setFormState(function(prev) {
      const rules = prev.writingRules.slice();
      rules[index] = Object.assign({}, rules[index], { [field]: value });
      return Object.assign({}, prev, { writingRules: rules });
    });
  }

  function removeWritingRule(index: number) {
    setFormState(function(prev) {
      const rules = prev.writingRules.filter(function(_, i) { return i !== index; });
      return Object.assign({}, prev, { writingRules: rules });
    });
  }

  function addTerminologyRule() {
    setFormState(function(prev) {
      return Object.assign({}, prev, {
        terminologyRules: prev.terminologyRules.concat([{
          id: generateTempId(),
          wrongTermsRaw: '',
          correctTerm: '',
          note: '',
        }]),
      });
    });
  }

  function updateTerminologyRule(index: number, field: keyof TerminologyRuleForm, value: string) {
    setFormState(function(prev) {
      const rules = prev.terminologyRules.slice();
      rules[index] = Object.assign({}, rules[index], { [field]: value });
      return Object.assign({}, prev, { terminologyRules: rules });
    });
  }

  function removeTerminologyRule(index: number) {
    setFormState(function(prev) {
      const rules = prev.terminologyRules.filter(function(_, i) { return i !== index; });
      return Object.assign({}, prev, { terminologyRules: rules });
    });
  }

  function addReferenceUrl() {
    setFormState(function(prev) {
      return Object.assign({}, prev, {
        referenceUrls: prev.referenceUrls.concat([{
          id: generateTempId(),
          url: '',
          description: '',
        }]),
      });
    });
  }

  function updateReferenceUrl(index: number, field: 'url' | 'description', value: string) {
    setFormState(function(prev) {
      const refs = prev.referenceUrls.slice();
      refs[index] = Object.assign({}, refs[index], { [field]: value });
      return Object.assign({}, prev, { referenceUrls: refs });
    });
  }

  function removeReferenceUrl(index: number) {
    setFormState(function(prev) {
      const refs = prev.referenceUrls.filter(function(_, i) { return i !== index; });
      return Object.assign({}, prev, { referenceUrls: refs });
    });
  }

  // ────────────────────────────────────────────────
  // フィルタリング済みリスト
  // ────────────────────────────────────────────────
  const filteredClients = clients.filter(function(c) {
    if (!showInactive && !c.isActive) return false;
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      c.name.toLowerCase().includes(q) ||
      c.industry.toLowerCase().includes(q)
    );
  });

  // ────────────────────────────────────────────────
  // レンダリング
  // ────────────────────────────────────────────────

  return (
    <div className="max-w-5xl mx-auto p-4">
      {/* 通知バー */}
      {successMessage && (
        <div className="mb-4 p-3 bg-green-100 text-green-800 rounded-lg border border-green-200">
          ✅ {successMessage}
        </div>
      )}
      {error && (
        <div className="mb-4 p-3 bg-red-100 text-red-800 rounded-lg border border-red-200">
          ❌ {error}
        </div>
      )}

      {/* ───── 一覧モード ───── */}
      {mode === 'list' && (
        <div>
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-bold text-gray-800">🏢 取引先管理</h2>
            <button
              onClick={handleNewClient}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium"
            >
              ＋ 新規登録
            </button>
          </div>

          {/* 検索 */}
          <div className="flex gap-3 mb-4">
            <input
              type="text"
              placeholder="会社名・業種で検索..."
              value={searchQuery}
              onChange={function(e) { setSearchQuery(e.target.value); }}
              className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm"
            />
            <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
              <input
                type="checkbox"
                checked={showInactive}
                onChange={function(e) { setShowInactive(e.target.checked); }}
              />
              無効も表示
            </label>
          </div>

          {isLoading ? (
            <div className="text-center py-8 text-gray-500">読み込み中...</div>
          ) : filteredClients.length === 0 ? (
            <div className="text-center py-8 text-gray-400">
              {searchQuery ? '検索結果がありません。' : '取引先が登録されていません。'}
            </div>
          ) : (
            <div className="space-y-2">
              {filteredClients.map(function(client) {
                return (
                  <div
                    key={client.id}
                    className={'flex items-center justify-between p-4 rounded-lg border ' +
                      (client.isActive ? 'bg-white border-gray-200' : 'bg-gray-50 border-gray-200 opacity-60')}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-gray-800 truncate">{client.name}</span>
                        {!client.isActive && (
                          <span className="text-xs bg-gray-200 text-gray-600 px-2 py-0.5 rounded">無効</span>
                        )}
                      </div>
                      <div className="text-sm text-gray-500 mt-0.5">
                        {client.industry && <span className="mr-3">📂 {client.industry}</span>}
                        {client.siteUrl && (
                          <a href={client.siteUrl} target="_blank" rel="noopener noreferrer"
                            className="text-blue-500 hover:underline truncate">
                            🔗 {client.siteUrl}
                          </a>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-2 ml-4">
                      <button
                        onClick={function() { handleEditClient(client.id); }}
                        className="px-3 py-1.5 text-sm bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
                      >
                        編集
                      </button>
                      {client.isActive && (
                        <button
                          onClick={function() { handleDelete(client.id, client.name); }}
                          className="px-3 py-1.5 text-sm bg-red-50 text-red-600 rounded hover:bg-red-100"
                        >
                          無効化
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ───── 新規 / 編集フォーム ───── */}
      {(mode === 'new' || mode === 'edit') && (
        <div>
          <div className="flex items-center gap-3 mb-6">
            <button
              onClick={function() { setMode('list'); setError(null); }}
              className="text-gray-500 hover:text-gray-700 text-sm"
            >
              ← 一覧に戻る
            </button>
            <h2 className="text-xl font-bold text-gray-800">
              {mode === 'new' ? '🏢 取引先 新規登録' : '🏢 取引先 編集'}
            </h2>
          </div>

          {/* ── 基本情報 ── */}
          <section className="mb-6 p-4 bg-white border border-gray-200 rounded-lg">
            <h3 className="font-semibold text-gray-700 mb-3">基本情報</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-gray-600 mb-1">会社名 <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  value={formState.name}
                  onChange={function(e) { updateField('name', e.target.value); }}
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
                  placeholder="株式会社〇〇"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">業種</label>
                <input
                  type="text"
                  value={formState.industry}
                  onChange={function(e) { updateField('industry', e.target.value); }}
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
                  placeholder="外壁塗装、リフォームなど"
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm text-gray-600 mb-1">サイトURL</label>
                <input
                  type="url"
                  value={formState.siteUrl}
                  onChange={function(e) { updateField('siteUrl', e.target.value); }}
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
                  placeholder="https://example.com"
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm text-gray-600 mb-1">
                  📋 ファクトDBシートタブ名
                  <span className="ml-2 text-xs text-gray-400">（FACT_SHEET_ID内のシートタブ名と一致させてください）</span>
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={formState.factSheetName}
                    onChange={function(e) {
                      updateField('factSheetName', e.target.value);
                      setFactPreview(null);
                    }}
                    className="flex-1 border border-gray-300 rounded px-3 py-2 text-sm"
                    placeholder="例：プロタイムズ岐阜羽島店"
                  />
                  <button
                    type="button"
                    onClick={handlePreviewFacts}
                    disabled={isLoadingFacts || !formState.factSheetName.trim()}
                    className="px-3 py-2 bg-indigo-500 hover:bg-indigo-600 text-white text-sm rounded transition-colors disabled:opacity-40"
                  >
                    {isLoadingFacts ? '取得中…' : '確認'}
                  </button>
                </div>
                {factPreview !== null && (
                  <div className="mt-2 border border-gray-200 rounded bg-gray-50 p-3 max-h-48 overflow-y-auto">
                    {factPreview.length === 0 ? (
                      <p className="text-xs text-gray-500">ファクトがまだ登録されていません。Spreadsheetにデータを入力してください。</p>
                    ) : (
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-gray-500 border-b border-gray-200">
                            <th className="text-left py-1 pr-2">カテゴリ</th>
                            <th className="text-left py-1 pr-2">項目</th>
                            <th className="text-left py-1">内容</th>
                          </tr>
                        </thead>
                        <tbody>
                          {factPreview.map(function(f, i) {
                            return (
                              <tr key={i} className="border-b border-gray-100">
                                <td className="py-1 pr-2 text-gray-500">{f.category}</td>
                                <td className="py-1 pr-2 font-medium text-gray-700">{f.item}</td>
                                <td className="py-1 text-gray-800">{f.content}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    )}
                    <p className="text-xs text-gray-400 mt-1">{factPreview.length}件のファクトが登録されています</p>
                  </div>
                )}
              </div>
              {mode === 'edit' && (
                <div>
                  <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formState.isActive}
                      onChange={function(e) { updateField('isActive', e.target.checked); }}
                    />
                    有効（無効にすると一覧に表示されません）
                  </label>
                </div>
              )}
            </div>
          </section>

          {/* ── 会社名ルール ── */}
          <section className="mb-6 p-4 bg-white border border-gray-200 rounded-lg">
            <h3 className="font-semibold text-gray-700 mb-3">会社名ルール</h3>
            <div className="grid grid-cols-1 gap-3">
              <div>
                <label className="block text-sm text-gray-600 mb-1">正式名称（本文中）</label>
                <input
                  type="text"
                  value={formState.companyNameFullName}
                  onChange={function(e) { updateField('companyNameFullName', e.target.value); }}
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
                  placeholder="株式会社カジワラリフォーム（プロタイムズ加古川北店）"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">タイトル用省略名</label>
                <input
                  type="text"
                  value={formState.companyNameTitleName}
                  onChange={function(e) { updateField('companyNameTitleName', e.target.value); }}
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
                  placeholder="株式会社カジワラリフォーム"
                />
              </div>
            </div>
          </section>

          {/* ── 執筆ルール ── */}
          <section className="mb-6 p-4 bg-white border border-gray-200 rounded-lg">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-gray-700">執筆ルール</h3>
              <button
                onClick={addWritingRule}
                className="text-sm text-blue-600 hover:text-blue-800"
              >
                ＋ ルールを追加
              </button>
            </div>
            {formState.writingRules.length === 0 ? (
              <p className="text-sm text-gray-400">ルールがありません。「＋ ルールを追加」から追加してください。</p>
            ) : (
              <div className="space-y-3">
                {formState.writingRules.map(function(rule, index) {
                  return (
                    <div key={rule.id} className="flex gap-2 items-start">
                      <select
                        value={rule.category}
                        onChange={function(e) { updateWritingRule(index, 'category', e.target.value); }}
                        className="border border-gray-300 rounded px-2 py-1.5 text-sm w-32 shrink-0"
                      >
                        {WRITING_CATEGORIES.map(function(cat) {
                          return <option key={cat} value={cat}>{cat}</option>;
                        })}
                      </select>
                      <textarea
                        value={rule.ruleContent}
                        onChange={function(e) { updateWritingRule(index, 'ruleContent', e.target.value); }}
                        rows={2}
                        className="flex-1 border border-gray-300 rounded px-3 py-1.5 text-sm resize-none"
                        placeholder="ルール内容を入力..."
                      />
                      <button
                        onClick={function() { removeWritingRule(index); }}
                        className="text-red-400 hover:text-red-600 text-sm shrink-0 mt-1"
                      >
                        ✕
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* ── 表記統一ルール ── */}
          <section className="mb-6 p-4 bg-white border border-gray-200 rounded-lg">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-gray-700">表記統一ルール</h3>
              <button
                onClick={addTerminologyRule}
                className="text-sm text-blue-600 hover:text-blue-800"
              >
                ＋ ルールを追加
              </button>
            </div>
            {formState.terminologyRules.length === 0 ? (
              <p className="text-sm text-gray-400">ルールがありません。</p>
            ) : (
              <div className="space-y-3">
                {formState.terminologyRules.map(function(rule, index) {
                  return (
                    <div key={rule.id} className="bg-gray-50 rounded p-3">
                      <div className="flex gap-2 mb-2">
                        <div className="flex-1">
                          <label className="block text-xs text-gray-500 mb-1">誤表記（カンマ区切りで複数可）</label>
                          <input
                            type="text"
                            value={rule.wrongTermsRaw}
                            onChange={function(e) { updateTerminologyRule(index, 'wrongTermsRaw', e.target.value); }}
                            className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
                            placeholder="塗装業者, 施工会社, 業者"
                          />
                        </div>
                        <div className="flex-1">
                          <label className="block text-xs text-gray-500 mb-1">正表記</label>
                          <input
                            type="text"
                            value={rule.correctTerm}
                            onChange={function(e) { updateTerminologyRule(index, 'correctTerm', e.target.value); }}
                            className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
                            placeholder="塗装会社"
                          />
                        </div>
                        <button
                          onClick={function() { removeTerminologyRule(index); }}
                          className="text-red-400 hover:text-red-600 text-sm mt-5 shrink-0"
                        >
                          ✕
                        </button>
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">備考</label>
                        <input
                          type="text"
                          value={rule.note}
                          onChange={function(e) { updateTerminologyRule(index, 'note', e.target.value); }}
                          className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
                          placeholder="例：文脈で判断"
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* ── 参照URL ── */}
          <section className="mb-6 p-4 bg-white border border-gray-200 rounded-lg">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-gray-700">店舗独自情報の参照URL</h3>
              <button
                onClick={addReferenceUrl}
                className="text-sm text-blue-600 hover:text-blue-800"
              >
                ＋ URLを追加
              </button>
            </div>
            {formState.referenceUrls.length === 0 ? (
              <p className="text-sm text-gray-400">参照URLがありません。</p>
            ) : (
              <div className="space-y-2">
                {formState.referenceUrls.map(function(ref, index) {
                  return (
                    <div key={ref.id} className="flex gap-2 items-center">
                      <input
                        type="url"
                        value={ref.url}
                        onChange={function(e) { updateReferenceUrl(index, 'url', e.target.value); }}
                        className="flex-1 border border-gray-300 rounded px-2 py-1.5 text-sm"
                        placeholder="https://example.com/price"
                      />
                      <input
                        type="text"
                        value={ref.description}
                        onChange={function(e) { updateReferenceUrl(index, 'description', e.target.value); }}
                        className="w-40 border border-gray-300 rounded px-2 py-1.5 text-sm"
                        placeholder="店舗価格・プラン"
                      />
                      <button
                        onClick={function() { removeReferenceUrl(index); }}
                        className="text-red-400 hover:text-red-600 text-sm shrink-0"
                      >
                        ✕
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* ── WordPress設定 ── */}
          <section className="mb-6 p-4 bg-white border border-gray-200 rounded-lg">
            <h3 className="font-semibold text-gray-700 mb-1">WordPress設定</h3>
            <p className="text-xs text-gray-500 mb-3">
              アプリパスワードは <code>server/config/wp-credentials.json</code> で管理します（このフォームには入力しません）。
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="md:col-span-2">
                <label className="block text-sm text-gray-600 mb-1">WordPress URL</label>
                <input
                  type="url"
                  value={formState.wpUrl}
                  onChange={function(e) { updateField('wpUrl', e.target.value); }}
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
                  placeholder="https://example.com"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">ユーザー名</label>
                <input
                  type="text"
                  value={formState.wpUsername}
                  onChange={function(e) { updateField('wpUsername', e.target.value); }}
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
                  placeholder="wp_editor"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">デフォルトカテゴリID</label>
                <input
                  type="number"
                  value={formState.wpDefaultCategoryId}
                  onChange={function(e) { updateField('wpDefaultCategoryId', e.target.value); }}
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
                  placeholder="1"
                />
              </div>
            </div>
          </section>

          {/* ── 独自情報（SEO/AIO強化） ── */}
          <section className="mb-6 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
            <h3 className="font-semibold text-yellow-800 mb-1">🏆 独自情報（SEO/AIO強化）</h3>
            <p className="text-xs text-yellow-700 mb-3">
              ここに入力した情報は記事中で使用され、AIが独自情報箇所にマーキングします。スタッフの実名は入力しないでください。
            </p>
            <div className="space-y-3">
              <div>
                <label className="block text-sm text-gray-600 mb-1">実績・数値</label>
                <input
                  type="text"
                  value={formState.uiAchievements}
                  onChange={function(e) { updateField('uiAchievements', e.target.value); }}
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
                  placeholder="例：年間施工200件以上・創業15年・累計施工1,000件"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">保有資格</label>
                <input
                  type="text"
                  value={formState.uiCertifications}
                  onChange={function(e) { updateField('uiCertifications', e.target.value); }}
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
                  placeholder="例：一級塗装技能士・外壁診断士・雨漏り診断士"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">スタッフ構成（実名不要）</label>
                <input
                  type="text"
                  value={formState.uiStaffInfo}
                  onChange={function(e) { updateField('uiStaffInfo', e.target.value); }}
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
                  placeholder="例：職人8名在籍・現場経験10年以上のベテランが対応"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">対応エリア</label>
                <input
                  type="text"
                  value={formState.uiServiceArea}
                  onChange={function(e) { updateField('uiServiceArea', e.target.value); }}
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
                  placeholder="例：倉敷市・岡山市・総社市・早島町・矢掛町"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">独自工法・特徴</label>
                <input
                  type="text"
                  value={formState.uiSpecialties}
                  onChange={function(e) { updateField('uiSpecialties', e.target.value); }}
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
                  placeholder="例：〇〇工法採用・10年保証・無料現地調査"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">受賞・認定</label>
                <input
                  type="text"
                  value={formState.uiAwards}
                  onChange={function(e) { updateField('uiAwards', e.target.value); }}
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
                  placeholder="例：〇〇メーカー認定施工店・〇〇表彰受賞"
                />
              </div>
            </div>
          </section>

          {/* 保存ボタン */}
          <div className="flex gap-3 justify-end">
            <button
              onClick={function() { setMode('list'); setError(null); }}
              className="px-5 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 text-sm"
              disabled={isSaving}
            >
              キャンセル
            </button>
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="px-5 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium disabled:opacity-50"
            >
              {isSaving ? '保存中...' : '保存'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default ClientManager;
