// ライティングチェックエージェント Ver.3
// 執筆された記事の品質を多角的に評価・改善提案

import { GoogleGenAI } from '@google/genai';
import { curriculumDataService } from './curriculumDataService';
// latestAIModelsは汎用化のため削除

const API_KEY = import.meta.env.VITE_GEMINI_API_KEY || process.env.GEMINI_API_KEY;
const genAI = new GoogleGenAI({ apiKey: API_KEY! });

interface CheckRequest {
  article: string;
  outline: string;
  keyword: string;
  competitorInfo?: any;
}

interface CheckResult {
  overallScore: number;
  scores: {
    seo: number;
    readability: number;
    accuracy: number;
    structure: number;
    value: number;
  };
  issues: Issue[];
  improvements: Improvement[];
  rewriteSuggestions: RewriteSuggestion[];
}

interface Issue {
  severity: 'critical' | 'major' | 'minor';
  category: string;
  description: string;
  location?: string;
}

interface Improvement {
  priority: 'high' | 'medium' | 'low';
  suggestion: string;
  expectedImpact: string;
}

interface RewriteSuggestion {
  original: string;
  suggested: string;
  reason: string;
}

const CHECK_CRITERIA = `
【最重要チェック項目】🔴
1. 固有名詞の正確性（特に重要）
   - 企業名、サービス名、製品名の表記確認
   - 人名、地名の正確な表記
   - ブランド名の統一性
   - 必ずWeb検索でファクトチェックを実施

2. 定量データ・数値の正確性（特に重要）
   - 統計データ、パーセンテージの正確性
   - 金額、価格情報の妥当性
   - 日付、期限の最新性
   - 実績数値の信頼性
   - 必ずWeb検索で最新情報と照合

【SEOチェック項目】
3. キーワード配置の適切性
   - タイトル、見出し、本文での自然な使用
   - キーワード密度（2-3%が理想）
   - 関連キーワードの使用

4. 構造の正確性と執筆メモ準拠度
   - 構成案との一致度
   - 見出し階層の適切性
   - 各セクションの文字数バランス
   - 執筆メモの要点が記事に反映されているか（8割以上の要素を確認）
   - H2・H3の執筆メモで指定された内容が適切に展開されているか

5. 読みやすさ
   - 文章の明瞭性
   - 段落構成の評価：
     * 200字を超える段落がないか（長すぎる段落の検出）
     * 話題転換で段落分けされているか
     * 「しかし」「一方で」「また」などの接続詞で適切に段落分けされているか
   - 箇条書き化の機会：
     * 並列的な情報（選択肢、メリット・デメリット等）が文章で羅列されていないか
     * 3つ以上の項目が「、」で繋がれていないか
     * ステップや手順が文章で説明されていないか
   - 専門用語の説明
   - 適切な接続詞の使用

6. 情報の正確性と価値
   - 事実の正確性（特に固有名詞と数値）
   - 最新情報の反映
   - 独自の視点や分析
   - 実用的なアドバイス

7. エンゲージメント要素
   - 導入部の魅力
   - 内部リンクの提案
   - ビジュアル要素の提案

【改善フロー】
- 評価が基準値（80点）未満の場合、改善提案を実施
- 特に固有名詞と数値の誤りは即座に修正必須
- 改善後、再評価を実施し、基準値達成まで継続

【見出しタグ内の<strong>タグ使用禁止】
- <h2>〜</h2>タグ内に<strong>タグが含まれていないか確認
- <h3>〜</h3>タグ内に<strong>タグが含まれていないか確認
- 見出しタグ内に<strong>タグが見つかった場合は「major」問題として指摘
- 本文（<p>タグ内など）での<strong>タグ使用は問題なし（むしろ推奨）

【ファクト・整合性の追加チェック（重要）】
8. 数値ハルシネーション検知
   - 施工件数・創業年数・スタッフ数・店舗数・満足度・順位等の具体数値を本文から抽出
   - 構成案・執筆メモ・参考資料に根拠が記載されていない数値は「major」問題として指摘
   - 特に「1000件以上」「30年の実績」「顧客満足度95%」等の慣用的な数値はハルシネーションの可能性が高い

9. 見出し数字と本文列挙数の整合性
   - H2/H3に「〇選」「〇つ」「〇個」「〇ポイント」「〇のコツ」等の数字がある場合、配下の H3 数または <li> 数と一致するか確認
   - 一致しない場合は「major」問題として指摘（例：「7つのコツ」→H3が3個しかない）

10. 費用相場・期間の同一記事内の整合性
    - 本文と相場表で同じ坪数・面積の金額範囲が一致しているか
    - 工期の日数と週数の換算が整合しているか（例：2週間＝14日、1週間＝7日）
    - 不一致は「major」問題として指摘

11. 取引先と本部の混同
    - 呼びかけ主語（「〇〇にご相談ください」等）が本部名（アステックペイント／プロタイムズ本部）になっていないか
    - 本部事業の説明（集客戦略・ブログ代行・デジタルマーケティング支援等）が混入していないか
    - いずれも「major」問題として指摘

12. 出典の妥当性
    - 出典元が同業他社（〇〇塗装店・〇〇工務店・〇〇ペイント・外壁塗装ポータルサイト等）でないか
    - 同業他社出典は「major」問題として指摘し、公的機関・業界団体・メーカー技術資料への差し替えを提案

13. 日本語の重複・不自然表現
    - 重複動詞（するする／くるくる／いるいる等の連続）
    - 重複助詞（のの／をを／にに／がが等の連続）
    - 意味重複（必ず必要／一番最初／まず最初に／予め事前に等）
    - いずれも「minor」問題として指摘し、修正例を提示

14. AI文体の追加チェック項目
    - 「あなた」「あなたの」「あなた自身」: 記事全体で5回以内が目安 → 超えた場合は主語省略または「ご自身」「ご家族」等に置換
    - 「〜ことをおすすめします」: 1回まで → 「〜してください」または削除
    - 「〜と言えます」「〜と言えるでしょう」: 合計1回まで → 言い切るか削除
    - 「〜に他なりません」: 0回（使用禁止） → 削除
    - 「大切な住まい」「大切な建物」: 1回まで → 「住まい」「建物」のみで十分
    - 「〜において」「〜における」の過多使用: 各2回以内を目安 → 「〜で」「〜の」に言い換え

15. 出典URLの形式チェック（内容確認前に判定）
    以下のパターンは内容を見るまでもなく出典として不適切。検出した場合は「critical」問題として指摘。
    - 検索結果ページ（google.com/search, bing.com/search, yahoo.co.jp/search 等）
    - ECサイト・モール検索（amazon.co.jp/s, rakuten 検索ページ等）がキャンペーン情報の出典
    - SNSのプロフィールページ（twitter.com/xxx, instagram.com/xxx 等）が公的データの出典
    - Wikipediaが最新の公的統計の出典（数値根拠としての使用）
    - 自社ドメイン以外のページが「自社施工事例」の出典

16. CTAセクションの必須要素チェック
    末尾CTAには以下4要素のうち、最低3つが含まれているか確認する。
    1. 無料で提供する具体的サービスのリスト（箇条書き2〜4項目）
    2. 想定される相談例の具体例（「〜が知りたい」「〜を確認してほしい」等の読者の悩み言語化）
    3. 連絡手段の明示（電話・Webフォーム・LINE等）
    4. ハードルを下げる一言（「相談だけでも歓迎」「他社見積の比較目的でもOK」等）
    NG例：「お気軽にご相談ください。お問い合わせをお待ちしております。」（4要素なし）
    → 3要素未満のCTAは「minor」問題として指摘し、補完すべき要素を具体的に示す

17. 重複・冗長性チェック（LLM判定）
    記事全体で同一内容・同一説明の繰り返しをスキャンし、以下を確認する。
    - 同じ数値・相場の記載: 2回まで（H2冒頭＋まとめ）→ 超えた箇所は文脈に応じて削除・参照化
    - 同じ用語の括弧書き定義: 1回（初出のみ）→ 2回目以降は用語のみで使用
    - 隣接するH3で同じ説明ロジックを二重に書いていないか
    - 各セクション末尾に「当社では〜します」のCTA文を毎回挿入していないか（記事全体で4回まで）
    - まとめで本文の用語定義（数値基準・専門用語等）を再掲していないか
    → 完全コピペの段落は「critical」最優先。言い換えの内容重複は「major」。

【自社固有情報の取り扱い（外部検証対象外）】
以下は取引先固有のデータとして外部検証を行わず、記事の記載をそのまま使用する。
外部検索や公的データと照合してファクトエラー判定しないこと。
- 会社名・店舗名・運営会社名
- 施工実績数・対応エリア・スタッフ人数（取引先から提供されたもの）
- 自社独自の保証制度名・診断時間・キャンペーン内容
- 自社サイト掲載の事例・お客様の声
- 自社公式ドメインへのリンク
ただし、「客観的に検証可能な事実」（公的資格の有無、業界団体の加盟状況など）は確認対象とする。
`;

