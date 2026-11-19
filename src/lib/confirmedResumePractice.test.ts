import assert from "node:assert/strict";
import test from "node:test";
import { clearPendingConfirmedResumePracticeSet, createConfirmedResumePracticeSet, confirmedResumePracticeContext, confirmedResumeVersion, groundedResumeReference, isConfirmedResumePracticeSetCurrent, isPendingConfirmedResumePracticeSetCurrent, isResumePracticeQuestionCurrent, loadPendingConfirmedResumePracticeSet, resumeIntroductionQuestion, resumeSourceVersion, savePendingConfirmedResumePracticeSet, validConfirmedResumePracticeSet, type ResumeQuestionInput } from "./confirmedResumePractice";
import { emptyUserProfile } from "./profileStorage";
import type { UserProfile } from "./domain";
import type { StorageLike } from "./projectStorage";
import { nextTurn, startSession } from "./interview";
import { trustedPreparation } from "./trustedPreparation";
import { answerCoachPrompt } from "./modelPrompts";
import { isKnowledgeQuestion } from "./coaching";

const now = "2026-11-03T00:00:00.000Z";
function memory(): StorageLike {
  const values = new Map<string, string>();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
}
function profile(): UserProfile {
  return { ...emptyUserProfile(new Date(now)), experiences: [
    { id: "edu", title: "AI 应用课程学习", type: "学习", situation: "转向 AI 应用方向", action: "完成检索增强问答课程作业并记录学习笔记", tools: "文档检索", result: "保留课程作业和学习笔记", reflection: "需要把概念理解和真实项目边界分开", confirmed: true, createdAt: now, updatedAt: now },
    { id: "work", title: "客户需求澄清", type: "工作", situation: "客户需求描述不完整", action: "本人访谈客户并整理需求清单", tools: "访谈提纲", result: "形成需求清单，没有负责模型研发或上线", reflection: "先确认问题边界再讨论方案", confirmed: true, createdAt: now, updatedAt: now },
    { id: "project", title: "个人知识库原型", type: "项目", situation: "练习企业知识库方案表达", action: "本人整理公开资料并设计检索对照记录", tools: "Python、向量检索", result: "保留对照记录，量化效果待补充", reflection: "不能把学习原型说成客户上线项目", confirmed: true, createdAt: now, updatedAt: now },
    { id: "draft", title: "未确认经历", type: "项目", situation: "", action: "我做过大量项目", result: "", reflection: "", confirmed: false, createdAt: now, updatedAt: now },
  ] };
}

const inputs: ResumeQuestionInput[] = [
  { text: "这段课程学习如何帮助你建立对检索增强问答边界的理解？", focus: "knowledge", evidence: [{ experienceId: "edu", fields: ["action", "reflection"] }], whyAsk: "考察你如何把学习经历转化为可解释的技术理解。", capabilities: ["学习迁移", "技术理解"], angles: ["设计动机", "验证方式"], followUps: ["你如何区分课程作业与真实项目经验？"], missingAspects: ["业务价值"], coverage: ["education"] },
  { text: "面对不完整的客户需求时，你如何说明自己先做了哪些澄清？", focus: "practice", evidence: [{ experienceId: "work", fields: ["situation", "action"] }], whyAsk: "考察需求澄清中的个人行动与边界意识。", capabilities: ["需求分析", "沟通协作"], angles: ["个人贡献", "实现流程"], followUps: ["需求清单形成后，你如何确认没有越过自己的职责边界？"], missingAspects: ["业务价值"], coverage: ["work"] },
  { text: "在个人知识库原型中，你为何采用检索对照记录来检查自己的方案理解？", focus: "practice", evidence: [{ experienceId: "project", fields: ["action", "tools"] }], whyAsk: "考察技术练习中的方法选择与可验证证据。", capabilities: ["技术实践", "验证思路"], angles: ["技术选型", "验证方式"], followUps: ["哪些结论仍需要补充真实证据？"], missingAspects: ["真实Badcase", "业务价值"], coverage: ["project", "technical_evidence"] },
  { text: "从客户需求澄清到个人知识库原型，你如何说明自己能力迁移中的相同与不同？", focus: "practice", evidence: [{ experienceId: "work", fields: ["action"] }, { experienceId: "project", fields: ["action"] }], whyAsk: "考察跨经历反思，避免把工作职责与学习原型混为一谈。", capabilities: ["能力迁移", "边界表达"], angles: ["个人贡献", "设计动机"], followUps: ["两段经历中哪些结果不能互相替代？"], missingAspects: ["业务价值"], coverage: ["work", "project"] },
];

test("整份确认简历题组保留分类覆盖、跨经历完整字段依据与单一存储快照", () => {
  const value = profile();
  const set = createConfirmedResumePracticeSet(value, inputs);
  assert.equal(set.questions.length, 4);
  assert.deepEqual(new Set(set.sources.map(source => source.experienceId)), new Set(["edu", "work", "project"]));
  assert.equal(set.contentVersion, confirmedResumeVersion(value));
  const cross = set.questions.at(-1)!;
  assert.equal(new Set(cross.resumePracticeOrigin!.evidence.map(item => item.experienceId)).size, 2);
  assert.ok(cross.resumePracticeOrigin!.evidence.every(item => value.experiences.find(card => card.id === item.experienceId)?.[item.field] === item.quote));
  assert.ok(isResumePracticeQuestionCurrent(value, cross));
});

