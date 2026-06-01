/**
 * レビュー依頼 API
 * - HTMLファイルをローカルに保存し、LAN内URLでアクセス可能にする
 * - スプレッドシートにURL・日時・取引先を追記
 *
 * POST /api/review/send
 * body: { clientName, keyword, type('構成案'|'記事'), htmlContent }
 */

const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const os = require('os');
const sheetsAuth = require('../sheetsAuth.cjs');

const REVIEW_SPREADSHEET_ID = process.env.REVIEW_SPREADSHEET_ID || '';
const REVIEWS_DIR = path.join(__dirname, '../data/reviews');

// ────────────────────────────────────────────────
// ローカルIPアドレスを取得
// ────────────────────────────────────────────────
function getLocalIP() {
  const interfaces = os.networkInterfaces();
  const keys = Object.keys(interfaces);
  for (let i = 0; i < keys.length; i++) {
    const name = keys[i];
    const iface = interfaces[name];
    for (let j = 0; j < iface.length; j++) {
      const alias = iface[j];
      if (alias.family === 'IPv4' && !alias.internal) {
        return alias.address;
      }
    }
  }
  return 'localhost';
}

// ────────────────────────────────────────────────
// HTMLをフルドキュメントにラップ
// ────────────────────────────────────────────────
function wrapHtml(htmlContent, clientName, keyword, type) {
  const now = new Date();
  const dateStr = now.getFullYear() + '/' +
    String(now.getMonth() + 1).padStart(2, '0') + '/' +
    String(now.getDate()).padStart(2, '0') + ' ' +
    String(now.getHours()).padStart(2, '0') + ':' +
    String(now.getMinutes()).padStart(2, '0');

  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${type}：${keyword}（${clientName}）</title>
<style>
  body { font-family: 'Hiragino Sans', 'Yu Gothic', sans-serif; max-width: 900px; margin: 40px auto; padding: 0 24px; color: #333; line-height: 1.8; }
  .review-header { background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 10px; padding: 16px 20px; margin-bottom: 32px; }
  .review-header h1 { font-size: 1.1rem; color: #1e40af; margin: 0 0 8px; }
  .review-header p { margin: 4px 0; font-size: 0.9rem; color: #374151; }
  .review-header span { font-weight: bold; color: #1e3a5f; }
  h1 { font-size: 1.7rem; color: #1e3a5f; border-bottom: 2px solid #3b82f6; padding-bottom: 0.6rem; margin-top: 2rem; }
  h2 { font-size: 1.3rem; color: #1e40af; margin-top: 2.5rem; border-left: 4px solid #3b82f6; padding-left: 0.8rem; }
  h3 { font-size: 1.1rem; color: #2563eb; margin-top: 1.5rem; }
  p { color: #374151; }
  ul, ol { color: #374151; }
  b, strong { color: #1e3a5f; }
</style>
</head>
<body>
<div class="review-header">
  <h1>📋 レビュー依頼：${type}</h1>
  <p><span>取引先：</span>${clientName}</p>
  <p><span>キーワード：</span>${keyword}</p>
  <p><span>送付日時：</span>${dateStr}</p>
</div>
${htmlContent}
</body>
</html>`;
}

// ────────────────────────────────────────────────
// POST /api/review/send
// ────────────────────────────────────────────────
router.post('/send', async function(req, res) {
  const body = req.body || {};
  const clientName = body.clientName || '未選択';
  const keyword = body.keyword || '';
  const type = body.type || '';
  const htmlContent = body.htmlContent || '';

  if (!type || !htmlContent.trim()) {
    return res.status(400).json({ error: 'type と htmlContent は必須です。' });
  }
  if (!REVIEW_SPREADSHEET_ID) {
    return res.status(500).json({ error: 'REVIEW_SPREADSHEET_ID が .env に設定されていません。' });
  }

  try {
    // 1. フォルダ作成
    const safeClientName = clientName.replace(/[\\/:*?"<>|]/g, '').trim().slice(0, 30) || '未選択';
    const clientDir = path.join(REVIEWS_DIR, safeClientName);
    if (!fs.existsSync(clientDir)) {
      fs.mkdirSync(clientDir, { recursive: true });
    }

    // 2. ファイル名生成
    const now = new Date();
    const dateStr = now.getFullYear() +
      String(now.getMonth() + 1).padStart(2, '0') +
      String(now.getDate()).padStart(2, '0');
    const safeKeyword = keyword.replace(/[\\/:*?"<>|]/g, '').slice(0, 30);
    let fileName = safeClientName + '_' + dateStr + '_' + safeKeyword + '_' + type + '.html';

    // 同名ファイルが存在する場合は連番を付ける
    let filePath = path.join(clientDir, fileName);
    let counter = 2;
    while (fs.existsSync(filePath)) {
      fileName = safeClientName + '_' + dateStr + '_' + safeKeyword + '_' + type + '_' + counter + '.html';
      filePath = path.join(clientDir, fileName);
      counter++;
    }

    // 3. HTMLファイルを保存
    const fullHtml = wrapHtml(htmlContent, clientName, keyword, type);
    fs.writeFileSync(filePath, fullHtml, 'utf8');
    console.log('✅ レビューファイル保存:', filePath);

    // 4. LAN内アクセスURL生成
    const localIP = getLocalIP();
    const reviewUrl = 'http://' + localIP + ':3010/reviews/' + safeClientName + '/' + encodeURIComponent(fileName);
    console.log('🔗 レビューURL:', reviewUrl);

    // 5. スプレッドシートに追記
    const nowStr = now.getFullYear() + '/' +
      String(now.getMonth() + 1).padStart(2, '0') + '/' +
      String(now.getDate()).padStart(2, '0') + ' ' +
      String(now.getHours()).padStart(2, '0') + ':' +
      String(now.getMinutes()).padStart(2, '0');

    await sheetsAuth.appendRow(REVIEW_SPREADSHEET_ID, 'レビュー依頼一覧!A:G', [
      [nowStr, clientName, keyword, type, reviewUrl, '', ''],
    ]);
    console.log('✅ スプレッドシート追記完了');

    return res.json({
      success: true,
      reviewUrl: reviewUrl,
      fileName: fileName,
    });

  } catch (err) {
    console.error('❌ review/send エラー:', err);
    return res.status(500).json({ error: err.message || 'レビュー依頼の送付に失敗しました。' });
  }
});

module.exports = router;
