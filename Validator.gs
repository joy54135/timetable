/**
 * ==========================================
 * File: Validator.gs - ルール判定と評価
 * ==========================================
 */

function checkStrictRules(lesson, d, p, schedule, state, rules, pLevels, PERIODS) {
  const isHigh = (key, defaultVal = false) => pLevels[key] !== undefined ? pLevels[key] === 'high' : defaultVal;
  const len = lesson.length || 1;
  const enforceOnePerDay = isHigh('limitOneSubjectPerDayStrict', true);
  const maxPeriod = Math.max(...PERIODS);

  if (lesson.limitOnePerDay || (enforceOnePerDay && lesson.totalHours <= 5)) {
    for(let i=1; i<=maxPeriod; i++) {
      if (i >= p && i < p + len) continue; 
      if (schedule[d][i] && schedule[d][i].some(l => l.id !== lesson.id && l.subject === lesson.subject && l.targets.some(t => lesson.targets.includes(t)))) {
        return { valid: false, reason: `【厳守】同日重複禁止(${lesson.subject})` };
      }
    }
  } else if (enforceOnePerDay && lesson.totalHours > 5) {
    let totalSlotsToday = len; 
    const countedIds = new Set();
    countedIds.add(lesson.id);

    for (let i=1; i<=maxPeriod; i++) {
      if (i >= p && i < p + len) continue;
      if (schedule[d][i]) {
        schedule[d][i].forEach(l => {
          if (l.id !== lesson.id && l.subject === lesson.subject && l.targets.some(t => lesson.targets.includes(t))) {
            if (!countedIds.has(l.id)) {
              countedIds.add(l.id);
              totalSlotsToday += (l.length || 1);
            }
          }
        });
      }
    }
    if (totalSlotsToday > 2) return { valid: false, reason: `【厳守】同日3コマ以上禁止(${lesson.subject})` };
  }

  if (isHigh('exclusivePairs', true) && rules.exclusivePairs && rules.exclusivePairs.length > 0) {
    for (let pair of rules.exclusivePairs) {
      let targetPairSub = null;
      if (lesson.subject === pair.subject1) targetPairSub = pair.subject2;
      else if (lesson.subject === pair.subject2) targetPairSub = pair.subject1;
      if (targetPairSub) {
        for(let i=1; i<=maxPeriod; i++) {
          if (i >= p && i < p + len) continue;
          if (schedule[d][i] && schedule[d][i].some(l => l.subject === targetPairSub && l.targets.some(t => lesson.targets.includes(t)))) {
            return { valid: false, reason: `【厳守】排他教科同日禁止(${targetPairSub})` };
          }
        }
      }
    }
  }

  if (isHigh('limitContinuousToSpecificPeriods', true) && len === 2) {
    if (p !== 1 && p !== 3 && p !== 5) return { valid: false, reason: '【厳守】連続授業ペア枠外' };
  }

  if (isHigh('homeroomOnlyTimes') && lesson.isSpecialist && rules.homeroomOnlyTimes) {
    for (let i=0; i<len; i++) {
      if (rules.homeroomOnlyTimes.some(r => r.day === d && r.period === (p+i) && matchRuleTarget(r, lesson))) {
        return { valid: false, reason: '【厳守】担任授業固定枠(専科不可)' };
      }
    }
  }

  if (isHigh('avoidSpecialistTimes') && lesson.isSpecialist && rules.avoidSpecialistTimes) {
    for (let i=0; i<len; i++) {
      if (rules.avoidSpecialistTimes.some(r => r.day === d && r.period === (p+i))) return { valid: false, reason: '【厳守】専科回避指定枠' };
    }
  }

  if (isHigh('avoidSpecificTimes') && rules.avoidSpecificTimes) {
    for (let i=0; i<len; i++) {
      if (rules.avoidSpecificTimes.some(r => r.day === d && r.period === (p+i) && r.subject === lesson.subject && matchRuleTarget(r, lesson))) {
        return { valid: false, reason: '【厳守】特定時間帯回避' };
      }
    }
  }

  if (isHigh('amPrioritySubjects') && isTargetRule(rules.amPrioritySubjects, lesson)) {
    if (p > 4) return { valid: false, reason: '【厳守】午前配置指定' };
  }
  if (isHigh('lastPeriodSubjects') && isTargetRule(rules.lastPeriodSubjects, lesson)) {
    const grade = lesson.targets[0].split('-')[0];
    const maxP = state.periods[grade]?.[d] || maxPeriod;
    if (p + len - 1 !== maxP) return { valid: false, reason: '【厳守】最終コマ指定' };
  }

  if (isHigh('homeroomBufferSubjects') && isTargetRule(rules.homeroomBufferSubjects, lesson)) {
    const cls = lesson.targets[0], homeroomId = state.classAssignments?.[cls]?.homeroom;
    if (homeroomId) {
      let bufferOk = false;
      const grade = cls.split('-')[0], maxP = state.periods[grade]?.[d] || maxPeriod;
      const checkBuffer = (pNow, pAdj) => {
        if (pAdj < 1 || pAdj > maxP) return false;
        if ((pNow === 4 && pAdj === 5) || (pNow === 5 && pAdj === 4)) return false; 
        const existing = schedule[d][pAdj]?.filter(l => l.targets.includes(cls)) || [];
        if (existing.length === 0) return true; 
        if (existing.some(l => l.teacherIds.includes(homeroomId))) return true; 
        return false;
      };
      if (checkBuffer(p, p - 1) || checkBuffer(p + len - 1, p + len)) bufferOk = true;
      if (!bufferOk) return { valid: false, reason: '【厳守】担任裁量バッファ確保不可' };
    }
  }

  return { valid: true };
}