// ─────────────────────────────────────────────────────────────
// 機械的チェック（正規表現ベース・LLMを介さず確実に検知）
// ─────────────────────────────────────────────────────────────

/**
 * HTMLタグを除去してプレーンテキストに変換
 */
function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * 文字列内の指定位置周辺のコンテキストを抽出
 */
function extractContext(text: string, index: number, matchLength: number, radius: number = 20): string {
  const start = Math.max(0, index - radius);
  const end = Math.min(text.length, index + matchLength + radius);
  const prefix = start > 0 ? '...' : '';
  const suffix = end < text.length ? '...' : '';
  return prefix + text.substring(start, end) + suffix;
}

/**
 * 日本語重複・不自然表現の検知
 */
function checkJapaneseDuplication(html: string): Issue[] {
  const issues: Issue[] = [];
  const text = stripHtml(html);

  const patterns: Array<{ regex: RegExp; category: string; severity: 'minor' | 'major' }> = [
    {
      regex: /(する|れる|られる|せる|させる|くる|いる|ある|いく|できる)\1/g,
      category: '日本語重複（動詞の連続）',
      severity: 'minor'
    },
    {
      // 重複助詞。誤検知を最小化するため安全な助詞のみ対象（「はは=母は」「もも=桃」等は除外）
      // 「のの」は「ののしる」等の正規語があるため lookahead で除外
      regex: /(のの(?!し|さま|字|ちゃん))|((をを|にに|がが|でで))/g,
      category: '日本語重複（助詞の連続）',
      severity: 'minor'
    },
    {
      regex: /(必ず必要|一番最初|まず最初に|予め事前に|事前に予め|頭痛が痛い|馬から落馬|最後の最後|各それぞれ)/g,
      category: '日本語重複（意味重複）',
      severity: 'minor'
    },
    {
      // 「約〇〇程度」は冗長だがlookbehindで数値を確認。
      regex: /約\s*\d+[^。、]{0,10}程度/g,
      category: '日本語重複（冗長表現）',
      severity: 'minor'
    }
  ];

  patterns.forEach(function (p) {
    const found = new Set<string>();
    let m = p.regex.exec(text);
    while (m !== null) {
      const matchText = m[0];
      if (!found.has(matchText)) {
        found.add(matchText);
        const context = extractContext(text, m.index, matchText.length);
        issues.push({
          severity: p.severity,
          category: p.category,
          description: '「' + matchText + '」は日本語として不自然です。修正推奨',
          location: context
        });
      }
      m = p.regex.exec(text);
    }
  });

  return issues;
}

/**
 * 見出し数字と本文列挙数の整合性チェック
 * 例：「7つのコツ」というH2なら、配下のH3または<li>が7個あるかを確認
 */
