import assert from "node:assert/strict";
import test from "node:test";
import { buildDocx, buildPdf, buildQuestionDocx, buildQuestionPdf, interviewExportLines, questionExportLines, type InterviewExportData } from "./interviewExport";

const data: InterviewExportData = { project: null, report: { overall: "仅作本地规则复盘", strengths: ["回答含有原文线索"], risks: [], gaps: ["需人工核对"], studyTopics: [], nextFocus: [] }, session: { id: "s", createdAt: "2026-10-11T00:00:00.000Z", preparation: { id: "p", createdAt: "2026-10-11T00:00:00.000Z", resume: { raw: "", summary: "", skills: [], evidence: [] }, job: { raw: "", title: "AI 产品", requirements: [] }, matrix: [], questions: [] }, questions: [], currentQuestionIndex: 0, awaitingFollowUp: false, status: "completed", turns: [{ questionId: "q", question: "请介绍项目", answer: "这是原回答", score: { overall: 0, dimensions: { 回应度: 0, 逻辑结构: 0, 事实与案例: 0, 岗位匹配度: 0, 表达清晰度: 0 }, improvement: "", referenceAnswer: "" }, followedUp: false, finalAnswer: "这是本人确认的最终答案" }] } };

test("导出内容明确保留原回答、最终确认答案和边界说明", () => {
  const lines = interviewExportLines(data).join("\n");
  assert.match(lines, /原回答/); assert.match(lines, /本人确认的最终答案/); assert.match(lines, /不是事实核验/);
});

test("DOCX 与 PDF 导出生成有正确文件头的非空文件", async () => {
  assert.deepEqual([...new Uint8Array(await buildDocx(data).slice(0, 2).arrayBuffer())], [80, 75]);
  assert.equal(new TextDecoder().decode(await buildPdf(data).slice(0, 8).arrayBuffer()), "%PDF-1.4");
});

test("单题导出复用 DOCX/PDF 生成器并标注最终答案边界", async () => {
  const question = { projectName: "AI 产品", company: "测试公司", question: "介绍项目", source: "JD 要求", originalAnswer: "原回答", suggestion: "补充本人行动", finalAnswer: "本人确认版本" };
  assert.match(questionExportLines(question).join("\n"), /用户手动确认/);
  assert.deepEqual([...new Uint8Array(await buildQuestionDocx(question).slice(0, 2).arrayBuffer())], [80, 75]);
  assert.equal(new TextDecoder().decode(await buildQuestionPdf(question).slice(0, 8).arrayBuffer()), "%PDF-1.4");
});
