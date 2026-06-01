import React, { useState } from 'react';
import type { SeoOutlineV2, OutlineMode } from '../types';
import { countCharacters } from '../utils/characterCounter';
import {
  TitleIcon,
  TargetIcon,
  IntroIcon,
  OutlineIcon,
  ConclusionIcon,
  KeywordIcon,
  ImageIcon,
  CharacterCountIcon,
  ClipboardIcon
} from './icons';

interface OutlineDisplayV2Props {
  outline: SeoOutlineV2;
  keyword: string;
  outlineMode?: OutlineMode; // 構成案生成モード
  onStartWriting?: () => void; // Ver.2執筆
  onStartWritingV3?: () => void; // Ver.3執筆（Gemini Pro + Grounding）
  onRevise?: (instruction: string) => Promise<void>; // AI修正
  onSave?: () => Promise<void>; // 構成案を保存
  isSaved?: boolean; // 保存済みかどうか
}

const Card: React.FC<{ icon: React.ReactNode; title: string; children: React.ReactNode }> = ({ icon, title, children }) => (
  <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm transition-all duration-300 hover:border-blue-300 hover:shadow-md">
    <div className="flex items-center gap-3 mb-4">
      <div className="bg-blue-50 p-2 rounded-full">
        {icon}
      </div>
      <h3 className="text-xl font-bold text-blue-700">{title}</h3>
    </div>
    <div className="prose prose-gray prose-p:text-gray-600 prose-li:text-gray-600 max-w-none">
      {children}
    </div>
  </div>
);

