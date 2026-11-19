import assert from "node:assert/strict";
import { test } from "node:test";
import { parseInterviewRecord, stripInlineMarkdown } from "./interviewRecordParser";

// 匿名测试样例：模拟一份包含分类标题、连续编号问题与面试官反馈的完整面经。
// 仅用于回归验证解析行为，不写死在解析代码中。
const sampleRecord = [
  "## 面试基本信息",
  "面试时间：某周三下午",
  "面试形式：视频面试",
  "",
  "## A. 个人背景与职业选择",
  "1. 请先做一个自我介绍，介绍教育背景与工作经历。",
  "2. 为什么从上一家公司离职？",
  "3. 对未来职业发展有什么规划？",
  "4. 为什么选择到北京发展？",
  "5. 目前面试了多少家公司？",
  "6. 之前有些面试没有通过，你认为原因是什么？",
  "",
  "## B. 工作经历与个人贡献",
  "7. 在之前的项目中主要承担什么角色，负责哪些工作？",
  "",
  "## C. 两个 AI 项目的来源与价值",
  "8. 为什么想到做 Bid-Writer？",
  "9. 为什么想到做 AI 面试通？",
  "10. AI 生成技术对政府科技项目申报工作有什么影响？",
  "11. 如果 AI 生成内容不符合预期，如何解决？",
  "",
  "## D. 面试官反馈",
  "面试官认为候选人可能更适合产品相关工作。",
].join("\n");

test("完整面经解析出 11 道独立题目，分类与顺序保持一致", () => {
  const result = parseInterviewRecord(sampleRecord);
  // 11 道编号题；2 条元信息行（面试时间/形式）被跳过，不生成候选。
  assert.equal(result.candidates.length, 11);
  assert.equal(result.feedback.length, 1);
  assert.match(result.feedback[0], /更适合产品相关工作/);
  assert.deepEqual(result.categories, ["面试基本信息", "A. 个人背景与职业选择", "B. 工作经历与个人贡献", "C. 两个 AI 项目的来源与价值"]);
  // 顺序与原文一致。
  assert.match(result.candidates[0].text, /自我介绍/);
  assert.match(result.candidates[10].text, /不符合预期/);
  // 分类归属正确。
  assert.match(result.candidates[0].category, /个人背景/);
  assert.match(result.candidates[6].category, /工作经历/);
  assert.match(result.candidates[10].category, /AI 项目的来源/);
  // 编号本身不进入题干。
  for (const candidate of result.candidates) assert.doesNotMatch(candidate.text, /^\d+[.、．]\s*/);
});

test("带背景与多个问号的单道题不被误拆", () => {
  const record = [
    "1. 请介绍一个你负责的 AI 项目？项目目标是什么？你做了哪些工作？遇到模型输出不稳定时你是怎么解决的？",
    "补充背景：这个项目当时只有两个月的交付窗口。",
  ].join("\n");
  const result = parseInterviewRecord(record);
  assert.equal(result.candidates.length, 1);
  assert.match(result.candidates[0].text, /AI 项目/);
  assert.match(result.candidates[0].text, /补充背景/);
});

test("Markdown 标记不污染题目正文", () => {
  const record = [
    "## A. 项目深挖",
    "1. **请介绍 RAG 项目的检索优化**：你用了什么`embedding`模型？",
    "   - 追问：如何评估效果？",
  ].join("\n");
  const result = parseInterviewRecord(record);
  const first = result.candidates[0];
  assert.doesNotMatch(first.text, /\*\*/);
  assert.doesNotMatch(first.text, /`/);
  assert.doesNotMatch(first.text, /^#/);
  assert.match(first.text, /请介绍 RAG 项目的检索优化/);
  assert.match(first.text, /追问：如何评估效果/);
});

test("复制导致换行丢失时按编号边界切分，并提示人工核对", () => {
  const record = "1. 为什么从上一家公司离职？2. 对未来职业发展有什么规划？3. 为什么选择到北京发展？";
  const result = parseInterviewRecord(record);
  assert.equal(result.candidates.length, 3);
  assert.match(result.candidates[0].text, /离职/);
  assert.match(result.candidates[1].text, /职业发展/);
  assert.match(result.candidates[2].text, /北京/);
  assert.ok(result.warnings.some(w => w.includes("换行")));
});

test("编号中断且无边界线索的长段落不强行拆分，标记待核对", () => {
  const record = "这是一段没有编号也没有换行的长描述，讲述整个面试过程，但没有明确的题目边界标记，系统不应该强行拆开它。";
  const result = parseInterviewRecord(record);
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].confidence, "needs_review");
});

test("反馈章节中的编号内容标记为待核对而不是普通题目", () => {
  const record = [
    "## 面试官反馈",
    "1. 整体表达清晰。",
    "2. 建议补充分层架构的取舍原因。",
  ].join("\n");
  const result = parseInterviewRecord(record);
  assert.ok(result.candidates.every(c => c.confidence === "needs_review"));
});

test("AI 预测题 Markdown 保留四类36题与顺序，资料说明、训练要求和复盘分类不误判", () => {
  const section = (title: string, start: number, count: number) => [
    `## ${title}`,
    ...Array.from({ length: count }, (_, index) => `${start + index}. ${title}预测问题 ${index + 1}？`),
  ];
  const record = [
    "岗位方向：匿名 AI 应用岗位",
    "资料来源：匿名 AI 预测题库",
    "题目性质：AI 预测题，仅供练习",
    "",
    ...section("A. 岗位理解", 1, 12), "",
    ...section("B. 项目方案", 13, 7), "",
    ...section("C. 技术判断", 20, 11), "",
    ...section("D. 复盘与发展规划", 31, 6), "",
    "## 训练要求",
    "每题先独立回答，再复盘表达；这一段不是面试题。",
  ].join("\n");
  const result = parseInterviewRecord(record);
  assert.equal(result.candidates.length, 36);
  assert.deepEqual(result.categories, ["A. 岗位理解", "B. 项目方案", "C. 技术判断", "D. 复盘与发展规划"]);
  assert.deepEqual(result.candidates.map(candidate => candidate.order), Array.from({ length: 36 }, (_, index) => index + 1));
  assert.match(result.candidates[0].text, /岗位理解预测问题 1/);
  assert.match(result.candidates[35].text, /复盘与发展规划预测问题 6/);
  assert.equal(result.candidates.some(candidate => /岗位方向|资料来源|题目性质|训练要求|先独立回答/.test(candidate.text)), false);
  assert.equal(result.feedback.length, 0);
});

test("Q1/问题1 编号格式同样识别", () => {
  const result = parseInterviewRecord("Q1. 请做自我介绍。\n问题2：为什么转岗？");
  assert.equal(result.candidates.length, 2);
  assert.match(result.candidates[0].text, /自我介绍/);
  assert.match(result.candidates[1].text, /转岗/);
});

test("空输入返回空结果", () => {
  const result = parseInterviewRecord("   \n  ");
  assert.equal(result.candidates.length, 0);
  assert.equal(result.feedback.length, 0);
});

test("stripInlineMarkdown 清理常见内联标记但保留正文", () => {
  const cleaned = stripInlineMarkdown("## **标题** 与 `代码` 以及 __下划线__");
  assert.equal(cleaned, "标题 与 代码 以及 下划线");
});
