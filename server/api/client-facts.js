/**
 * ファクトDB API
 * 取引先ごとのファクト（事実・数値）をGoogle Sheetsから取得する
 *
 * FACT_SHEET_ID のスプレッドシートに、取引先名のシートタブが存在することを前提とする。
 * シートフォーマット:
 *   A列: カテゴリ
 *   B列: 項目
 *   C列: 内容
 *   D列: 出典記事
 */

const express = require('express');
const router = express.Router();
const sheetsAuth = require('../sheetsAuth.cjs');

const FACT_SHEET_ID = process.env.FACT_SHEET_ID || '';

// ────────────────────────────────────────────────
// GET /api/client-facts?sheetName=シートタブ名
// ────────────────────────────────────────────────
router.get('/', async function(req, res) {
  if (!FACT_SHEET_ID) {
    console.warn('⚠️ FACT_SHEET_ID が未設定のため空で返します');
    return res.json({ success: true, facts: [], warning: 'FACT_SHEET_ID が .env に設定されていません。' });
  }

  const sheetName = (req.query.sheetName || '').trim();
  if (!sheetName) {
    return res.status(400).json({
      success: false,
      error: 'sheetName パラメータが必要です。',
    });
  }

  try {
    console.log('📊 ファクトDB取得:', sheetName);
    const range = sheetName + '!A2:D';
    const rows = await sheetsAuth.readRange(FACT_SHEET_ID, range);

    if (!rows || rows.length === 0) {
      return res.json({ success: true, facts: [] });
    }

    const facts = rows
      .filter(function(row) { return row[0] || row[1] || row[2]; }) // 空行除外
      .map(function(row) {
        return {
          category: row[0] || '',
          item: row[1] || '',
          content: row[2] || '',
          sourceArticle: row[3] || '',
        };
      });

    console.log('✅ ファクト取得完了:', facts.length, '件 (', sheetName, ')');
    res.json({ success: true, facts: facts });
  } catch (err) {
    var errMsg = err && err.message ? err.message : String(err);
    console.error('ファクトDB取得エラー:', errMsg);
    // エラー種別に関わらず空配列で返す（記事生成を止めない）
    return res.json({
      success: true,
      facts: [],
      warning: 'ファクトDB取得エラー（' + errMsg.slice(0, 80) + '）',
    });
  }
});

module.exports = router;