function checkHeadingNumberConsistency(html: string): Issue[] {
  const issues: Issue[] = [];

  // H2セクションごとに分割（次のH2が出るまでを1セクションとする）
  const h2BlockRegex = /<h2[^>]*>([\s\S]*?)<\/h2>([\s\S]*?)(?=<h2|$)/gi;
  let match = h2BlockRegex.exec(html);

  while (match !== null) {
    const headingHtml = match[1];
    const bodyHtml = match[2];
    const headingText = stripHtml(headingHtml);

    // 数字+単位パターンを抽出（例：「7つのコツ」「5選」「3つのポイント」）
    const numberMatch = headingText.match(/([0-9０-９]+)\s*(選|つ|個|点|ポイント|のコツ|ステップ|つの方法|つのステップ|のメリット|のデメリット)/);

    if (numberMatch) {
      // 全角数字を半角化
      const numStr = numberMatch[1].replace(/[０-９]/g, function (c) {
        return String.fromCharCode(c.charCodeAt(0) - 0xFEE0);
      });
      const declaredNum = parseInt(numStr, 10);
      const unit = numberMatch[2];

      // 配下のH3数をカウント
      const h3Count = (bodyHtml.match(/<h3[^>]*>/gi) || []).length;
      // 配下の<li>数をカウント
      const liCount = (bodyHtml.match(/<li[^>]*>/gi) || []).length;

      // 判定基準：H3があればH3優先、なければli
      let actualNum = 0;
      let actualType = '';
      if (h3Count > 0) {
        actualNum = h3Count;
        actualType = 'H3';
      } else if (liCount > 0) {
        actualNum = liCount;
        actualType = '箇条書き項目';
      }

      if (actualNum > 0 && actualNum !== declaredNum) {
        issues.push({
          severity: 'major',
          category: '見出し数字と本文列挙数の不一致',
          description: 'H2「' + headingText + '」は「' + declaredNum + unit + '」と記載していますが、実際の' + actualType + '数は' + actualNum + '個です。見出しの数字を実態に合わせるか、' + actualType + 'を' + declaredNum + '個に揃えてください',
          location: 'H2: ' + headingText
        });
      }
    }

    match = h2BlockRegex.exec(html);
  }

  return issues;
}

/**
 * 費用相場の同一記事内整合性チェック
 * 例：本文「30坪 60万円～90万円」と表「30坪 60万円～100万円」の矛盾を検出
 */
function checkCostRangeConsistency(html: string): Issue[] {
  const issues: Issue[] = [];
  const text = stripHtml(html);

  // 「N坪」の近傍（〜60文字以内）に「X万円〜Y万円」の範囲があるパターン
  const costPattern = /([0-9０-９]{2,3})\s*坪[^。]{0,60}?([0-9０-９]+(?:\.[0-9]+)?)\s*万円\s*[〜～\-~ー]\s*([0-9０-９]+(?:\.[0-9]+)?)\s*万円/g;

  const ranges: Record<string, Array<{ min: number; max: number; raw: string }>> = {};
  const normalize = function (s: string): string {
    return s.replace(/[０-９]/g, function (c) {
      return String.fromCharCode(c.charCodeAt(0) - 0xFEE0);
    });
  };

  let m = costPattern.exec(text);
  while (m !== null) {
    const tsuboKey = normalize(m[1]);
    const min = parseFloat(normalize(m[2]));
    const max = parseFloat(normalize(m[3]));
    if (!ranges[tsuboKey]) {
      ranges[tsuboKey] = [];
    }
    ranges[tsuboKey].push({ min: min, max: max, raw: m[0] });
    m = costPattern.exec(text);
  }

  Object.keys(ranges).forEach(function (tsubo) {
    const rs = ranges[tsubo];
    if (rs.length < 2) {
      return;
    }
    const first = rs[0];
    const mismatch = rs.some(function (r) {
      return r.min !== first.min || r.max !== first.max;
    });
    if (mismatch) {
      const summary = rs.map(function (r) {
        return r.min + '〜' + r.max + '万円';
      }).join(' / ');
      issues.push({
        severity: 'major',
        category: '費用相場の数値不一致',
        description: tsubo + '坪の費用範囲が記事内で複数パターン存在します: ' + summary + '。本文と相場表で数値を完全に統一してください',
        location: '代表箇所: 「' + rs[0].raw + '」'
      });
    }
  });

  return issues;
}

/**
 * 期間の日数・週数換算の整合性チェック
 * 例：「2週間（10〜14日）」「1週間＝7日」等の換算ずれを検出
 */
function checkPeriodConsistency(html: string): Issue[] {
  const issues: Issue[] = [];
  const text = stripHtml(html);

  // パターン：「N週間（M日）」「N週間（M〜L日）」「N週間＝M日」等
  const pattern = /([0-9]+)\s*週間\s*[（(＝=]\s*(?:約\s*)?([0-9]+)\s*(?:日|〜\s*([0-9]+)\s*日)?\s*(?:日\s*(?:間)?)?\s*[)）]?/g;

  let m = pattern.exec(text);
  while (m !== null) {
    const weeks = parseInt(m[1], 10);
    const day1 = parseInt(m[2], 10);
    const day2 = m[3] ? parseInt(m[3], 10) : day1;
    const expected = weeks * 7;

    // 範囲 [day1, day2] が expected を含んでいれば OK
    const min = Math.min(day1, day2);
    const max = Math.max(day1, day2);
    const inRange = expected >= min && expected <= max;

    if (!inRange) {
      const rangeStr = day1 === day2 ? day1 + '日' : day1 + '〜' + day2 + '日';
      issues.push({
        severity: 'major',
        category: '期間の換算不一致',
        description: weeks + '週間は' + expected + '日ですが、本文では「' + rangeStr + '」と記載されています。「' + weeks + '週間（' + expected + '日）」に統一するか、表現を見直してください',
        location: '該当箇所: 「' + m[0].trim() + '」'
      });
    }
    m = pattern.exec(text);
  }

  return issues;
}

/**
 * 数値ハルシネーション（データ根拠なしの具体数値）の検知
 * 構成案・執筆メモ内に根拠が見当たらない数値を検出
 */
