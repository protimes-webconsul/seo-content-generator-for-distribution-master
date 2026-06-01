/**
 * キーワード管理バッチ API
 *
 * GET  /api/outline-batch/sync          — Spreadsheetからキーワード+店舗名一覧を取得
 * POST /api/outline-batch/write-back    — 構成案をSpreadsheetの新規タブに書き込む
 * GET  /api/outline-batch/read-outline  — SpreadsheetタブからJSON形式の構成案を読み込む
 * PUT  /api/outline-batch/update-status — キーワード管理シートのステータスを更新
 *
 * Spreadsheet「キーワード管理」シートのフォーマット:
 *   A: キーワード  B: 店舗名  C: ステータス  D: タブ名  E: メモ
 *
 * 構成案タブのフォーマット:
 *   A: タイプ（タイトル/メタ説明/対象読者/リード文A/リード文B/H2/H3）
 *   B: 内容
 *   C: メモ（執筆メモ等）
 */

const express = require('express');
const router = express.Router();
const sheetsAuth = require('../sheetsAuth.cjs');

const KEYWORD_SHEET_NAME = 'キーワード管理';

// ────────────────────────────────────────────────
// GET /api/outline-batch/sync
// Spreadsheetからキーワード+店舗名一覧を取得
// query: { spreadsheetId }
// ────────────────────────────────────────────────
router.get('/sync', async function(req, res) {
  var spreadsheetId = (req.query.spreadsheetId || '').trim();
  if (!spreadsheetId) {
    return res.status(400).json({ error: 'spreadsheetId パラメータが必要です。' });
  }

  try {
    var rows = await sheetsAuth.readRange(spreadsheetId, KEYWORD_SHEET_NAME + '!A2:E');
    var items = [];

    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      var keyword  = (row[0] || '').trim();
      var store    = (row[1] || '').trim();
      var status   = (row[2] || '').trim();
      var tabName  = (row[3] || '').trim();
      var memo     = (row[4] || '').trim();

      if (!keyword) continue;

      items.push({
        rowIndex: i + 2, // 1行目はヘッダーなので2始まり
        keyword: keyword,
        storeName: store,
        status: status || '未処理',
        tabName: tabName,
        memo: memo,
      });
    }

    console.log('✅ outline-batch/sync: ' + items.length + '件取得');
    return res.json({ success: true, items: items, total: items.length });
  } catch (err) {
    console.error('❌ outline-batch/sync エラー:', err);
    var syncErrMsg = (err && err.message) ? String(err.message) : 'キーワード一覧の取得に失敗しました。';
    if (!res.headersSent) {
      return res.status(500).json({ error: syncErrMsg });
    }
  }
});