test("未正式保存的整份简历候选题组可恢复、重试前仍检查确认事实版本", () => {
  const storage = memory(); const value = profile(); const set = createConfirmedResumePracticeSet(value, inputs);
  savePendingConfirmedResumePracticeSet(set, storage);
  const restored = loadPendingConfirmedResumePracticeSet(storage);
  assert.equal(restored?.id, set.id);
  assert.equal(isPendingConfirmedResumePracticeSetCurrent(value, restored!), true);
  const changed = { ...value, experiences: value.experiences.map(card => card.id === "work" ? { ...card, action: "已修改的本人行动" } : card) };
  assert.equal(isPendingConfirmedResumePracticeSetCurrent(changed, restored!), false);
  clearPendingConfirmedResumePracticeSet(storage);
  assert.equal(loadPendingConfirmedResumePracticeSet(storage), null);
});

test("选择部分确认经历生成的题组不受未选经历变动影响，但会拒绝所选事实变化", () => {
  const value = profile();
  const selected = { ...value, experiences: value.experiences.filter(card => card.id === "work" || card.id === "project") };
  const set = createConfirmedResumePracticeSet(selected, inputs.slice(1));
  assert.deepEqual(set.sources.map(source => source.experienceId).sort(), ["project", "work"]);
  assert.equal(isConfirmedResumePracticeSetCurrent(value, set), true);
  const unrelatedChanged = { ...value, experiences: value.experiences.map(card => card.id === "edu" ? { ...card, action: "新的课程练习记录" } : card) };
  assert.equal(isConfirmedResumePracticeSetCurrent(unrelatedChanged, set), true);
  const selectedChanged = { ...value, experiences: value.experiences.map(card => card.id === "project" ? { ...card, action: "新的个人原型行动" } : card) };
  assert.equal(isConfirmedResumePracticeSetCurrent(selectedChanged, set), false);
});

test("整份简历题逐题拒绝无依据数字、重复和无效技术实践，但保留其余安全题", () => {
  const value = profile();
  const unsupported = createConfirmedResumePracticeSet(value, inputs.map((item, index) => index === 2 ? { ...item, text: "这个原型如何让通过率达到 99%？" } : item));
  assert.equal(unsupported.questions.length, 3); assert.ok(unsupported.generationIssues?.some(issue => issue.reason === "safety"));
  const duplicate = createConfirmedResumePracticeSet(value, inputs.map((item, index) => index === 1 ? { ...item, text: inputs[0].text } : item));
  assert.equal(duplicate.questions.length, 3); assert.ok(duplicate.generationIssues?.some(issue => issue.reason === "duplicate"));
  const incompleteCoverage = createConfirmedResumePracticeSet(value, inputs.map(item => ({ ...item, coverage: item.coverage?.filter(kind => kind !== "education") })));
  assert.ok(incompleteCoverage.questions.some(question => question.resumePracticeOrigin?.coverage.includes("education")));
  const invalidPractice = createConfirmedResumePracticeSet(value, inputs.map((item, index) => index === 2 ? { ...item, evidence: [{ experienceId: "project", fields: ["action"] }] } : item));
  assert.equal(invalidPractice.questions.length, 3); assert.ok(invalidPractice.generationIssues?.some(issue => issue.reason === "evidence"));
});

test("技术知识题只需引用简历明确的技术领域，个人技术实践仍须同卡行动和工具", () => {
  const value = profile();
  const knowledge: ResumeQuestionInput = { ...inputs[2], text: "你会如何解释向量检索在知识库问答中的作用与验证思路？", focus: "knowledge", evidence: [{ experienceId: "project", fields: ["tools"] }], angles: ["技术选型", "验证方式"], coverage: ["project", "technical_evidence"] };
  const set = createConfirmedResumePracticeSet(value, inputs.map((item, index) => index === 2 ? knowledge : item));
  const question = set.questions[2];
  assert.equal(question.category, "技术理解");
  assert.equal(question.resumePracticeOrigin?.focus, "knowledge");
  assert.equal(isKnowledgeQuestion(question), true);
  assert.ok(validConfirmedResumePracticeSet(set));
  const practice = createConfirmedResumePracticeSet(value, inputs.map((item, index) => index === 2 ? { ...knowledge, focus: "practice" as const } : item));
  assert.equal(practice.questions.length, 3);
  assert.ok(practice.generationIssues?.some(issue => issue.message.includes("技术实践题")));
  const omittedCoverage = createConfirmedResumePracticeSet(value, inputs.map((item, index) => index === 2 ? { ...knowledge, focus: "practice" as const, coverage: [] } : item));
  assert.equal(omittedCoverage.questions.length, 3);
  assert.ok(omittedCoverage.generationIssues?.some(issue => issue.message.includes("类别标记")));
});

