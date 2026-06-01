/**
 * 取引先管理 API
 * Google Sheets をバックエンドとして使用した CRUD エンドポイント
 *
 * Sheets 構成:
 *   Sheet1: clients             (A: id, B: name, C: industry, D: siteUrl, E: isActive)
 *   Sheet2: writing_rules       (A: id, B: clientId, C: category, D: ruleContent)
 *   Sheet3: terminology_rules   (A: id, B: clientId, C: wrongTerms(カンマ区切り), D: correctTerm, E: note)
 *   Sheet4: company_name_rules  (A: id, B: clientId, C: fullName, D: titleName)
 *   Sheet5: reference_urls      (A: id, B: clientId, C: url, D: description)
 *   Sheet6: wordpress_settings  (A: clientId, B: wpUrl, C: wpUsername, D: defaultCategoryId)
 *   Sheet7: client_unique_info  (A: clientId, B: achievements, C: certifications, D: staffInfo, E: serviceArea, F: specialties, G: awards)
 */

const express = require('express');
const router = express.Router();
const sheetsAuth = require('../sheetsAuth.cjs');
const { v4: uuidv4 } = require('uuid');

const SPREADSHEET_ID = process.env.SPREADSHEET_ID || '';
const FACT_SHEET_ID = process.env.FACT_SHEET_ID || '';

// ────────────────────────────────────────────────
// ヘルパー関数
// ────────────────────────────────────────────────

/**
 * Sheets の行データを clients オブジェクトに変換
 */
function rowToClient(row) {
  return {
    id: row[0] || '',
    name: row[1] || '',
    industry: row[2] || '',
    siteUrl: row[3] || '',
    isActive: row[4] === 'TRUE' || row[4] === 'true' || row[4] === true,
    factSheetName: row[5] || '',
  };
}

/**
 * writing_rules の行をオブジェクトに変換
 */
function rowToWritingRule(row) {
  return {
    id: row[0] || '',
    clientId: row[1] || '',
    category: row[2] || '',
    ruleContent: row[3] || '',
  };
}

/**
 * terminology_rules の行をオブジェクトに変換
 */
function rowToTerminologyRule(row) {
  const wrongTermsRaw = row[2] || '';
  return {
    id: row[0] || '',
    clientId: row[1] || '',
    wrongTerms: wrongTermsRaw ? wrongTermsRaw.split(',').map(function(t) { return t.trim(); }) : [],
    correctTerm: row[3] || '',
    note: row[4] || '',
  };
}

/**
 * company_name_rules の行をオブジェクトに変換
 */
function rowToCompanyNameRule(row) {
  return {
    id: row[0] || '',
    clientId: row[1] || '',
    fullName: row[2] || '',
    titleName: row[3] || '',
  };
}

/**
 * reference_urls の行をオブジェクトに変換
 */
function rowToReferenceUrl(row) {
  return {
    id: row[0] || '',
    clientId: row[1] || '',
    url: row[2] || '',
    description: row[3] || '',
  };
}

/**
 * wordpress_settings の行をオブジェクトに変換
 */
function rowToWordPressSettings(row) {
  return {
    clientId: row[0] || '',
    wpUrl: row[1] || '',
    wpUsername: row[2] || '',
    defaultCategoryId: parseInt(row[3] || '0', 10) || 0,
  };
}

/**
 * client_unique_info の行をオブジェクトに変換
 */
function rowToUniqueInfo(row) {
  return {
    clientId: row[0] || '',
    achievements: row[1] || '',
    certifications: row[2] || '',
    staffInfo: row[3] || '',
    serviceArea: row[4] || '',
    specialties: row[5] || '',
    awards: row[6] || '',
  };
}

/**
 * 指定 clientId に対応するすべての関連データを取得してプロフィールを組み立てる
 */
