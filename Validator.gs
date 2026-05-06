/**
 * ==========================================
 * File: Validator.gs - 時間割の評価・ルール検証
 * ==========================================
 */

function checkStrictRules(lesson, day, period, schedule, state, rules, pLevels, PERIODS) {
    if (!rules) return { valid: true };
    const isStrict = (key) => pLevels[key] === 'high';

    if (isStrict('limitOneSubjectPerDayStrict') && rules.limitOneSubjectPerDayStrict) {
        if (!lesson.isSpecialist) { 
            let count = 0;
            PERIODS.forEach(p => {
                if (p === period) return;
                const ls = schedule[day]?.[p];
                if (ls) {
                    ls.forEach(l => {
                        // 手動追加された駒（manual_...）であっても、IDが異なり同教科・同クラスなら重複とみなす
                        if (l.id !== lesson.id && l.subject === lesson.subject && l.targets.some(t => lesson.targets.includes(t))) count++;
                    });
                }
            });
            if (count > 0) return { valid: false, reason: '同日重複' };
        }
    }

    if (isStrict('exclusivePairs') && rules.exclusivePairs?.length > 0) {
        for (let r of rules.exclusivePairs) {
            let s1 = r.subject1, s2 = r.subject2;
            if (lesson.subject === s1 || lesson.subject === s2) {
                let checkSub = lesson.subject === s1 ? s2 : s1;
                let pairExists = false;
                PERIODS.forEach(p => {
                    const ls = schedule[day]?.[p];
                    if (ls && ls.some(l => l.subject === checkSub && l.targets.some(t => lesson.targets.includes(t)))) pairExists = true;
                });
                if (pairExists) return { valid: false, reason: '排他ペア同日' };
            }
        }
    }

    if (isStrict('limitContinuousToSpecificPeriods') && rules.limitContinuousToSpecificPeriods) {
        if ((lesson.length || 1) >= 2) {
            if (period > 3) return { valid: false, reason: '連続授業の午後配置' };
        }
    }

    return { valid: true };
}

function calcRulePenalty(lesson, day, period, schedule, state, rules, pLevels, PERIODS) {
    if (!rules) return 0;
    let penalty = 0;
    const isEffort = (key) => pLevels[key] === 'low';
    const isStrict = (key) => pLevels[key] === 'high';

    if (isEffort('limitOneSubjectPerDayStrict') && rules.limitOneSubjectPerDayStrict && !lesson.isSpecialist) {
        let count = 0;
        PERIODS.forEach(p => {
            if (p === period) return;
            const ls = schedule[day]?.[p];
            if (ls && ls.some(l => l.id !== lesson.id && l.subject === lesson.subject && l.targets.some(t => lesson.targets.includes(t)))) count++;
        });
        if (count > 0) penalty += 500;
    }

    if (isEffort('exclusivePairs') && rules.exclusivePairs?.length > 0) {
        for (let r of rules.exclusivePairs) {
            let s1 = r.subject1, s2 = r.subject2;
            if (lesson.subject === s1 || lesson.subject === s2) {
                let checkSub = lesson.subject === s1 ? s2 : s1;
                PERIODS.forEach(p => {
                    const ls = schedule[day]?.[p];
                    if (ls && ls.some(l => l.subject === checkSub && l.targets.some(t => lesson.targets.includes(t)))) penalty += 300;
                });
            }
        }
    }

    if (isEffort('limitContinuousToSpecificPeriods') && rules.limitContinuousToSpecificPeriods && (lesson.length || 1) >= 2) {
        if (period > 3) penalty += 200;
    }

    if (rules.avoidSpecificTimes?.length > 0) {
        for (let r of rules.avoidSpecificTimes) {
            if (matchRuleTarget(r, lesson) && matchRuleSubject(r, lesson)) {
                if (r.day === day && r.period === period) {
                    penalty += isStrict('avoidSpecificTimes') ? 10000 : 300;
                }
            }
        }
    }

    if (rules.amPrioritySubjects?.length > 0) {
        if (rules.amPrioritySubjects.some(r => matchRuleTarget(r, lesson) && matchRuleSubject(r, lesson))) {
            if (period > 4) penalty += isStrict('amPrioritySubjects') ? 5000 : 200;
        }
    }

    if (rules.lastPeriodSubjects?.length > 0) {
        if (rules.lastPeriodSubjects.some(r => matchRuleTarget(r, lesson) && matchRuleSubject(r, lesson))) {
            const maxP = state.periods[lesson.targets[0].split('-')[0]]?.[day] || 6;
            if (period !== maxP) penalty += isStrict('lastPeriodSubjects') ? 5000 : 200;
        }
    }

    return penalty;
}

function evaluateSchedule(schedule, state, rules, pLevels, unassigned, teacherObj, DAYS, PERIODS) {
    let totalLessons = 0;
    let placedLessons = 0;
    
    DAYS.forEach(d => {
        PERIODS.forEach(p => {
            if (schedule[d]?.[p]) placedLessons += schedule[d][p].length;
        });
    });
    totalLessons = placedLessons + (unassigned?.length || 0);

    let basicScore = totalLessons > 0 ? Math.round((placedLessons / totalLessons) * 100) : 0;
    let advancedScores = { rules: {} };
    
    if (rules.limitOneSubjectPerDayStrict) {
        advancedScores.rules.limitOneSubjectPerDayStrict = { name: "同日重複の分散", score: 100, failures: [] };
    }

    return {
        basic: { score: basicScore },
        advanced: advancedScores
    };
}

function matchRuleTarget(rule, lesson) {
    if (!rule.grade && !rule.exclude) return true;
    let isTarget = false;
    if (rule.grade === "全学年" || !rule.grade) isTarget = true;
    else if (lesson.targets.some(t => t.startsWith(rule.grade.replace('年生', '')))) isTarget = true;
    
    if (isTarget && rule.exclude) {
        if (lesson.targets.some(t => t.startsWith(rule.exclude.replace('年生', '')))) isTarget = false;
    }
    return isTarget;
}

function matchRuleSubject(rule, lesson) {
    if (!rule.subject) return true;
    return lesson.subject === rule.subject;
}

function getLessonDifficulty(lesson, teacherObj, roomObj) {
    let score = 0;
    score += (lesson.length || 1) * 100;
    if (lesson.isSpecialist) score += 50;
    if (lesson.teacherIds.length > 1) score += 80 * lesson.teacherIds.length;
    if (lesson.targets.length > 1) score += 80 * lesson.targets.length;
    if (lesson.room && lesson.room !== '通常教室') score += 40;
    return score;
}