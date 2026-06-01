/**
 * 夜間バッチ処理 API
 * - 記事生成キューシートから「待機中」行を取得
 * - 処理結果（ステータス・日時・ファイル名）をシートに書き戻す
 *
 * GET  /api/batch/queue        - 待機中の行を取得
 * PUT  /api/batch/update-row   - 行のステータス等を更新
 */

const express = require('express');
const router = express.Router();
const sheetsAuth = require('../sheetsAuth.cjs');

const REVIEW_SPREADSHEET_ID = process.env.REVIEW_SPREADSHEET_ID || '';
const SHEET_NAME = '記事生成キュー';

// ────────────────────────────────────────────────
// GET /api/batch/queue
// 待機中の行を全件返す
// ────────────────────────────────────────────────
router.get('/queue', async function(req, res) {
  if (!REVIEW_SPREADSHEET_ID) {
    return res.status(500).json({ error: 'REVIEW_SPREADSHEET_ID が .env に設定されていません。' });
  }

  try {
    const rows = await sheetsAuth.readRange(REVIEW_SPREADSHEET_ID, SHEET_NAME + '!A2:F');
    const items = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const keyword    = (row[0] || '').trim();
      const clientName = (row[1] || '').trim();
      const status     = (row[2] || '').trim();
      const memo       = (row[5] || '').trim();

      if (!keyword) continue;

      // 完了・エラー・処理中はスキップ（待機中のみ処理対象）
      if (status === '完了' || status === 'エラー' || status === '処理中') continue;

      items.push({
        rowIndex: i + 2, // 1行目はヘッダーなので2始まり
        keyword: keyword,
        clientName: clientName,
        status: status || '待機中',
        memo: memo,
      });
    }

    return res.json({ success: true, items: items, total: items.length });
  } catch (err) {
    console.error('❌ batch/queue エラー:', err);
    return res.status(500).json({ error: err.message || 'キュー取得に失敗しました。' });
  }
});

// ────────────────────────────────────────────────
// PUT /api/batch/update-row
// body: { rowIndex, status, date?, fileName?, memo? }
// ────────────────────────────────────────────────
router.put('/update-row', async function(req, res) {
  if (!REVIEW_SPREADSHEET_ID) {
    return res.status(500).json({ error: 'REVIEW_SPREADSHEET_ID が .env に設定されていません。' });
  }

  const body     = req.body || {};
  const rowIndex = body.rowIndex;
  const status   = body.status   || '';
  const date     = body.date     || '';
  const fileName = body.fileName || '';
  const memo     = body.memo     || '';

  if (!rowIndex || !status) {
    return res.status(400).json({ error: 'rowIndex と status は必須です。' });
  }

  try {
    // C列(status) D列(date) E列(fileName) F列(memo) を更新
    const range = SHEET_NAME + '!C' + rowIndex + ':F' + rowIndex;
    await sheetsAuth.updateRange(REVIEW_SPREADSHEET_ID, range, [[status, date, fileName, memo]]);
    console.log('✅ バッチ行更新:', rowIndex, status);

    return res.json({ success: true });
  } catch (err) {
    console.error('❌ batch/update-row エラー:', err);
    return res.status(500).json({ error: err.message || '行の更新に失敗しました。' });
  }
});

module.exports = router;
