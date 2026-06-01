/**
 * .docx → HTML 変換エンドポイント
 * POST /api/docx-convert
 */

const express = require('express');
const router = express.Router();
const multer = require('multer');
const mammoth = require('mammoth');

// メモリストレージ
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB上限
  fileFilter: function(req, file, cb) {
    if (file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      || file.originalname.endsWith('.docx')) {
      cb(null, true);
    } else {
      cb(new Error('.docxファイルのみアップロード可能です'));
    }
  }
});

// multer を Promise でラップ（エラーを確実に捕捉するため）
function runMulter(req, res) {
  return new Promise(function(resolve, reject) {
    upload.single('file')(req, res, function(err) {
      if (err) { reject(err); } else { resolve(); }
    });
  });
}

// POST /api/docx-convert
router.post('/', async function(req, res) {
  try {
    // multer でファイルを受け取る
    await runMulter(req, res);

    if (!req.file) {
      return res.status(400).json({ error: 'ファイルが送信されていません。' });
    }

    console.log('📄 docx変換開始:', req.file.originalname, req.file.size + 'bytes');

    // .docx → HTML 変換
    const result = await mammoth.convertToHtml(
      { buffer: req.file.buffer },
      {
        styleMap: [
          "p[style-name='Heading 1'] => h1:fresh",
          "p[style-name='Heading 2'] => h2:fresh",
          "p[style-name='Heading 3'] => h3:fresh",
        ]
      }
    );

    const rawHtml = result.value;
    console.log('✅ docx変換完了: HTML長さ =', rawHtml.length);

    // メタ情報と本文を分離
    let title = '';
    let metaDescription = '';
    let keyword = '';
    let clientId = '';
    let articleHtml = rawHtml;

    const h1Match = rawHtml.match(/<h1>([\s\S]*?)<\/h1>/);
    if (h1Match) {
      title = h1Match[1].replace(/<[^>]+>/g, '').trim();
    }

    const metaMatch = rawHtml.match(/<p>__META__:\s*([\s\S]*?)<\/p>/);
    if (metaMatch) {
      metaDescription = metaMatch[1].replace(/<[^>]+>/g, '').trim();
    }

    const kwMatch = rawHtml.match(/<p>__KEYWORD__:\s*([\s\S]*?)<\/p>/);
    if (kwMatch) {
      keyword = kwMatch[1].replace(/<[^>]+>/g, '').trim();
    }

    const cidMatch = rawHtml.match(/<p>__CLIENT_ID__:\s*([\s\S]*?)<\/p>/);
    if (cidMatch) {
      clientId = cidMatch[1].replace(/<[^>]+>/g, '').trim();
    }

    const sepIdx = rawHtml.indexOf('<p>__SEPARATOR__</p>');
    if (sepIdx !== -1) {
      articleHtml = rawHtml.substring(sepIdx + '<p>__SEPARATOR__</p>'.length).trim();
    } else {
      articleHtml = rawHtml
        .replace(/<h1>[\s\S]*?<\/h1>/, '')
        .replace(/<p>__META__:[\s\S]*?<\/p>/, '')
        .replace(/<p>__KEYWORD__:[\s\S]*?<\/p>/, '')
        .replace(/<p>__CLIENT_ID__:[\s\S]*?<\/p>/, '')
        .trim();
    }

    res.json({
      success: true,
      title: title,
      metaDescription: metaDescription,
      keyword: keyword,
      clientId: clientId,
      htmlContent: articleHtml,
      warnings: result.messages,
    });

  } catch (err) {
    console.error('❌ docx変換エラー:', err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: 'docxの変換に失敗しました: ' + err.message });
    }
  }
});

module.exports = router;
