/**
 * リンクチェッカーAPI
 * 記事内のURLを検証し、リンク切れ（404等）を検出する
 */

const fetch = require("node-fetch");

/**
 * POST /api/check-links
 * Body: { urls: string[] }
 * Returns: { results: Array<{ url, status, ok, redirectUrl?, error? }> }
 */
async function handleCheckLinks(req, res) {
  try {
    var urls = req.body && req.body.urls ? req.body.urls : [];

    if (!Array.isArray(urls) || urls.length === 0) {
      return res.status(400).json({ error: "URLリストが必要です" });
    }

    // 最大50URLまで
    if (urls.length > 50) {
      urls = urls.slice(0, 50);
    }

    console.log("🔗 リンクチェック開始:", urls.length, "件");

    var results = [];

    for (var i = 0; i < urls.length; i++) {
      var url = urls[i];

      // 無効なURLはスキップ
      if (!url || (!url.startsWith("http://") && !url.startsWith("https://"))) {
        results.push({
          url: url,
          status: 0,
          ok: false,
          error: "無効なURL形式",
        });
        continue;
      }

      try {
        var UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

        // まずリダイレクトを自動追跡してHEADリクエスト
        var response = await fetch(url, {
          method: "HEAD",
          timeout: 10000,
          redirect: "follow",
          headers: { "User-Agent": UA },
        });

        var statusCode = response.status;
        var finalUrl = response.url || url;
        var redirectUrl = finalUrl !== url ? finalUrl : "";

        // HEADが405（Method Not Allowed）の場合はGETで再試行
        if (statusCode === 405) {
          response = await fetch(url, {
            method: "GET",
            timeout: 10000,
            redirect: "follow",
            headers: { "User-Agent": UA },
          });
          statusCode = response.status;
          finalUrl = response.url || url;
          redirectUrl = finalUrl !== url ? finalUrl : "";
        }

        var isOk = statusCode >= 200 && statusCode < 300;

        results.push({
          url: url,
          status: statusCode,
          ok: isOk,
          redirectUrl: redirectUrl || undefined,
        });

        console.log(
          "  " + (isOk ? "✅" : "❌") + " [" + statusCode + "] " + url.substring(0, 80)
        );
      } catch (err) {
        results.push({
          url: url,
          status: 0,
          ok: false,
          error: err.message || "接続エラー",
        });
        console.log("  ❌ [ERR] " + url.substring(0, 80) + " - " + err.message);
      }

      // レート制限対策: リクエスト間のディレイ
      if (i < urls.length - 1) {
        await new Promise(function (resolve) {
          setTimeout(resolve, 300);
        });
      }
    }

    var okCount = results.filter(function (r) { return r.ok; }).length;
    var errorCount = results.length - okCount;
    console.log(
      "🔗 リンクチェック完了: " + okCount + "件OK / " + errorCount + "件エラー"
    );

    res.json({ success: true, results: results });
  } catch (err) {
    console.error("❌ リンクチェックエラー:", err.message);
    res.status(500).json({ error: err.message });
  }
}

/**
 * POST /api/verify-citations
 * Body: { citations: Array<{ url: string, title: string }> }
 * 出典タイトルでGoogle検索し、記事内URLが正しいか検証する
 * Returns: { results: Array<{ url, title, verified, suggestedUrl?, suggestedTitle?, matchType }> }
 */
