import assert from "node:assert/strict";
import test from "node:test";
import { buildMatrix, createPreparation, evaluateAnswer, finishSession, nextTurn, parseJob, parseResume, startSession } from "./interview";
import { saveFinalAnswer } from "./coaching";

const resume = "李明，AI 售前顾问。负责企业知识库 POC，完成 8 个客户项目；使用 Python 和 SQL 分析数据，与产品、算法和交付团队协作，将召回率从 70% 提升到 85%。";
const jd = "AI 解决方案经理，负责客户调研、方案设计、POC 推进。要求理解 LLM、RAG 和模型评测，具备客户沟通、项目交付与 Python 能力。";

test("简历与 JD 被解析成可用结构，且矩阵不虚构证据", () => {
  const profile = parseResume(resume); const job = parseJob(jd); const matrix = buildMatrix(profile, job);
  assert.ok(profile.evidence.length > 0); assert.ok(job.requirements.length > 0);
  for (const row of matrix) assert.ok(!row.evidence || resume.includes(row.evidence.split("；")[0]));
});

test("回答缺少事实会追问，追问后进入下一题", () => {
  const preparation = createPreparation(resume, jd);
  preparation.questions[0] = { ...preparation.questions[0], category: "经历复盘", technical: false, sourceType: "resume", text: "请说明一个真实项目中你亲自负责的行动和实际产物。" };
  const initial = startSession(preparation);
  const followUp = nextTurn(initial, "我会努力做好这个岗位。");
  assert.equal(followUp.awaitingFollowUp, true); assert.equal(followUp.currentQuestionIndex, 0);
  const progressed = nextTurn(followUp, "在企业知识库 POC 中，我负责客户调研和方案设计，完成 8 个客户项目，并把召回率从 70% 提升到 85%。");
  assert.equal(progressed.awaitingFollowUp, false); assert.equal(progressed.currentQuestionIndex, 1);
});

test("已配置模型时，模型的追问决策会推进会话状态", () => {
  const preparation = createPreparation(resume, jd); const initial = startSession(preparation);
  const advanced = nextTurn(initial, "我完成了客户 POC 并做了复盘。", { action: "follow_up", followUpQuestion: "请说明你本人负责的动作和量化结果。" });
  assert.equal(advanced.awaitingFollowUp, true); assert.equal(advanced.questions[0].text, "请说明你本人负责的动作和量化结果。");
});

test("保留旧结构兼容但技术题不再输出准确性分数", () => {
  const p = createPreparation(resume, jd); const technical = p.questions.find(q => q.technical)!;
  const score = evaluateAnswer("在知识库 POC 中，我先定义召回率指标，再通过检索切分和 rerank 评测提升召回率；我负责 Python 数据分析并与算法协作验证。", technical, p);
  assert.deepEqual(Object.keys(score.dimensions), ["回应度", "逻辑结构", "事实与案例", "岗位匹配度", "表达清晰度"]);
  assert.equal(score.technicalAccuracy, undefined);
  assert.equal(score.observations?.find(o => o.id === "technical")?.status, "unknown");
});

test("完成会话能够生成包含缺口与训练重点的报告", () => {
  const p = createPreparation(resume, jd); let session = startSession(p);
  while (session.status === "active") session = nextTurn(session, "在企业知识库 POC 中，我负责客户调研和方案设计，完成 8 个客户项目；我用 Python 和 SQL 分析数据，与算法和交付团队协作，把召回率从 70% 提升到 85%。");
  const report = finishSession(session); assert.ok(report.gaps.length > 0); assert.ok(report.nextFocus.length > 0);
});

test("保存最终答案保留原回答和重答历史", () => {
  const preparation = createPreparation(resume, jd);
  const session = nextTurn(startSession(preparation), "我负责整理客户需求并输出方案文档。", { action: "next" });
  const saved = saveFinalAnswer(session, 0, "我先澄清客户目标，再整理需求并输出可评审的方案文档，同时说明本人负责范围。");
  assert.equal(saved.turns[0].answer, session.turns[0].answer);
  assert.match(saved.turns[0].finalAnswer || "", /澄清客户目标/);
  assert.ok(saved.turns[0].finalAnswerUpdatedAt);
});