function checkFabrication(html: string, outline: string): Issue[] {
  const issues: Issue[] = [];
  const text = stripHtml(html);
  const outlineText = outline || '';

  // 検出対象：施工件数・創業年数・スタッフ数・店舗数・満足度・順位等の「実績系の具体数値」
  const fabricationPatterns: Array<{ regex: RegExp; category: string }> = [
    { regex: /([0-9,]+)\s*(件|棟|戸|物件)\s*(以上|超|を超える|の実績|の施工|達成)/g, category: '施工件数' },
    { regex: /創業\s*([0-9]+)\s*年(?:以上)?/g, category: '創業年数' },
    { regex: /([0-9]+)\s*年(?:以上)?\s*の(?:実績|経験|歴史)/g, category: '業歴' },
    { regex: /(?:スタッフ|職人|社員|従業員)\s*(?:数\s*)?([0-9]+)\s*(?:名|人)(?:以上)?/g, category: 'スタッフ数' },
    { regex: /(?:店舗|拠点)\s*(?:数\s*)?([0-9]+)\s*(?:店|箇所|拠点)(?:以上)?/g, category: '店舗数' },
    { regex: /(?:顧客満足度|満足度|リピート率)\s*([0-9]+)\s*%/g, category: '満足度' },
    { regex: /(?:シェア|業界|地域)\s*No\.?\s*1/gi, category: '順位' },
    { regex: /業界\s*(?:トップ|No\.?1|一?位)/g, category: '順位' }
  ];

  fabricationPatterns.forEach(function (p) {
    let m = p.regex.exec(text);
    while (m !== null) {
      const matchText = m[0];
      // 構成案・執筆メモ内に同じ数値が含まれているか確認
      // 数値部分を抽出して outline 内で検索
      const numMatch = matchText.match(/[0-9]+/);
      const num = numMatch ? numMatch[0] : '';

      let isSupported = false;
      if (num && outlineText.indexOf(num) !== -1) {
        // outline 内に同一数値があれば、さらに同じカテゴリ文脈で出現しているかを簡易確認
        // （完全な検証は難しいので、同一数値があれば一旦OKとする）
        isSupported = true;
      }

      if (!isSupported) {
        issues.push({
          severity: 'major',
          category: '数値ハルシネーション疑い（' + p.category + '）',
          description: '「' + matchText + '」は構成案・執筆メモに根拠が見当たりません。提供データに記載がある場合のみ残し、なければ定性表現（『豊富な施工実績』『地域密着』等）に置換してください',
          location: extractContext(text, m.index, matchText.length)
        });
      }
      m = p.regex.exec(text);
    }
  });

  return issues;
}

/**
 * 取引先と本部の呼称混同の検知
 * 「アステックペイントにご相談ください」等の本部名への誘導を検出
 */
function checkClientNamingMisuse(html: string): Issue[] {
  const issues: Issue[] = [];
  const text = stripHtml(html);

  // 本部名＋呼びかけ（「にご相談」「へお問い合わせ」「までご連絡」等）
  const patterns: Array<{ regex: RegExp; desc: string }> = [
    {
      regex: /(アステックペイント|プロタイムズ本部)\s*(?:に|へ|まで)\s*(?:ご相談|お問い合わせ|ご連絡|お任せ|お気軽に)/g,
      desc: '本部名を呼びかけ主語にしています。取引先（加盟店）名に置き換えるか、一般表現（『地域の専門業者』等）にしてください'
    },
    {
      regex: /(アステックペイント|プロタイムズ(?:本部)?)\s*(?:では|は)\s*(?:地域集客|集客戦略|ブログ代行|デジタル(?:マーケティング)?|マーケティング支援|広告運用)/g,
      desc: '本部事業の説明が記事本文に混入しています。加盟店の施工サービス以外の本部事業紹介は削除してください'
    },
    {
      regex: /[一-龠ぁ-んァ-ヶー]{2,10}(?:市|町|村|区)\s*(?:の|で)\s*(?:外壁塗装|屋根(?:塗装|修理)|塗装|修繕)\s*は\s*アステックペイント/g,
      desc: '「[地名]の塗装はアステックペイントに」という記述は、本部に地域拠点があるような誤認を招きます。取引先名に差し替えてください'
    }
  ];

  patterns.forEach(function (p) {
    let m = p.regex.exec(text);
    while (m !== null) {
      issues.push({
        severity: 'major',
        category: '取引先と本部の混同',
        description: p.desc,
        location: extractContext(text, m.index, m[0].length)
      });
      m = p.regex.exec(text);
    }
  });

  return issues;
}

/**
 * 出典が同業他社サイトになっていないかの検知
 */
function checkCompetitorCitation(html: string): Issue[] {
  const issues: Issue[] = [];

  // 出典タグパターン：<p class="source-citation">※出典元：タイトル（組織名・年）</p>
  const citationRegex = /<p[^>]*class="source-citation"[^>]*>[^<]*※出典元：([^（<]+)（([^）<]*)）<\/p>/gi;

  // 同業他社と推定される組織名キーワード
  const competitorKeywords = [
    '塗装店', '塗装会社', 'ペイント', '工務店', 'リフォーム店', 'リフォーム会社',
    '外壁塗装', '屋根塗装', '塗装ナビ', '塗装マッチング', '塗装見積',
    'ホームペイント', 'ベストホーム', 'ひかりペイント'
  ];

  // ホワイトリスト（メーカー・公的機関等）
  const whitelistKeywords = [
    '日本ペイント', '関西ペイント', 'エスケー化研', 'アステックペイント',
    '国土交通省', '経済産業省', '消費者庁', '環境省', '厚生労働省',
    '日本塗装工業会', '日本建築学会', '建築研究所'
  ];

  let m = citationRegex.exec(html);
  while (m !== null) {
    const title = m[1].trim();
    const org = m[2].trim();
    const combined = title + ' ' + org;

    // ホワイトリストに該当する場合はスキップ
    const isWhitelisted = whitelistKeywords.some(function (w) {
      return combined.indexOf(w) !== -1;
    });

    if (!isWhitelisted) {
      const isCompetitor = competitorKeywords.some(function (k) {
        return combined.indexOf(k) !== -1;
      });

      if (isCompetitor) {
        issues.push({
          severity: 'major',
          category: '出典に同業他社サイト',
          description: '出典元「' + title + '（' + org + '）」は同業他社（塗装業者・リフォーム業者・比較サイト等）の可能性が高いです。公的機関・業界団体・メーカー技術資料に差し替えるか、出典ごと削除してください',
          location: '出典記載箇所'
        });
      }
    }
    m = citationRegex.exec(html);
  }

  return issues;
}

/**
 * 空bold・Markdownbold漏れの検知
 * - <strong></strong> / <b></b>（内容が空またはスペースのみ）
 * - **** や ** が本文に残存（Markdown→HTML変換漏れ）
 */