async function buildClientProfile(clientRow) {
  const client = rowToClient(clientRow);
  const clientId = client.id;

  // 各サブシートを並列取得
  const results = await Promise.all([
    sheetsAuth.readRange(SPREADSHEET_ID, 'writing_rules!A2:D').catch(function() { return []; }),
    sheetsAuth.readRange(SPREADSHEET_ID, 'terminology_rules!A2:E').catch(function() { return []; }),
    sheetsAuth.readRange(SPREADSHEET_ID, 'company_name_rules!A2:D').catch(function() { return []; }),
    sheetsAuth.readRange(SPREADSHEET_ID, 'reference_urls!A2:D').catch(function() { return []; }),
    sheetsAuth.readRange(SPREADSHEET_ID, 'wordpress_settings!A2:D').catch(function() { return []; }),
    sheetsAuth.readRange(SPREADSHEET_ID, 'client_unique_info!A2:G').catch(function() { return []; }),
  ]);

  const allWritingRules = results[0];
  const allTerminologyRules = results[1];
  const allCompanyNameRules = results[2];
  const allReferenceUrls = results[3];
  const allWordPressSettings = results[4];
  const allUniqueInfo = results[5];

  const writingRules = allWritingRules
    .filter(function(r) { return r[1] === clientId; })
    .map(rowToWritingRule);

  const terminologyRules = allTerminologyRules
    .filter(function(r) { return r[1] === clientId; })
    .map(rowToTerminologyRule);

  const companyNameRuleRow = allCompanyNameRules.find(function(r) { return r[1] === clientId; });
  const companyNameRule = companyNameRuleRow ? rowToCompanyNameRule(companyNameRuleRow) : null;

  const referenceUrls = allReferenceUrls
    .filter(function(r) { return r[1] === clientId; })
    .map(rowToReferenceUrl);

  const wpRow = allWordPressSettings.find(function(r) { return r[0] === clientId; });
  const wordpressSettings = wpRow ? rowToWordPressSettings(wpRow) : null;

  const uniqueInfoRow = allUniqueInfo.find(function(r) { return r[0] === clientId; });
  const uniqueInfo = uniqueInfoRow ? rowToUniqueInfo(uniqueInfoRow) : null;

  return {
    id: client.id,
    name: client.name,
    industry: client.industry,
    siteUrl: client.siteUrl,
    isActive: client.isActive,
    factSheetName: client.factSheetName || '',
    writingRules: writingRules,
    terminologyRules: terminologyRules,
    companyNameRule: companyNameRule,
    referenceUrls: referenceUrls,
    wordpressSettings: wordpressSettings,
    uniqueInfo: uniqueInfo,
  };
}

// ────────────────────────────────────────────────
// GET /api/clients  → 取引先一覧（軽量版）
// ────────────────────────────────────────────────
router.get('/', async function(req, res) {
  if (!SPREADSHEET_ID) {
    return res.status(500).json({ error: 'SPREADSHEET_ID が設定されていません。' });
  }

  try {
    const rows = await sheetsAuth.readRange(SPREADSHEET_ID, 'clients!A2:F');
    const clients = rows
      .filter(function(r) { return r[0]; }) // 空行を除外
      .map(rowToClient);

    res.json({ clients: clients });
  } catch (err) {
    var errMsg = err && err.message ? err.message : String(err);
    console.error('取引先一覧取得エラー:', errMsg);

    // 権限エラー・シート未存在の場合は空リストで返す（アプリ継続稼働のため）
    if (
      errMsg.includes('does not have permission') ||
      errMsg.includes('not found') ||
      errMsg.includes('Unable to parse range') ||
      errMsg.includes('403') ||
      errMsg.includes('404')
    ) {
      console.warn(
        '⚠️ clients シートへのアクセス権がありません。\n' +
        '   スプレッドシート ID: ' + SPREADSHEET_ID + '\n' +
        '   サービスアカウント: blog-tool-sheets@blog-ai-agent-490609.iam.gserviceaccount.com\n' +
        '   → そのスプレッドシートを上記メールアドレスに「編集者」として共有してください。'
      );
      return res.json({ clients: [], warning: 'スプレッドシートへのアクセス権がありません。サービスアカウントに共有してください。' });
    }

    res.status(500).json({ error: '取引先一覧の取得に失敗しました。' });
  }
});

