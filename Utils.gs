/**
 * ==========================================
 * File: Utils.gs - 共通ヘルパー関数
 * ==========================================
 */

function getSubjectColor(subjectName, data) {
  if (!subjectName) return "#FFFFFF";
  if (data && data.subjects) {
      const sub = data.subjects.find(s => s.name === subjectName);
      if (sub && sub.color) return sub.color;
  }
  const s = subjectName;
  if (s.includes("国語") || s.includes("書写")) return "#E3F2FD";
  if (s.includes("算数") || s.includes("数学")) return "#FFFDE7";
  if (s.includes("体育")) return "#FFEBEE";
  if (s.includes("理科")) return "#E8F5E9";
  if (s.includes("社会")) return "#FFF3E0";
  if (s.includes("英語") || s.includes("外国語")) return "#F3E5F5";
  if (s.includes("音楽")) return "#FCE4EC";
  if (s.includes("図工") || s.includes("美術")) return "#E0F7FA";
  return "#F5F5F5";
}

function getDynamicDaysAndPeriods(state) {
    let daysSet = new Set();
    let maxP = 0;
    if (state.periods) {
        Object.keys(state.periods).forEach(g => {
            Object.keys(state.periods[g]).forEach(d => {
                daysSet.add(d);
                if (state.periods[g][d] > maxP) maxP = state.periods[g][d];
            });
        });
    }
    const DAYS = Array.from(daysSet).length > 0 ? Array.from(daysSet) : ['月', '火', '水', '木', '金'];
    const PERIODS = Array.from({length: maxP > 0 ? maxP : 6}, (_, i) => i + 1);
    return { DAYS, PERIODS };
}

function matchRuleTarget(rule, lesson) {
  if (!rule) return false;
  let isTarget = (!rule.grade || rule.grade === '全学年' || lesson.targets.some(t => t.startsWith(rule.grade.replace('年生', ''))));
  if (isTarget && rule.exclude) {
    const excludeStr = rule.exclude.replace('年生', '');
    if (lesson.targets.some(t => t.startsWith(excludeStr))) isTarget = false;
  }
  return isTarget;
}

function isTargetRule(rulesArray, lesson) {
  if (!rulesArray || !Array.isArray(rulesArray)) return false;
  return rulesArray.some(r => r.subject === lesson.subject && matchRuleTarget(r, lesson));
}

function removeLesson(lesson, schedule) {
  Object.keys(schedule).forEach(d => { 
    Object.keys(schedule[d]).forEach(p => { 
      if(schedule[d] && schedule[d][p]) {
        schedule[d][p] = schedule[d][p].filter(l => l.id !== lesson.id); 
      }
    }); 
  });
}

function getLessonDifficulty(lesson, teacherObj, roomObj) {
  let score = (lesson.length || 1) * 2000 + lesson.targets.length * 500;
  if (lesson.room && roomObj && roomObj[lesson.room]) score += 500; 
  lesson.teacherIds.forEach(tid => {
    const t = teacherObj[tid];
    if (t && t.ngTimes) score += Object.values(t.ngTimes).filter(v=>v).length * 100;
  });
  if (lesson.limitOnePerDay) score += 500; 
  return score;
}