function checkEmptyBold(html: string): Issue[] {
  const issues: Issue[] = [];

  // ① HTML空bold: <strong></strong> または <b></b>（空・スペースのみ）
  const emptyHtmlBoldRegex = /<(strong|b)>\s*<\/\1>/gi;
  let m = emptyHtmlBoldRegex.exec(html);
  while (m !== null) {
    issues.push({
      severity: 'minor',
      category: 'HTML空bold',
      description: '空の<' + m[1] + '>タグが検出されました。削除してください',
      location: extractContext(html, m.index, m[0].length)
    });
    m = emptyHtmlBoldRegex.exec(html);
  }

  // ② Markdown bold記法の残存: **** または単独の **〜** パターン
  // 「****」= 空のMarkdown bold
  const emptyMarkdownBoldRegex = /\*{4}/g;
  let m2 = emptyMarkdownBoldRegex.exec(html);
  while (m2 !== null) {
    issues.push({
      severity: 'major',
      category: 'Markdown記法漏れ（空bold）',
      description: '「****」がMarkdown記法として残存しています。削除またはHTMLに変換してください',
      location: extractContext(html, m2.index, m2[0].length)
    });
    m2 = emptyMarkdownBoldRegex.exec(html);
  }

  // ③ Markdown bold記法の残存: **テキスト** パターン（HTMLに変換されず残ったもの）
  const markdownBoldRegex = /\*\*([^*\n]{1,50})\*\*/g;
  let m3 = markdownBoldRegex.exec(html);
  while (m3 !== null) {
    issues.push({
      severity: 'major',
      category: 'Markdown記法漏れ（bold）',
      description: '「**' + m3[1] + '**」がMarkdown記法として残存しています。<strong>タグに変換してください',
      location: extractContext(html, m3.index, m3[0].length)
    });
    m3 = markdownBoldRegex.exec(html);
  }

  return issues;
}

/**
 * ①重複・冗長性チェック（機械的に計量できる部分）
 * - 完全重複段落
 * - 自社CTA文の過多（4回超）
 * - 自社名の過多出現（5回超）
 * - 対応エリア地名列挙の過多（5箇所超）
 */
function checkDuplication(html: string): Issue[] {
  const issues: Issue[] = [];
  const text = stripHtml(html);

  // ── 完全重複段落 ──
  const paraMatches = html.match(/<p[^>]*>([\s\S]*?)<\/p>/gi) || [];
  const paraSet = new Set<string>();
  paraMatches.forEach(function (p) {
    const stripped = stripHtml(p).trim();
    if (stripped.length < 25) return;
    if (paraSet.has(stripped)) {
      issues.push({
        severity: 'critical',
        category: '段落の完全重複',
        description: '以下の段落が記事内で完全に重複しています（最優先で削除してください）：「' + stripped.slice(0, 60) + '…」',
        location: stripped.slice(0, 60)
      });
    }
    paraSet.add(stripped);
  });

  // ── 自社CTA文カウント（「〜では○○します」「〜にお任せください」型） ──
  const ctaPattern = /(?:では|では、)[^。]{0,40}(?:します|いたします|行います|実施します|対応します|承ります|提供します)/g;
  const ctaMatches = text.match(ctaPattern) || [];
  if (ctaMatches.length > 4) {
    issues.push({
      severity: 'minor',
      category: '自社CTA文の過多',
      description: '自社CTA文（「〜では○○します」型）が' + ctaMatches.length + '回検出されました（許容4回まで）。中盤の繰り返しを削減してください',
      location: '記事全体'
    });
  }

  // ── 対応エリア地名列挙の過多 ──
  // 「○○市・○○市」「○○市や○○市」など複数地名が並んでいる箇所をカウント
  const areaListPattern = /[一-龠ぁ-んァ-ヶ]{2,6}(?:市|町|村|区)\s*[・、，,や]\s*[一-龠ぁ-んァ-ヶ]{2,6}(?:市|町|村|区)/g;
  const areaMatches = text.match(areaListPattern) || [];
  if (areaMatches.length > 5) {
    issues.push({
      severity: 'minor',
      category: '対応エリア地名列挙の過多',
      description: '地名の複数列挙が' + areaMatches.length + '箇所検出されました（許容5箇所まで）。CTA・冒頭・主要セクションに限定し、中間セクションでは省略を検討してください',
      location: '記事全体'
    });
  }

  // ── 会社名（店舗名）の過多出現 ──
  // 「○○塗装店」「○○工務店」等のパターンで最多出現の名称を検出
  const companyPattern = /[一-龠ぁ-んァ-ヶA-Za-z0-9]{2,10}(?:塗装店|工務店|リフォーム|ペイント|建装|建設)/g;
  const companyMatches = text.match(companyPattern) || [];
  const companyCounts: Record<string, number> = {};
  companyMatches.forEach(function (n) {
    companyCounts[n] = (companyCounts[n] || 0) + 1;
  });
  Object.keys(companyCounts).forEach(function (name) {
    if (companyCounts[name] > 6) {
      issues.push({
        severity: 'minor',
        category: '会社名の過多出現',
        description: '「' + name + '」が' + companyCounts[name] + '回出現しています（目安6回まで）。中盤では「同店」「当社」「こちら」等の略称の使用を検討してください',
        location: '記事全体'
      });
    }
  });

  return issues;
}

/**
 * ②HTML構造チェック
 * - 見出し階層のジャンプ（H2→H4など）
 * - 見出し直後の生テキスト（<p>タグ漏れ）
 */
function checkHtmlStructure(html: string): Issue[] {
  const issues: Issue[] = [];

  // 見出し階層のジャンプ検出
  const headingTagPattern = /<h([1-6])[^>]*>/gi;
  const headings: number[] = [];
  let hm = headingTagPattern.exec(html);
  while (hm !== null) {
    headings.push(parseInt(hm[1], 10));
    hm = headingTagPattern.exec(html);
  }
  for (let i = 1; i < headings.length; i++) {
    const prev = headings[i - 1];
    const curr = headings[i];
    if (curr > prev + 1) {
      issues.push({
        severity: 'major',
        category: '見出し階層エラー',
        description: 'H' + prev + 'の次にH' + curr + 'が来ています（H' + (prev + 1) + 'をスキップ）。見出し階層を正しく修正してください',
        location: 'H' + prev + ' → H' + curr
      });
      break; // 最初の1件のみ報告
    }
  }

  // 見出し直後に <p> タグなしで30文字以上のテキストが続く場合（タグ漏れの可能性）
  const rawAfterHeadingPattern = /<\/h[23]>\s*([^<\n]{30,})/gi;
  let rm = rawAfterHeadingPattern.exec(html);
  while (rm !== null) {
    const rawText = rm[1].trim();
    if (rawText.length > 0) {
      issues.push({
        severity: 'minor',
        category: '見出し直後の生テキスト（<p>タグ漏れ疑い）',
        description: '見出しの直後にHTMLタグなしのテキストが続いています。<p>タグで囲んでください：「' + rawText.slice(0, 40) + '…」',
        location: rawText.slice(0, 50)
      });
    }
    rm = rawAfterHeadingPattern.exec(html);
  }

  return issues;
}

