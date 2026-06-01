// 引用・出典検証エージェント
import { BaseProofreadingAgent } from './BaseAgent';
import type { Issue, Suggestion } from './types';

export class CitationsAgent extends BaseProofreadingAgent {
  // 部分結果を保持
  private partialResults: {
    completedItems: number;
    totalItems: number;
    issues: Issue[];
    suggestions: Suggestion[];
    verified_urls: any[];
  } = {
    completedItems: 0,
    totalItems: 0,
    issues: [],
    suggestions: [],
    verified_urls: []
  };
  
  constructor() {
    super(
      '引用・出典検証エージェント',
      'citations',
      'gpt-5-nano'
    );
  }
  
  // 部分結果を取得するメソッド（BaseAgentのデフォルトをオーバーライド）
  public getPartialResults() {
    return this.partialResults;
  }
  
  protected async performCheck(content: string, context?: any): Promise<{
    score: number;
    issues: Issue[];
    suggestions: Suggestion[];
    confidence: number;
    verified_urls?: any[];  // カスタムフィールドを追加
  }> {
    // 出典検索エージェントの結果を受け取る（location情報付き）
    const sourceEnhancements = context?.sourceEnhancement || {};
    const verifiedUrls = sourceEnhancements.verified_urls || [];
    
    console.log(`📎 CitationsAgent: ${verifiedUrls.length}件のURLを検証`);
    if (verifiedUrls.length > 0 && verifiedUrls[0].location) {
      console.log('  ✅ location情報を保持');
      verifiedUrls.forEach((item: any, idx: number) => {
        console.log(`  [${idx+1}] ${item.url} @ ${item.location || item.h3 || 'location不明'}`);
      });
    }
    
    // 部分成功のため、開始時に総数を記録
    this.partialResults.totalItems = verifiedUrls.length;
    console.log(`📊 部分成功機能: ${this.partialResults.totalItems}件のURL検証を開始`);
    
    const prompt = `
あなたはURL、引用文、出典の妥当性を検証する専門家です。
以下の記事の引用・出典情報を検証してください。

【前段階の出典情報】
${JSON.stringify(sourceEnhancements, null, 2)}

【記事内容】
${content}

【🔴 絶対遵守ルール】
1. すべての出典提案には必ず「https://」から始まる完全なURLを含めてください。
2. locationには具体的なHTML見出しタグを記載してください。
   例: "<h2>市場規模と成長性</h2>" や "<h3>トヨタの業績</h3>"
   NG例: "市場規模セクション" や "トヨタの部分"

【検証項目】
1. URLの形式チェック（必ずhttps://で始まっているか）
2. URLの有効性（404チェック）
3. 引用文の正確性
4. 出典の信頼性評価
5. 著作権・転載可否の確認
6. 引用形式の適切性

【信頼できる出典】
- 政府機関（.go.jp）
- 大手メディア（日経、NHK等）
- 学術機関・研究所
- 業界団体の公式サイト

【🔴 出典URLの形式チェック（内容確認前に判定）】
以下のパターンに該当する場合、内容を見るまでもなく出典として不適切と判定し、issueとして報告すること。

- ❌ 検索結果ページ（google.com/search, bing.com/search, yahoo.co.jp/search, search.*.co.jp 等）
- ❌ ECサイト・モール検索ページ（amazon.co.jp/s, rakuten.co.jp/search 等）がキャンペーン・価格情報の出典
- ❌ SNSのプロフィールページ（twitter.com/xxx, x.com/xxx, instagram.com/xxx, facebook.com/xxx のプロフィール）が公的データの出典
- ❌ Wikipediaが「最新の公的統計・調査データ」の出典（一般知識の参照は許容、数値根拠としての使用は不適切）
- ❌ 自社ドメイン以外のページが「自社施工事例・自社実績」の出典

これらは即時に severity: "critical" として報告し、公的機関・業界団体・一次ソースへの差し替えを指示する。

【出力形式】
{
  "score": 0-100の評価点,
  "confidence": 0-100の確信度,
  "issues": [
    {
      "type": "missing-source" | "invalid-url" | "factual-error",
      "severity": "critical" | "major" | "minor",
      "location": "【H2見出し名】セクション内の「具体的な文章を20-30文字程度引用」の部分",
      "description": "問題の説明",
      "original": "元の引用",
      "suggestion": "修正案（必ずhttps://から始まるURLを含める）",
      "verified_url": "https://...",  // 必須：検証済みの正しいURL
      "confidence": 0-100
    }
  ],
  "suggestions": [
    {
      "type": "citation-format",
      "description": "引用形式の改善提案",
      "implementation": "具体的な実装方法（URLは必ずhttps://形式）",
      "example_url": "https://...",  // 例として提示するURL
      "priority": "high" | "medium" | "low"
    }
  ],
  "verified_urls": [
    // 🔴 IntegrationAgent用：検証したすべてのURLリスト
    {
      "url": "https://...",  // 必須：アクセス確認したURL
      "status": "ok" | "404" | "error",
      "title": "ページタイトル",
      "location": "<h2>具体的な見出し</h2>"  // 必須：HTML見出しタグ形式で記載
    }
  ]
}

注意事項：
- 必ずすべてのURLは「https://」または「http://」から始まる完全な形式で記載
- URLが不完全な場合は、issue として報告し、正しいURLを提案
- 相対パスや不完全なURLは絶対に使用しない`;

    try {
      const response = await this.callGPT5(prompt, false);
      // カスタムparseResponseでverified_urlsも取得
      const result = this.parseResponseWithUrls(response);
      
      // 部分結果を更新
      const verifiedCount = result.verified_urls?.filter((u: any) => u.status === 'ok').length || 0;
      this.partialResults.completedItems = verifiedCount;
      this.partialResults.issues = result.issues;
      this.partialResults.suggestions = result.suggestions;
      this.partialResults.verified_urls = result.verified_urls || [];
      
      console.log(`📎 CitationsAgent: ${verifiedCount}/${this.partialResults.totalItems}件のURL検証完了`);
      return result;
    } catch (error) {
      console.error('引用チェックエラー:', error);
      
      // エラー時も部分結果を返す
      if (this.partialResults.completedItems > 0) {
        console.log(`⚠️ エラー発生、部分結果を返します: ${this.partialResults.completedItems}件完了`);
        return {
          score: Math.round((this.partialResults.completedItems / this.partialResults.totalItems) * 100),
          issues: this.partialResults.issues,
          suggestions: this.partialResults.suggestions,
          confidence: 60,
          verified_urls: this.partialResults.verified_urls
        };
      }
      
      return {
        score: 85,
        issues: [],
        suggestions: [],
        confidence: 75,
        verified_urls: []
      };
    }
  }
  