// ────────────────────────────────────────────────
// GET /api/clients/:id  → 取引先プロフィール（全情報）
// ────────────────────────────────────────────────
router.get('/:id', async function(req, res) {
  if (!SPREADSHEET_ID) {
    return res.status(500).json({ error: 'SPREADSHEET_ID が設定されていません。' });
  }

  const clientId = req.params.id;

  try {
    const rows = await sheetsAuth.readRange(SPREADSHEET_ID, 'clients!A2:F');
    const clientRow = rows.find(function(r) { return r[0] === clientId; });

    if (!clientRow) {
      return res.status(404).json({ error: '取引先が見つかりません。' });
    }

    const profile = await buildClientProfile(clientRow);
    res.json({ client: profile });
  } catch (err) {
    console.error('取引先取得エラー:', err.message);
    res.status(500).json({ error: '取引先の取得に失敗しました。' });
  }
});

// ────────────────────────────────────────────────
// POST /api/clients  → 取引先を新規登録
// ────────────────────────────────────────────────
router.post('/', async function(req, res) {
  if (!SPREADSHEET_ID) {
    return res.status(500).json({ error: 'SPREADSHEET_ID が設定されていません。' });
  }

  const body = req.body || {};
  const name = body.name || '';
  const industry = body.industry || '';
  const siteUrl = body.siteUrl || '';

  if (!name) {
    return res.status(400).json({ error: '会社名は必須です。' });
  }

  try {
    const newId = uuidv4();
    const isActive = 'TRUE';
    const factSheetName = (body.factSheetName || '').trim();

    // clients シートに追加（F列にfactSheetNameを含む）
    await sheetsAuth.appendRow(SPREADSHEET_ID, 'clients!A:F', [
      [newId, name, industry, siteUrl, isActive, factSheetName],
    ]);

    // ファクトDBシートタブを自動作成（FACT_SHEET_IDが設定されていてシート名がある場合）
    if (FACT_SHEET_ID && factSheetName) {
      try {
        await sheetsAuth.addSheet(FACT_SHEET_ID, factSheetName);
        // ヘッダー行を挿入
        await sheetsAuth.appendRow(FACT_SHEET_ID, factSheetName + '!A:D', [
          ['カテゴリ', '項目', '内容', '出典記事'],
        ]);
        console.log('✅ ファクトDBシート自動作成:', factSheetName);
      } catch (sheetErr) {
        // シートが既に存在する場合などはスキップ（エラー無視）
        console.warn('⚠️ ファクトDBシート作成スキップ:', sheetErr.message);
      }
    }

    // 執筆ルールの初期登録（body.writingRules があれば）
    const writingRules = Array.isArray(body.writingRules) ? body.writingRules : [];
    for (let i = 0; i < writingRules.length; i++) {
      const rule = writingRules[i];
      const ruleId = uuidv4();
      await sheetsAuth.appendRow(SPREADSHEET_ID, 'writing_rules!A:D', [
        [ruleId, newId, rule.category || 'その他', rule.ruleContent || ''],
      ]);
    }

    // 表記統一ルールの初期登録
    const terminologyRules = Array.isArray(body.terminologyRules) ? body.terminologyRules : [];
    for (let i = 0; i < terminologyRules.length; i++) {
      const rule = terminologyRules[i];
      const ruleId = uuidv4();
      const wrongTermsStr = Array.isArray(rule.wrongTerms) ? rule.wrongTerms.join(',') : (rule.wrongTerms || '');
      await sheetsAuth.appendRow(SPREADSHEET_ID, 'terminology_rules!A:E', [
        [ruleId, newId, wrongTermsStr, rule.correctTerm || '', rule.note || ''],
      ]);
    }

    // 会社名ルールの初期登録
    if (body.companyNameRule && body.companyNameRule.fullName) {
      const ruleId = uuidv4();
      await sheetsAuth.appendRow(SPREADSHEET_ID, 'company_name_rules!A:D', [
        [ruleId, newId, body.companyNameRule.fullName, body.companyNameRule.titleName || ''],
      ]);
    }

    // 参照URLの初期登録
    const referenceUrls = Array.isArray(body.referenceUrls) ? body.referenceUrls : [];
    for (let i = 0; i < referenceUrls.length; i++) {
      const ref = referenceUrls[i];
      const refId = uuidv4();
      await sheetsAuth.appendRow(SPREADSHEET_ID, 'reference_urls!A:D', [
        [refId, newId, ref.url || '', ref.description || ''],
      ]);
    }

    // WordPress設定の初期登録
    if (body.wordpressSettings && body.wordpressSettings.wpUrl) {
      const wp = body.wordpressSettings;
      await sheetsAuth.appendRow(SPREADSHEET_ID, 'wordpress_settings!A:D', [
        [newId, wp.wpUrl, wp.wpUsername || '', String(wp.defaultCategoryId || 0)],
      ]);
    }

    // 独自情報の初期登録
    if (body.uniqueInfo) {
      const ui = body.uniqueInfo;
      await sheetsAuth.appendRow(SPREADSHEET_ID, 'client_unique_info!A:G', [
        [newId, ui.achievements || '', ui.certifications || '', ui.staffInfo || '', ui.serviceArea || '', ui.specialties || '', ui.awards || ''],
      ]);
    }

    res.status(201).json({ id: newId, message: '取引先を登録しました。' });
  } catch (err) {
    console.error('取引先登録エラー:', err.message);
    res.status(500).json({ error: '取引先の登録に失敗しました。' });
  }
});

