/**
 * 記事保存・管理 API
 * ローカルファイルシステムを使った CRUD エンドポイント
 *
 * 保存先: server/data/articles/{clientId}/{clientName}_{YYYYMMDD}_{keyword}.json
 */

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const DATA_DIR = path.join(__dirname, '..', 'data', 'articles');

// data ディレクトリがなければ作成
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// ────────────────────────────────────────────────
// ヘルパー関数
// ────────────────────────────────────────────────

/**
 * ファイル名に使えない文字を除去
 */
function sanitizeForFilename(str) {
  return (str || '')
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, '')
    .trim()
    .slice(0, 40); // 長すぎる場合は切り詰め
}

/**
 * 命名規則: {clientName}_{YYYYMMDD}_{keyword}
 */
function buildBaseFilename(clientName, keyword) {
  const now = new Date();
  const y = now.getFullYear().toString();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const dateStr = y + m + d;
  const safeName = sanitizeForFilename(clientName || '未選択');
  const safeKeyword = sanitizeForFilename(keyword || 'nokey');
  return safeName + '_' + dateStr + '_' + safeKeyword;
}

/**
 * 重複ファイル名を避けて連番付きファイル名を返す
 */
function resolveFilename(clientDir, baseFilename) {
  let filename = baseFilename + '.json';
  if (!fs.existsSync(path.join(clientDir, filename))) {
    return filename;
  }
  let counter = 2;
  while (fs.existsSync(path.join(clientDir, baseFilename + '_' + counter + '.json'))) {
    counter++;
  }
  return baseFilename + '_' + counter + '.json';
}

/**
 * 全ディレクトリをスキャンして指定 ID のファイルを探す
 * 戻り値: { filePath, data } or null
 */
function findArticleById(articleId) {
  if (!fs.existsSync(DATA_DIR)) return null;
  const dirs = fs.readdirSync(DATA_DIR);
  for (let i = 0; i < dirs.length; i++) {
    const dirPath = path.join(DATA_DIR, dirs[i]);
    if (!fs.statSync(dirPath).isDirectory()) continue;
    const files = fs.readdirSync(dirPath);
    for (let j = 0; j < files.length; j++) {
      if (!files[j].endsWith('.json')) continue;
      const filePath = path.join(dirPath, files[j]);
      try {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        if (data.id === articleId) {
          return { filePath: filePath, data: data };
        }
      } catch (e) {
        // 破損ファイルはスキップ
      }
    }
  }
  return null;
}

// ────────────────────────────────────────────────
// GET /api/articles  → 保存済み記事一覧
// ────────────────────────────────────────────────
router.get('/', function(req, res) {
  const clientIdFilter = req.query.clientId || null;
  const articles = [];

  try {
    if (!fs.existsSync(DATA_DIR)) {
      return res.json({ articles: [] });
    }

    const dirs = fs.readdirSync(DATA_DIR);
    for (let i = 0; i < dirs.length; i++) {
      const dirPath = path.join(DATA_DIR, dirs[i]);
      if (!fs.statSync(dirPath).isDirectory()) continue;
      if (clientIdFilter && dirs[i] !== clientIdFilter) continue;

      const files = fs.readdirSync(dirPath);
      for (let j = 0; j < files.length; j++) {
        if (!files[j].endsWith('.json')) continue;
        try {
          const data = JSON.parse(fs.readFileSync(path.join(dirPath, files[j]), 'utf8'));
          articles.push({
            id: data.id,
            clientId: data.clientId,
            clientName: data.clientName,
            keyword: data.keyword,
            status: data.status,
            createdAt: data.createdAt,
            updatedAt: data.updatedAt,
            filename: files[j],
            title: (data.article && data.article.title)
              ? data.article.title
              : (data.outline ? data.outline.title : ''),
          });
        } catch (e) {
          console.error('記事ファイル読み込みエラー:', files[j], e.message);
        }
      }
    }

    // 更新日時の降順でソート
    articles.sort(function(a, b) {
      return new Date(b.updatedAt) - new Date(a.updatedAt);
    });

    res.json({ articles: articles });
  } catch (err) {
    console.error('記事一覧取得エラー:', err.message);
    res.status(500).json({ error: '記事一覧の取得に失敗しました。' });
  }
});

// ────────────────────────────────────────────────
// GET /api/articles/:id  → 記事を1件取得
// ────────────────────────────────────────────────
router.get('/:id', function(req, res) {
  const result = findArticleById(req.params.id);
  if (!result) {
    return res.status(404).json({ error: '記事が見つかりません。' });
  }
  res.json({ article: result.data });
});

// ────────────────────────────────────────────────
// POST /api/articles  → 新規保存（構成案 or 構成案+記事）
// ────────────────────────────────────────────────
router.post('/', function(req, res) {
  const body = req.body || {};
  const clientId = body.clientId || 'none';
  const clientName = body.clientName || '未選択';
  const keyword = body.keyword || 'unknown';

  try {
    const clientDir = path.join(DATA_DIR, clientId);
    if (!fs.existsSync(clientDir)) {
      fs.mkdirSync(clientDir, { recursive: true });
    }

    const id = uuidv4();
    const now = new Date().toISOString();
    const baseFilename = buildBaseFilename(clientName, keyword);
    const filename = resolveFilename(clientDir, baseFilename);

    const data = {
      id: id,
      clientId: clientId,
      clientName: clientName,
      keyword: keyword,
      filename: filename,
      status: body.article ? 'complete' : 'outline_only',
      createdAt: now,
      updatedAt: now,
      outline: body.outline || null,
      article: body.article || null,
    };

    fs.writeFileSync(path.join(clientDir, filename), JSON.stringify(data, null, 2), 'utf8');
    console.log('💾 記事保存:', filename);
    res.status(201).json({ id: id, filename: filename, message: '保存しました。' });
  } catch (err) {
    console.error('記事保存エラー:', err.message);
    res.status(500).json({ error: '記事の保存に失敗しました。' });
  }
});

// ────────────────────────────────────────────────
// PUT /api/articles/:id  → 上書き更新（記事追加・修正保存）
// ────────────────────────────────────────────────
router.put('/:id', function(req, res) {
  const result = findArticleById(req.params.id);
  if (!result) {
    return res.status(404).json({ error: '記事が見つかりません。' });
  }

  try {
    const body = req.body || {};
    const updated = Object.assign({}, result.data, {
      updatedAt: new Date().toISOString(),
    });

    if (body.outline !== undefined) updated.outline = body.outline;
    if (body.article !== undefined) {
      updated.article = body.article;
      updated.status = 'complete';
    }
    if (body.status !== undefined) updated.status = body.status;

    fs.writeFileSync(result.filePath, JSON.stringify(updated, null, 2), 'utf8');
    console.log('✏️ 記事更新:', result.data.filename);
    res.json({ message: '更新しました。' });
  } catch (err) {
    console.error('記事更新エラー:', err.message);
    res.status(500).json({ error: '記事の更新に失敗しました。' });
  }
});

// ────────────────────────────────────────────────
// DELETE /api/articles/:id  → 削除
// ────────────────────────────────────────────────
router.delete('/:id', function(req, res) {
  const result = findArticleById(req.params.id);
  if (!result) {
    return res.status(404).json({ error: '記事が見つかりません。' });
  }

  try {
    fs.unlinkSync(result.filePath);
    console.log('🗑️ 記事削除:', result.data.filename);
    res.json({ message: '削除しました。' });
  } catch (err) {
    console.error('記事削除エラー:', err.message);
    res.status(500).json({ error: '記事の削除に失敗しました。' });
  }
});

module.exports = router;