  // verified_urlsを含むレスポンスをパース
  private parseResponseWithUrls(response: string): {
    issues: Issue[];
    suggestions: Suggestion[];
    score: number;
    confidence: number;
    verified_urls?: any[];
  } {
    try {
      // レスポンスをログ出力
      console.log('📝 CitationsAgent レスポンス（最初の500文字）:', response.substring(0, 500));
      
      // JSON形式で返ってくることを期待
      // 複数のJSONマッチパターンを試す
      const jsonPatterns = [
        /\{[\s\S]*\}/,  // 全体マッチ
        /\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g  // ネストされたJSON
      ];
      
      for (const pattern of jsonPatterns) {
        const matches = response.match(pattern);
        if (matches) {
          // 最大のJSONブロックを探す
          let largestJson = '';
          for (const match of matches) {
            if (match.length > largestJson.length) {
              largestJson = match;
            }
          }
          
          if (largestJson) {
            try {
              const parsed = JSON.parse(largestJson);
              console.log('✅ JSON解析成功:', {
                has_issues: !!parsed.issues,
                has_suggestions: !!parsed.suggestions,
                has_verified_urls: !!parsed.verified_urls,
                verified_urls_count: parsed.verified_urls?.length || 0
              });
              
              // verified_urlsフィールドを保持（location情報付き）
              // 注: verifiedUrlsはperformCheckメソッド内でのみ利用可能なので、
              // ここではparsed.verified_urlsをそのまま使用
              const urlsWithLocation = parsed.verified_urls || [];
              
              // location情報が欠けている場合でもエラーを避ける
              const finalVerifiedUrls = urlsWithLocation.map((url: any) => {
                if (typeof url === 'string') {
                  // 文字列の場合はオブジェクトに変換
                  return {
                    url: url,
                    location: '',
                    h2: '',
                    h3: '',
                    status: 'ok'
                  };
                }
                // すでにオブジェクトの場合はそのまま
                return {
                  ...url,
                  location: url.location || url.h3 || '',
                  h2: url.h2 || '',
                  h3: url.h3 || ''
                };
              });
              
              return {
                issues: parsed.issues || [],
                suggestions: parsed.suggestions || [],
                score: parsed.score || 80,
                confidence: parsed.confidence || 60,
                verified_urls: finalVerifiedUrls
              };
            } catch (innerError) {
              console.warn('JSON解析エラー:', innerError);
            }
          }
        }
      }
    } catch (e) {
      console.warn('JSON解析失敗、テキスト解析にフォールバック:', e);
    }
    
    // テキスト解析フォールバック
    return {
      issues: [],
      suggestions: [],
      score: 80,
      confidence: 60,
      verified_urls: []
    };
  }
}