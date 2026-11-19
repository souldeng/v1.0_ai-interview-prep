import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { buildInterviewContext } from "./interviewContext";
import { emptyUserProfile, PROFILE_KEY } from "./profileStorage";
import { createPreparation, nextTurn, startSession } from "./interview";
import { createInterviewProject, updateProjectFromSession } from "./projects";
import { deepDiveAngles, groundedReference, validateProjectQuestions } from "./projectDeepDive";
import { attachCoachReview, reviseTurn, saveFinalAnswer } from "./coaching";
import { exportBackup, importBackup } from "./backup";
import { coachInterviewAnswer, generateJobProjectQuestions } from "../services/modelClient";
import type { CoachFeedback } from "./domain";

const fixture = JSON.parse(readFileSync(new URL("../../test-fixtures/public-coach/project-depth.json", import.meta.url), "utf8"));
const profile = emptyUserProfile();
profile.experiences = fixture.experiences.map((e: any) => ({ ...e, confirmed: true, createdAt: profile.updatedAt, updatedAt: profile.updatedAt }));
profile.experiences.push({ ...profile.experiences[0], id: "unconfirmed", confirmed: false, action: fixture.unconfirmed });
const project = createInterviewProject({ company: "匿名合成", jobTitle: "AI Builder", jobDescription: fixture.jd, candidateBackground: "", concerns: "" }, createPreparation("", fixture.jd));
const context = buildInterviewContext({ profile, project });
const response = { questions: [0, 1, 2].map(i => ({ text: ["Bid-Writer 的上下文如何保留边界？", "你用 Codex 理解代码时如何验证调用链？", "RAG 对照评测怎样区分检索与生成问题？"][i], experienceId: "fixture-bid", requirementQuote: fixture.jd, evidenceQuote: profile.experiences[0].action, whyAsk: "核对岗位要求与个人实际行动。", angles: i === 0 ? deepDiveAngles.slice(0, 3) : i === 1 ? deepDiveAngles.slice(3, 5) : deepDiveAngles.slice(5), followUps: ["有哪些原始记录可以说明你的判断？"] })) };
const questions = validateProjectQuestions(context, response);

test("岗位深挖题逐题关联JD与完整个人字段，拒绝面经/草稿/截断否定/重复和缺角度", () => {
  assert.equal(questions.length, 3);
  for (const change of [
    { experienceId: "unconfirmed" }, { requirementQuote: fixture.thirdParty }, { evidenceQuote: "负责模型训练" }, { evidenceQuote: "模型训练" }, { followUps: [] }, { angles: ["胡编"] },
    { text: "你已经节省80%时间了吗？" }, { text: "你没有参与模型训练吗？" }, { text: "你没有通过率和上线证据，怎么解释价值？" }, { text: "你没有用户学习效果或录用结果，如何介绍？" },
  ]) assert.throws(() => validateProjectQuestions(context, { questions: response.questions.map((q, i) => i === 0 ? { ...q, ...change } : q) }));
  assert.throws(() => validateProjectQuestions(context, { questions: [response.questions[0], response.questions[0], response.questions[2]] }));
  assert.throws(() => validateProjectQuestions(context, { questions: response.questions.map(q => ({ ...q, angles: ["设计动机"] })) }));
});

test("参考表达只选完整字段，保留否定和责任边界；不能跨项目借指标或用最终答案补事实", () => {
  const input = buildInterviewContext({ profile, project, question: questions[0] });
  const result = groundedReference(input, questions[0], [{ experienceId: "fixture-bid", fields: ["tools", "result"] }], ["真实Badcase"]);
  assert.match(result.optimizedExample, /没有负责模型训练/);
  assert.match(result.optimizedExample, /尚未提供通过率/);
  assert.doesNotMatch(result.optimizedExample, /80%|99%|独立负责全部/);
  assert.ok(result.referenceBasis!.every(b => profile.experiences[0][b.field] === b.quote));
  assert.match(result.referenceUncertainties!.join(""), /待核实.*真实Badcase/);
  for (const selection of [[{ experienceId: "fixture-prep", fields: ["result"] }], [{ experienceId: "unconfirmed", fields: ["action"] }], [{ experienceId: "fixture-bid", fields: ["我节省80%时间"] }]]) assert.equal(groundedReference(input, questions[0], selection, []).optimizedExample, "");
});

