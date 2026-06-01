/**
 * 執筆スタイルサンプル管理コンポーネント
 * 取引先ごとに最大4件の参考文章を登録・編集・削除
 */

import React, { useState, useEffect } from 'react';
import type { WritingStyleSample, WritingStyleEntry, ClientSummary } from '../types';
import {
  fetchWritingStyle,
  saveWritingStyle,
  deleteWritingStyle,
} from '../services/writingStyleService';

const MAX_SAMPLES = 4;

interface WritingStyleManagerProps {
  clientSummaries: ClientSummary[];
  selectedClientId: string;
  onStyleSaved: (sample: WritingStyleSample | null) => void;
}

// 編集フォームの状態
interface EditForm {
  id: string | null;  // null = 新規
  description: string;
  sampleText: string;
  createdAt: string | null;
}

const emptyForm: EditForm = { id: null, description: '', sampleText: '', createdAt: null };

function formatDate(isoStr: string): string {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  return d.getFullYear() + '/' +
    String(d.getMonth() + 1).padStart(2, '0') + '/' +
    String(d.getDate()).padStart(2, '0') + ' ' +
    String(d.getHours()).padStart(2, '0') + ':' +
    String(d.getMinutes()).padStart(2, '0');
}

function generateId(): string {
  return 'sample-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
}