// ────────────────────────────────────────────────
// POST /api/outline-batch/write-back
// 構成案をSpreadsheetの新規タブに書き込む
// body: { spreadsheetId, keyword, storeName, rowIndex, outline }
// ────────────────────────────────────────────────
router.post('/write-back', async function(req, res) {
  // ─── 最優先ログ：ルートハンドラーに到達した証明 ───
  console.log('🟢 write-back ROUTE HIT - body keys:', Object.keys(req.body || {}));

  var body         = req.body || {};
  var spreadsheetId = (body.spreadsheetId || '').trim();
  var keyword      = (body.keyword || '').trim();
  var storeName    = (body.storeName || '').trim();
  var rowIndex     = body.rowIndex;
  var outline      = body.outline;

  console.log('🟢 write-back PARAMS - spreadsheetId:', !!spreadsheetId, 'keyword:', !!keyword, 'outline:', !!outline);

  if (!spreadsheetId || !keyword || !outline) {
    console.warn('⚠️ write-back: 必須パラメータ不足');
    return res.status(400).json({ error: 'spreadsheetId, keyword, outline は必須です。' });
  }

  try {
    // STEP1: 認証
    console.log('📝 write-back STEP1: 認証開始 keyword=' + keyword);
    var sheets = await sheetsAuth.ensureAuthenticated();
    console.log('📝 write-back STEP2: 認証完了');

    // タブ名を作成（最大30文字）
    // Sheets APIのrange記法で問題を起こす文字（括弧・スペース等）を除去
    var rawTabName = (storeName ? storeName + '_' : '') + keyword;
    var safeTabName = rawTabName
      .replace(/[\\\/\[\]\*\?:'\(\)（）「」【】『』〔〕]/g, '') // 括弧類・記号を除去
      .replace(/\s+/g, '_')                                       // 空白をアンダースコアに変換
      .slice(0, 30);
    // range記法でシート名を安全に引用符で囲む（残存する特殊文字に備える）
    var quotedTabName = "'" + safeTabName.replace(/'/g, "''") + "'";
    console.log('📝 write-back STEP3: タブ名=' + safeTabName);

    // 新規タブを作成（既存の場合はそのまま使用）
    try {
      console.log('📝 write-back STEP4: タブ作成開始');
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: spreadsheetId,
        requestBody: {
          requests: [{
            addSheet: {
              properties: { title: safeTabName }
            }
          }]
        }
      });
      console.log('✅ 新規タブ作成:', safeTabName);
    } catch (addErr) {
      // タブが既に存在する場合はそのまま続行
      var addErrMsg = (addErr && addErr.message) ? String(addErr.message) : String(addErr);
      console.warn('⚠️ タブ作成スキップ（既存or権限不足）:', addErrMsg);
    }

    // 構成案をフラット行配列に変換
    console.log('📝 write-back STEP5: 行データ生成開始');
    var rows = [];
    rows.push(['タイプ', '内容', 'メモ']);
    rows.push(['タイトル', String(outline.title || ''), '']);
    rows.push(['メタ説明', String(outline.metaDescription || ''), '']);
    rows.push(['対象読者', String(outline.targetAudience || ''), '']);

    // 導入文（introductions オブジェクト）
    var introductions = outline.introductions || {};
    rows.push(['リード文A（結論先行型）', String(introductions.conclusionFirst || '').slice(0, 5000), '']);
    rows.push(['リード文B（共感型）', String(introductions.empathy || '').slice(0, 5000), '']);

    // H2/H3 セクション
    var sections = (outline.outline && Array.isArray(outline.outline)) ? outline.outline : [];
    for (var i = 0; i < sections.length; i++) {
      var section = sections[i];
      var h2Note = String(section.writingNote || section.notes || '').slice(0, 1000);
      rows.push(['H2', String(section.heading || ''), h2Note]);

      var subheadings = (section.subheadings && Array.isArray(section.subheadings))
        ? section.subheadings : [];
      for (var j = 0; j < subheadings.length; j++) {
        var sub = subheadings[j];
        if (typeof sub === 'string') {
          rows.push(['H3', String(sub), '']);
        } else if (sub && sub.text) {
          rows.push(['H3', String(sub.text), String(sub.writingNote || sub.note || '')]);
        }
      }
    }
    console.log('📝 write-back STEP6: 行データ生成完了 ' + rows.length + '行');

    // タブをまず全クリアしてから書き込み
    try {
      console.log('📝 write-back STEP7: クリア開始 range=' + quotedTabName + '!A1:C1000');
      await sheetsAuth.clearRange(spreadsheetId, quotedTabName + '!A1:C1000');
      console.log('📝 write-back STEP7: クリア完了');
    } catch (clearErr) {
      var clearErrMsg = (clearErr && clearErr.message) ? String(clearErr.message) : String(clearErr);
      console.warn('⚠️ クリア失敗（続行）:', clearErrMsg);
    }

    var range = quotedTabName + '!A1:C' + rows.length;
    console.log('📝 write-back STEP8: 書き込み開始 range=' + range);
    await sheetsAuth.updateRange(spreadsheetId, range, rows);
    console.log('📝 write-back STEP8: 書き込み完了');

    // キーワード管理シートのステータスを更新
    if (rowIndex) {
      console.log('📝 write-back STEP9: ステータス更新 row=' + rowIndex);
      var statusRange = KEYWORD_SHEET_NAME + '!C' + rowIndex + ':D' + rowIndex;
      await sheetsAuth.updateRange(spreadsheetId, statusRange, [['処理済み', safeTabName]]);
    }

    console.log('✅ 構成案をSpreadsheetに書き込み完了:', safeTabName, rows.length + '行');
    if (!res.headersSent) {
      return res.status(200).end(JSON.stringify({ success: true, tabName: safeTabName, rowCount: rows.length }));
    }
  } catch (err) {
    var writeErrMsg = '書き込みに失敗しました。';
    try {
      writeErrMsg = (err && err.message) ? String(err.message) : String(err);
    } catch (e2) { /* ignore */ }
    console.error('❌ outline-batch/write-back エラー: ' + writeErrMsg);
    if (!res.headersSent) {
      res.status(500).end(JSON.stringify({ error: writeErrMsg }));
    }
  }
});

// ────────────────────────────────────────────────
// GET /api/outline-batch/read-outline
// SpreadsheetタブからJSON形式の構成案を読み込む
// query: { spreadsheetId, tabName }
// ────────────────────────────────────────────────
router.get('/read-outline', async function(req, res) {
  var spreadsheetId = (req.query.spreadsheetId || '').trim();
  var tabName       = (req.query.tabName || '').trim();

  if (!spreadsheetId || !tabName) {
    return res.status(400).json({ error: 'spreadsheetId と tabName パラメータが必要です。' });
  }

  try {
    // シート名をrange記法で安全に引用符で囲む
    var quotedReadTabName = "'" + tabName.replace(/'/g, "''") + "'";
    // ヘッダー行(1行目)はスキップして2行目から読む
    var rows = await sheetsAuth.readRange(spreadsheetId, quotedReadTabName + '!A2:C1000');

    // SeoOutlineV2 形式に変換
    var outline = {
      title: '',
      metaDescription: '',
      targetAudience: '',
      introductions: {
        conclusionFirst: '',
        empathy: '',
      },
      outline: [],
      conclusion: '',
      keywords: [],
      competitorComparison: {
        averageH2Count: 0,
        averageH3Count: 0,
        ourH2Count: 0,
        ourH3Count: 0,
        freshnessRisks: [],
        differentiators: [],
      },
      searchIntent: {
        primary: 'KNOW',
      },
    };

    var currentSection = null;

    for (var i = 0; i < rows.length; i++) {
      var row     = rows[i];
      var type    = (row[0] || '').trim();
      var content = (row[1] || '').trim();
      var note    = (row[2] || '').trim();

      if (!type && !content) continue;

      if (type === 'タイトル') {
        outline.title = content;
      } else if (type === 'メタ説明') {
        outline.metaDescription = content;
      } else if (type === '対象読者') {
        outline.targetAudience = content;
      } else if (type === 'リード文A（結論先行型）' || type === 'リード文A') {
        outline.introductions.conclusionFirst = content;
      } else if (type === 'リード文B（共感型）' || type === 'リード文B') {
        outline.introductions.empathy = content;
      } else if (type === 'H2') {
        // 前のセクションを追加
        if (currentSection) {
          outline.outline.push(currentSection);
        }
        currentSection = {
          heading: content,
          subheadings: [],
          writingNote: note,
          imageSuggestion: '',
        };
      } else if (type === 'H3') {
        if (currentSection) {
          currentSection.subheadings.push({
            text: content,
            writingNote: note,
          });
        }
      }
    }

    // 最後のセクションを追加
    if (currentSection) {
      outline.outline.push(currentSection);
    }

    // H2/H3数を集計
    outline.competitorComparison.ourH2Count = outline.outline.length;
    var totalH3 = 0;
    for (var k = 0; k < outline.outline.length; k++) {
      totalH3 += outline.outline[k].subheadings.length;
    }
    outline.competitorComparison.ourH3Count = totalH3;

    console.log('✅ outline-batch/read-outline 完了: H2=' + outline.outline.length + ' H3=' + totalH3);
    return res.json({ success: true, outline: outline });
  } catch (err) {
    console.error('❌ outline-batch/read-outline エラー:', err);
    return res.status(500).json({ error: err.message || '読み込みに失敗しました。' });
  }
});

// ────────────────────────────────────────────────
// PUT /api/outline-batch/update-status
// body: { spreadsheetId, rowIndex, status, tabName? }
// ────────────────────────────────────────────────
router.put('/update-status', async function(req, res) {
  var body          = req.body || {};
  var spreadsheetId = (body.spreadsheetId || '').trim();
  var rowIndex      = body.rowIndex;
  var status        = (body.status || '').trim();
  var tabName       = (body.tabName || '').trim();

  if (!spreadsheetId || !rowIndex || !status) {
    return res.status(400).json({ error: 'spreadsheetId, rowIndex, status は必須です。' });
  }

  try {
    var range = KEYWORD_SHEET_NAME + '!C' + rowIndex + ':D' + rowIndex;
    await sheetsAuth.updateRange(spreadsheetId, range, [[status, tabName]]);
    console.log('✅ ステータス更新: row=' + rowIndex + ' status=' + status);
    return res.json({ success: true });
  } catch (err) {
    console.error('❌ outline-batch/update-status エラー:', err);
    return res.status(500).json({ error: err.message || 'ステータス更新に失敗しました。' });
  }
});

module.exports = router;