// ────────────────────────────────────────────────
// PUT /api/clients/:id  → 取引先情報を更新
// ────────────────────────────────────────────────
router.put('/:id', async function(req, res) {
  if (!SPREADSHEET_ID) {
    return res.status(500).json({ error: 'SPREADSHEET_ID が設定されていません。' });
  }

  const clientId = req.params.id;
  const body = req.body || {};

  try {
    // clients シートから全行を読み込み
    const rows = await sheetsAuth.readRange(SPREADSHEET_ID, 'clients!A2:F');
    const rowIndex = rows.findIndex(function(r) { return r[0] === clientId; });

    if (rowIndex === -1) {
      return res.status(404).json({ error: '取引先が見つかりません。' });
    }

    const existingRow = rows[rowIndex];
    const sheetRow = rowIndex + 2; // ヘッダー行(1) + 0始まり補正(+1) = +2

    const updatedRow = [
      clientId,
      body.name !== undefined ? body.name : (existingRow[1] || ''),
      body.industry !== undefined ? body.industry : (existingRow[2] || ''),
      body.siteUrl !== undefined ? body.siteUrl : (existingRow[3] || ''),
      body.isActive !== undefined ? (body.isActive ? 'TRUE' : 'FALSE') : (existingRow[4] || 'TRUE'),
      body.factSheetName !== undefined ? body.factSheetName : (existingRow[5] || ''),
    ];

    await sheetsAuth.updateRange(
      SPREADSHEET_ID,
      'clients!A' + sheetRow + ':F' + sheetRow,
      [updatedRow]
    );

    // factSheetNameが新たに設定されたらシートタブ自動作成
    const newFactSheetName = (body.factSheetName || '').trim();
    const oldFactSheetName = (existingRow[5] || '').trim();
    if (FACT_SHEET_ID && newFactSheetName && newFactSheetName !== oldFactSheetName) {
      try {
        await sheetsAuth.addSheet(FACT_SHEET_ID, newFactSheetName);
        await sheetsAuth.appendRow(FACT_SHEET_ID, newFactSheetName + '!A:D', [
          ['カテゴリ', '項目', '内容', '出典記事'],
        ]);
        console.log('✅ ファクトDBシート自動作成（更新時）:', newFactSheetName);
      } catch (sheetErr) {
        console.warn('⚠️ ファクトDBシート作成スキップ（既存or未設定）:', sheetErr.message);
      }
    }

    // ── 執筆ルールの更新（既存を全削除して再登録）──
    if (Array.isArray(body.writingRules)) {
      // 既存行をクリア
      const wrRows = await sheetsAuth.readRange(SPREADSHEET_ID, 'writing_rules!A2:D');
      for (let i = 0; i < wrRows.length; i++) {
        if (wrRows[i][1] === clientId) {
          const clearRow = i + 2;
          await sheetsAuth.updateRange(
            SPREADSHEET_ID,
            'writing_rules!A' + clearRow + ':D' + clearRow,
            [['', '', '', '']]
          );
        }
      }
      // 再登録
      for (let i = 0; i < body.writingRules.length; i++) {
        const rule = body.writingRules[i];
        const ruleId = rule.id || uuidv4();
        await sheetsAuth.appendRow(SPREADSHEET_ID, 'writing_rules!A:D', [
          [ruleId, clientId, rule.category || 'その他', rule.ruleContent || ''],
        ]);
      }
    }

    // ── 表記統一ルールの更新 ──
    if (Array.isArray(body.terminologyRules)) {
      const trRows = await sheetsAuth.readRange(SPREADSHEET_ID, 'terminology_rules!A2:E');
      for (let i = 0; i < trRows.length; i++) {
        if (trRows[i][1] === clientId) {
          const clearRow = i + 2;
          await sheetsAuth.updateRange(
            SPREADSHEET_ID,
            'terminology_rules!A' + clearRow + ':E' + clearRow,
            [['', '', '', '', '']]
          );
        }
      }
      for (let i = 0; i < body.terminologyRules.length; i++) {
        const rule = body.terminologyRules[i];
        const ruleId = rule.id || uuidv4();
        const wrongTermsStr = Array.isArray(rule.wrongTerms) ? rule.wrongTerms.join(',') : (rule.wrongTerms || '');
        await sheetsAuth.appendRow(SPREADSHEET_ID, 'terminology_rules!A:E', [
          [ruleId, clientId, wrongTermsStr, rule.correctTerm || '', rule.note || ''],
        ]);
      }
    }

    // ── 会社名ルールの更新 ──
    if (body.companyNameRule !== undefined) {
      const cnRows = await sheetsAuth.readRange(SPREADSHEET_ID, 'company_name_rules!A2:D');
      const cnRowIndex = cnRows.findIndex(function(r) { return r[1] === clientId; });

      if (body.companyNameRule && body.companyNameRule.fullName) {
        if (cnRowIndex !== -1) {
          const clearRow = cnRowIndex + 2;
          await sheetsAuth.updateRange(
            SPREADSHEET_ID,
            'company_name_rules!A' + clearRow + ':D' + clearRow,
            [[cnRows[cnRowIndex][0], clientId, body.companyNameRule.fullName, body.companyNameRule.titleName || '']]
          );
        } else {
          const ruleId = uuidv4();
          await sheetsAuth.appendRow(SPREADSHEET_ID, 'company_name_rules!A:D', [
            [ruleId, clientId, body.companyNameRule.fullName, body.companyNameRule.titleName || ''],
          ]);
        }
      }
    }

    // ── 参照URLの更新 ──
    if (Array.isArray(body.referenceUrls)) {
      const ruRows = await sheetsAuth.readRange(SPREADSHEET_ID, 'reference_urls!A2:D');
      for (let i = 0; i < ruRows.length; i++) {
        if (ruRows[i][1] === clientId) {
          const clearRow = i + 2;
          await sheetsAuth.updateRange(
            SPREADSHEET_ID,
            'reference_urls!A' + clearRow + ':D' + clearRow,
            [['', '', '', '']]
          );
        }
      }
      for (let i = 0; i < body.referenceUrls.length; i++) {
        const ref = body.referenceUrls[i];
        const refId = ref.id || uuidv4();
        await sheetsAuth.appendRow(SPREADSHEET_ID, 'reference_urls!A:D', [
          [refId, clientId, ref.url || '', ref.description || ''],
        ]);
      }
    }

    // ── WordPress設定の更新 ──
    if (body.wordpressSettings !== undefined) {
      const wpRows = await sheetsAuth.readRange(SPREADSHEET_ID, 'wordpress_settings!A2:D');
      const wpRowIndex = wpRows.findIndex(function(r) { return r[0] === clientId; });

      if (body.wordpressSettings && body.wordpressSettings.wpUrl) {
        const wp = body.wordpressSettings;
        const newWpRow = [clientId, wp.wpUrl, wp.wpUsername || '', String(wp.defaultCategoryId || 0)];

        if (wpRowIndex !== -1) {
          const clearRow = wpRowIndex + 2;
          await sheetsAuth.updateRange(
            SPREADSHEET_ID,
            'wordpress_settings!A' + clearRow + ':D' + clearRow,
            [newWpRow]
          );
        } else {
          await sheetsAuth.appendRow(SPREADSHEET_ID, 'wordpress_settings!A:D', [newWpRow]);
        }
      }
    }

    // ── 独自情報の更新 ──
    if (body.uniqueInfo !== undefined) {
      const uiRows = await sheetsAuth.readRange(SPREADSHEET_ID, 'client_unique_info!A2:G');
      const uiRowIndex = uiRows.findIndex(function(r) { return r[0] === clientId; });
      const ui = body.uniqueInfo || {};
      const newUiRow = [clientId, ui.achievements || '', ui.certifications || '', ui.staffInfo || '', ui.serviceArea || '', ui.specialties || '', ui.awards || ''];

      if (uiRowIndex !== -1) {
        const clearRow = uiRowIndex + 2;
        await sheetsAuth.updateRange(
          SPREADSHEET_ID,
          'client_unique_info!A' + clearRow + ':G' + clearRow,
          [newUiRow]
        );
      } else {
        await sheetsAuth.appendRow(SPREADSHEET_ID, 'client_unique_info!A:G', [newUiRow]);
      }
    }

    res.json({ message: '取引先を更新しました。' });
  } catch (err) {
    console.error('取引先更新エラー:', err.message);
    res.status(500).json({ error: '取引先の更新に失敗しました。' });
  }
});