const WritingStyleManager: React.FC<WritingStyleManagerProps> = ({
  clientSummaries,
  selectedClientId,
  onStyleSaved,
}) => {
  const [styleSample, setStyleSample] = useState<WritingStyleSample | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // 編集フォーム
  const [editForm, setEditForm] = useState<EditForm | null>(null); // null = 非表示

  // 取引先が切り替わったらサンプルを読み込み
  useEffect(function() {
    if (!selectedClientId) {
      setStyleSample(null);
      setEditForm(null);
      return;
    }
    setIsLoading(true);
    setError(null);
    setSuccessMessage(null);
    fetchWritingStyle(selectedClientId)
      .then(function(data) {
        setStyleSample(data);
        setEditForm(null);
      })
      .catch(function(err) {
        setError(err instanceof Error ? err.message : '読み込みに失敗しました。');
      })
      .finally(function() {
        setIsLoading(false);
      });
  }, [selectedClientId]);

  const samples: WritingStyleEntry[] = styleSample ? styleSample.samples : [];

  const clientSummary = clientSummaries.find(function(c) { return c.id === selectedClientId; });
  const clientName = clientSummary ? clientSummary.name : selectedClientId;

  // ──────────────────────────────────────────────
  // サンプルを追加・更新して保存
  // ──────────────────────────────────────────────
  async function handleSave() {
    if (!selectedClientId || !editForm) return;
    if (!editForm.sampleText.trim()) {
      setError('参考文章を入力してください。');
      return;
    }

    const now = new Date().toISOString();
    let newSamples: WritingStyleEntry[];

    if (editForm.id === null) {
      // 新規追加
      const newEntry: WritingStyleEntry = {
        id: generateId(),
        description: editForm.description,
        sampleText: editForm.sampleText,
        createdAt: now,
        updatedAt: now,
      };
      newSamples = samples.concat([newEntry]);
    } else {
      // 既存を更新
      const targetId = editForm.id;
      newSamples = samples.map(function(s) {
        if (s.id === targetId) {
          return {
            id: s.id,
            description: editForm.description,
            sampleText: editForm.sampleText,
            createdAt: s.createdAt,
            updatedAt: now,
          };
        }
        return s;
      });
    }

    setIsSaving(true);
    setError(null);
    setSuccessMessage(null);
    try {
      const saved = await saveWritingStyle({
        clientId: selectedClientId,
        clientName: clientName,
        samples: newSamples,
      });
      setStyleSample(saved);
      setEditForm(null);
      setSuccessMessage('✅ 保存しました');
      onStyleSaved(saved);
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存に失敗しました。');
    } finally {
      setIsSaving(false);
    }
  }

  // ──────────────────────────────────────────────
  // 特定のサンプルを削除して保存
  // ──────────────────────────────────────────────
  async function handleDeleteSample(sampleId: string) {
    if (!selectedClientId) return;
    if (!window.confirm('このサンプルを削除しますか？')) return;

    const newSamples = samples.filter(function(s) { return s.id !== sampleId; });

    setIsSaving(true);
    setError(null);
    setSuccessMessage(null);
    try {
      if (newSamples.length === 0) {
        // 全件削除
        await deleteWritingStyle(selectedClientId);
        setStyleSample(null);
        setSuccessMessage('削除しました');
        onStyleSaved(null);
      } else {
        const saved = await saveWritingStyle({
          clientId: selectedClientId,
          clientName: clientName,
          samples: newSamples,
        });
        setStyleSample(saved);
        setSuccessMessage('削除しました');
        onStyleSaved(saved);
      }
      setEditForm(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '削除に失敗しました。');
    } finally {
      setIsSaving(false);
    }
  }

  // ──────────────────────────────────────────────
  // 取引先未選択
  // ──────────────────────────────────────────────
  if (!selectedClientId) {
    return (
      <div className="bg-white p-8 rounded-xl border border-gray-200 text-center text-gray-400">
        <div className="text-4xl mb-3">✍️</div>
        <p className="text-sm">取引先を選択してください。</p>
        <p className="text-xs mt-1">キーワード入力画面の「取引先」ドロップダウンで選択してください。</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="bg-white p-8 rounded-xl border border-gray-200 text-center text-gray-500">
        読み込み中...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* ヘッダー */}
      <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2">
            <span>✍️</span> 執筆スタイルサンプル
          </h2>
          <div className="flex items-center gap-3">
            <span className="text-xs text-gray-400">
              {samples.length} / {MAX_SAMPLES} 件登録済み
            </span>
            <span className="text-sm text-gray-500">🏢 {clientName}</span>
          </div>
        </div>
        <p className="mt-1 text-xs text-gray-500">
          取引先ごとに最大{MAX_SAMPLES}件の参考文章を登録できます。AIが複数の文体・表現パターンを組み合わせて記事を生成します。
        </p>
      </div>

      {/* エラー・成功メッセージ */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
          ❌ {error}
        </div>
      )}
      {successMessage && (
        <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg text-sm">
          {successMessage}
        </div>
      )}

      {/* サンプルカード一覧 */}
      {samples.length === 0 && editForm === null && (
        <div className="bg-white p-8 rounded-xl border border-gray-200 text-center">
          <div className="text-4xl mb-3">📝</div>
          <p className="text-sm text-gray-500 mb-4">
            「{clientName}」の執筆スタイルサンプルがまだ登録されていません。
          </p>
          <button
            onClick={function() { setEditForm(emptyForm); setError(null); setSuccessMessage(null); }}
            className="px-5 py-2.5 bg-blue-500 hover:bg-blue-600 text-white font-semibold rounded-lg transition-colors"
          >
            ＋ スタイルサンプルを登録する
          </button>
        </div>
      )}

      {samples.map(function(s, index) {
        const isEditingThis = editForm !== null && editForm.id === s.id;
        return (
          <div
            key={s.id}
            className={'bg-white p-5 rounded-xl border shadow-sm space-y-3 ' + (isEditingThis ? 'border-blue-300' : 'border-gray-200')}
          >
            {/* カードヘッダー */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-blue-500 text-white text-xs font-bold">
                  {index + 1}
                </span>
                {s.description ? (
                  <span className="text-sm font-medium text-gray-700">{s.description}</span>
                ) : (
                  <span className="text-sm text-gray-400">（説明なし）</span>
                )}
              </div>
              <span className="text-xs text-gray-400">更新: {formatDate(s.updatedAt)}</span>
            </div>

            {/* 参考文章プレビュー（編集中でなければ表示） */}
            {!isEditingThis && (
              <div>
                <p className="text-xs text-gray-400 mb-1">{s.sampleText.length}文字</p>
                <div className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 max-h-36 overflow-y-auto">
                  <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">
                    {s.sampleText}
                  </p>
                </div>
              </div>
            )}

            {/* 編集フォーム（このカードが編集中） */}
            {isEditingThis && editForm !== null && (
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    メモ・説明（任意）
                  </label>
                  <input
                    type="text"
                    value={editForm.description}
                    onChange={function(e) { setEditForm({ id: editForm.id, description: e.target.value, sampleText: editForm.sampleText, createdAt: editForm.createdAt }); }}
                    placeholder="例：丁寧系 / 簡潔系 / 事例重視"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                    disabled={isSaving}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    参考文章 <span className="text-red-500">*</span>
                  </label>
                  <textarea
                    value={editForm.sampleText}
                    onChange={function(e) { setEditForm({ id: editForm.id, description: editForm.description, sampleText: e.target.value, createdAt: editForm.createdAt }); }}
                    placeholder="参考にしたい文章をここにペーストしてください..."
                    className="w-full h-48 border border-gray-300 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-400"
                    disabled={isSaving}
                  />
                  <p className="text-xs text-gray-400 mt-1 text-right">{editForm.sampleText.length} 文字</p>
                </div>
                <div className="flex gap-2 justify-end">
                  <button
                    onClick={function() { setEditForm(null); setError(null); }}
                    disabled={isSaving}
                    className="px-4 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 text-gray-600 border border-gray-200 rounded-lg transition-colors disabled:opacity-50"
                  >
                    キャンセル
                  </button>
                  <button
                    onClick={handleSave}
                    disabled={isSaving || !editForm.sampleText.trim()}
                    className="px-5 py-1.5 text-sm bg-blue-500 hover:bg-blue-600 text-white font-semibold rounded-lg transition-colors disabled:opacity-50"
                  >
                    {isSaving ? '保存中...' : '💾 保存する'}
                  </button>
                </div>
              </div>
            )}

            {/* アクションボタン（編集中でなければ表示） */}
            {!isEditingThis && (
              <div className="flex gap-2">
                <button
                  onClick={function() {
                    setEditForm({ id: s.id, description: s.description, sampleText: s.sampleText, createdAt: s.createdAt });
                    setError(null);
                    setSuccessMessage(null);
                  }}
                  disabled={isSaving || editForm !== null}
                  className="px-4 py-1.5 text-sm bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 rounded-lg transition-colors disabled:opacity-40"
                >
                  ✏️ 編集
                </button>
                <button
                  onClick={function() { handleDeleteSample(s.id); }}
                  disabled={isSaving || editForm !== null}
                  className="px-4 py-1.5 text-sm bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 rounded-lg transition-colors disabled:opacity-40"
                >
                  🗑️ 削除
                </button>
              </div>
            )}
          </div>
        );
      })}

      {/* 新規追加フォーム */}
      {editForm !== null && editForm.id === null && (
        <div className="bg-white p-5 rounded-xl border border-blue-300 shadow-sm space-y-3">
          <h3 className="font-semibold text-gray-800 flex items-center gap-2">
            <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-blue-500 text-white text-xs font-bold">
              {samples.length + 1}
            </span>
            新しいスタイルサンプルを追加
          </h3>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              メモ・説明（任意）
            </label>
            <input
              type="text"
              value={editForm.description}
              onChange={function(e) { setEditForm({ id: null, description: e.target.value, sampleText: editForm.sampleText, createdAt: null }); }}
              placeholder="例：丁寧系 / 簡潔系 / 事例重視"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              disabled={isSaving}
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              参考文章 <span className="text-red-500">*</span>
            </label>
            <p className="text-xs text-gray-400 mb-2">
              参考にしたい文章をそのままペーストしてください。HTMLタグは自動で除去されます。
            </p>
            <textarea
              value={editForm.sampleText}
              onChange={function(e) { setEditForm({ id: null, description: editForm.description, sampleText: e.target.value, createdAt: null }); }}
              placeholder="参考にしたい文章をここにペーストしてください..."
              className="w-full h-48 border border-gray-300 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-400"
              disabled={isSaving}
            />
            <p className="text-xs text-gray-400 mt-1 text-right">{editForm.sampleText.length} 文字</p>
          </div>

          <div className="flex gap-2 justify-end">
            <button
              onClick={function() { setEditForm(null); setError(null); }}
              disabled={isSaving}
              className="px-4 py-2 text-sm bg-gray-100 hover:bg-gray-200 text-gray-600 border border-gray-200 rounded-lg transition-colors disabled:opacity-50"
            >
              キャンセル
            </button>
            <button
              onClick={handleSave}
              disabled={isSaving || !editForm.sampleText.trim()}
              className="px-5 py-2 text-sm bg-blue-500 hover:bg-blue-600 text-white font-semibold rounded-lg transition-colors disabled:opacity-50"
            >
              {isSaving ? '保存中...' : '💾 保存する'}
            </button>
          </div>
        </div>
      )}

      {/* 追加ボタン */}
      {samples.length > 0 && editForm === null && samples.length < MAX_SAMPLES && (
        <button
          onClick={function() { setEditForm(emptyForm); setError(null); setSuccessMessage(null); }}
          className="w-full py-3 border-2 border-dashed border-blue-300 text-blue-500 hover:bg-blue-50 rounded-xl text-sm font-medium transition-colors"
        >
          ＋ サンプルを追加（{samples.length}/{MAX_SAMPLES}件）
        </button>
      )}

      {/* 上限表示 */}
      {samples.length >= MAX_SAMPLES && editForm === null && (
        <div className="text-center text-xs text-gray-400 py-2">
          最大{MAX_SAMPLES}件登録済み（これ以上は追加できません）
        </div>
      )}

      {/* 使い方ガイド */}
      <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 text-xs text-blue-700 space-y-1">
        <p className="font-semibold">📌 使い方</p>
        <p>1. 参考にしたい文章（過去の良記事など）をペーストして保存します。最大{MAX_SAMPLES}件まで登録できます。</p>
        <p>2. 取引先を選択した状態で執筆を開始すると、AIがすべてのサンプルの良い点を組み合わせて記事を生成します。</p>
        <p>3. サンプル文章は文体・段落構成の参考のみに使用されます。内容（数値・固有名詞）はコピーされません。</p>
      </div>
    </div>
  );
};

export default WritingStyleManager;