test("修改/撤销确认/删除经历后旧题不再使用旧事实，长字段尾部限制不被截断", () => {
  for (const experiences of [[], profile.experiences.map(e => ({ ...e, confirmed: false })), profile.experiences.map(e => ({ ...e, action: e.action + "新版" }))]) {
    const stale = buildInterviewContext({ project, profile: { ...profile, experiences }, question: questions[0] });
    assert.equal(stale.confirmedUserFacts.length, 0);
    assert.equal(groundedReference(stale, questions[0], [{ experienceId: "fixture-bid", fields: ["action"] }], []).optimizedExample, "");
  }
  const long = buildInterviewContext({ profile: { ...profile, experiences: [{ ...profile.experiences[0], situation: "背景".repeat(900), reflection: "没有负责上线" }] } });
  assert.match(long.confirmedUserFacts[0], /没有负责上线$/);
});

test("动态追问不可用时复用本题的预备追问，并标明实际来源而非假称本轮模型成功", () => {
  const prepared = { ...createPreparation("", fixture.jd), questions };
  const followed = nextTurn(startSession(prepared), "我不知道", null);
  assert.equal(followed.questions[0].text, questions[0].projectDeepDive!.followUps[0]);
  assert.match(followed.questions[0].source, /未获得动态追问/);
  assert.equal(followed.questions[0].sourceType, "ai_follow_up");
  assert.equal(nextTurn(followed, "我还是需要核对", null).currentQuestionIndex, 1);
});

test("新生成/点评走原代理；自由故事和第三方指标不进入参考答案", async () => {
  const previous = globalThis.fetch;
  const feedback = { strengths: [], issues: [], factRisks: [], suggestions: [], answerStructure: "我上线并节省80%时间", studyTopics: [], optimizedExample: "我负责训练并上线99%准确率", referenceSelection: [{ experienceId: "fixture-bid", fields: ["tools"] }], missingAspects: ["真实Badcase"] };
  const requests: any[] = [];
  try {
    globalThis.fetch = async (_url, init) => { const req = JSON.parse(String(init?.body)); requests.push(req); return new Response(JSON.stringify({ content: JSON.stringify(req.feature === "interview_question" ? response : feedback) })); };
    const generated = await generateJobProjectQuestions(context);
    const result = await coachInterviewAnswer(buildInterviewContext({ profile, project, question: generated[0], currentQuestion: generated[0].text, userAnswer: fixture.unconfirmed }), generated[0]);
    assert.deepEqual(requests.map(r => r.feature), ["interview_question", "interview_feedback"]);
    assert.match(result.optimizedExample, /没有负责模型训练/);
    assert.doesNotMatch(result.optimizedExample + result.answerStructure, /80%|99%|我负责训练并上线/);
  } finally { globalThis.fetch = previous; }
});

test("参考答案、原答、重答、最终答案经备份导入仍独立，副本经历可继续核对", () => {
  const prepared = { ...createPreparation("", fixture.jd), questions };
  const original = saveFinalAnswer(nextTurn(startSession(prepared), "我先独立回答", { action: "next" }), 0, "本人确认最终答案");
  const ref = groundedReference(buildInterviewContext({ profile, project, question: questions[0] }), questions[0], [{ experienceId: "fixture-bid", fields: ["tools"] }], []);
  const feedback: CoachFeedback = { ...ref, strengths: [], issues: [], factRisks: [], suggestions: [], answerStructure: "指导", studyTopics: [], generatedAt: profile.updatedAt };
  const coached = attachCoachReview(original, 0, 1, "我先独立回答", feedback);
  const revised = reviseTurn(coached, 0, "我关闭提示后重新回答");
  const values = new Map<string, string>();
  const storage = { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => { values.set(k, v); }, removeItem: (k: string) => { values.delete(k); } };
  values.set(PROFILE_KEY, JSON.stringify(profile));
  values.set("ai-interview-projects-v1", JSON.stringify([updateProjectFromSession(project, revised)]));
  const backup = exportBackup(storage);
  const restored = new Map<string, string>();
  const target = { getItem: (k: string) => restored.get(k) ?? null, setItem: (k: string, v: string) => { restored.set(k, v); }, removeItem: (k: string) => { restored.delete(k); } };
  importBackup(backup, target);
  const copy = JSON.parse(restored.get("ai-interview-projects-v1")!)[0];
  const turn = copy.session.turns[0];
  assert.equal(turn.answer, "我先独立回答"); assert.equal(turn.finalAnswer, "本人确认最终答案"); assert.equal(turn.revisions[0].answer, "我关闭提示后重新回答");
  assert.equal(turn.coachReviews[0].feedback.optimizedExample, ref.optimizedExample);
  const copyProfile = JSON.parse(restored.get(PROFILE_KEY)!);
  const copyQuestion = copy.session.preparation.questions[0];
  assert.notEqual(copyQuestion.projectDeepDive.experienceId, "fixture-bid");
  assert.equal(buildInterviewContext({ project: copy, profile: copyProfile, question: copyQuestion }).confirmedExperienceSources!.length, 1);
});