/**
 * ④出典URLの不正パターンチェック
 * - 検索結果ページ
 * - SNSプロフィール
 * - Wikipedia（統計出典として使用）
 * - ECサイト検索ページ
 */
function checkInvalidSourceUrls(html: string): Issue[] {
  const issues: Issue[] = [];

  const hrefPattern = /href="(https?:\/\/[^"]{5,})"/gi;
  let m = hrefPattern.exec(html);
  while (m !== null) {
    const url = m[1];
    // 出典文脈かどうか（前後300文字に出典・参考・source等が含まれるか）
    const ctx = html.slice(Math.max(0, m.index - 300), m.index + 300);
    const isSourceCtx = /(?:source-citation|出典|参考|参照|引用)/i.test(ctx);

    if (/(?:google|bing|yahoo|goo\.ne).*?(?:\/search|\?q=|\?p=)/i.test(url)) {
      issues.push({
        severity: 'critical',
        category: '出典URL不正（検索結果ページ）',
        description: '検索結果ページが出典URLに使用されています。実際のコンテンツページのURLに差し替えてください',
        location: url.slice(0, 100)
      });
    } else if (
      isSourceCtx &&
      /(?:amazon\.co\.jp\/s|rakuten\.co\.jp\/search|shopping\.yahoo)/i.test(url)
    ) {
      issues.push({
        severity: 'major',
        category: '出典URL要確認（ECサイト検索）',
        description: 'ECサイトの検索・一覧ページが出典に使用されています。公的機関・業界団体の資料に差し替えてください',
        location: url.slice(0, 100)
      });
    } else if (
      isSourceCtx &&
      /(?:twitter\.com|x\.com|instagram\.com|facebook\.com|tiktok\.com)\/[A-Za-z0-9_@.]+\/?$/i.test(url)
    ) {
      issues.push({
        severity: 'major',
        category: '出典URL不正（SNSプロフィール）',
        description: 'SNSのプロフィールページが出典に使用されています。公式サイトや公的資料のURLに差し替えてください',
        location: url.slice(0, 100)
      });
    } else if (
      isSourceCtx &&
      /wikipedia\.org/i.test(url)
    ) {
      issues.push({
        severity: 'major',
        category: '出典URL要確認（Wikipedia）',
        description: 'Wikipediaが出典に使用されています。統計・数値の根拠として使用する場合は公的機関・研究機関の一次ソースに差し替えてください',
        location: url.slice(0, 100)
      });
    }

    m = hrefPattern.exec(html);
  }

  return issues;
}

/**
 * 全ての機械的チェックを実行
 */
function runMechanicalChecks(article: string, outline: string): Issue[] {
  const allIssues: Issue[] = [];
  try {
    allIssues.push.apply(allIssues, checkJapaneseDuplication(article));
  } catch (e) {
    console.warn('⚠️ checkJapaneseDuplication 失敗:', e);
  }
  try {
    allIssues.push.apply(allIssues, checkHeadingNumberConsistency(article));
  } catch (e) {
    console.warn('⚠️ checkHeadingNumberConsistency 失敗:', e);
  }
  try {
    allIssues.push.apply(allIssues, checkDuplication(article));
  } catch (e) {
    console.warn('⚠️ checkDuplication 失敗:', e);
  }
  try {
    allIssues.push.apply(allIssues, checkHtmlStructure(article));
  } catch (e) {
    console.warn('⚠️ checkHtmlStructure 失敗:', e);
  }
  try {
    allIssues.push.apply(allIssues, checkInvalidSourceUrls(article));
  } catch (e) {
    console.warn('⚠️ checkInvalidSourceUrls 失敗:', e);
  }
  try {
    allIssues.push.apply(allIssues, checkCostRangeConsistency(article));
  } catch (e) {
    console.warn('⚠️ checkCostRangeConsistency 失敗:', e);
  }
  try {
    allIssues.push.apply(allIssues, checkPeriodConsistency(article));
  } catch (e) {
    console.warn('⚠️ checkPeriodConsistency 失敗:', e);
  }
  try {
    allIssues.push.apply(allIssues, checkFabrication(article, outline));
  } catch (e) {
    console.warn('⚠️ checkFabrication 失敗:', e);
  }
  try {
    allIssues.push.apply(allIssues, checkClientNamingMisuse(article));
  } catch (e) {
    console.warn('⚠️ checkClientNamingMisuse 失敗:', e);
  }
  try {
    allIssues.push.apply(allIssues, checkCompetitorCitation(article));
  } catch (e) {
    console.warn('⚠️ checkCompetitorCitation 失敗:', e);
  }
  try {
    allIssues.push.apply(allIssues, checkEmptyBold(article));
  } catch (e) {
    console.warn('⚠️ checkEmptyBold 失敗:', e);
  }
  return allIssues;
}

