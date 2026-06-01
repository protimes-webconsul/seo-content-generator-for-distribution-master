/**
 * 参考資料（独自情報ソース）サービス
 * バックエンドAPIとの通信 + AIによる構造化分析 + プロンプト用テキスト整形
 */

import { GoogleGenerativeAI } from "@google/generative-ai";

export interface ReferenceMaterial {
  id: string;
  originalFileName: string;
  fileType: string;
  fileSize: number;
  title: string;
  description: string;
  tags: string[];
  uploadedAt: string;
  extractedTextLength: number;
  status: string;
}

export interface ReferenceMaterialWithContent extends ReferenceMaterial {
  extractedText: string;
}

// プロンプトに注入するテキストの最大文字数
const MAX_PROMPT_CHARS = 15000;

function getApiBase(): string {
  const viteApiUrl = import.meta.env.VITE_API_URL;
  if (viteApiUrl) {
    return String(viteApiUrl).replace("/api", "");
  }
  const backendUrl = import.meta.env.VITE_BACKEND_URL;
  if (backendUrl) {
    return String(backendUrl);
  }
  return "http://localhost:3010";
}

function getApiKey(): string {
  return String(import.meta.env.VITE_INTERNAL_API_KEY || "");
}

function getHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  const apiKey = getApiKey();
  if (apiKey) {
    headers["x-api-key"] = apiKey;
  }
  return headers;
}

/**
 * ファイルをアップロード
 */
export async function uploadMaterial(
  file: File,
  title?: string,
  description?: string,
  tags?: string[]
): Promise<ReferenceMaterial> {
  const formData = new FormData();
  formData.append("file", file);
  if (title) formData.append("title", title);
  if (description) formData.append("description", description);
  if (tags && tags.length > 0) formData.append("tags", JSON.stringify(tags));

  const response = await fetch(
    getApiBase() + "/api/reference-materials/upload",
    {
      method: "POST",
      headers: getHeaders(),
      body: formData,
    }
  );

  if (!response.ok) {
    const err = await response.json().catch(function () {
      return { error: "アップロードに失敗しました" };
    });
    throw new Error(err.error || "アップロードに失敗しました");
  }

  const data = await response.json();
  return data.material;
}

/**
 * 参考資料一覧を取得
 */
export async function listMaterials(
  tags?: string[]
): Promise<ReferenceMaterial[]> {
  let url = getApiBase() + "/api/reference-materials";
  if (tags && tags.length > 0) {
    url += "?tags=" + encodeURIComponent(tags.join(","));
  }

  const response = await fetch(url, {
    headers: getHeaders(),
  });

  if (!response.ok) {
    const err = await response.json().catch(function () {
      return { error: "一覧取得に失敗しました" };
    });
    throw new Error(err.error || "一覧取得に失敗しました");
  }

  const data = await response.json();
  return data.materials || [];
}

/**
 * 抽出テキストを取得
 */
export async function getExtractedText(
  id: string
): Promise<{ title: string; originalFileName: string; extractedText: string }> {
  const response = await fetch(
    getApiBase() + "/api/reference-materials/" + id,
    {
      headers: getHeaders(),
    }
  );

  if (!response.ok) {
    const err = await response.json().catch(function () {
      return { error: "テキスト取得に失敗しました" };
    });
    throw new Error(err.error || "テキスト取得に失敗しました");
  }

  return response.json();
}

/**
 * 参考資料を削除
 */
export async function deleteMaterial(id: string): Promise<void> {
  const response = await fetch(
    getApiBase() + "/api/reference-materials/" + id,
    {
      method: "DELETE",
      headers: getHeaders(),
    }
  );

  if (!response.ok) {
    const err = await response.json().catch(function () {
      return { error: "削除に失敗しました" };
    });
    throw new Error(err.error || "削除に失敗しました");
  }
}

/**
 * 選択された参考資料のIDリストから、AIプロンプト用コンテキストを構築
 */
export async function buildPromptContext(
  selectedIds: string[]
): Promise<string> {
  if (!selectedIds || selectedIds.length === 0) {
    return "";
  }

  console.log(
    "📚 参考資料コンテキスト構築中...",
    selectedIds.length,
    "件"
  );

  // 各資料のテキストを取得
  const materialsWithContent: Array<{
    title: string;
    originalFileName: string;
    extractedText: string;
  }> = [];

  for (let i = 0; i < selectedIds.length; i++) {
    try {
      const data = await getExtractedText(selectedIds[i]);
      materialsWithContent.push(data);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(
        "⚠️ 参考資料テキスト取得失敗 (ID: " + selectedIds[i] + "):",
        errMsg
      );
    }
  }

  if (materialsWithContent.length === 0) {
    return "";
  }

  // 合計文字数を計算し、必要に応じてトランケート
  let totalChars = 0;
  for (let i = 0; i < materialsWithContent.length; i++) {
    totalChars += materialsWithContent[i].extractedText.length;
  }

  const needsTruncation = totalChars > MAX_PROMPT_CHARS;
  const charPerMaterial = needsTruncation
    ? Math.floor(MAX_PROMPT_CHARS / materialsWithContent.length)
    : 0;

  // コンテキストテキスト組み立て
  const parts: string[] = [];

  for (let i = 0; i < materialsWithContent.length; i++) {
    const m = materialsWithContent[i];
    let text = m.extractedText;

    if (needsTruncation && text.length > charPerMaterial) {
      text = text.substring(0, charPerMaterial) + "\n（以下省略）";
    }

    parts.push(
      "--- 参考資料" +
        (i + 1) +
        ": " +
        m.title +
        " (出典: " +
        m.originalFileName +
        ") ---\n" +
        text
    );
  }

  const context = parts.join("\n\n");

  console.log(
    "✅ 参考資料コンテキスト構築完了:",
    materialsWithContent.length,
    "件,",
    context.length,
    "文字"
  );

  return context;
}

