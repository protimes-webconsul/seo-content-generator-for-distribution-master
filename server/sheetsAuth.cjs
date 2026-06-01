// Google Sheets 自動認証モジュール（driveAutoAuth.cjs と同パターン）
const { google } = require('googleapis');
const path = require('path');
const fs = require('fs');

class SheetsAuth {
  constructor() {
    this.sheets = null;
    this.lastAuthTime = null;
    this.AUTH_TIMEOUT = 50 * 60 * 1000; // 50分
  }

  /**
   * 認証状態を確認し、必要に応じて更新
   */
  async ensureAuthenticated() {
    const now = Date.now();

    if (
      !this.sheets ||
      !this.lastAuthTime ||
      now - this.lastAuthTime > this.AUTH_TIMEOUT
    ) {
      console.log('🔄 Google Sheets 認証を更新中...');
      try {
        await this.initializeSheetsClient();
        this.lastAuthTime = now;
        console.log(
          '✅ Sheets 認証成功（次回更新: ' +
            new Date(now + this.AUTH_TIMEOUT).toLocaleTimeString() +
            '）'
        );
      } catch (error) {
        console.error('❌ Sheets 認証エラー:', error.message);
        throw error;
      }
    }

    return this.sheets;
  }

  /**
   * Sheets API クライアントを初期化
   * GOOGLE_APPLICATION_CREDENTIALS の相対パスをプロジェクトルートから絶対パスに変換して解決
   */
  async initializeSheetsClient() {
    // GOOGLE_APPLICATION_CREDENTIALS の相対パスをプロジェクトルート基準の絶対パスに変換
    const rawCredPath = process.env.GOOGLE_APPLICATION_CREDENTIALS || '';
    if (rawCredPath && !path.isAbsolute(rawCredPath)) {
      // __dirname = server/ フォルダ、.. = プロジェクトルート
      const projectRoot = path.join(__dirname, '..');
      const absolutePath = path.join(projectRoot, rawCredPath);
      if (fs.existsSync(absolutePath)) {
        process.env.GOOGLE_APPLICATION_CREDENTIALS = absolutePath;
        console.log('🔑 サービスアカウントJSON（絶対パスに変換）:', absolutePath);
      } else {
        console.warn('⚠️ GOOGLE_APPLICATION_CREDENTIALS のファイルが見つかりません:', absolutePath);
        console.warn('   .env の設定: ' + rawCredPath);
      }
    }

    const auth = new google.auth.GoogleAuth({
      scopes: [
        'https://www.googleapis.com/auth/spreadsheets',
      ],
    });

    const authClient = await auth.getClient();
    this.sheets = google.sheets({ version: 'v4', auth: authClient });
  }

  /**
   * スプレッドシートの指定範囲を読み込む
   * @param {string} spreadsheetId
   * @param {string} range  例: 'clients!A2:E'
   */
  async readRange(spreadsheetId, range) {
    const sheets = await this.ensureAuthenticated();

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range,
    });

    const values = response.data.values;
    if (!values) {
      return [];
    }
    return values;
  }

  /**
   * スプレッドシートの指定範囲に行を追加（append）
   * @param {string} spreadsheetId
   * @param {string} range
   * @param {Array}  values  2次元配列
   */
  async appendRow(spreadsheetId, range, values) {
    const sheets = await this.ensureAuthenticated();

    const response = await sheets.spreadsheets.values.append({
      spreadsheetId,
      range,
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values },
    });

    return response.data;
  }

  /**
   * スプレッドシートの指定範囲を更新（update）
   * @param {string} spreadsheetId
   * @param {string} range  例: 'clients!A5:E5'
   * @param {Array}  values  2次元配列
   */
  async updateRange(spreadsheetId, range, values) {
    const sheets = await this.ensureAuthenticated();

    const response = await sheets.spreadsheets.values.update({
      spreadsheetId,
      range,
      valueInputOption: 'RAW',
      requestBody: { values },
    });

    return response.data;
  }

  /**
   * 新しいシートタブを追加する
   * @param {string} spreadsheetId
   * @param {string} sheetTitle  タブ名
   */
  async addSheet(spreadsheetId, sheetTitle) {
    const sheets = await this.ensureAuthenticated();

    const response = await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            addSheet: {
              properties: {
                title: sheetTitle,
              },
            },
          },
        ],
      },
    });

    return response.data;
  }

  /**
   * 指定範囲の値をクリア（行削除の代わりに使用）
   * @param {string} spreadsheetId
   * @param {string} range
   */
  async clearRange(spreadsheetId, range) {
    const sheets = await this.ensureAuthenticated();

    const response = await sheets.spreadsheets.values.clear({
      spreadsheetId,
      range,
    });

    return response.data;
  }
}

// シングルトンインスタンスをエクスポート
module.exports = new SheetsAuth();
