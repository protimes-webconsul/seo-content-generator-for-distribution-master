'use strict';
/**
 * scraping-worker.js
 *
 * メインサーバー(scraping-server.js)からchild_process.spawnで起動される
 * 独立したスクレイピング専用プロセス。
 *
 * - Chromiumはこのプロセス内で起動・終了する
 * - このプロセスがクラッシュしてもメインサーバーには影響しない
 * - stdin: JSON { urls: string[] }
 * - stdout: JSON { success, results, memoryReport }
 */

// .envをプロジェクトルートから読み込む
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

var puppeteer = require('puppeteer');

var browser = null;

// ブラウザ初期化
async function initBrowser() {
  if (browser) {
    try { await browser.version(); return browser; } catch (e) { browser = null; }
  }
  browser = await puppeteer.launch({
    headless: true,
    ignoreHTTPSErrors: true,
    protocolTimeout: 60000,
    // シグナルハンドラを無効化（このプロセス専用ブラウザ）
    handleSIGINT: false,
    handleSIGTERM: false,
    handleSIGHUP: false,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--disable-gpu',
    ],
  });
  return browser;
}

// 重いサイトのパターン
var HEAVY_SITE_PATTERNS = [
  /youtube\.com/i,
  /facebook\.com/i,
  /instagram\.com/i,
  /twitter\.com/i,
  /tiktok\.com/i,
  /netflix\.com/i,
  /amazon\.com.*\/dp\//i,
  /\.pdf$/i,
];

// 1URLをスクレイピング
async function scrapeUrl(url) {
  // 重いサイト or PDFはスキップ
  if (HEAVY_SITE_PATTERNS.some(function(p) { return p.test(url); }) || url.toLowerCase().endsWith('.pdf')) {
    return { url: url, h1: '', h2Items: [], characterCount: 0, error: 'スキップ（重いサイトまたはPDF）' };
  }

  var br = await initBrowser();
  if (!br) {
    return { url: url, h1: '', h2Items: [], characterCount: 0, error: 'ブラウザ初期化失敗' };
  }

  var page = null;
  try {
    page = await br.newPage();

    // リソースブロック
    try {
      await page.setRequestInterception(true);
      page.on('request', function(req) {
        try {
          var blocked = ['image', 'stylesheet', 'font', 'media'];
          if (blocked.includes(req.resourceType())) {
            req.abort();
          } else {
            req.continue();
          }
        } catch (e) {
          try { req.continue(); } catch (e2) {}
        }
      });
    } catch (e) {}

    // ページ取得
    var timeout = parseInt(process.env.TIMEOUT_MS) || 60000;
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeout });
    } catch (gotoErr) {
      if (gotoErr.message.includes('timeout') || gotoErr.message.includes('net::')) {
        await page.goto(url, { waitUntil: 'load', timeout: 30000 });
      } else {
        throw gotoErr;
      }
    }

    // H1/H2/H3/文字数を取得
    var headings = await page.evaluate(function() {
      var h1El = document.querySelector('h1');
      var h1 = h1El ? h1El.textContent.trim() : '';

      var h2Els = document.querySelectorAll('h2');
      var h2Items = [];
      h2Els.forEach(function(h2) {
        var h3Items = [];
        var next = h2.nextElementSibling;
        while (next && next.tagName !== 'H2') {
          if (next.tagName === 'H3') h3Items.push(next.textContent.trim());
          var childH3s = next.querySelectorAll('h3');
          childH3s.forEach(function(h3) { h3Items.push(h3.textContent.trim()); });
          next = next.nextElementSibling;
        }
        h2Items.push({ text: h2.textContent.trim(), h3Items: h3Items });
      });

      return {
        h1: h1,
        h2Items: h2Items,
        characterCount: (document.body.innerText || '').length,
        title: document.title,
      };
    });

    return {
      url: url,
      h1: headings.h1,
      h2Items: headings.h2Items,
      characterCount: headings.characterCount,
      title: headings.title,
    };

  } catch (err) {
    return { url: url, h1: '', h2Items: [], characterCount: 0, error: err.message };
  } finally {
    if (page) {
      try {
        await page.evaluate(function() { window.stop(); }).catch(function() {});
        await page.close();
      } catch (e) {}
    }
  }
}

// メイン処理
async function main() {
  // stdinからURLリストをJSON形式で受け取る
  var inputData = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', function(chunk) { inputData += chunk; });

  await new Promise(function(resolve) { process.stdin.on('end', resolve); });

  var input;
  try {
    input = JSON.parse(inputData);
  } catch (e) {
    process.stderr.write(JSON.stringify({ error: 'stdin parse error: ' + e.message }));
    process.exit(1);
  }

  var urls = Array.isArray(input.urls) ? input.urls : [];
  var concurrentLimit = parseInt(process.env.CONCURRENT_LIMIT) || 3;
  var batchWaitMs = parseInt(process.env.BATCH_WAIT_MS) || 3000;

  var startMB = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
  var results = [];

  // バッチ処理
  var batches = [];
  for (var i = 0; i < urls.length; i += concurrentLimit) {
    batches.push(urls.slice(i, i + concurrentLimit));
  }

  for (var b = 0; b < batches.length; b++) {
    var batch = batches[b];
    var batchResults = await Promise.all(batch.map(function(url) { return scrapeUrl(url); }));
    results = results.concat(batchResults);

    if (b < batches.length - 1) {
      await new Promise(function(r) { setTimeout(r, batchWaitMs); });
    }
  }

  // ブラウザを正常にクローズ（同プロセス内なので安全）
  if (browser) {
    try { await browser.close(); } catch (e) {}
    browser = null;
  }

  var endMB = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
  var successCount = results.filter(function(r) { return !r.error; }).length;

  var output = {
    success: true,
    results: results,
    memoryReport: {
      startMB: startMB,
      endMB: endMB,
      memoryDiff: endMB - startMB,
      processedUrls: urls.length,
      successRate: urls.length > 0 ? Math.round((successCount / urls.length) * 100) : 0,
    },
  };

  // stdoutに結果を出力してプロセス終了
  process.stdout.write(JSON.stringify(output));
  process.exit(0);
}

main().catch(function(err) {
  process.stderr.write(JSON.stringify({ error: err.message || String(err) }));
  process.exit(1);
});