/**
 * 参考資料をAIで分析し、記事テーマに関連する情報を構造化して抽出する
 *
 * @param selectedIds 選択された参考資料のIDリスト
 * @param keyword 記事のターゲットキーワード
 * @returns 構造化された分析結果テキスト（構成案・執筆プロンプト両方で使用）
 */
export async function analyzeForArticle(
  selectedIds: string[],
  keyword: string
): Promise<string> {
  if (!selectedIds || selectedIds.length === 0) {
    return "";
  }

  var apiKey =
    import.meta.env.VITE_GEMINI_API_KEY || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn("⚠️ Gemini APIキー未設定のためフォールバック（生テキスト注入）");
    return buildPromptContext(selectedIds);
  }

  console.log(
    "🔬 参考資料のAI分析開始...",
    selectedIds.length,
    "件 / キーワード:",
    keyword
  );

  // 各資料のテキストを取得
  var materialsWithContent: Array<{
    title: string;
    originalFileName: string;
    extractedText: string;
  }> = [];

  for (var i = 0; i < selectedIds.length; i++) {
    try {
      var data = await getExtractedText(selectedIds[i]);
      materialsWithContent.push(data);
    } catch (err) {
      var errMsg = err instanceof Error ? err.message : String(err);
      console.error(
        "⚠️ 参考資料テキスト取得失敗 (ID: " + selectedIds[i] + "):",
        errMsg
      );
    }
  }

  if (materialsWithContent.length === 0) {
    return "";
  }

  // 各資料のテキストを準備（8000文字ずつに制限）
  var MAX_PER_MATERIAL = 8000;
  var rawParts: string[] = [];
  for (var j = 0; j < materialsWithContent.length; j++) {
    var m = materialsWithContent[j];
    var text = m.extractedText;
    if (text.length > MAX_PER_MATERIAL) {
      text = text.substring(0, MAX_PER_MATERIAL) + "\n（以下省略）";
    }
    rawParts.push(
      "【資料" + (j + 1) + "】" + m.title + "（" + m.originalFileName + "）\n" + text
    );
  }
  var rawText = rawParts.join("\n\n");

  // Geminiで構造化分析
  try {
    var genAI = new GoogleGenerativeAI(apiKey);
    var model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 4096,
      },
    });

    var analysisPrompt = "あなたはSEOコンテンツの資料分析の専門家です。\n" +
      "以下の参考資料から、記事テーマ「" + keyword + "」に関連する情報を抽出・構造化してください。\n\n" +
      "【分析対象の参考資料】\n" + rawText + "\n\n" +
      "【抽出ルール】\n" +
      "以下のカテゴリに分けて、記事に活用できる情報を抽出してください。\n" +
      "各項目は具体的な数値・固有名詞を含め、記事本文にそのまま引用できる粒度で記載してください。\n" +
      "該当する情報がないカテゴリは「該当なし」と記載してください。\n\n" +
      "■ 独自データ・統計\n" +
      "（自社調査の数値、アンケート結果、実績データなど。数値・母数・時点を明記）\n\n" +
      "■ 専門的知見・ノウハウ\n" +
      "（業界の専門家としての見解、独自の方法論、実務上のポイントなど）\n\n" +
      "■ 導入事例・成功体験\n" +
      "（クライアント企業名、課題、施策、具体的な成果・数値。Before/Afterで記載）\n\n" +
      "■ 業界トレンド・市場情報\n" +
      "（市場規模、成長率、法改正、技術動向など。年・出典を明記）\n\n" +
      "■ 比較・選定基準\n" +
      "（サービス比較のポイント、料金体系、機能差分など）\n\n" +
      "■ FAQ・よくある課題\n" +
      "（顧客からの質問、よくある誤解、注意すべき落とし穴など）\n\n" +
      "■ 記事への活用提案\n" +
      "（上記の情報を記事のどの部分に、どのように挿入すると効果的かを3-5個提案。\n" +
      "  例: 「リード文で〇〇の統計を引用し、課題の深刻さを示す」\n" +
      "  例: 「H2『導入事例』で□□社の成功体験をBefore/After形式で紹介」）\n\n" +
      "【重要】\n" +
      "- 記事テーマ「" + keyword + "」との関連性が高い情報を優先すること\n" +
      "- 資料に含まれない情報を捏造しないこと\n" +
      "- 各項目に出典元の資料名を明記すること（例: 出典: 資料1「〇〇」）\n" +
      "- E-E-A-T（経験・専門性・権威性・信頼性）を高める情報を重点的に抽出すること";

    console.log("🤖 Gemini Flash で参考資料を分析中...");
    var startTime = Date.now();

    var result = await model.generateContent(analysisPrompt);
    var analysisResult = result.response.text();

    var elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(
      "✅ 参考資料分析完了: " + elapsed + "秒, " + analysisResult.length + "文字"
    );

    // 分析結果を整形して返す
    var output =
      "【参考資料AI分析結果】\n" +
      "分析対象: " + materialsWithContent.length + "件の資料 / 記事テーマ: 「" + keyword + "」\n" +
      "出典資料: " + materialsWithContent.map(function (mat, idx) {
        return "資料" + (idx + 1) + "「" + mat.title + "」";
      }).join("、") + "\n\n" +
      analysisResult;

    return output;
  } catch (err) {
    var analyzeErr = err instanceof Error ? err.message : String(err);
    console.error("⚠️ AI分析に失敗。生テキストにフォールバック:", analyzeErr);
    // フォールバック: 従来の生テキスト注入
    return buildPromptContext(selectedIds);
  }
}

/**
 * ファイルサイズを読みやすい形式に変換
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}