const OutlineDisplayV2: React.FC<OutlineDisplayV2Props> = ({ outline, keyword, outlineMode, onStartWriting, onStartWritingV3, onRevise, onSave, isSaved }) => {
  const [copyButtonText, setCopyButtonText] = useState('Markdownコピー');
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');

  const handleSave = async () => {
    if (!onSave) return;
    setIsSaving(true);
    setSaveMessage('');
    try {
      await onSave();
      setSaveMessage('saved');
    } catch (err) {
      setSaveMessage('error');
    } finally {
      setIsSaving(false);
    }
  };
  // 構成案をHTMLに変換（レビュー依頼用）
  const buildOutlineHtml = () => {
    let html = '<h1>' + outline.title + '</h1>\n';
    html += '<p><strong>メタディスクリプション：</strong>' + outline.metaDescription + '</p>\n';
    html += '<p><strong>ターゲット読者：</strong>' + outline.targetAudience + '</p>\n';
    html += '<p><strong>検索意図：</strong>' + outline.searchIntent.primary;
    if (outline.searchIntent.secondary) {
      html += ' / ' + outline.searchIntent.secondary;
    }
    html += '</p>\n<hr>\n';

    for (let i = 0; i < outline.outline.length; i++) {
      const section = outline.outline[i];
      html += '<h2>' + section.heading + '</h2>\n';
      if (section.writingNote) {
        html += '<p><em>執筆メモ：' + section.writingNote + '</em></p>\n';
      }
      if (section.subheadings && section.subheadings.length > 0) {
        html += '<ul>\n';
        for (let j = 0; j < section.subheadings.length; j++) {
          const sub = section.subheadings[j];
          const subText = typeof sub === 'string' ? sub : sub.text;
          const subNote = typeof sub === 'string' ? '' : (sub.writingNote || '');
          html += '<li><strong>' + subText + '</strong>';
          if (subNote) {
            html += '（' + subNote + '）';
          }
          html += '</li>\n';
        }
        html += '</ul>\n';
      }
    }

    html += '<hr>\n<h2>まとめ</h2>\n<p>' + outline.conclusion + '</p>\n';
    return html;
  };

  // 全体AI修正パネルの状態
  const [globalInstruction, setGlobalInstruction] = useState('');
  const [isGlobalRevising, setIsGlobalRevising] = useState(false);
  const [globalRevisionError, setGlobalRevisionError] = useState('');

  // セクション別修正パネルの状態
  const [openRevisionIndex, setOpenRevisionIndex] = useState<number | null>(null);
  const [sectionInstruction, setSectionInstruction] = useState('');
  const [isRevising, setIsRevising] = useState(false);
  const [revisionError, setRevisionError] = useState('');

  const handleOpenRevision = (index: number) => {
    if (openRevisionIndex === index) {
      // 同じパネルをクリックしたら閉じる
      setOpenRevisionIndex(null);
      setSectionInstruction('');
      setRevisionError('');
    } else {
      setOpenRevisionIndex(index);
      setSectionInstruction('');
      setRevisionError('');
    }
  };

  const handleSectionRevise = async (sectionIndex: number, sectionHeading: string) => {
    if (!sectionInstruction.trim() || !onRevise) return;
    setIsRevising(true);
    setRevisionError('');
    try {
      const contextualInstruction =
        '「H2-' + (sectionIndex + 1) + ': ' + sectionHeading + '」のセクションを修正してください。\n' + sectionInstruction.trim();
      await onRevise(contextualInstruction);
      setSectionInstruction('');
      setOpenRevisionIndex(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '修正に失敗しました';
      setRevisionError(msg);
    } finally {
      setIsRevising(false);
    }
  };

  const handleGlobalRevise = async () => {
    if (!globalInstruction.trim() || !onRevise) return;
    setIsGlobalRevising(true);
    setGlobalRevisionError('');
    try {
      await onRevise(globalInstruction.trim());
      setGlobalInstruction('');
    } catch (err) {
      const msg = err instanceof Error ? err.message : '修正に失敗しました';
      setGlobalRevisionError(msg);
    } finally {
      setIsGlobalRevising(false);
    }
  };

  const handleCopyAsMarkdown = () => {
    const markdown = `
# 「${keyword}」の構成案

## キーワード
${keyword}

## 検索意図（主/副）
- 主: ${outline.searchIntent.primary}
${outline.searchIntent.secondary ? `- 副: ${outline.searchIntent.secondary}` : ''}
${outline.searchIntentAnalysis ? `
## 検索意図3軸分析
- ① 解決したい問題: ${outline.searchIntentAnalysis.problem}
- ② 知りたい情報: ${outline.searchIntentAnalysis.information}
- ③ なりたい状態: ${outline.searchIntentAnalysis.desiredOutcome}
${outline.articlePurpose ? `
## 記事の目的・ストーリー
${outline.articlePurpose}
` : ''}` : ''}
## タイトル（${countCharacters(outline.title)}文字）
${outline.title}

## メタディスクリプション（${countCharacters(outline.metaDescription)}文字）
${outline.metaDescription}

## 目標文字数
5,000〜6,000文字（自社設定値）${outline.characterCountAnalysis ? `　※競合平均: ${outline.characterCountAnalysis.average.toLocaleString()}文字（参考値）` : ''}

## ターゲット読者
${outline.targetAudience}

## 導入文（共感型）
${outline.introductions.empathy}

## 構成本体

${outline.outline.map((section, index) => `
### H2-${index + 1}：${section.heading}
- 画像提案：${section.imageSuggestion}
- 執筆メモ：${section.writingNote}
${section.subheadings.map((sub, subIndex) => `
  - **H3-${subIndex + 1}**：${sub.text} — 執筆メモ：${sub.writingNote || '未設定'}`).join('\n')}
`).join('\n')}

## 競合比較サマリ（上位10記事）
- **総H2/H3数**
  - 競合平均: H2=${outline.competitorComparison.averageH2Count} / H3=${outline.competitorComparison.averageH3Count}
  - サービス訴求追加後: H2=${outline.competitorComparison.averageH2Count + 1} / H3=${outline.competitorComparison.averageH3Count + 2}
  - 自案: H2=${outline.competitorComparison.ourH2Count} / H3=${outline.competitorComparison.ourH3Count}
  - 差分: H2=${outline.competitorComparison.ourH2Count - (outline.competitorComparison.averageH2Count + 1) >= 0 ? '+' : ''}${outline.competitorComparison.ourH2Count - (outline.competitorComparison.averageH2Count + 1)} / H3=${outline.competitorComparison.ourH3Count - (outline.competitorComparison.averageH3Count + 2) >= 0 ? '+' : ''}${outline.competitorComparison.ourH3Count - (outline.competitorComparison.averageH3Count + 2)}

- **鮮度リスク**
${outline.competitorComparison.freshnessRisks.length > 0
  ? outline.competitorComparison.freshnessRisks.map(risk => `  - ${risk}`).join('\n')
  : '  - なし'}

- **わたしたちの差分3点**
${outline.competitorComparison.differentiators.map((diff, i) => `  ${i + 1}) ${diff}`).join('\n')}

## チェックリスト
- [${countCharacters(outline.title) <= 50 ? 'x' : ' '}] タイトル≤50全角（現在: ${countCharacters(outline.title)}文字）
- [${countCharacters(outline.metaDescription) >= 100 && countCharacters(outline.metaDescription) <= 150 ? 'x' : ' '}] メタディスクリプション100-150全角（現在: ${countCharacters(outline.metaDescription)}文字）
- [x] H2順序＝上位3多数派
- [${outline.outline.every(s => s.subheadings.length === 0 || s.subheadings.length >= 2) ? 'x' : ' '}] H3は0 or 2以上
- [x] -10%ルール適合（H2/H3）
- [${!outline.freshnessData?.hasOutdatedInfo ? 'x' : ' '}] 鮮度NGゼロ
- [${outline.competitorComparison.differentiators.length >= 3 ? 'x' : ' '}] 差分3点の明示
`.trim();

    navigator.clipboard.writeText(markdown).then(() => {
      setCopyButtonText('コピーしました！');
      setTimeout(() => {
        setCopyButtonText('Markdownコピー');
      }, 2000);
    }).catch(err => {
      console.error('Failed to copy:', err);
    });
  };

  // チェックリストの状態を計算
  const checklistStatus = {
    titleOk: countCharacters(outline.title) <= 50,
    metaOk: countCharacters(outline.metaDescription) >= 100 && countCharacters(outline.metaDescription) <= 150,
    h3RuleOk: outline.outline.every(s => s.subheadings.length === 0 || s.subheadings.length >= 2),
    freshnessOk: !outline.freshnessData?.hasOutdatedInfo,
    differentiatorOk: outline.competitorComparison.differentiators.length >= 3
  };

  return (
    <div className="animate-fade-in space-y-8">
      {/* ヘッダー */}
      <div className="space-y-4">
        <div className="relative text-center">
          <div className="absolute top-0 left-0 flex items-center gap-2">
            <span className="px-3 py-1 bg-gradient-to-r from-blue-500 to-indigo-500 text-white text-xs font-bold rounded-full">
              Ver.2
            </span>
            {outlineMode === 'siteData' ? (
              <span className="px-3 py-1 bg-emerald-500 text-white text-xs font-bold rounded-full">
                サイトデータ型
              </span>
            ) : (
              <span className="px-3 py-1 bg-blue-100 text-blue-700 text-xs font-bold rounded-full">
                標準モード
              </span>
            )}
          </div>
          <h2 className="text-3xl font-bold text-gray-800 py-2">
            「<span className="text-blue-600">{keyword}</span>」の構成案
          </h2>
        </div>

        {/* アクションボタン */}
        <div className="flex justify-center gap-2 flex-wrap">
          <button
            onClick={handleCopyAsMarkdown}
            className="flex items-center gap-2 px-4 py-2 bg-white text-blue-600 font-semibold rounded-xl border border-gray-200 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-all duration-200 ease-in-out text-sm shadow-sm"
          >
            <ClipboardIcon className="w-5 h-5" />
            {copyButtonText}
          </button>
          {onStartWritingV3 && (
            <button
              onClick={onStartWritingV3}
              className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-blue-500 to-indigo-500 text-white font-semibold rounded-xl hover:from-blue-600 hover:to-indigo-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-all duration-200 ease-in-out text-sm shadow-md"
            >
              執筆開始（Ver.3 Pro）
              <span className="text-xs bg-white/20 px-2 py-0.5 rounded">NEW</span>
            </button>
          )}
          {onSave && (
            <button
              onClick={handleSave}
              disabled={isSaving || isSaved}
              className={`flex items-center gap-2 px-4 py-2 font-semibold rounded-xl text-sm transition-all duration-200 border ${
                isSaved || saveMessage === 'saved'
                  ? 'bg-green-50 text-green-700 border-green-300 cursor-default'
                  : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
              } disabled:opacity-60`}
            >
              {isSaving ? '保存中...' : (isSaved || saveMessage === 'saved') ? '✅ 保存済み' : '💾 保存'}
            </button>
          )}
        </div>
      </div>

      {/* チェックリストステータス */}
      <div className="bg-gray-50 p-4 rounded-xl border border-gray-200">
        <h3 className="text-lg font-semibold text-gray-800 mb-3">品質チェック</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className={`flex items-center gap-2 ${checklistStatus.titleOk ? 'text-green-600' : 'text-red-500'}`}>
            <span>{checklistStatus.titleOk ? '✅' : '❌'}</span>
            <span className="text-sm">タイトル{countCharacters(outline.title)}/50</span>
          </div>
          <div className={`flex items-center gap-2 ${checklistStatus.metaOk ? 'text-green-600' : 'text-red-500'}`}>
            <span>{checklistStatus.metaOk ? '✅' : '❌'}</span>
            <span className="text-sm">メタ{countCharacters(outline.metaDescription)}/100-150</span>
          </div>
          <div className={`flex items-center gap-2 ${checklistStatus.h3RuleOk ? 'text-green-600' : 'text-red-500'}`}>
            <span>{checklistStatus.h3RuleOk ? '✅' : '❌'}</span>
            <span className="text-sm">H3ルール</span>
          </div>
          <div className={`flex items-center gap-2 ${checklistStatus.freshnessOk ? 'text-green-600' : 'text-amber-500'}`}>
            <span>{checklistStatus.freshnessOk ? '✅' : '⚠️'}</span>
            <span className="text-sm">鮮度</span>
          </div>
        </div>
      </div>

      {/* 基本情報 */}
      <div className="space-y-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card icon={<TitleIcon className="w-6 h-6 text-blue-500" />} title="タイトル案">
            <p className="text-lg font-semibold text-gray-800">{outline.title}</p>
            <p className="text-sm text-gray-500 mt-2">
              文字数: {countCharacters(outline.title)} / 50
            </p>
          </Card>
          <Card icon={<TargetIcon className="w-6 h-6 text-blue-500" />} title="メタディスクリプション">
            <p className="text-gray-700">{outline.metaDescription}</p>
            <p className="text-sm text-gray-500 mt-2">
              文字数: {countCharacters(outline.metaDescription)} / 100-150（推奨125）
            </p>
          </Card>
        </div>

        {/* 目標文字数 */}
        <Card icon={<CharacterCountIcon className="w-6 h-6 text-blue-500" />} title="目標文字数">
          <p className="text-lg font-semibold text-gray-800">
            5,000〜6,000 文字
          </p>
          <p className="text-sm text-gray-500 mt-2">
            自社設定値（読者の離脱防止のため上限6,000字）
          </p>
          {outline.characterCountAnalysis && (
            <p className="text-xs text-gray-400 mt-1">
              ※ 競合平均: {outline.characterCountAnalysis.average.toLocaleString()} 文字（参考値のみ）
            </p>
          )}
        </Card>
      </div>

      {/* 検索意図3軸分析（統合版プロンプトで生成された場合のみ表示） */}
      {outline.searchIntentAnalysis && (
        <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-5">
          <h3 className="text-base font-bold text-indigo-800 mb-3 flex items-center gap-2">
            <span>🧭</span> 検索意図3軸分析
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-white rounded-lg p-3 border border-indigo-100">
              <p className="text-xs font-bold text-indigo-600 mb-1">① 解決したい問題</p>
              <p className="text-sm text-gray-700">{outline.searchIntentAnalysis.problem}</p>
            </div>
            <div className="bg-white rounded-lg p-3 border border-indigo-100">
              <p className="text-xs font-bold text-indigo-600 mb-1">② 知りたい情報</p>
              <p className="text-sm text-gray-700">{outline.searchIntentAnalysis.information}</p>
            </div>
            <div className="bg-white rounded-lg p-3 border border-indigo-100">
              <p className="text-xs font-bold text-indigo-600 mb-1">③ なりたい状態</p>
              <p className="text-sm text-gray-700">{outline.searchIntentAnalysis.desiredOutcome}</p>
            </div>
          </div>
          {outline.articlePurpose && (
            <div className="mt-3 bg-white rounded-lg p-3 border border-indigo-100">
              <p className="text-xs font-bold text-indigo-600 mb-1">🎯 記事の目的・ストーリー</p>
              <p className="text-sm text-gray-700">{outline.articlePurpose}</p>
            </div>
          )}
          {outline.articleFlow && (
            <div className="mt-2 bg-white rounded-lg p-3 border border-indigo-100">
              <p className="text-xs font-bold text-indigo-600 mb-1">📖 記事の流れ</p>
              <p className="text-sm text-gray-700">{outline.articleFlow}</p>
            </div>
          )}
        </div>
      )}

      {/* ターゲット読者 */}
      <Card icon={<TargetIcon className="w-6 h-6 text-blue-500" />} title="ターゲット読者">
        <p className="text-gray-700">{outline.targetAudience}</p>
      </Card>

      {/* 導入文 */}
      <Card icon={<IntroIcon className="w-6 h-6 text-blue-500" />} title="導入文（共感型）">
        <p className="text-gray-700">{outline.introductions.empathy}</p>
      </Card>

      {/* 構成本体 */}
      <Card icon={<OutlineIcon className="w-6 h-6 text-blue-500" />} title="記事構成案">
        <div className="space-y-6">
          {outline.outline.map((section, index) => (
            <div key={index} className="border-l-4 border-blue-400 pl-4 space-y-3">
              <div>
                <h4 className="font-bold text-lg text-gray-800">
                  <span className="text-blue-600 mr-2">H2-{index + 1}:</span>
                  {section.heading}
                </h4>

                {/* 画像提案 */}
                {section.imageSuggestion && (
                  <div className="mt-2 p-3 bg-blue-50 rounded-lg flex items-start gap-3">
                    <ImageIcon className="w-5 h-5 text-blue-600 flex-shrink-0 mt-1" />
                    <div>
                      <p className="font-semibold text-sm text-blue-700">画像提案</p>
                      <p className="text-gray-600 text-sm">{section.imageSuggestion}</p>
                    </div>
                  </div>
                )}

                {/* 執筆メモ */}
                <div className="mt-2 p-3 bg-gray-50 rounded-lg">
                  <p className="text-sm text-gray-600">
                    <span className="font-semibold">執筆メモ:</span> {section.writingNote}
                  </p>
                </div>
              </div>

              {/* H3 */}
              {section.subheadings.length > 0 && (
                <ul className="ml-6 space-y-2">
                  {section.subheadings.map((sub, subIndex) => (
                    <li key={subIndex} className="space-y-1">
                      <div className="flex items-start gap-2">
                        <span className="text-blue-600 font-semibold">H3-{subIndex + 1}:</span>
                        <span className="text-gray-700">{sub.text}</span>
                      </div>
                      {sub.writingNote && (
                        <div className="ml-8 p-2 bg-gray-50 rounded text-sm text-gray-500">
                          執筆メモ: {sub.writingNote}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}

              {/* セクション修正ボタン＆パネル */}
              {onRevise && (
                <div className="mt-2">
                  <button
                    onClick={() => handleOpenRevision(index)}
                    disabled={isRevising}
                    className={`text-xs px-3 py-1.5 rounded-lg border transition-colors flex items-center gap-1 ${
                      openRevisionIndex === index
                        ? 'bg-amber-100 border-amber-400 text-amber-800'
                        : 'bg-white border-gray-300 text-gray-500 hover:bg-amber-50 hover:border-amber-300 hover:text-amber-700'
                    }`}
                  >
                    <span>✏️</span>
                    {openRevisionIndex === index ? 'パネルを閉じる' : 'このセクションを修正依頼'}
                  </button>

                  {openRevisionIndex === index && (
                    <div className="mt-2 p-4 bg-amber-50 border border-amber-200 rounded-lg">
                      <p className="text-xs text-amber-700 mb-2 font-medium">
                        H2-{index + 1}「{section.heading}」への修正指示
                      </p>
                      <p className="text-xs text-amber-600 mb-2">
                        例：「H3を2つ追加して」「見出しをもっと具体的に」「このセクションは不要なので削除して」
                      </p>
                      <textarea
                        value={sectionInstruction}
                        onChange={(e) => setSectionInstruction(e.target.value)}
                        placeholder="修正内容を入力してください..."
                        className="w-full h-20 px-3 py-2 border border-amber-300 rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white"
                        disabled={isRevising}
                      />
                      {revisionError && openRevisionIndex === index && (
                        <p className="text-xs text-red-600 mt-1">❌ {revisionError}</p>
                      )}
                      <div className="flex justify-end mt-2">
                        <button
                          onClick={() => handleSectionRevise(index, section.heading)}
                          disabled={isRevising || !sectionInstruction.trim()}
                          className="px-4 py-1.5 bg-amber-500 text-white text-sm font-semibold rounded-lg hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                          {isRevising ? '✨ AI修正中...' : '✨ AI修正を実行'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </Card>

      {/* 全体AI修正パネル */}
      {onRevise && (
        <div className="bg-gradient-to-r from-indigo-50 to-blue-50 border-2 border-indigo-200 rounded-xl p-6">
          <div className="flex items-center gap-3 mb-1">
            <span className="text-2xl">🔄</span>
            <div>
              <h3 className="text-lg font-bold text-indigo-800">構成案をAIで修正</h3>
            </div>
          </div>
          <p className="text-sm text-indigo-600 mb-4 ml-11">
            特定のセクションへの部分修正も、「全部作り直して」などの全体再設計も対応しています。
          </p>
          <textarea
            value={globalInstruction}
            onChange={(e) => setGlobalInstruction(e.target.value)}
            placeholder={'修正指示を自由に入力してください。\n例：「FAQセクションを追加して」「H2を1つ削って全体をコンパクトにして」「全体を作り直して、もっとコスト削減にフォーカスした構成にして」'}
            className="w-full h-32 px-4 py-3 border border-indigo-300 rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-indigo-400 bg-white"
            disabled={isGlobalRevising}
          />
          {globalRevisionError && (
            <p className="text-xs text-red-600 mt-2">❌ {globalRevisionError}</p>
          )}
          <div className="flex justify-end mt-3">
            <button
              onClick={handleGlobalRevise}
              disabled={isGlobalRevising || !globalInstruction.trim()}
              className="px-6 py-2 bg-indigo-600 text-white font-semibold rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
            >
              {isGlobalRevising ? (
                <span>✨ AI修正中...</span>
              ) : (
                <span>🔄 AI修正を実行</span>
              )}
            </button>
          </div>
        </div>
      )}

      {/* 競合比較サマリ */}
      <Card icon={<CharacterCountIcon className="w-6 h-6 text-blue-500" />} title="競合比較サマリ">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div>
            <h4 className="font-semibold text-blue-700 mb-2">H2/H3数の比較</h4>
            <div className="space-y-1 text-sm">
              <p className="text-gray-700">競合平均: H2={outline.competitorComparison.averageH2Count} / H3={outline.competitorComparison.averageH3Count}</p>
              <p className="text-gray-500">サービス訴求追加後: H2={outline.competitorComparison.averageH2Count + 1} / H3={outline.competitorComparison.averageH3Count + 2}</p>
              <p className="text-gray-700">自案: H2={outline.competitorComparison.ourH2Count} / H3={outline.competitorComparison.ourH3Count}</p>
              <p className="font-semibold text-blue-600">
                差分: H2={outline.competitorComparison.ourH2Count - (outline.competitorComparison.averageH2Count + 1) >= 0 ? '+' : ''}{outline.competitorComparison.ourH2Count - (outline.competitorComparison.averageH2Count + 1)} /
                H3={outline.competitorComparison.ourH3Count - (outline.competitorComparison.averageH3Count + 2) >= 0 ? '+' : ''}{outline.competitorComparison.ourH3Count - (outline.competitorComparison.averageH3Count + 2)}
              </p>
            </div>
          </div>

          <div>
            <h4 className="font-semibold text-blue-700 mb-2">鮮度リスク</h4>
            {outline.competitorComparison.freshnessRisks.length > 0 ? (
              <ul className="space-y-1 text-sm text-amber-600">
                {outline.competitorComparison.freshnessRisks.map((risk, i) => (
                  <li key={i}>⚠️ {risk}</li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-green-600">✅ 鮮度リスクなし</p>
            )}
          </div>

          <div>
            <h4 className="font-semibold text-blue-700 mb-2">差分ポイント</h4>
            <ol className="space-y-1 text-sm text-gray-700">
              {outline.competitorComparison.differentiators.map((diff, i) => (
                <li key={i}>{i + 1}. {diff}</li>
              ))}
            </ol>
          </div>
        </div>
      </Card>

      {/* キーワード */}
      <Card icon={<KeywordIcon className="w-6 h-6 text-blue-500" />} title="含めるべきキーワード">
        <div className="flex flex-wrap gap-2">
          {outline.keywords.map((kw, index) => (
            <span
              key={index}
              className="px-3 py-1 bg-blue-100 text-blue-700 text-sm font-medium rounded-full"
            >
              {kw}
            </span>
          ))}
        </div>
      </Card>

    </div>
  );
};

export default OutlineDisplayV2;
