import type { CoachFeedback, InterviewSession, InterviewTurn, Observation, Preparation, Question, Scorecard } from "./domain";

export const observationLabels = { provided: "已提供", missing: "缺失", contradiction: "矛盾（待核对）", unknown: "无法判断" };
const clauses = (value: string) => value.split(/[。；;\n，,]/).map(s => s.trim()).filter(Boolean);
export const hasNegativeClaim = (value: string) => /从未|没有|未曾|尚未|尚无|未负责|不负责|未参与|未完成|不懂|不会|不能|不代表|计划|打算|准备学习/.test(value);

export function isKnowledgeQuestion(question: Question) {
  if (/真实项目|你的项目|个人贡献|简历|经历|做过|负责的/.test(question.text)) return false;
  return question.technical || (question.sourceType === "foundation" && question.category !== "转岗动机 / 能力迁移" && question.category !== "项目表达 / 行为面试");
}

export function evaluateEvidence(answer: string, question: Question, preparation: Preparation): Scorecard {
  const lines = clauses(answer);
  const hypothetical = /如果|假设|预期|将会|我会|拟定/.test(answer);
  const action = lines.filter(s => /(?:我|本人)(?:亲自|主要|具体)?(?:负责|完成|设计|整理|访谈|搭建|实现|分析|验证|推动)/.test(s) && !hasNegativeClaim(s) && !hypothetical);
  const result = lines.filter(s => /结果|产出|产物|纪要|清单|报告|验证集|测试集|demo|提升|降低|缩短|交付/i.test(s) && !hasNegativeClaim(s) && !hypothetical);
  const boundary = lines.filter(s => /未负责|没有|未参与|尚无|尚未|局限|边界|不足|取舍|权衡|限制|不代表|团队负责/.test(s));
  function item(id: string, label: string, quotes: string[], nextStep: string): Observation {
    return { id, label, status: quotes.length ? "provided" : "missing", quotes: quotes.slice(0, 3), explanation: quotes.length ? "识别到相关表述，仅说明写到了，不代表事实已核验或内容正确。" : "规则未识别到明确表述，可能存在漏判；请核对原回答。", nextStep };
  }
  const knowledge = isKnowledgeQuestion(question);
  const observations: Observation[] = knowledge ? [] : [
    item("action", "个人行动", action, "说明你本人具体做了什么，与团队贡献分开。"),
    item("result", "结果或产物", result, "补充可展示的产物、验证方法或指标口径；无数据时如实说明。"),
    item("boundary", "能力边界", boundary, "说明未参与的部分、证据限制或关键取舍。"),
  ];
  // Only flag a narrow, exact responsibility contradiction. Never infer general truth.
  const claims = lines.flatMap(line => {
    const match = line.match(/(?:我|本人)(没有|未曾|从未|未)?负责(.+)/);
    return match ? [{ line, negative: Boolean(match[1]), subject: match[2].trim() }] : [];
  });
  const materials = clauses(preparation.resume.raw);
  const conflict = claims.flatMap(claim => {
    const opposite = `${claim.negative ? "" : "没有"}负责${claim.subject}`;
    const inAnswer = claims.find(other => other.subject === claim.subject && other.negative !== claim.negative);
    const normalized = opposite.replace(/\s/g, "");
    const inMaterial = materials.find(line => { const value = line.replace(/\s/g, ""); return value === `我${normalized}` || value === `本人${normalized}`; });
    return inAnswer || inMaterial ? [{ claim, inAnswer, inMaterial }] : [];
  })[0];
  observations.push({ id: "consistency", label: "材料一致性", status: conflict ? "contradiction" : "unknown", quotes: conflict ? [conflict.claim.line, ...(conflict.inAnswer ? [conflict.inAnswer.line] : [])] : [], materialQuotes: conflict?.inMaterial ? [conflict.inMaterial] : [], explanation: conflict ? "检测到同一职责的肯定与否定表述。可能是时间或项目不同，请人工核对，不能直接判断哪句真实。" : "未发现本规则可识别的直接冲突；这不等于没有矛盾或已核验。", nextStep: "核对项目、时间范围和个人职责，必要时更正原材料。" });
  if (question.technical) observations.push({ id: "technical", label: "技术正确性", status: "unknown", quotes: [], explanation: "本地规则无法判断技术原理是否正确，不输出技术准确性分数。", nextStep: "请用权威资料、可运行实验或专业人工评审核对原理与结论。" });
  return {
    overall: 0,
    dimensions: { "回应度": 0, "逻辑结构": 0, "事实与案例": 0, "岗位匹配度": 0, "表达清晰度": 0 },
    observations,
    technicalNote: question.technical ? "无法判断技术正确性" : undefined,
    improvement: observations.filter(o => o.status === "missing" || o.status === "contradiction").map(o => o.nextStep).join(" ") || "继续人工核对原句、证据来源和岗位相关性。",
    referenceAnswer: knowledge ? `回答思路：先解释「${question.text}」涉及的概念 → 说明工作原理或技术逻辑 → 举应用场景 → 说明局限与尚不理解的部分。本地提示不能判断知识是否正确或已经掌握。` : "回答思路：背景与目标 → 自己的职责与行动 → 真实结果或产物 → 边界与反思。无需机械套用 STAR；假设方案应说清楚‘如果由我负责’，不能表述成已完成经历。",
  };
}

