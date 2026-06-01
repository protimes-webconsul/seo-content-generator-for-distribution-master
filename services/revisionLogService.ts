// 修正ログ蓄積サービス（localStorage + CSV エクスポート）

const STORAGE_KEY = 'seo_tool_revision_log';
const MAX_ENTRIES = 500;

export interface RevisionLogEntry {
  id: string;
  date: string; // ISO8601
  keyword: string;
  clientName: string;
  modificationCount: number;
  reportText: string;
}

export function saveRevisionLog(
  entry: Omit<RevisionLogEntry, 'id' | 'date'>
): void {
  const logs = getRevisionLogs();
  const newEntry: RevisionLogEntry = {
    id: Date.now().toString(),
    date: new Date().toISOString(),
    keyword: entry.keyword,
    clientName: entry.clientName,
    modificationCount: entry.modificationCount,
    reportText: entry.reportText,
  };
  logs.unshift(newEntry);
  const trimmed = logs.slice(0, MAX_ENTRIES);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch (e) {
    console.warn('修正ログの保存に失敗しました:', e);
  }
}

export function getRevisionLogs(): RevisionLogEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed as RevisionLogEntry[];
    }
    return [];
  } catch {
    return [];
  }
}

export function clearRevisionLogs(): void {
  localStorage.removeItem(STORAGE_KEY);
}

export function exportRevisionLogsCsv(): void {
  const logs = getRevisionLogs();
  if (logs.length === 0) {
    alert('修正ログがありません。');
    return;
  }

  const headers = ['日時', 'キーワード', '取引先名', '修正件数', '修正内容'];

  const rows = logs.map(function (entry) {
    const dateStr = new Date(entry.date).toLocaleString('ja-JP', {
      timeZone: 'Asia/Tokyo',
    });
    // CSV用に改行・カンマを除去
    const reportClean = entry.reportText
      .replace(/\r?\n/g, ' / ')
      .replace(/,/g, '、');
    return [
      dateStr,
      entry.keyword,
      entry.clientName,
      String(entry.modificationCount),
      reportClean,
    ];
  });

  const allRows = [headers].concat(rows);
  const csvContent = allRows
    .map(function (row) {
      return row
        .map(function (cell) {
          return '"' + cell.replace(/"/g, '""') + '"';
        })
        .join(',');
    })
    .join('\n');

  const bom = '﻿'; // Excel UTF-8 BOM
  const blob = new Blob([bom + csvContent], {
    type: 'text/csv;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download =
    'revision_log_' + new Date().toISOString().slice(0, 10) + '.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