test("一分与三分钟自我介绍复用现有单题训练的 Question 结构，不创建新题库", () => {
  const short = resumeIntroductionQuestion(1), long = resumeIntroductionQuestion(3);
  assert.equal(short.id, "resume-introduction-1m");
  assert.equal(long.id, "resume-introduction-3m");
  assert.match(short.text, /1 分钟/);
  assert.match(long.text, /3 分钟/);
  assert.equal(short.sourceType, "resume");
});

test("一段确认经历也可从整份简历入口生成小题组，长字段使用短版本标识且可保存", () => {
  const value = profile();
  const single = { ...value, experiences: value.experiences.filter(card => card.id === "edu") };
  const singleInputs: ResumeQuestionInput[] = [
    { ...inputs[0], text: "课程学习如何帮助你理解检索增强问答的边界？", coverage: ["education"] },
    { ...inputs[0], text: "课程作业中你如何使用文档检索检查自己的理解？", evidence: [{ experienceId: "edu", fields: ["action", "tools"] }], coverage: ["technical_evidence"] },
    { ...inputs[0], text: "你会如何区分课程作业与真实项目经验？", evidence: [{ experienceId: "edu", fields: ["reflection"] }], coverage: ["education"] },
    { ...inputs[0], text: "这段学习经历有哪些边界需要在面试中如实说明？", evidence: [{ experienceId: "edu", fields: ["action", "reflection"] }], coverage: ["education"] },
  ];
  const set = createConfirmedResumePracticeSet(single, singleInputs);
  assert.equal(set.sources.length, 1);
  assert.ok(validConfirmedResumePracticeSet(set));
  const long = { ...value, experiences: value.experiences.filter(card => card.confirmed).map(card => ({ ...card, action: `${card.action}${"甲".repeat(3000)}`, reflection: `${card.reflection}${"乙".repeat(3000)}` })) };
  const longSet = createConfirmedResumePracticeSet(long, inputs);
  assert.ok(longSet.contentVersion.length < 200);
  assert.ok(longSet.sources.every(source => source.contentVersion.length < 200));
  assert.ok(longSet.questions.every(question => question.resumePracticeOrigin!.evidence.every(evidence => evidence.contentVersion.length < 200)));
  assert.ok(validConfirmedResumePracticeSet(longSet));
  assert.equal(resumeSourceVersion(long.experiences[0]), longSet.sources.find(source => source.experienceId === "edu")!.contentVersion);
});

test("训练上下文只保留题目绑定经历；修改、删除或撤销确认后不再使用旧个人事实", () => {
  const value = profile(), set = createConfirmedResumePracticeSet(value, inputs), question = set.questions.at(-1)!;
  const context = confirmedResumePracticeContext(value, question, "我的原回答");
  assert.equal(context.confirmedExperienceSources?.length, 2);
  assert.doesNotMatch(JSON.stringify(context), /AI 应用课程学习|未确认经历/);
  const changed = { ...value, experiences: value.experiences.map(card => card.id === "project" ? { ...card, action: "已修改的行动" } : card) };
  assert.equal(isResumePracticeQuestionCurrent(changed, question), false);
  assert.deepEqual(confirmedResumePracticeContext(changed, question).confirmedUserFacts, []);
});

test("参考表达由题目绑定的完整确认字段组成，并明确保留待核实项", () => {
  const value = profile(), set = createConfirmedResumePracticeSet(value, inputs), question = set.questions.at(-1)!;
  const reference = groundedResumeReference(confirmedResumePracticeContext(value, question), question);
  assert.match(reference.optimizedExample, /本人访谈客户并整理需求清单/);
  assert.match(reference.optimizedExample, /本人整理公开资料并设计检索对照记录/);
  assert.doesNotMatch(reference.optimizedExample, /未确认经历|99%/);
  assert.ok(reference.referenceUncertainties.some(item => item.includes("业务价值")));
});

test("跨经历题的预备追问、教练提示和参考长度均复用现有训练链路", () => {
  const value = profile(), set = createConfirmedResumePracticeSet(value, inputs), question = set.questions.at(-1)!;
  const context = confirmedResumePracticeContext(value, question);
  const advanced = nextTurn(startSession(trustedPreparation(context, [question])), "");
  assert.equal(advanced.awaitingFollowUp, true);
  assert.equal(advanced.questions[0].text, question.resumePracticeOrigin!.followUps[0]);
  assert.equal(advanced.questions[0].sourceType, "ai_follow_up");
  const prompt = answerCoachPrompt(context, question);
  assert.match(prompt.system, /一到两段经历/);
  assert.doesNotMatch(prompt.system, /最多一段；没有适用事实返回/);
  const long = { ...value, experiences: value.experiences.map(card => card.id === "work" || card.id === "project" ? { ...card, action: `${card.action}${"长".repeat(3000)}` } : card) };
  const longQuestion = createConfirmedResumePracticeSet(long, inputs).questions.at(-1)!;
  const reference = groundedResumeReference(confirmedResumePracticeContext(long, longQuestion), longQuestion);
  assert.ok(reference.optimizedExample.length <= 4100);
  assert.ok(reference.referenceUncertainties.some(item => item.includes("较长确认字段")));
});