export function questionForTurn(session: InterviewSession, turn: InterviewTurn): Question {
  const original = session.preparation.questions.find(q => q.id === turn.questionId.replace(/-followup$/, ""));
  return { ...(original ?? { id: turn.questionId, category: "经历复盘", source: "本轮回答", sourceType: "resume", technical: false }), id: turn.questionId, text: turn.question } as Question;
}

export function latestAnswer(turn: InterviewTurn) { return turn.revisions?.at(-1)?.answer ?? turn.answer; }
export function currentCoachReview(turn: InterviewTurn) {
  return turn.coachReviews?.find(review => review.answerVersion === (turn.revisions?.length ?? 0) + 1 && review.answer === latestAnswer(turn));
}

export function attachCoachReview(session: InterviewSession, index: number, answerVersion: number, answer: string, feedback: CoachFeedback): InterviewSession {
  const turn = session.turns[index];
  if (!turn || answerVersion !== (turn.revisions?.length ?? 0) + 1 || answer !== latestAnswer(turn)) throw new Error("回答版本已变化，未写入旧版本点评。请为当前回答重新请求点评。");
  if (currentCoachReview(turn)) throw new Error("当前回答版本已有点评，未覆盖历史建议。");
  return { ...session, turns: session.turns.map((item, i) => i === index ? { ...item,
    coachReviews: [...(item.coachReviews ?? []), { answerVersion, answer, feedback }], coachFailure: undefined,
    // Original-answer compatibility for existing question previews; never overwrite legacy feedback.
    ...(answerVersion === 1 && !item.aiCoach ? { aiCoach: feedback } : {}),
  } : item) };
}

export function markCoachFailure(session: InterviewSession, index: number, answerVersion: number, message: string): InterviewSession {
  const turn = session.turns[index];
  if (!turn || answerVersion !== (turn.revisions?.length ?? 0) + 1) throw new Error("回答版本已变化，未写入旧版本状态。");
  return { ...session, turns: session.turns.map((item, i) => i === index ? { ...item, coachFailure: { answerVersion, message } } : item) };
}
export function reviewTurn(session: InterviewSession, turn: InterviewTurn) {
  return evaluateEvidence(latestAnswer(turn), questionForTurn(session, turn), session.preparation);
}

export function compareFeedback(previous: Scorecard, current: Scorecard) {
  const before = new Map((previous.observations ?? []).map(o => [o.id, o]));
  return {
    added: (current.observations ?? []).filter(o => o.status === "provided" && before.get(o.id)?.status !== "provided").map(o => o.label),
    unresolved: (current.observations ?? []).filter(o => o.status === "missing" || o.status === "contradiction").map(o => o.label),
    lost: (current.observations ?? []).filter(o => o.status !== "provided" && before.get(o.id)?.status === "provided").map(o => o.label),
    unknown: (current.observations ?? []).filter(o => o.status === "unknown").map(o => o.label),
  };
}

export function reviseTurn(session: InterviewSession, index: number, answer: string, now = new Date()): InterviewSession {
  const turn = session.turns[index];
  if (!turn || !answer.trim()) throw new Error("请填写重答内容；可以如实说明不会或不知道。");
  if ((turn.revisions?.length ?? 0) >= 20) throw new Error("本题已保存 20 次重答，请先导出备份。");
  const revision = { answer, score: evaluateEvidence(answer, questionForTurn(session, turn), session.preparation), createdAt: now.toISOString() };
  return { ...session, report: undefined, turns: session.turns.map((t, i) => i === index ? { ...t, revisions: [...(t.revisions ?? []), revision] } : t) };
}

export function saveFinalAnswer(session: InterviewSession, index: number, answer: string, now = new Date()): InterviewSession {
  if (!session.turns[index]) throw new Error("未找到要保存的回答。");
  if (!answer.trim()) throw new Error("请填写本人认可的回答思路。");
  return { ...session, turns: session.turns.map((turn, turnIndex) => turnIndex === index ? { ...turn, finalAnswer: answer.trim(), finalAnswerUpdatedAt: now.toISOString() } : turn) };
}
