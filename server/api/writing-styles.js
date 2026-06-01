/**
 * 執筆スタイルサンプル API
 * 取引先ごとに最大4件のスタイルサンプルをローカルファイルで管理
 *
 * 保存先: server/data/writing-styles/{clientId}.json
 */

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data', 'writing-styles');

// data ディレクトリがなければ作成
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// ────────────────────────────────────────────────
// HTMLタグを除去してプレーンテキスト化
// ────────────────────────────────────────────────
function stripHtml(str) {
  return (str || '').replace(/<[^>]+>/g, '').trim();
}

// ────────────────────────────────────────────────
// 旧フォーマット（sampleText が直接ある）を新フォーマットに変換
// ────────────────────────────────────────────────
function migrateOldFormat(data) {
  if (data && data.sampleText !== undefined) {
    // 旧フォーマット → 新フォーマットに変換
    return {
      clientId: data.clientId || '',
      clientName: data.clientName || '',
      samples: [
        {
          id: 'sample-migrated-1',
          description: data.description || '',
          sampleText: data.sampleText || '',
          createdAt: data.createdAt || new Date().toISOString(),
          updatedAt: data.updatedAt || new Date().toISOString(),
        }
      ],
      updatedAt: data.updatedAt || new Date().toISOString(),
    };
  }
  return data;
}

// ────────────────────────────────────────────────
// GET /api/writing-styles/:clientId
// 取引先のスタイルサンプル一覧を取得
// ────────────────────────────────────────────────
router.get('/:clientId', function(req, res) {
  var clientId = req.params.clientId;
  if (!clientId) {
    return res.status(400).json({ error: 'clientId は必須です。' });
  }

  var filePath = path.join(DATA_DIR, clientId + '.json');

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'スタイルサンプルが見つかりません。' });
  }

  try {
    var raw = fs.readFileSync(filePath, 'utf-8');
    var data = JSON.parse(raw);
    // 旧フォーマットは自動マイグレーション
    var migrated = migrateOldFormat(data);
    return res.json({ sample: migrated });
  } catch (err) {
    console.error('writing-styles GET エラー:', err);
    return res.status(500).json({ error: '読み込みに失敗しました。' });
  }
});

// ────────────────────────────────────────────────
// POST /api/writing-styles/:clientId
// サンプル一覧を上書き保存（最大4件）
// body: { clientName, samples: [{id, description, sampleText, createdAt?}] }
// ────────────────────────────────────────────────
router.post('/:clientId', function(req, res) {
  var clientId = req.params.clientId;
  var body = req.body || {};
  var clientName = body.clientName || '';
  var samples = body.samples;

  if (!clientId) {
    return res.status(400).json({ error: 'clientId は必須です。' });
  }
  if (!Array.isArray(samples) || samples.length === 0) {
    return res.status(400).json({ error: 'samples は1件以上の配列で指定してください。' });
  }
  if (samples.length > 4) {
    return res.status(400).json({ error: 'スタイルサンプルは最大4件まで登録できます。' });
  }

  var now = new Date().toISOString();

  // 各サンプルのバリデーションと正規化
  var normalizedSamples = [];
  for (var i = 0; i < samples.length; i++) {
    var s = samples[i];
    if (!s || !s.sampleText || !s.sampleText.trim()) {
      return res.status(400).json({ error: 'サンプル' + (i + 1) + ' の参考文章が空です。' });
    }
    normalizedSamples.push({
      id: s.id || ('sample-' + Date.now() + '-' + i),
      description: stripHtml(s.description || ''),
      sampleText: stripHtml(s.sampleText),
      createdAt: s.createdAt || now,
      updatedAt: now,
    });
  }

  var filePath = path.join(DATA_DIR, clientId + '.json');

  var data = {
    clientId: clientId,
    clientName: clientName,
    samples: normalizedSamples,
    updatedAt: now,
  };

  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
    return res.json({ success: true, sample: data });
  } catch (err) {
    console.error('writing-styles POST エラー:', err);
    return res.status(500).json({ error: '保存に失敗しました。' });
  }
});

// ────────────────────────────────────────────────
// DELETE /api/writing-styles/:clientId
// スタイルサンプルをすべて削除
// ────────────────────────────────────────────────
router.delete('/:clientId', function(req, res) {
  var clientId = req.params.clientId;
  if (!clientId) {
    return res.status(400).json({ error: 'clientId は必須です。' });
  }

  var filePath = path.join(DATA_DIR, clientId + '.json');

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'スタイルサンプルが見つかりません。' });
  }

  try {
    fs.unlinkSync(filePath);
    return res.json({ success: true });
  } catch (err) {
    console.error('writing-styles DELETE エラー:', err);
    return res.status(500).json({ error: '削除に失敗しました。' });
  }
});

module.exports = router;
