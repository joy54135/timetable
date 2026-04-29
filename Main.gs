/**
 * ==========================================
 * Smart TimeTable - Backend Engine (GAS)
 * Version: 17.4.0 (Modularized Architecture)
 * File: Main.gs - 通信エンドポイント管理
 * ==========================================
 */

function doOptions(e) { 
  return ContentService.createTextOutput("OK").setMimeType(ContentService.MimeType.TEXT); 
}

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return ContentService.createTextOutput(JSON.stringify({ success: false, message: "No data received." })).setMimeType(ContentService.MimeType.JSON);
    }
    
    const params = JSON.parse(e.postData.contents);
    
    if (params.action === 'generate') {
      const result = generateSchedule(params.state, params.currentSchedule, params.unassigned);
      return ContentService.createTextOutput(JSON.stringify({ 
        success: true, 
        schedule: result.schedule, 
        unassigned: result.unassigned, 
        isComplete: result.isComplete, 
        reportDetails: result.reportDetails,
        fatalError: result.fatalError,
        scoreCard: result.scoreCard
      })).setMimeType(ContentService.MimeType.JSON);
      
    } else if (params.action === 'export') {
      const options = params.options || {};
      const result = handleExport(params.schedule, params.state, options);
      return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
      
    } else if (params.action === 'importFromSS') {
      const result = handleImportFromSS(params.spreadsheetUrl, params.state);
      return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
    }
    
    return ContentService.createTextOutput(JSON.stringify({ success: false, message: 'Invalid action' })).setMimeType(ContentService.MimeType.JSON);
  } catch (error) { 
    return ContentService.createTextOutput(JSON.stringify({ success: false, message: "GAS Error: " + error.toString() })).setMimeType(ContentService.MimeType.JSON); 
  }
}

function doGet(e) { 
  // Index.html をテンプレートとして評価し、Webアプリとして画面を表示する
  return HtmlService.createTemplateFromFile('Index').evaluate()
      .setTitle('Smart TimeTable')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no');
}

// 分割されたHTML/JS/CSSファイルをメイン画面(Index)に合体させるための必須関数
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}