export async function checkArticleV3(request: CheckRequest): Promise<CheckResult> {
  console.log('🔍 ライティングチェックV3 開始');

  // ── ① 機械的チェック（正規表現ベース・即時実行）──
  console.log('🔧 機械的チェック実行中...');
  const mechanicalIssues = runMechanicalChecks(request.article, request.outline || '');
  console.log('✅ 機械的チェック完了: ' + mechanicalIssues.length + '件の問題を検知');
  if (mechanicalIssues.length > 0) {
    const categoryCount: Record<string, number> = {};
    mechanicalIssues.forEach(function (i) {
      categoryCount[i.category] = (categoryCount[i.category] || 0) + 1;
    });
    Object.keys(categoryCount).forEach(function (c) {
      console.log('  ・' + c + ': ' + categoryCount[c] + '件');
    });
  }

  try {
    const prompt = `
あなたはSEOとコンテンツマーケティングの専門家です。
以下の記事を厳密に評価し、改善提案を行ってください。

${CHECK_CRITERIA}

【評価対象記事】
${request.article.slice(0, 30000)} // 最初の30000文字

【元の構成案（執筆メモ含む）】
${request.outline}

【ターゲットキーワード】
${request.keyword}

【執筆メモ準拠度の確認指示】
構成案に含まれる「執筆メモ」（writingNote）を確認し、以下を評価してください：
- 各H2・H3の執筆メモで指定された要点が記事に含まれているか
- 特に重要な数値、事例、具体的な内容が反映されているか
- 執筆メモの要素が8割以上記事に反映されているか確認
- もし重要な要素が欠けている場合は、具体的に何が足りないか指摘

【評価タスク】
1. 各項目を100点満点で採点
2. 重大な問題点を3つまで指摘（特に段落が長すぎる箇所を優先的に指摘）
3. 改善提案を5つまで提示（以下を必ず含める）：
   - 200字を超える段落があれば、具体的な分割位置を提案
   - 箇条書きにすべき箇所があれば、具体的な変換例を提示
   - 話題転換での段落分けが必要な箇所を指摘
4. 書き直しが必要な箇所を3つまで特定

【JSON形式で出力】
{
  "overallScore": 85,
  "scores": {
    "seo": 90,
    "readability": 85,
    "accuracy": 88,
    "structure": 92,
    "value": 80
  },
  "issues": [
    {
      "severity": "major",
      "category": "サービス訴求",
      "description": "サービスの強みが十分に訴求されていない",
      "location": "リード文"
    }
  ],
  "improvements": [
    {
      "priority": "high",
      "suggestion": "2箇所のCTA必須配置を確認（リード文末、記事文末）",
      "expectedImpact": "コンバージョン率15%向上"
    }
  ],
  "rewriteSuggestions": [
    {
      "original": "サービスを検討することができます。",
      "suggested": "実践型の研修サービスなら、助成金を活用しながら即戦力人材を育成できます。",
      "reason": "冗長表現の削除とサービスの価値訴求"
    }
  ]
}
`;

    const result = await genAI.models.generateContent({
      model: "gemini-3.1-pro-preview",
      contents: prompt,
      config: {
        temperature: 0.3, // より正確な評価のため低めに設定
        maxOutputTokens: 16384, // 4096から16384に拡大（テスト結果より）
        responseMimeType: "application/json"
      }
    });
    const response = result.text || '';

    try {
      const checkResult = JSON.parse(response) as CheckResult;

      // ── ② 機械的チェック結果を LLM 結果の issues にマージ ──
      const mergedIssues = mergeIssues(checkResult.issues || [], mechanicalIssues);
      checkResult.issues = mergedIssues;

      // ── ③ 機械チェックで major 以上が検知されたら accuracy / structure スコアを減点 ──
      const majorMechanical = mechanicalIssues.filter(function (i) {
        return i.severity === 'major' || i.severity === 'critical';
      }).length;
      if (majorMechanical > 0 && checkResult.scores) {
        const penalty = Math.min(30, majorMechanical * 5);
        checkResult.scores.accuracy = Math.max(0, (checkResult.scores.accuracy || 80) - penalty);
        checkResult.scores.structure = Math.max(0, (checkResult.scores.structure || 80) - Math.floor(penalty / 2));
        // 総合スコアを再計算
        const s = checkResult.scores;
        checkResult.overallScore = Math.round(((s.seo || 0) + (s.readability || 0) + (s.accuracy || 0) + (s.structure || 0) + (s.value || 0)) / 5);
        console.log('📉 機械チェックでmajor' + majorMechanical + '件検知のため accuracy を' + penalty + '点減点');
      }

      console.log('✅ チェック完了 - 総合スコア:', checkResult.overallScore, '（LLM: ' + (checkResult.issues.length - mechanicalIssues.length) + '件 + 機械: ' + mechanicalIssues.length + '件）');
      return checkResult;
    } catch (parseError) {
      console.error('JSONパースエラー:', parseError);
      // フォールバック結果でも機械チェック結果は保持
      const fallback = createFallbackResult();
      fallback.issues = mergeIssues(fallback.issues, mechanicalIssues);
      return fallback;
    }

  } catch (error) {
    console.error('❌ チェックエラー:', error);
    throw error;
  }
}

/**
 * LLM 由来の issues と機械チェック由来の issues をマージ
 * 重複を除外しつつ、severity 高い順に並べ替え
 */
