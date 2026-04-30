/**
 * ==========================================
 * File: IO.gs - スプレッドシート・ドライブ連携
 * Version: 18.1.0 (A/B Rotation Export)
 * ==========================================
 */

// A/B週判定ユーティリティ
function getWeekType(l) {
    if(!l.isFraction) return 'both';
    let sum=0; for(let i=0;i<l.id.length;i++) sum+=l.id.charCodeAt(i);
    return sum%2===0 ? 'A' : 'B';
}

function handleImportFromSS(url, state) {
  try {
    const idMatch = url.match(/\/d\/([a-zA-Z0-9-_]+)/);
    if (!idMatch) return { success: false, message: "無効なスプレッドシートURLです。URLを確認してください。" };
    
    const ssId = idMatch[1];
    const ss = SpreadsheetApp.openById(ssId);
    
    // インポートは基本的に「全体(クラス)」またはそのA週/B週シートから行う想定ですが、
    // ここでは一番左のシートを対象とするようフォールバックします
    let sheet = ss.getSheetByName("全体(クラス)") || ss.getSheetByName("クラス(A週)") || ss.getSheets()[0];
    if (!sheet) return { success: false, message: "対象のシートが見つかりません。" };

    const range = sheet.getDataRange();
    const values = range.getDisplayValues(); 
    if (values.length < 3) return { success: false, message: "シートにデータが存在しません。" };

    const { DAYS, PERIODS } = getDynamicDaysAndPeriods(state);
    
    let importedSchedule = {};
    DAYS.forEach(d => {
      importedSchedule[d] = {};
      PERIODS.forEach(p => importedSchedule[d][p] = []);
    });

    let errorLog = [];
    let importCount = 0;

    const dayRow = values[0];
    const periodRow = values[1];
    const colMap = {}; 

    let currentDay = "";
    for (let c = 1; c < dayRow.length; c++) {
      if (dayRow[c] !== "") currentDay = dayRow[c].replace("曜", "").trim();
      let pStr = periodRow[c];
      if (currentDay && pStr) {
        colMap[c] = { day: currentDay, period: parseInt(pStr, 10) };
      }
    }

    const teacherNameMap = {};
    (state.teachers || []).forEach(t => teacherNameMap[t.name.trim()] = t.id);

    const subjectMap = {};
    (state.subjects || []).forEach(s => subjectMap[s.name.trim()] = s.id);

    for (let r = 2; r < values.length; r++) {
      const row = values[r];
      const clsName = row[0] ? row[0].toString().trim() : "";
      if (!clsName || clsName === "Axis") continue; // ヘッダー除外

      for (let c = 1; c < row.length; c++) {
        const cellValue = row[c] ? row[c].toString().trim() : "";
        if (!cellValue) continue;

        const cellInfo = colMap[c];
        if (!cellInfo) continue;

        const lines = cellValue.split('\n').map(l => l.trim().replace(/🔄[AB]\s*/g, '')); // 回転アイコンを除外してパース
        if (lines[0] === "重") continue;

        const subjectName = lines[0];
        const subId = subjectMap[subjectName];
        if (!subId) {
          errorLog.push(`${clsName}の${cellInfo.day}曜${cellInfo.period}限: 教科「${subjectName}」が未登録です。`);
          continue;
        }

        const teacherName = lines.length > 1 ? lines[1] : '';
        let tIds = [];
        if (teacherName) {
           const names = teacherName.split(',').map(n => n.trim());
           names.forEach(n => {
             if (teacherNameMap[n]) tIds.push(teacherNameMap[n]);
             else errorLog.push(`${clsName}の${cellInfo.day}曜: 教員「${n}」が見つかりません。`);
           });
        }
        
        const teacherIdsStr = tIds.slice().sort().join(',');

        let existingLesson = importedSchedule[cellInfo.day][cellInfo.period].find(
            l => l.subjectId === subId && l.teacherIds.slice().sort().join(',') === teacherIdsStr
        );

        if (existingLesson) {
            if (!existingLesson.targets.includes(clsName)) {
                existingLesson.targets.push(clsName);
            }
            importCount++;
        } else {
            const lessonId = `imp_${subId}_${cellInfo.day}${cellInfo.period}_${tIds.join('-')}_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
            const importedLesson = {
              id: lessonId,
              subjectId: subId,
              subject: subjectName,
              targets: [clsName],
              teacherIds: tIds.length > 0 ? tIds : [state.classAssignments?.[clsName]?.homeroom].filter(Boolean),
              teacherName: teacherName,
              room: state.subjects.find(s => s.id === subId)?.defaultRoom || '通常教室',
              isSpecialist: tIds.some(tid => tid !== state.classAssignments?.[clsName]?.homeroom),
              length: 1, 
              totalHours: 1,
              type: 'normal',
              limitOnePerDay: false,
              isFixed: true, 
              isLocked: true,
              isFraction: false // インポート時は一旦通常コマとして扱う
            };

            importedSchedule[cellInfo.day][cellInfo.period].push(importedLesson);
            importCount++;
        }
      }
    }

    return { 
      success: true, 
      schedule: importedSchedule, 
      importCount: importCount, 
      errors: errorLog,
      message: `スプレッドシートから ${importCount} 件のコマを読み込み、合同授業を最適化しました。` 
    };

  } catch (e) {
    return { success: false, message: "インポートエラー: " + e.message };
  }
}

function handleExport(schedule, data, options) {
  try {
    const timestamp = Utilities.formatDate(new Date(), "JST", "yyyyMMdd_HHmm");
    const ssName = `時間割データ_${timestamp}`;
    const ss = SpreadsheetApp.create(ssName);
    
    let pdfOpts = options.pdf || {};
    let ssOpts = options.spreadsheet || {};
    if (!options.pdf && !options.spreadsheet) {
        ssOpts = { matrixClass: true, individualClass: true };
    }

    const reqMatrixClass = ssOpts.matrixClass || pdfOpts.matrixClass;
    const reqMatrixTeacher = ssOpts.matrixTeacher || pdfOpts.matrixTeacher;
    const reqMatrixRoom = ssOpts.matrixRoom || pdfOpts.matrixRoom;
    const reqIndivClass = ssOpts.individualClass || pdfOpts.individualClass;
    const reqIndivTeacher = ssOpts.individualTeacher || pdfOpts.individualTeacher;

    const defaultSheet = ss.getSheets()[0];
    let hasSheet = false;
    
    // A週/B週ローテーションの有無を判定
    let hasRotation = false;
    const { DAYS, PERIODS } = getDynamicDaysAndPeriods(data);
    DAYS.forEach(d => PERIODS.forEach(p => {
        (schedule[d]?.[p]||[]).forEach(l => { if(l.isFraction) hasRotation = true; });
    }));

    // 回転がある場合は A週用・B週用のシートをセットで作成
    if (reqMatrixClass) { 
        if (hasRotation) {
            createMatrixSheet(ss, `クラス(A週)`, schedule, data, 'class', 'A');
            createMatrixSheet(ss, `クラス(B週)`, schedule, data, 'class', 'B');
        } else {
            createMatrixSheet(ss, `全体(クラス)`, schedule, data, 'class', 'all');
        }
        hasSheet = true; 
    }
    if (reqMatrixTeacher) { 
        if (hasRotation) {
            createMatrixSheet(ss, `教員(A週)`, schedule, data, 'teacher', 'A');
            createMatrixSheet(ss, `教員(B週)`, schedule, data, 'teacher', 'B');
        } else {
            createMatrixSheet(ss, `全体(教員)`, schedule, data, 'teacher', 'all'); 
        }
        hasSheet = true; 
    }
    if (reqMatrixRoom) { 
        if (hasRotation) {
            createMatrixSheet(ss, `教室(A週)`, schedule, data, 'room', 'A');
            createMatrixSheet(ss, `教室(B週)`, schedule, data, 'room', 'B');
        } else {
            createMatrixSheet(ss, `全体(教室)`, schedule, data, 'room', 'all'); 
        }
        hasSheet = true; 
    }
    if (reqIndivClass) { 
        if (hasRotation) {
            createIndividualSheet(ss, `各クラス(A週)`, schedule, data, 'class', 'A');
            createIndividualSheet(ss, `各クラス(B週)`, schedule, data, 'class', 'B');
        } else {
            createIndividualSheet(ss, `各クラス`, schedule, data, 'class', 'all'); 
        }
        hasSheet = true; 
    }
    if (reqIndivTeacher) { 
        if (hasRotation) {
            createIndividualSheet(ss, `各教員(A週)`, schedule, data, 'teacher', 'A');
            createIndividualSheet(ss, `各教員(B週)`, schedule, data, 'teacher', 'B');
        } else {
            createIndividualSheet(ss, `各教員`, schedule, data, 'teacher', 'all'); 
        }
        hasSheet = true; 
    }

    if (hasSheet) ss.deleteSheet(defaultSheet);
    
    SpreadsheetApp.flush();

    let resultUrls = {};
    let wantsSpreadsheet = Object.keys(ssOpts).length > 0 && Object.values(ssOpts).some(v => v);
    let wantsPdf = Object.keys(pdfOpts).length > 0 && Object.values(pdfOpts).some(v => v);
    
    let targetFolder = DriveApp.getRootFolder();
    if (options.folderId) {
        try {
            targetFolder = DriveApp.getFolderById(options.folderId);
        } catch(e) {
            console.log("Folder access error, falling back to root.");
        }
    }

    const ssFile = DriveApp.getFileById(ss.getId());

    if (wantsPdf) {
        const url = `https://docs.google.com/spreadsheets/d/${ss.getId()}/export?exportFormat=pdf&format=pdf&size=A3&portrait=false&fitw=true&top_margin=0.5&bottom_margin=0.5&left_margin=0.5&right_margin=0.5&sheetnames=false&printtitle=false&pagenumbers=false&gridlines=false&fzr=false`;
        const token = ScriptApp.getOAuthToken();
        const response = UrlFetchApp.fetch(url, { headers: { 'Authorization': 'Bearer ' + token } });
        const pdfBlob = response.getBlob().setName(`${ssName}.pdf`);
        const pdfFile = targetFolder.createFile(pdfBlob);
        resultUrls.pdfUrl = pdfFile.getDownloadUrl() || pdfFile.getUrl();
    }

    if (wantsSpreadsheet) {
        ssFile.moveTo(targetFolder);
        resultUrls.spreadsheetUrl = ssFile.getUrl();
    } else if (wantsPdf) {
        ssFile.setTrashed(true);
    }
    
    return { success: true, urls: resultUrls };
  } catch (e) {
    return { success: false, message: e.message };
  }
}

function createMatrixSheet(ss, sheetName, schedule, data, type, weekFilter = 'all') {
  const { DAYS, PERIODS } = getDynamicDaysAndPeriods(data);
  const sheet = ss.insertSheet(sheetName);
  
  let rows = [];
  if (type === 'class') {
    Object.keys(data.grades).forEach(g => {
      for (let c = 1; c <= data.grades[g]; c++) rows.push({id: `${g}-${c}`, name: `${g}-${c}`});
    });
  } else if (type === 'teacher') {
    rows = (data.teachers || []).map(t => ({id: t.id, name: t.name}));
  } else if (type === 'room') {
    rows = (data.rooms || []).map(r => ({id: r.name, name: r.name}));
  }

  const totalCols = 1 + DAYS.length * PERIODS.length;
  const totalRows = rows.length + 2;

  sheet.getRange(1, 1, totalRows, totalCols).setNumberFormat("@");

  let headerRow1 = ["軸 \\ 曜日"];
  let headerRow2 = ["時限"];
  DAYS.forEach(d => {
    for(let i=0; i<PERIODS.length; i++) headerRow1.push(i===0 ? `${d}曜` : "");
    PERIODS.forEach(p => headerRow2.push(p));
  });
  
  sheet.getRange(1, 1, 1, totalCols).setValues([headerRow1]).setFontWeight("bold").setBackground("#e2e8f0").setHorizontalAlignment("center").setFontSize(9);
  sheet.getRange(2, 1, 1, totalCols).setValues([headerRow2]).setFontWeight("bold").setBackground("#f8fafc").setHorizontalAlignment("center").setFontSize(9);
  
  let c = 2;
  DAYS.forEach(d => {
    if (PERIODS.length > 1) sheet.getRange(1, c, 1, PERIODS.length).merge();
    c += PERIODS.length;
  });

  let backgrounds = [];
  let gridValues = [];
  
  rows.forEach(item => {
    let rowData = [item.name];
    let rowColors = ["#ffffff"];
    DAYS.forEach(d => {
      PERIODS.forEach(p => {
        let cellText = "", cellColor = "#ffffff";
        if (schedule[d] && schedule[d][p]) {
          let targetLessons = [];
          if (type === 'class') targetLessons = schedule[d][p].filter(l => l.targets && l.targets.includes(item.id));
          else if (type === 'teacher') targetLessons = schedule[d][p].filter(l => l.teacherIds && l.teacherIds.includes(item.id));
          else if (type === 'room') targetLessons = schedule[d][p].filter(l => l.room === item.id);
          
          // 該当する週(AまたはB)のコマだけをフィルタリング
          targetLessons = targetLessons.filter(l => weekFilter === 'all' || getWeekType(l) === 'both' || getWeekType(l) === weekFilter);
          
          if (targetLessons.length > 0) {
            let l = targetLessons[0];
            if (targetLessons.length > 1) { cellText = "重\n" + l.subject; cellColor = "#ffcdd2"; }
            else {
              let subT = type === 'class' ? (l.teacherName || '') : (l.targets ? l.targets.join(',') : '');
              if (type === 'room') subT = (l.targets ? l.targets.join(',') : '') + " " + (l.teacherName || '');
              
              // 回転枠の場合は視覚的な印をつける（PDF印刷時用）
              let prefix = l.isFraction ? `🔄${getWeekType(l)} ` : "";
              cellText = `${prefix}${l.subject}\n${subT}`;
              cellColor = getSubjectColor(l.subject, data);
            }
          }
        }
        rowData.push(cellText);
        rowColors.push(cellColor);
      });
    });
    gridValues.push(rowData);
    backgrounds.push(rowColors);
  });
  
  if (gridValues.length > 0) {
    sheet.getRange(3, 1, gridValues.length, totalCols).setValues(gridValues).setBackgrounds(backgrounds);
  }
  
  sheet.setRowHeights(3, rows.length, 40);
  sheet.setColumnWidth(1, 80);
  sheet.setColumnWidths(2, totalCols - 1, 45);
  sheet.getRange(1, 1, totalRows, totalCols).setBorder(true, true, true, true, true, true).setHorizontalAlignment("center").setVerticalAlignment("middle").setWrap(true).setFontSize(8);
  sheet.setFrozenRows(2);
  sheet.setFrozenColumns(1);
}

function createIndividualSheet(ss, sheetName, schedule, data, type, weekFilter = 'all') {
  const { DAYS, PERIODS } = getDynamicDaysAndPeriods(data);
  const sheet = ss.insertSheet(sheetName);
  
  let items = [];
  if (type === 'class') {
    Object.keys(data.grades).forEach(g => {
      for (let c = 1; c <= data.grades[g]; c++) items.push(`${g}-${c}`);
    });
  } else if (type === 'teacher') {
    items = (data.teachers || []).map(t => ({id: t.id, name: t.name}));
  }
  
  sheet.getRange("A:Z").setNumberFormat("@");

  let currentRow = 1;
  items.forEach(item => {
    let weekSuffix = weekFilter !== 'all' ? ` (${weekFilter}週)` : '';
    let title = type === 'class' ? `${item} 時間割${weekSuffix}` : `${item.name} 先生 時間割${weekSuffix}`;
    let targetId = type === 'class' ? item : item.id;
    
    sheet.getRange(currentRow, 1, 1, DAYS.length + 1).merge().setValue(title).setFontWeight("bold").setFontSize(14).setBackground("#e2e8f0").setHorizontalAlignment("center").setVerticalAlignment("middle");
    currentRow++;
    
    let header = ["時限 \\ 曜日", ...DAYS];
    sheet.getRange(currentRow, 1, 1, DAYS.length + 1).setValues([header]).setFontWeight("bold").setBackground("#f8fafc").setHorizontalAlignment("center").setVerticalAlignment("middle");
    currentRow++;
    
    PERIODS.forEach(p => {
      let rowData = [`${p}限`];
      let rowColors = ["#f8fafc"];
      DAYS.forEach(d => {
        let cellText = "", cellColor = "#ffffff";
        if (schedule[d] && schedule[d][p]) {
          let targets = schedule[d][p].filter(l => l.targets && l.targets.includes(targetId) || (type==='teacher' && l.teacherIds && l.teacherIds.includes(targetId)));
          
          // 該当する週(AまたはB)のコマだけをフィルタリング
          targets = targets.filter(l => weekFilter === 'all' || getWeekType(l) === 'both' || getWeekType(l) === weekFilter);

          if (targets.length > 0) {
             let l = targets[0];
             if (targets.length > 1) { cellText = "重複"; cellColor = "#ffcdd2"; }
             else {
                 let prefix = l.isFraction ? `🔄${getWeekType(l)}\n` : "";
                 cellText = type === 'class' ? `${prefix}${l.subject}\n(${l.teacherName || ''})` : `${prefix}${l.subject}\n(${l.targets ? l.targets.join(',') : ''})`;
                 cellColor = getSubjectColor(l.subject, data);
             }
          }
        }
        rowData.push(cellText);
        rowColors.push(cellColor);
      });
      sheet.getRange(currentRow, 1, 1, DAYS.length + 1).setValues([rowData]).setBackgrounds([rowColors]).setHorizontalAlignment("center").setVerticalAlignment("middle").setWrap(true).setFontSize(10);
      currentRow++;
    });
    sheet.getRange(currentRow - PERIODS.length - 2, 1, PERIODS.length + 2, DAYS.length + 1).setBorder(true, true, true, true, true, true);
    sheet.setRowHeights(currentRow - PERIODS.length, PERIODS.length, 60); 
    currentRow += 2;
  });
}