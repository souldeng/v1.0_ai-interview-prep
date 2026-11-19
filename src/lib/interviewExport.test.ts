import assert from "node:assert/strict";
import test from "node:test";
import { buildDocx, buildPdf, buildQuestionDocx, buildQuestionPdf, buildQuestionSetDocx, buildQuestionSetPdf, buildTrainingRecordsDocx, buildTrainingRecordsPdf, interviewExportLines, questionExportLines, questionSetExportLines, trainingSetExportLines, type InterviewExportData, type QuestionExportData } from "./interviewExport";

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

test("AI 预测题导出保留预测来源，而不冒充真实面试记录", () => {
  const lines = questionExportLines({ projectName: "", company: "", question: "如何说明 RAG 评测方案？", source: "AI 预测题；仅供练习，不是企业真实面试记录、第三方面经或已确认个人事实。", originalAnswer: "", suggestion: "", finalAnswer: "" }).join("\n");
  assert.match(lines, /来源：AI 预测题；仅供练习/);
  assert.doesNotMatch(lines, /本人记录的真实面试题/);
});

test("多题资料导出保留岗位、分类、来源与答案边界，可按选项排除答案", () => {
  const questions: QuestionExportData[] = [
    { projectName: "AI 产品", company: "测试公司", category: "岗位理解", question: "请说明岗位重点", source: "JD 分析", originalAnswer: "", suggestion: "AI 参考建议", finalAnswer: "" },
    { projectName: "AI 产品", company: "测试公司", category: "经历复盘", question: "介绍一段相关经历", source: "已保存训练", originalAnswer: "原答", suggestion: "", finalAnswer: "本人确认版" },
  ];
  const lines = questionSetExportLines(questions).join("\n");
  assert.match(lines, /岗位理解/);
  assert.match(lines, /JD 分析/);
  assert.match(lines, /最终确认答案：未保存/);
  assert.match(lines, /不代表本人已确认事实/);
  const withoutAnswers = questionSetExportLines(questions, { includeOriginalAnswer: false, includeSuggestion: false, includeFinalAnswer: false }).join("\n");
  assert.doesNotMatch(withoutAnswers, /原答|本人确认版|AI 参考建议/);
  assert.match(withoutAnswers, /请说明岗位重点/);
});

test("训练复盘导出包含保存的历史反馈且明确不是本人事实", () => {
  const feedback = { strengths: ["回答包含背景"], issues: ["行动不清楚"], factRisks: ["结果需要核对"], suggestions: ["补充本人行动"], answerStructure: "背景到结果", studyTopics: ["模型评测"], optimizedExample: "可选示例", generatedAt: "2026-10-11T00:01:00.000Z" };
  const record = { ...data, session: { ...data.session, turns: [{ ...data.session.turns[0], coachReviews: [{ answerVersion: 1, answer: "这是原回答", feedback }] }] } };
  const lines = trainingSetExportLines([record]).join("\n");
  assert.match(lines, /AI 教练反馈/);
  assert.match(lines, /参考建议，不是本人已确认事实/);
  assert.match(lines, /AI 改写示例（未确认）/);
  assert.match(lines, /原回答/);
});

async function readStoredZipEntry(blob: Blob, target: string) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();
  for (let offset = 0; offset + 30 < bytes.length;) {
    if (view.getUint32(offset, true) !== 0x04034b50) break;
    const size = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const nameStart = offset + 30;
    const contentStart = nameStart + nameLength + extraLength;
    const name = decoder.decode(bytes.slice(nameStart, nameStart + nameLength));
    if (name === target) return decoder.decode(bytes.slice(contentStart, contentStart + size));
    offset = contentStart + size;
  }
  throw new Error(`Missing ZIP entry: ${target}`);
}

test("DOCX 包含可读中文正文和标题样式", async () => {
  const xml = await readStoredZipEntry(buildQuestionSetDocx([{ projectName: "AI 产品", company: "测试公司", category: "岗位理解", question: "请用中文介绍岗位", source: "JD 分析", originalAnswer: "", suggestion: "", finalAnswer: "" }]), "word/document.xml");
  const styles = await readStoredZipEntry(buildQuestionSetDocx([{ projectName: "AI 产品", company: "测试公司", category: "岗位理解", question: "请用中文介绍岗位", source: "JD 分析", originalAnswer: "", suggestion: "", finalAnswer: "" }]), "word/styles.xml");
  assert.match(xml, /请用中文介绍岗位/);
  assert.match(xml, /w:pStyle w:val="Heading1"/);
  assert.match(styles, /w:styleId="Title"/);
  assert.match(styles, /w:eastAsia="Microsoft YaHei"/);
});

test("多题与多轮 DOCX/PDF 生成器均输出非空文件", async () => {
  const question: QuestionExportData[] = [{ projectName: "AI 产品", company: "测试公司", category: "岗位理解", question: "介绍岗位", source: "JD", originalAnswer: "", suggestion: "", finalAnswer: "" }];
  const training = [data];
  assert.ok((await buildQuestionSetDocx(question).arrayBuffer()).byteLength > 0);
  assert.equal(new TextDecoder().decode(await buildQuestionSetPdf(question).slice(0, 8).arrayBuffer()), "%PDF-1.4");
  assert.ok((await buildTrainingRecordsDocx(training).arrayBuffer()).byteLength > 0);
  assert.equal(new TextDecoder().decode(await buildTrainingRecordsPdf(training).slice(0, 8).arrayBuffer()), "%PDF-1.4");
});