function mergeIssues(llmIssues: Issue[], mechanicalIssues: Issue[]): Issue[] {
  const all = (llmIssues || []).concat(mechanicalIssues || []);
  // 同一 category + description の重複を除外
  const seen = new Set<string>();
  const unique = all.filter(function (i) {
    const key = (i.category || '') + '|' + (i.description || '').substring(0, 50);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
  // severity の重い順にソート
  const order: Record<string, number> = { critical: 0, major: 1, minor: 2 };
  unique.sort(function (a, b) {
    return (order[a.severity] || 9) - (order[b.severity] || 9);
  });
  return unique;
}

// 競合比較チェック
export async function compareWithCompetitors(
  article: string,
  competitorArticles: string[]
): Promise<{
  strengths: string[];
  weaknesses: string[];
  opportunities: string[];
}> {
  console.log('📊 競合比較分析開始');
  
  const prompt = `
【自社記事】
${article.slice(0, 5000)}

【競合記事サンプル】
${competitorArticles.map((a, i) => `競合${i + 1}: ${a.slice(0, 1000)}`).join('\n\n')}

以下の観点で比較分析してください：
1. 情報の網羅性
2. 独自性・差別化
3. 実用性
4. 構成・読みやすさ

【分析結果】
強み、弱み、改善機会を箇条書きで提示してください。
`;

  console.log('🔄 競合分析中...');
  const result = await genAI.models.generateContent({
    model: "gemini-3.1-pro-preview",
    contents: prompt,
    config: {
      temperature: 0.4,
      maxOutputTokens: 2048,
    }
  });
  const text = result.text || '';
  
  // テキストから強み・弱み・機会を抽出（簡易パース）
  const analysisResult = parseCompetitiveAnalysis(text);
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  
  console.log(`✅ 競合分析完了 (${elapsed}秒)`);
  console.log(`  ・強み: ${analysisResult.strengths.length}点`);
  console.log(`  ・弱み: ${analysisResult.weaknesses.length}点`);
  console.log(`  ・機会: ${analysisResult.opportunities.length}点`);
  
  return analysisResult;
}

// リアルタイム改善提案
export async function getSuggestionForSection(
  section: string,
  context: string
): Promise<string> {
  const prompt = `
【現在のセクション】
${section}

【文脈】
${context.slice(-500)}

このセクションを改善する具体的な提案を1つ提供してください。
簡潔に、実行可能な形で。
`;

  const result = await genAI.models.generateContent({
    model: "gemini-3.1-pro-preview",
    contents: prompt,
    config: {
      temperature: 0.5,
      maxOutputTokens: 512,
    }
  });
  return result.text || '';
}

// ヘルパー関数
function createFallbackResult(): CheckResult {
  return {
    overallScore: 70,
    scores: {
      seo: 70,
      readability: 70,
      accuracy: 70,
      structure: 70,
      value: 70
    },
    issues: [
      {
        severity: 'minor',
        category: 'General',
        description: '自動評価を完了できませんでした',
      }
    ],
    improvements: [
      {
        priority: 'medium',
        suggestion: '手動でのレビューを推奨します',
        expectedImpact: '品質向上'
      }
    ],
    rewriteSuggestions: []
  };
}

// JSON生成テスト関数
export async function testJsonGeneration() {
  console.log('🧪 JSON生成テスト開始');
  console.log('=====================================');

  const tests = [
    {
      name: "最小限のテスト（100文字）",
      articleLength: 100,
      useJsonMimeType: true,
      maxOutputTokens: 4096
    },
    {
      name: "短い記事（1000文字）",
      articleLength: 1000,
      useJsonMimeType: true,
      maxOutputTokens: 4096
    },
    {
      name: "中程度の記事（5000文字・16384トークン）",
      articleLength: 5000,
      useJsonMimeType: true,
      maxOutputTokens: 16384
    },
    {
      name: "長い記事（10000文字・16384トークン）",
      articleLength: 10000,
      useJsonMimeType: true,
      maxOutputTokens: 16384
    },
    {
      name: "やや長い記事（15000文字・16384トークン）",
      articleLength: 15000,
      useJsonMimeType: true,
      maxOutputTokens: 16384
    },
    {
      name: "激烈に長い記事（20000文字・16384トークン）",
      articleLength: 20000,
      useJsonMimeType: true,
      maxOutputTokens: 16384
    },
    {
      name: "めちゃくちゃ爆裂に長い記事（50000文字・16384トークン）",
      articleLength: 50000,
      useJsonMimeType: true,
      maxOutputTokens: 16384
    }
  ];

  const results = [];

  for (const test of tests) {
    console.log(`\n📝 テスト: ${test.name}`);
    console.log(`   記事長: ${test.articleLength}文字`);
    console.log(`   MimeType: ${test.useJsonMimeType ? 'application/json' : 'なし'}`);
    console.log(`   MaxTokens: ${test.maxOutputTokens}`);

    try {
      // テスト用の記事を生成
      const testArticle = `<h2>テスト記事</h2>
<p>これはテスト用の記事です。${"あいうえお".repeat(Math.floor(test.articleLength / 10))}</p>
<h3>サブセクション</h3>
<p>詳細な内容がここに入ります。</p>`;

      const testConfig: any = {
        temperature: 0.3,
        maxOutputTokens: test.maxOutputTokens,
      };

      if (test.useJsonMimeType) {
        testConfig.responseMimeType = "application/json";
      }

      const prompt = `
以下の記事を評価して、JSON形式で結果を返してください。

【評価対象記事】
${testArticle.slice(0, test.articleLength)}

【評価項目】
- 総合スコア（0-100）
- 改善点（3つまで）

【JSON形式】
{
  "overallScore": 数値,
  "issues": [
    {
      "severity": "major/minor",
      "description": "問題の説明"
    }
  ],
  "testInfo": {
    "receivedLength": 実際に受信した文字数,
    "processedSuccessfully": true/false
  }
}`;

      const startTime = Date.now();
      const result = await genAI.models.generateContent({
        model: "gemini-3.1-pro-preview",
        contents: prompt,
        config: testConfig
      });
      const response = result.text || '';
      const elapsed = Date.now() - startTime;

      console.log(`   ✅ レスポンス受信: ${response.length}文字（${elapsed}ms）`);

      // JSONパースを試みる
      try {
        const parsed = JSON.parse(response);
        console.log(`   ✅ JSONパース成功`);
        console.log(`   スコア: ${parsed.overallScore}`);
        results.push({
          test: test.name,
          success: true,
          responseLength: response.length,
          time: elapsed,
          score: parsed.overallScore
        });
      } catch (parseError) {
        console.log(`   ❌ JSONパースエラー: ${parseError.message}`);
        console.log(`   レスポンス冒頭: ${response.slice(0, 100)}...`);
        results.push({
          test: test.name,
          success: false,
          responseLength: response.length,
          time: elapsed,
          error: parseError.message
        });
      }

    } catch (error) {
      console.log(`   ❌ API呼び出しエラー: ${error.message}`);
      results.push({
        test: test.name,
        success: false,
        error: error.message
      });
    }

    // API制限を考慮して少し待機
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  // 結果サマリー
  console.log('\n=====================================');
  console.log('📊 テスト結果サマリー');
  console.log('=====================================');

  const successCount = results.filter(r => r.success).length;
  console.log(`成功: ${successCount}/${results.length}`);

  console.log('\n詳細:');
  results.forEach(r => {
    const status = r.success ? '✅' : '❌';
    console.log(`${status} ${r.test}`);
    if (r.success) {
      console.log(`   - レスポンス: ${r.responseLength}文字`);
      console.log(`   - 処理時間: ${r.time}ms`);
      console.log(`   - スコア: ${r.score}`);
    } else {
      console.log(`   - エラー: ${r.error}`);
    }
  });

  return results;
}

function parseCompetitiveAnalysis(text: string): {
  strengths: string[];
  weaknesses: string[];
  opportunities: string[];
} {
  // 簡易的なテキスト解析
  const lines = text.split('\n');
  const result = {
    strengths: [] as string[],
    weaknesses: [] as string[],
    opportunities: [] as string[]
  };
  
  let currentSection = '';
  
  for (const line of lines) {
    if (line.includes('強み') || line.includes('Strengths')) {
      currentSection = 'strengths';
    } else if (line.includes('弱み') || line.includes('Weaknesses')) {
      currentSection = 'weaknesses';
    } else if (line.includes('機会') || line.includes('Opportunities')) {
      currentSection = 'opportunities';
    } else if (line.trim().startsWith('-') || line.trim().startsWith('・')) {
      const item = line.replace(/^[\-・]\s*/, '').trim();
      if (item && currentSection) {
        result[currentSection as keyof typeof result].push(item);
      }
    }
  }
  
  return result;
}