async function handleVerifyCitations(req, res) {
  try {
    var citations =
      req.body && req.body.citations ? req.body.citations : [];

    if (!Array.isArray(citations) || citations.length === 0) {
      return res.status(400).json({ error: "出典リストが必要です" });
    }

    var googleApiKey = process.env.GOOGLE_API_KEY;
    var searchEngineId = process.env.GOOGLE_SEARCH_ENGINE_ID;

    if (!googleApiKey || !searchEngineId) {
      return res.status(500).json({
        error: "GOOGLE_API_KEY または GOOGLE_SEARCH_ENGINE_ID が未設定です",
      });
    }

    // 最大20件まで
    if (citations.length > 20) {
      citations = citations.slice(0, 20);
    }

    console.log("🔍 出典URL検証開始:", citations.length, "件");
    var results = [];

    for (var i = 0; i < citations.length; i++) {
      var citation = citations[i];
      var articleUrl = citation.url || "";
      var title = citation.title || "";

      if (!title) {
        results.push({
          url: articleUrl,
          title: title,
          verified: false,
          matchType: "no_title",
          message: "出典タイトルが空です",
        });
        continue;
      }

      try {
        // Google Custom Search APIで出典タイトルを検索
        var searchQuery = encodeURIComponent(title);
        var searchUrl =
          "https://www.googleapis.com/customsearch/v1" +
          "?key=" + googleApiKey +
          "&cx=" + searchEngineId +
          "&q=" + searchQuery +
          "&num=5";

        var searchResponse = await fetch(searchUrl, { timeout: 15000 });

        if (!searchResponse.ok) {
          var errText = await searchResponse.text();
          console.error(
            "  ❌ Google Search API エラー:", errText.substring(0, 200)
          );
          results.push({
            url: articleUrl,
            title: title,
            verified: false,
            matchType: "search_error",
            message: "Google検索APIエラー",
          });
          continue;
        }

        var searchData = await searchResponse.json();
        var searchItems =
          searchData && searchData.items ? searchData.items : [];

        if (searchItems.length === 0) {
          results.push({
            url: articleUrl,
            title: title,
            verified: false,
            matchType: "not_found",
            message: "Google検索で該当ページが見つかりませんでした",
          });
          console.log("  ⚠️ 検索結果なし: " + title.substring(0, 50));
          continue;
        }

        // 検索結果から最も近いものを探す
        var bestMatch = null;
        var bestScore = 0;

        for (var j = 0; j < searchItems.length; j++) {
          var item = searchItems[j];
          var itemUrl = item.link || "";
          var itemTitle = item.title || "";
          var score = 0;

          // URL完全一致
          if (normalizeUrl(itemUrl) === normalizeUrl(articleUrl)) {
            score += 100;
          }

          // ドメイン一致
          var itemDomain = getDomain(itemUrl);
          var articleDomain = getDomain(articleUrl);
          if (itemDomain && articleDomain && itemDomain === articleDomain) {
            score += 20;
          }

          // タイトル一致度
          var titleSimilarity = calcSimilarity(
            title.toLowerCase(),
            itemTitle.toLowerCase()
          );
          score += Math.round(titleSimilarity * 50);

          if (score > bestScore) {
            bestScore = score;
            bestMatch = {
              url: itemUrl,
              title: itemTitle,
              score: score,
            };
          }
        }

        if (!bestMatch) {
          results.push({
            url: articleUrl,
            title: title,
            verified: false,
            matchType: "no_match",
            message: "検索結果と記事内URLが一致しませんでした",
          });
          continue;
        }

        // 判定
        var urlMatch =
          normalizeUrl(bestMatch.url) === normalizeUrl(articleUrl);

        if (urlMatch) {
          // URL一致 → 検証OK
          results.push({
            url: articleUrl,
            title: title,
            verified: true,
            matchType: "exact",
            message: "URLが検索結果と一致",
          });
          console.log("  ✅ 一致: " + title.substring(0, 40));
        } else {
          // URL不一致 → 修正候補を返す
          results.push({
            url: articleUrl,
            title: title,
            verified: false,
            matchType: "mismatch",
            suggestedUrl: bestMatch.url,
            suggestedTitle: bestMatch.title,
            message:
              "URLが検索結果と異なります。正しいURLの候補: " + bestMatch.url,
          });
          console.log(
            "  ❌ 不一致: " +
              title.substring(0, 30) +
              "\n     記事: " +
              articleUrl.substring(0, 70) +
              "\n     候補: " +
              bestMatch.url.substring(0, 70)
          );
        }
      } catch (err) {
        results.push({
          url: articleUrl,
          title: title,
          verified: false,
          matchType: "error",
          message: "検証中にエラー: " + err.message,
        });
        console.error("  ❌ 検証エラー: " + err.message);
      }

      // レート制限対策
      if (i < citations.length - 1) {
        await new Promise(function (resolve) {
          setTimeout(resolve, 500);
        });
      }
    }

    var verifiedCount = results.filter(function (r) {
      return r.verified;
    }).length;
    var mismatchCount = results.filter(function (r) {
      return r.matchType === "mismatch";
    }).length;
    console.log(
      "🔍 出典検証完了: " +
        verifiedCount +
        "件一致 / " +
        mismatchCount +
        "件不一致 / " +
        results.length +
        "件中"
    );

    res.json({ success: true, results: results });
  } catch (err) {
    console.error("❌ 出典検証エラー:", err.message);
    res.status(500).json({ error: err.message });
  }
}

/**
 * URLを正規化（末尾スラッシュ、プロトコル、www等を統一）
 */
function normalizeUrl(url) {
  if (!url) return "";
  return url
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/+$/, "")
    .toLowerCase();
}

/**
 * URLからドメインを抽出
 */
function getDomain(url) {
  try {
    var match = url.match(/^https?:\/\/(?:www\.)?([^\/\?#]+)/i);
    return match ? match[1].toLowerCase() : "";
  } catch (e) {
    return "";
  }
}

/**
 * 2つの文字列の類似度を計算（0-1）
 * 共通部分文字列の割合で簡易判定
 */
function calcSimilarity(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;

  // 短い方を基準に、共通する文字の割合
  var shorter = a.length <= b.length ? a : b;
  var longer = a.length > b.length ? a : b;
  var matchCount = 0;

  // 3文字以上のn-gramで一致を数える
  var gramSize = 3;
  if (shorter.length < gramSize) return 0;

  var longerGrams = {};
  for (var i = 0; i <= longer.length - gramSize; i++) {
    var gram = longer.substring(i, i + gramSize);
    longerGrams[gram] = (longerGrams[gram] || 0) + 1;
  }

  for (var j = 0; j <= shorter.length - gramSize; j++) {
    var sGram = shorter.substring(j, j + gramSize);
    if (longerGrams[sGram] && longerGrams[sGram] > 0) {
      matchCount++;
      longerGrams[sGram]--;
    }
  }

  var totalGrams = shorter.length - gramSize + 1;
  return totalGrams > 0 ? matchCount / totalGrams : 0;
}

module.exports = { handleCheckLinks, handleVerifyCitations };
