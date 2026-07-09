import React, { useState, useEffect, useRef } from 'react';

// 認証ヘッダー（バックエンドの INTERNAL_API_KEY と一致させる）
const INTERNAL_API_KEY = (import.meta as any).env.VITE_INTERNAL_API_KEY || '';
// バックエンド直接URL（Viteプロキシを経由しないファイルアップロード用）
const API_BASE_DIRECT = (import.meta as any).env.VITE_API_URL || 'http://localhost:3010/api';
function authHeaders(extra?: Record<string, string>): Record<string, string> {
  return Object.assign({ 'x-api-key': INTERNAL_API_KEY }, extra || {});
}

// ────────────────────────────────────────────────
// 型定義
// ────────────────────────────────────────────────

interface ClientSummary {
  id: string;
  name: string;
  industry: string;
  isActive: boolean;
}

interface ParsedArticle {
  title: string;
  metaDescription: string;
  keyword: string;
  clientId: string;
  htmlContent: string;
}

type Step = 'select-client' | 'upload' | 'preview' | 'done';

// ────────────────────────────────────────────────
// メインコンポーネント
// ────────────────────────────────────────────────

export default function SubmissionPage() {
  const [step, setStep] = useState<Step>('select-client');
  const [clients, setClients] = useState<ClientSummary[]>([]);
  const [selectedClientId, setSelectedClientId] = useState('');
  const [isLoadingClients, setIsLoadingClients] = useState(true);
  const [clientError, setClientError] = useState('');

  const [isConverting, setIsConverting] = useState(false);
  const [convertError, setConvertError] = useState('');
  const [parsed, setParsed] = useState<ParsedArticle | null>(null);

  const [editTitle, setEditTitle] = useState('');
  const [editMeta, setEditMeta] = useState('');
  const [editContent, setEditContent] = useState('');

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState<{ id: number; link: string; editLink: string } | null>(null);
  const [submitError, setSubmitError] = useState('');

  const fileInputRef = useRef<HTMLInputElement>(null);

  // 取引先一覧を取得
  useEffect(function() {
    setIsLoadingClients(true);
    fetch('/api/clients', { headers: authHeaders() })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        const list = Array.isArray(data) ? data : (data.clients || []);
        setClients(list.filter(function(c: ClientSummary) { return c.isActive; }));
        setIsLoadingClients(false);
      })
      .catch(function(err) {
        setClientError('取引先の取得に失敗しました: ' + err.message);
        setIsLoadingClients(false);
      });
  }, []);

  // ── STEP 1: 取引先選択 ──────────────────────────
  function handleClientSelect(id: string) {
    setSelectedClientId(id);
  }

  function handleClientConfirm() {
    if (!selectedClientId) return;
    setStep('upload');
  }

  // ── STEP 2: HTML ファイルアップロード ──────────────

  // ── HTML パーサーヘルパー ───────────────────────────

  // HTMLコメント形式（__KEY__: value）からメタ情報を抽出
  function extractMetaFromComment(html: string, key: string): string {
    const pattern = new RegExp('<!--\\s*' + key + ':\\s*([\\s\\S]*?)\\s*-->');
    const m = html.match(pattern);
    return m ? m[1].trim() : '';
  }

  // <tag ...>value</tag> または <tag ... content="value"> 形式からテキストを取得
  function extractTag(html: string, tag: string): string {
    const m = html.match(new RegExp('<' + tag + '[^>]*>([\\s\\S]*?)<\\/' + tag + '>', 'i'));
    return m ? m[1].replace(/<[^>]+>/g, '').trim() : '';
  }

  function extractMetaAttr(html: string, name: string): string {
    const m = html.match(new RegExp('<meta[^>]+name=["\']' + name + '["\'][^>]+content=["\']([^"\']*)["\']', 'i'))
           || html.match(new RegExp('<meta[^>]+content=["\']([^"\']*)["\'][^>]+name=["\']' + name + '["\']', 'i'));
    return m ? m[1].trim() : '';
  }

  // <body>〜</body> の内容のみを抽出し、<style>/<script> を除去・<h1> の重複を排除
  function extractBodyContent(html: string): string {
    // <body> タグがある場合はその内側だけを使う
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    let content = bodyMatch ? bodyMatch[1] : html;

    // <script> ブロックを削除（JSON-LD 等）
    content = content.replace(/<script[\s\S]*?<\/script>/gi, '');
    // <style> ブロックを削除（WordPress は style タグを文字列化するため除去）
    content = content.replace(/<style[\s\S]*?<\/style>/gi, '');
    // メタコメント行を削除
    content = content
      .replace(/<!--\s*__TITLE__:[\s\S]*?-->\n?/g, '')
      .replace(/<!--\s*__META__:[\s\S]*?-->\n?/g, '')
      .replace(/<!--\s*__KEYWORD__:[\s\S]*?-->\n?/g, '')
      .replace(/<!--\s*__CLIENT_ID__:[\s\S]*?-->\n?/g, '');

    // WordPress が投稿タイトルを自動追加するため、本文先頭の <h1> を1つ除去
    content = content.replace(/<h1[^>]*>[\s\S]*?<\/h1>/i, '');

    return content.trim();
  }

  // ── ファイル読み込み ──────────────────────────────

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files ? e.target.files[0] : null;
    if (!file) return;

    setIsConverting(true);
    setConvertError('');

    const reader = new FileReader();
    reader.onload = function(ev) {
      try {
        const text = ev.target && typeof ev.target.result === 'string' ? ev.target.result : '';
        if (!text) { throw new Error('ファイルの読み込みに失敗しました'); }

        const isFullDocument = /<html/i.test(text);

        // メタ情報を取得（形式に応じて切り替え）
        let title = '';
        let metaDescription = '';
        let keyword = '';
        let clientId = '';

        if (isFullDocument) {
          // 完全 HTML ドキュメント形式（<title> / <meta name="description"> から取得）
          title = extractTag(text, 'title');
          metaDescription = extractMetaAttr(text, 'description');
          // keyword・clientId はコメントに埋め込まれていれば取得
          keyword = extractMetaFromComment(text, '__KEYWORD__');
          clientId = extractMetaFromComment(text, '__CLIENT_ID__');
        } else {
          // ツール①の加盟店用HTML書き出し形式（コメントから取得）
          title = extractMetaFromComment(text, '__TITLE__');
          metaDescription = extractMetaFromComment(text, '__META__');
          keyword = extractMetaFromComment(text, '__KEYWORD__');
          clientId = extractMetaFromComment(text, '__CLIENT_ID__');
        }

        const htmlContent = extractBodyContent(text);

        const result: ParsedArticle = {
          title: title,
          metaDescription: metaDescription,
          keyword: keyword,
          clientId: clientId || selectedClientId,
          htmlContent: htmlContent,
        };

        // clientId が埋め込まれていれば自動で選択
        if (result.clientId && result.clientId !== selectedClientId) {
          const matched = clients.find(function(c) { return c.id === result.clientId; });
          if (matched) {
            setSelectedClientId(result.clientId);
          }
        }

        setParsed(result);
        setEditTitle(result.title);
        setEditMeta(result.metaDescription);
        setEditContent(result.htmlContent);
        setStep('preview');
      } catch (err) {
        setConvertError(err instanceof Error ? err.message : String(err));
      } finally {
        setIsConverting(false);
        e.target.value = '';
      }
    };
    reader.onerror = function() {
      setConvertError('ファイルの読み込みに失敗しました');
      setIsConverting(false);
      e.target.value = '';
    };
    reader.readAsText(file, 'utf-8');
  }

  // ── STEP 3: プレビュー・確認 ────────────────────────

  async function handleSubmit() {
    if (!selectedClientId || !editTitle || !editContent) {
      alert('取引先・タイトル・記事本文は必須です。');
      return;
    }

    setIsSubmitting(true);
    setSubmitError('');

    try {
      const res = await fetch('/api/wordpress/draft', {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          clientId: selectedClientId,
          title: editTitle,
          content: editContent,
          categoryId: 0,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || 'WordPress投稿に失敗しました');
      }
      setSubmitResult({ id: data.id, link: data.link, editLink: data.editLink });
      setStep('done');
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleReset() {
    setStep('select-client');
    setSelectedClientId('');
    setParsed(null);
    setEditTitle('');
    setEditMeta('');
    setEditContent('');
    setSubmitResult(null);
    setSubmitError('');
    setConvertError('');
  }

  // ────────────────────────────────────────────────
  // レンダリング
  // ────────────────────────────────────────────────

  const selectedClient = clients.find(function(c) { return c.id === selectedClientId; });

  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc', fontFamily: 'sans-serif' }}>
      {/* ヘッダー */}
      <div style={{ background: '#1e40af', color: 'white', padding: '16px 24px', display: 'flex', alignItems: 'center', gap: '12px' }}>
        <span style={{ fontSize: '24px' }}>🚀</span>
        <div>
          <div style={{ fontWeight: 'bold', fontSize: '18px' }}>入稿ツール</div>
          <div style={{ fontSize: '12px', opacity: 0.8 }}>加盟店確認済みの記事をWordPressに投稿</div>
        </div>
      </div>

      {/* ステップインジケーター */}
      <div style={{ background: 'white', borderBottom: '1px solid #e2e8f0', padding: '12px 24px', display: 'flex', gap: '8px', alignItems: 'center' }}>
        {(['select-client', 'upload', 'preview', 'done'] as Step[]).map(function(s, i) {
          const labels: Record<Step, string> = {
            'select-client': '① 加盟店選択',
            'upload': '② Wordアップロード',
            'preview': '③ 確認・入稿',
            'done': '✅ 完了',
          };
          const isActive = step === s;
          const isDone = ['select-client', 'upload', 'preview', 'done'].indexOf(step) > i;
          return (
            <React.Fragment key={s}>
              {i > 0 && <span style={{ color: '#94a3b8' }}>›</span>}
              <span style={{
                padding: '4px 12px',
                borderRadius: '20px',
                fontSize: '13px',
                fontWeight: isActive ? 'bold' : 'normal',
                background: isActive ? '#1e40af' : isDone ? '#dcfce7' : '#f1f5f9',
                color: isActive ? 'white' : isDone ? '#166534' : '#64748b',
              }}>
                {labels[s]}
              </span>
            </React.Fragment>
          );
        })}
      </div>

      <div style={{ maxWidth: '800px', margin: '32px auto', padding: '0 24px' }}>

        {/* ── STEP 1: 取引先選択 ── */}
        {step === 'select-client' && (
          <div style={{ background: 'white', borderRadius: '12px', padding: '32px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
            <h2 style={{ fontSize: '20px', fontWeight: 'bold', marginBottom: '8px', color: '#1e293b' }}>
              加盟店を選択してください
            </h2>
            <p style={{ color: '#64748b', fontSize: '14px', marginBottom: '24px' }}>
              ※ Wordファイルに取引先IDが埋め込まれている場合は自動選択されます
            </p>

            {isLoadingClients ? (
              <p style={{ color: '#94a3b8' }}>取引先を読み込み中...</p>
            ) : clientError ? (
              <p style={{ color: '#ef4444' }}>{clientError}</p>
            ) : (
              <>
                <div style={{ display: 'grid', gap: '12px', marginBottom: '24px' }}>
                  {clients.map(function(client) {
                    const isSelected = client.id === selectedClientId;
                    return (
                      <button
                        key={client.id}
                        onClick={function() { handleClientSelect(client.id); }}
                        style={{
                          display: 'flex', alignItems: 'center', gap: '12px',
                          padding: '16px', borderRadius: '8px', textAlign: 'left',
                          border: isSelected ? '2px solid #1e40af' : '2px solid #e2e8f0',
                          background: isSelected ? '#eff6ff' : 'white',
                          cursor: 'pointer', transition: 'all 0.15s',
                          width: '100%',
                        }}
                      >
                        <span style={{
                          width: '36px', height: '36px', borderRadius: '50%',
                          background: isSelected ? '#1e40af' : '#e2e8f0',
                          color: isSelected ? 'white' : '#64748b',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontWeight: 'bold', flexShrink: 0,
                        }}>
                          {client.name.charAt(0)}
                        </span>
                        <div>
                          <div style={{ fontWeight: 'bold', color: '#1e293b' }}>{client.name}</div>
                          <div style={{ fontSize: '12px', color: '#64748b' }}>{client.industry}</div>
                        </div>
                        {isSelected && <span style={{ marginLeft: 'auto', color: '#1e40af', fontSize: '20px' }}>✓</span>}
                      </button>
                    );
                  })}
                </div>
                <button
                  onClick={handleClientConfirm}
                  disabled={!selectedClientId}
                  style={{
                    padding: '12px 32px', borderRadius: '8px', border: 'none',
                    background: selectedClientId ? '#1e40af' : '#cbd5e1',
                    color: 'white', fontWeight: 'bold', fontSize: '16px',
                    cursor: selectedClientId ? 'pointer' : 'not-allowed',
                  }}
                >
                  次へ →
                </button>
              </>
            )}
          </div>
        )}

        {/* ── STEP 2: ファイルアップロード ── */}
        {step === 'upload' && (
          <div style={{ background: 'white', borderRadius: '12px', padding: '32px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
              <span style={{ background: '#eff6ff', color: '#1e40af', padding: '4px 12px', borderRadius: '20px', fontSize: '13px' }}>
                🏢 {selectedClient ? selectedClient.name : selectedClientId}
              </span>
              <button onClick={function() { setStep('select-client'); }} style={{ fontSize: '12px', color: '#94a3b8', background: 'none', border: 'none', cursor: 'pointer' }}>
                変更
              </button>
            </div>
            <h2 style={{ fontSize: '20px', fontWeight: 'bold', marginBottom: '8px', color: '#1e293b' }}>
              加盟店確認済みのHTMLファイルをアップロード
            </h2>
            <p style={{ color: '#64748b', fontSize: '14px', marginBottom: '24px' }}>
              ツール①の「📤 加盟店用HTML書き出し」で出力したファイルを選択してください。<br />
              タイトル・メタ・記事本文が自動で読み込まれます。
            </p>

            <label style={{
              display: 'block', border: '2px dashed #93c5fd', borderRadius: '12px',
              padding: '48px', textAlign: 'center', cursor: 'pointer',
              background: '#f8faff', transition: 'all 0.15s',
            }}>
              <div style={{ fontSize: '48px', marginBottom: '12px' }}>🌐</div>
              <div style={{ fontWeight: 'bold', color: '#1e40af', fontSize: '16px', marginBottom: '4px' }}>
                クリックしてHTMLファイルを選択
              </div>
              <div style={{ color: '#94a3b8', fontSize: '13px' }}>.html 形式のみ対応</div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".html"
                style={{ display: 'none' }}
                onChange={handleFileChange}
              />
            </label>

            {isConverting && (
              <div style={{ marginTop: '16px', padding: '12px', background: '#eff6ff', borderRadius: '8px', color: '#1e40af' }}>
                ⏳ Wordファイルを変換中...
              </div>
            )}
            {convertError && (
              <div style={{ marginTop: '16px', padding: '12px', background: '#fef2f2', borderRadius: '8px', color: '#ef4444' }}>
                ❌ {convertError}
              </div>
            )}
          </div>
        )}

        {/* ── STEP 3: プレビュー・確認・入稿 ── */}
        {step === 'preview' && parsed && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {/* ヘッダー情報 */}
            <div style={{ background: 'white', borderRadius: '12px', padding: '24px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
              <h2 style={{ fontSize: '18px', fontWeight: 'bold', marginBottom: '16px', color: '#1e293b' }}>
                📝 記事情報の確認・編集
              </h2>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {/* 取引先 */}
                <div>
                  <label style={{ fontSize: '13px', fontWeight: 'bold', color: '#64748b', display: 'block', marginBottom: '4px' }}>
                    加盟店
                  </label>
                  <div style={{ padding: '10px 12px', background: '#f8fafc', borderRadius: '6px', border: '1px solid #e2e8f0', color: '#1e293b' }}>
                    {selectedClient ? selectedClient.name : selectedClientId}
                  </div>
                </div>

                {/* タイトル */}
                <div>
                  <label style={{ fontSize: '13px', fontWeight: 'bold', color: '#64748b', display: 'block', marginBottom: '4px' }}>
                    タイトル <span style={{ color: '#ef4444' }}>*</span>
                  </label>
                  <input
                    type="text"
                    value={editTitle}
                    onChange={function(e) { setEditTitle(e.target.value); }}
                    style={{ width: '100%', padding: '10px 12px', borderRadius: '6px', border: '1px solid #e2e8f0', fontSize: '14px', boxSizing: 'border-box' }}
                  />
                  <div style={{ fontSize: '11px', color: editTitle.length >= 29 && editTitle.length <= 35 ? '#16a34a' : '#f59e0b', marginTop: '2px' }}>
                    {editTitle.length}文字 {editTitle.length >= 29 && editTitle.length <= 35 ? '✓ 適切' : '（推奨: 29〜35文字）'}
                  </div>
                </div>

                {/* メタディスクリプション */}
                <div>
                  <label style={{ fontSize: '13px', fontWeight: 'bold', color: '#64748b', display: 'block', marginBottom: '4px' }}>
                    メタディスクリプション
                  </label>
                  <textarea
                    value={editMeta}
                    onChange={function(e) { setEditMeta(e.target.value); }}
                    rows={3}
                    style={{ width: '100%', padding: '10px 12px', borderRadius: '6px', border: '1px solid #e2e8f0', fontSize: '14px', resize: 'vertical', boxSizing: 'border-box' }}
                  />
                  <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '2px' }}>
                    {editMeta.length}文字（推奨: 120〜160文字）
                  </div>
                </div>
              </div>
            </div>

            {/* 記事プレビュー */}
            <div style={{ background: 'white', borderRadius: '12px', padding: '24px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
              <h2 style={{ fontSize: '18px', fontWeight: 'bold', marginBottom: '16px', color: '#1e293b' }}>
                📄 記事本文プレビュー
              </h2>
              <div
                style={{ border: '1px solid #e2e8f0', borderRadius: '8px', padding: '24px', lineHeight: '1.8', color: '#1e293b', maxHeight: '400px', overflowY: 'auto' }}
                dangerouslySetInnerHTML={{ __html: editContent }}
              />
            </div>

            {/* 入稿ボタン */}
            <div style={{ background: 'white', borderRadius: '12px', padding: '24px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
              {submitError && (
                <div style={{ padding: '12px', background: '#fef2f2', borderRadius: '8px', color: '#ef4444', marginBottom: '16px' }}>
                  ❌ {submitError}
                </div>
              )}
              <div style={{ display: 'flex', gap: '12px' }}>
                <button
                  onClick={function() { setStep('upload'); }}
                  style={{ padding: '12px 24px', borderRadius: '8px', border: '1px solid #e2e8f0', background: 'white', color: '#64748b', cursor: 'pointer', fontSize: '14px' }}
                >
                  ← 戻る
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={isSubmitting || !editTitle || !editContent}
                  style={{
                    flex: 1, padding: '14px', borderRadius: '8px', border: 'none',
                    background: isSubmitting || !editTitle || !editContent ? '#cbd5e1' : '#1e40af',
                    color: 'white', fontWeight: 'bold', fontSize: '16px',
                    cursor: isSubmitting || !editTitle || !editContent ? 'not-allowed' : 'pointer',
                  }}
                >
                  {isSubmitting ? '⏳ WordPress に投稿中...' : '🚀 WordPress に下書き保存'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── STEP 4: 完了 ── */}
        {step === 'done' && submitResult && (
          <div style={{ background: 'white', borderRadius: '12px', padding: '48px 32px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', textAlign: 'center' }}>
            <div style={{ fontSize: '64px', marginBottom: '16px' }}>✅</div>
            <h2 style={{ fontSize: '24px', fontWeight: 'bold', color: '#1e293b', marginBottom: '8px' }}>
              WordPress に下書き保存しました
            </h2>
            <p style={{ color: '#64748b', marginBottom: '32px' }}>
              記事ID: {submitResult.id}
            </p>
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', flexWrap: 'wrap' }}>
              <a
                href={submitResult.editLink}
                target="_blank"
                rel="noopener noreferrer"
                style={{ padding: '12px 24px', borderRadius: '8px', background: '#1e40af', color: 'white', textDecoration: 'none', fontWeight: 'bold' }}
              >
                ✏️ WP編集画面を開く
              </a>
              <a
                href={submitResult.link}
                target="_blank"
                rel="noopener noreferrer"
                style={{ padding: '12px 24px', borderRadius: '8px', border: '1px solid #e2e8f0', color: '#1e293b', textDecoration: 'none' }}
              >
                🔍 プレビューを確認
              </a>
              <button
                onClick={handleReset}
                style={{ padding: '12px 24px', borderRadius: '8px', border: '1px solid #e2e8f0', background: 'white', color: '#64748b', cursor: 'pointer' }}
              >
                ↩ 別の記事を入稿する
              </button>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