function evaluateSchedule(schedule, state, rules, pLevels, unassigned, teacherObj, DAYS, PERIODS) {
  const scoreCard = { basic: { score: 100, details: [] }, advanced: { score: 100, rules: {} } };
  let scheduledCount = 0; let unassignedCount = unassigned.length;
  
  const allScheduledLessons = [];
  const lessonSet = new Set();
  DAYS.forEach(d => PERIODS.forEach(p => { 
      (schedule[d]?.[p]||[]).forEach(l => { 
          if (!lessonSet.has(l.id)) {
              lessonSet.add(l.id);
              allScheduledLessons.push({ lesson: l, day: d, period: p });
          }
      }); 
  }));
  scheduledCount = lessonSet.size;
  
  let total = scheduledCount + unassignedCount;
  if (total > 0) scoreCard.basic.score = Math.round((scheduledCount / total) * 100);
  if (unassignedCount > 0) scoreCard.basic.details.push(`${unassignedCount}コマが未配置です。`);
  else scoreCard.basic.details.push(`全 ${scheduledCount} コマの配置を完了しました。`);

  const classSchedules = {};
  if (state.classAssignments) {
    Object.keys(state.classAssignments).forEach(cls => {
      classSchedules[cls] = {};
      DAYS.forEach(d => {
        classSchedules[cls][d] = [];
        PERIODS.forEach(p => { if (schedule[d] && schedule[d][p]) { const lessons = schedule[d][p].filter(l => l.targets.includes(cls)); if (lessons.length > 0) classSchedules[cls][d].push({ period: p, lessons }); } });
      });
    });
  }

  const evalRule = (key, name, logic) => {
    const res = logic();
    let score = 100;
    if (res.targetCount > 0) score = Math.max(0, Math.round((1 - res.failures.length / res.targetCount) * 100));
    scoreCard.advanced.rules[key] = { name, score, failures: res.failures };
    return score;
  };

  evalRule('limitOneSubjectPerDayStrict', '1日1コマ制限(分散)', () => {
    let targetCount = 0, failures = [];
    const enforceOnePerDay = pLevels['limitOneSubjectPerDayStrict'] !== 'low';
    Object.keys(classSchedules).forEach(cls => {
      DAYS.forEach(d => {
        const counts = {}; 
        classSchedules[cls][d].forEach(slot => { slot.lessons.forEach(l => { 
            if (!counts[l.subject]) counts[l.subject] = { ids: new Set(), totalHours: l.totalHours, limitOnePerDay: l.limitOnePerDay };
            counts[l.subject].ids.add(l.id);
        }); });
        Object.entries(counts).forEach(([sub, info]) => { 
          if (info.limitOnePerDay || (enforceOnePerDay && info.totalHours <= 5)) {
            targetCount++; 
            if (info.ids.size > 1) {
                failures.push(`${cls} ${sub} が${d}曜に複数回(別コマとして)存在`); 
            }
          }
        });
      });
    });
    return { targetCount, failures };
  });

  if (rules.limitContinuousToSpecificPeriods) {
    evalRule('limitContinuousToSpecificPeriods', '連続授業の特定枠限定', () => {
      let targetCount = 0, failures = [];
      allScheduledLessons.forEach(({lesson, day, period}) => {
         if (lesson.length === 2) {
            targetCount++;
            if (period !== 1 && period !== 3 && period !== 5) failures.push(`${lesson.targets.join(',')} ${lesson.subject}(${day}曜${period}限) がペア枠外`);
         }
      });
      return { targetCount, failures };
    });
  }

  if (rules.exclusivePairs && rules.exclusivePairs.length > 0) {
    evalRule('exclusivePairs', '同日実施回避(排他ペア)', () => {
      let targetCount = 0, failures = [];
      Object.keys(classSchedules).forEach(cls => {
        DAYS.forEach(d => {
           const todaySubjects = new Set();
           classSchedules[cls][d].forEach(slot => slot.lessons.forEach(l => todaySubjects.add(l.subject)));
           rules.exclusivePairs.forEach(pair => {
             targetCount++; 
             if (todaySubjects.has(pair.subject1) && todaySubjects.has(pair.subject2)) failures.push(`${cls} ${pair.subject1}と${pair.subject2} が${d}曜に同日実施`);
           });
        });
      });
      return { targetCount, failures };
    });
  }

  if (rules.homeroomOnlyTimes && rules.homeroomOnlyTimes.length > 0) {
    evalRule('homeroomOnlyTimes', '担任授業固定枠', () => {
      let targetCount = 0, failures = [];
      allScheduledLessons.forEach(({lesson, day, period}) => {
         if (lesson.isSpecialist) {
            for(let i=0; i<(lesson.length||1); i++){
                if (rules.homeroomOnlyTimes.some(r => r.day === day && r.period === (period+i) && matchRuleTarget(r, lesson))) {
                    failures.push(`${lesson.targets.join(',')} ${lesson.subject}(${day}曜${period+i}限) が担任固定枠に配置`);
                }
            }
         }
      });
      targetCount = failures.length > 0 ? failures.length * 2 : 1; 
      return { targetCount, failures };
    });
  }

  if (rules.avoidSpecialistTimes && rules.avoidSpecialistTimes.length > 0) {
    evalRule('avoidSpecialistTimes', '専科回避指定枠', () => {
      let targetCount = 0, failures = [];
      allScheduledLessons.forEach(({lesson, day, period}) => {
         if (lesson.isSpecialist) {
            targetCount++;
            for(let i=0; i<(lesson.length||1); i++){
               if (rules.avoidSpecialistTimes.some(r => r.day === day && r.period === (period+i))) failures.push(`${lesson.targets.join(',')} ${lesson.subject}(${day}曜${period+i}限) が専科回避枠に配置`);
            }
         }
      });
      return { targetCount, failures };
    });
  }

  if (rules.avoidSpecificTimes && rules.avoidSpecificTimes.length > 0) {
    evalRule('avoidSpecificTimes', '特定時間帯回避', () => {
      let targetCount = 0, failures = [];
      allScheduledLessons.forEach(({lesson, day, period}) => {
         for(let i=0; i<(lesson.length||1); i++){
            if (rules.avoidSpecificTimes.some(r => r.day === day && r.period === (period+i) && r.subject === lesson.subject && matchRuleTarget(r, lesson))) {
               failures.push(`${lesson.targets.join(',')} ${lesson.subject}(${day}曜${period+i}限) が回避指定枠に配置`);
            }
         }
         if (rules.avoidSpecificTimes.some(r => r.subject === lesson.subject && matchRuleTarget(r, lesson))) targetCount++;
      });
      return { targetCount, failures };
    });
  }

  if (rules.amPrioritySubjects && rules.amPrioritySubjects.length > 0) {
    evalRule('amPrioritySubjects', '午前優先配置', () => {
      let targetCount = 0, failures = [];
      allScheduledLessons.forEach(({lesson, day, period}) => {
         if (isTargetRule(rules.amPrioritySubjects, lesson)) {
            targetCount++;
            if (period > 4) failures.push(`${lesson.targets.join(',')} ${lesson.subject}(${day}曜${period}限) が午後に配置`);
         }
      });
      return { targetCount, failures };
    });
  }

  if (rules.lastPeriodSubjects && rules.lastPeriodSubjects.length > 0) {
    evalRule('lastPeriodSubjects', '最終コマ優先配置', () => {
      let targetCount = 0, failures = [];
      allScheduledLessons.forEach(({lesson, day, period}) => {
         if (isTargetRule(rules.lastPeriodSubjects, lesson)) {
            targetCount++;
            const grade = lesson.targets[0].split('-')[0];
            const maxP = state.periods[grade]?.[day] || Math.max(...PERIODS);
            if (period + (lesson.length||1) - 1 !== maxP) failures.push(`${lesson.targets.join(',')} ${lesson.subject}(${day}曜${period}限) が最終コマ以外に配置`);
         }
      });
      return { targetCount, failures };
    });
  }

  if (rules.homeroomBufferSubjects && rules.homeroomBufferSubjects.length > 0) {
    evalRule('homeroomBufferSubjects', '担任裁量バッファ', () => {
      let targetCount = 0, failures = [];
      allScheduledLessons.forEach(({lesson, day, period}) => {
         if (isTargetRule(rules.homeroomBufferSubjects, lesson)) {
            targetCount++;
            const cls = lesson.targets[0], homeroomId = state.classAssignments?.[cls]?.homeroom;
            if (homeroomId) {
              let bufferOk = false;
              const grade = cls.split('-')[0], maxP = state.periods[grade]?.[day] || Math.max(...PERIODS);
              const checkBuffer = (pNow, pAdj) => {
                if (pAdj < 1 || pAdj > maxP) return false;
                if ((pNow === 4 && pAdj === 5) || (pNow === 5 && pAdj === 4)) return false; 
                const existing = schedule[day][pAdj]?.filter(l => l.targets.includes(cls)) || [];
                if (existing.length === 0) return true; 
                if (existing.some(l => l.teacherIds.includes(homeroomId))) return true; 
                return false;
              };
              if (checkBuffer(period, period - 1) || checkBuffer(period + (lesson.length||1) - 1, period + (lesson.length||1))) bufferOk = true;
              if (!bufferOk) failures.push(`${lesson.targets.join(',')} ${lesson.subject}(${day}曜${period}限) の前後にバッファなし`);
            }
         }
      });
      return { targetCount, failures };
    });
  }

  let advScores = Object.values(scoreCard.advanced.rules).map(r => r.score);
  if (advScores.length > 0) scoreCard.advanced.score = Math.round(advScores.reduce((a,b)=>a+b, 0) / advScores.length);
  return scoreCard;
}

function calcRulePenalty(lesson, d, p, schedule, state, rules, pLevels, PERIODS) {
  let penalty = 0;
  const isHigh = (k, def = false) => pLevels[k] !== undefined ? pLevels[k] === 'high' : def;
  
  if (!isHigh('amPrioritySubjects') && isTargetRule(rules.amPrioritySubjects, lesson)) {
    if (p > 4) penalty += 300; 
  }
  
  if (!isHigh('lastPeriodSubjects') && isTargetRule(rules.lastPeriodSubjects, lesson)) {
    const grade = lesson.targets[0].split('-')[0];
    const maxP = state.periods[grade]?.[d] || Math.max(...PERIODS);
    if (p + (lesson.length||1) - 1 !== maxP) penalty += 200; 
  }

  if (!isHigh('limitOneSubjectPerDayStrict', true)) {
    const maxPeriod = Math.max(...PERIODS);
    for(let i=1; i<=maxPeriod; i++) {
      if (i >= p && i < p + (lesson.length||1)) continue; 
      if (schedule[d][i] && schedule[d][i].some(l => l.id !== lesson.id && l.subject === lesson.subject && l.targets.some(t => lesson.targets.includes(t)))) {
        penalty += 800; 
      }
    }
  }

  return penalty;
}