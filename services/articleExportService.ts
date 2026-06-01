// 最終チェック依頼用エクスポートサービス
// .md（Claude Project用）および .docx（加盟店確認用）を生成する
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel,
  AlignmentType, BorderStyle,
} from 'docx';

export interface ArticleExportInput {
  keyword: string;
  clientName?: string;
  articleTitle: string;
  metaDescription?: string;
  articleHtml: string;
  outlineMarkdown?: string;
}

export function generateExportMarkdown(input: ArticleExportInput): string {
  const now = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });

  let md = '# 最終チェック依頼ドキュメント\n';
  md += '生成日時: ' + now + '\n\n';
  md += '---\n\n';

  md += '## 記事情報\n';
  md += '- **キーワード**: ' + input.keyword + '\n';
  if (input.clientName) {
    md += '- **取引先名**: ' + input.clientName + '（本部名誤用チェックに使用）\n';
  }
  md += '- **タイトル**: ' + input.articleTitle + '\n';
  if (input.metaDescription) {
    md += '- **メタディスクリプション**: ' + input.metaDescription + '\n';
  }
  md += '\n';

  md += '## 提供済み数値データ（ハルシネーション判定基準）\n';
  md += '以下に記載がない具体数値（件数・年数・%等）はすべて捏造チェック対象です。\n';
  md += '（取引先情報は取引先管理画面・自社実績データを参照してください）\n\n';

  if (input.outlineMarkdown && input.outlineMarkdown.trim()) {
    md += '## 構成案（執筆メモ含む）\n';
    md += '※ 執筆メモの反映漏れ・内容の逸脱チェックに使用してください。\n\n';
    md += input.outlineMarkdown.trim() + '\n\n';
  }

  md += '## 記事本文（HTML）\n\n';
  md += input.articleHtml.trim() + '\n';

  return md;
}

export function downloadExportFile(input: ArticleExportInput): void {
  const content = generateExportMarkdown(input);
  const safeKeyword = input.keyword.replace(/[\s\/\\:*?"<>|]/g, '_');
  const dateStr = new Date().toISOString().slice(0, 10);
  const filename = safeKeyword + '_finalcheck_' + dateStr + '.md';

  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ────────────────────────────────────────────────
// 加盟店確認用 .docx 書き出し（入稿ツール②で再インポート可能な形式）
// ────────────────────────────────────────────────

/**
 * HTML 文字列を docx の Paragraph 配列に変換する（簡易パーサー）
 */
function htmlToParagraphs(html: string): Paragraph[] {
  const paragraphs: Paragraph[] = [];

  // タグ単位でトークナイズ
  const parts = html.split(/(<[^>]+>)/);
  let currentLevel: 'h2' | 'h3' | 'p' | null = null;
  let buffer = '';

  function flush() {
    const text = buffer.replace(/&amp;/g, '&').replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').trim();
    if (!text) { buffer = ''; return; }

    if (currentLevel === 'h2') {
      paragraphs.push(new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun({ text: text, bold: true })],
        spacing: { before: 300, after: 150 },
      }));
    } else if (currentLevel === 'h3') {
      paragraphs.push(new Paragraph({
        heading: HeadingLevel.HEADING_3,
        children: [new TextRun({ text: text })],
        spacing: { before: 200, after: 100 },
      }));
    } else {
      paragraphs.push(new Paragraph({
        children: [new TextRun({ text: text })],
        spacing: { before: 80, after: 80 },
      }));
    }
    buffer = '';
  }

  for (const part of parts) {
    if (!part) continue;
    if (part.startsWith('<')) {
      const tag = part.toLowerCase().replace(/<\/?([a-z0-9]+)[^>]*>/, '$1');
      const isClose = part.startsWith('</');
      if (!isClose) {
        if (['h2', 'h3', 'p', 'li'].includes(tag)) {
          flush();
          currentLevel = (tag === 'li' ? 'p' : tag) as any;
        }
      } else {
        if (['h2', 'h3', 'p', 'li'].includes(tag)) {
          flush();
          currentLevel = null;
        }
      }
    } else {
      buffer += part;
    }
  }
  flush();

  return paragraphs;
}

// ────────────────────────────────────────────────
// 加盟店確認用 .html 書き出し（入稿ツール②で直接インポート可能な形式）
// メタ情報は HTML コメントとして先頭に埋め込む
// ────────────────────────────────────────────────

export function downloadHtmlForFranchise(input: ArticleExportInput & { clientId?: string }): void {
  const safeTitle = (input.articleTitle || '').replace(/-->/g, '');
  const safeMeta = (input.metaDescription || '').replace(/-->/g, '');
  const safeKeyword = (input.keyword || '').replace(/-->/g, '');
  const safeClientId = (input.clientId || '').replace(/-->/g, '');

  const htmlContent = [
    '<!-- __TITLE__: ' + safeTitle + ' -->',
    '<!-- __META__: ' + safeMeta + ' -->',
    '<!-- __KEYWORD__: ' + safeKeyword + ' -->',
    '<!-- __CLIENT_ID__: ' + safeClientId + ' -->',
    '',
    input.articleHtml,
  ].join('\n');

  const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const safeFilename = input.keyword.replace(/[\s\/\\:*?"<>|]/g, '_');
  const dateStr = new Date().toISOString().slice(0, 10);
  const a = document.createElement('a');
  a.href = url;
  a.download = safeFilename + '_franchise_' + dateStr + '.html';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export async function downloadDocxForFranchise(input: ArticleExportInput & { clientId?: string }): Promise<void> {
  const metaParagraph = new Paragraph({
    children: [new TextRun({ text: '__META__: ' + (input.metaDescription || ''), size: 20 })],
    spacing: { after: 80 },
  });

  const keywordParagraph = new Paragraph({
    children: [new TextRun({ text: '__KEYWORD__: ' + input.keyword, size: 20 })],
    spacing: { after: 80 },
  });

  const clientIdParagraph = new Paragraph({
    children: [new TextRun({ text: '__CLIENT_ID__: ' + (input.clientId || ''), size: 20 })],
    spacing: { after: 80 },
  });

  const separatorParagraph = new Paragraph({
    children: [new TextRun({ text: '__SEPARATOR__', size: 20 })],
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'AAAAAA' } },
    spacing: { after: 200 },
  });

  const noteParagraph = new Paragraph({
    children: [new TextRun({
      text: '※ 上部のメタ情報行（__META__ 等）は変更しないでください。記事本文のみ編集してください。',
      italics: true,
      color: '888888',
      size: 18,
    })],
    spacing: { after: 200 },
  });

  const articleParagraphs = htmlToParagraphs(input.articleHtml);

  const doc = new Document({
    sections: [{
      properties: {
        page: {
          size: { width: 11906, height: 16838 },
          margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
        },
      },
      children: [
        new Paragraph({
          heading: HeadingLevel.HEADING_1,
          children: [new TextRun({ text: input.articleTitle, bold: true })],
          spacing: { after: 200 },
        }),
        metaParagraph,
        keywordParagraph,
        clientIdParagraph,
        separatorParagraph,
        noteParagraph,
        ...articleParagraphs,
      ],
    }],
  });

  const buffer = await Packer.toBuffer(doc);
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  const url = URL.createObjectURL(blob);
  const safeKeyword = input.keyword.replace(/[\s\/\\:*?"<>|]/g, '_');
  const dateStr = new Date().toISOString().slice(0, 10);
  const a = document.createElement('a');
  a.href = url;
  a.download = safeKeyword + '_franchise_' + dateStr + '.docx';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
