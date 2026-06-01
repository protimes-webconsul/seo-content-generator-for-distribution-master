// 最終チェック済み記事インポートサービス
// ClaudeProject が返す ===REPORT=== / ===ARTICLE=== フォーマットを解析する

export const REPORT_SEPARATOR = '===REPORT===';
export const ARTICLE_SEPARATOR = '===ARTICLE===';

export interface ImportResult {
  success: boolean;
  reportText: string;
  articleHtml: string;
  modificationCount: number;
  error?: string;
}

export function parseImportFile(content: string): ImportResult {
  try {
    const reportIdx = content.indexOf(REPORT_SEPARATOR);
    const articleIdx = content.indexOf(ARTICLE_SEPARATOR);

    if (reportIdx === -1 || articleIdx === -1) {
      return {
        success: false,
        reportText: '',
        articleHtml: '',
        modificationCount: 0,
        error:
          '必要なセクション区切り（===REPORT=== / ===ARTICLE===）が見つかりません。\n' +
          'ClaudeProject から返ってきたファイルのフォーマットを確認してください。',
      };
    }

    if (articleIdx < reportIdx) {
      return {
        success: false,
        reportText: '',
        articleHtml: '',
        modificationCount: 0,
        error:
          'セクションの順序が不正です。===REPORT=== の後に ===ARTICLE=== が必要です。',
      };
    }

    const reportText = content
      .substring(reportIdx + REPORT_SEPARATOR.length, articleIdx)
      .trim();

    const articleHtml = content
      .substring(articleIdx + ARTICLE_SEPARATOR.length)
      .trim();

    if (!articleHtml) {
      return {
        success: false,
        reportText: '',
        articleHtml: '',
        modificationCount: 0,
        error: '===ARTICLE=== 以降に記事本文が見つかりません。',
      };
    }

    // 修正件数を抽出（例：「修正箇所: 5件」「修正箇所：5件」）
    const countMatch = reportText.match(/修正箇所[：:]\s*(\d+)件/);
    const modificationCount = countMatch ? parseInt(countMatch[1], 10) : 0;

    return {
      success: true,
      reportText,
      articleHtml,
      modificationCount,
    };
  } catch (e) {
    return {
      success: false,
      reportText: '',
      articleHtml: '',
      modificationCount: 0,
      error:
        'ファイルの解析中にエラーが発生しました: ' +
        (e instanceof Error ? e.message : String(e)),
    };
  }
}

// ファイル読み込みをPromiseで返す
export function readFileAsText(file: File): Promise<string> {
  return new Promise(function (resolve, reject) {
    const reader = new FileReader();
    reader.onload = function (e) {
      const result = e.target ? e.target.result : null;
      if (typeof result === 'string') {
        resolve(result);
      } else {
        reject(new Error('ファイルの読み込みに失敗しました'));
      }
    };
    reader.onerror = function () {
      reject(new Error('ファイルの読み込み中にエラーが発生しました'));
    };
    reader.readAsText(file, 'utf-8');
  });
}
