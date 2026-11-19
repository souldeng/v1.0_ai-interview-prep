import { expect, test, type Page } from "@playwright/test";

const now = "2026-11-08T10:00:00.000Z";
const score = { overall: 0, dimensions: { 回应度: 0, 逻辑结构: 0, 事实与案例: 0, 岗位匹配度: 0, 表达清晰度: 0 }, improvement: "", referenceAnswer: "" };
const questions = [
  { id: "record-q1", category: "经历复盘", text: "请说明你如何验证 RAG 检索效果。", source: "匿名资料", sourceType: "resume", technical: true },
  { id: "record-q2", category: "技术理解", text: "下一题：如何处理检索失败？", source: "匿名资料", sourceType: "foundation", technical: true },
];
const preparation = { id: "record-prep", createdAt: now, resume: { raw: "", summary: "", skills: [], evidence: [] }, job: { raw: "", title: "匿名 AI 产品岗位", requirements: [] }, matrix: [], questions };
const projectSession = {
  id: "project-record-session", createdAt: now, preparation, questions, currentQuestionIndex: 1, awaitingFollowUp: false, status: "active", skippedQuestionIds: [],
  turns: [{ questionId: "record-q1", question: questions[0].text, answer: "这是本轮原始回答。", score, followedUp: false, finalAnswer: "这是本轮用户保存的最终回答。", finalAnswerUpdatedAt: "2026-11-08T10:05:00.000Z", aiCoach: { strengths: ["结构完整"], issues: ["补充验证口径"], factRisks: [], suggestions: ["说明边界"], answerStructure: "背景、行动、验证", studyTopics: [], optimizedExample: "这是表达建议", generatedAt: "2026-11-08T10:03:00.000Z" }}],
};
const project = {
  id: "record-project", company: "匿名公司", jobTitle: "匿名 AI 产品岗位", jobDescription: "负责 AI 产品设计与评测。", candidateBackground: "匿名候选资料", concerns: "", analysis: null,
  questions: questions.map(question => ({ id: question.id, category: question.category, question: question.text, whyAsk: question.source, answerGuide: [], difficulty: "medium", status: question.id === "record-q1" ? "answered" : "unanswered", userAnswer: question.id === "record-q1" ? "这是本轮原始回答。" : "", feedback: null, followUpQuestions: [], score: null })),
  status: "practicing", completedQuestions: 1, totalQuestions: 2, createdAt: now, updatedAt: "2026-11-08T10:05:00.000Z", lastPracticedAt: "2026-11-08T10:05:00.000Z", preparation, session: projectSession,
};
const independentSession = { ...projectSession, id: "independent-record-session", createdAt: "2026-11-07T10:00:00.000Z", preparation: { ...preparation, id: "independent-prep", job: { ...preparation.job, title: "基础知识练习" } }, turns: [], currentQuestionIndex: 0 };

async function nav(page: Page, name: string) {
  const menu = page.getByRole("button", { name: "打开导航" });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole("button", { name }).first().click();
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(({ storedProject, storedHistory }) => {
    localStorage.setItem("ai-interview-projects-v1", JSON.stringify([storedProject]));
    localStorage.setItem("ai-interview-prep-history-v1", JSON.stringify(storedHistory));
  }, { storedProject: project, storedHistory: [projectSession, independentSession] });
  await page.route("**/api/health", route => route.fulfill({ json: { modelConfigured: false } }));
  await page.route("**/api/model/**", route => route.abort());
});

test("训练记录按会话去重，复盘只展示本轮保存内容，并按真实进度继续", async ({ page }) => {
  let modelRequests = 0;
  await page.route("**/api/model/**", route => { modelRequests += 1; return route.abort(); });
  await page.goto("/");
  await nav(page, "训练记录");

  await expect(page.getByText("2 次", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("匿名 AI 产品岗位", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("基础知识练习", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("岗位会话与其历史副本按会话 ID 合并显示，不重复计数。", { exact: false })).toBeVisible();

  await page.getByRole("button", { name: "查看复盘", exact: true }).first().click();
  await expect(page.getByRole("heading", { name: "历史单轮复盘", exact: true })).toBeVisible();
  await expect(page.getByText("这是本轮原始回答。", { exact: true })).toBeVisible();
  await expect(page.getByText("补充验证口径", { exact: true })).toBeVisible();
  await expect(page.getByText("这是本轮用户保存的最终回答。", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "继续训练", exact: true }).first().click();
  await expect(page.getByRole("heading", { name: "下一题：如何处理检索失败？", exact: true })).toBeVisible();
  expect(modelRequests).toBe(0);
});

test("训练记录与单轮复盘在 1440 和 1280 桌面宽度不产生页面横向溢出", async ({ page }, testInfo) => {
  for (const width of [1440, 1280]) {
    await page.setViewportSize({ width, height: 960 });
    await page.goto("/");
    await nav(page, "训练记录");
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`g4-training-records-${width}.png`), fullPage: true });
    await page.getByRole("button", { name: "查看复盘", exact: true }).first().click();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`g4-training-review-${width}.png`), fullPage: true });
  }
});