// ────────────────────────────────────────────────
// DELETE /api/clients/:id  → 取引先を無効化（isActive: FALSE）
// ────────────────────────────────────────────────
router.delete('/:id', async function(req, res) {
  if (!SPREADSHEET_ID) {
    return res.status(500).json({ error: 'SPREADSHEET_ID が設定されていません。' });
  }

  const clientId = req.params.id;

  try {
    const rows = await sheetsAuth.readRange(SPREADSHEET_ID, 'clients!A2:F');
    const rowIndex = rows.findIndex(function(r) { return r[0] === clientId; });

    if (rowIndex === -1) {
      return res.status(404).json({ error: '取引先が見つかりません。' });
    }

    const existingRow = rows[rowIndex];
    const sheetRow = rowIndex + 2;

    // 物理削除ではなく isActive を FALSE に変更
    await sheetsAuth.updateRange(
      SPREADSHEET_ID,
      'clients!A' + sheetRow + ':E' + sheetRow,
      [[existingRow[0], existingRow[1], existingRow[2], existingRow[3], 'FALSE']]
    );

    res.json({ message: '取引先を無効化しました。' });
  } catch (err) {
    console.error('取引先削除エラー:', err.message);
    res.status(500).json({ error: '取引先の削除に失敗しました。' });
  }
});

module.exports = router;
