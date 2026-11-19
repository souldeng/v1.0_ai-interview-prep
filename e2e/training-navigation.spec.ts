import { expect, test, type Page } from "@playwright/test";

const now = "2026-11-04T00:00:00.000Z";
const questions = [
  { id: "nav-q1", category: "AI / LLM 基础", text: "请解释 RAG 的基本流程。", source: "匿名基础题", sourceType: "foundation", technical: true },
  { id: "nav-q2", category: "AI / LLM 基础", text: "如何验证检索结果是否可靠？", source: "匿名基础题", sourceType: "foundation", technical: true },
];
const preparation = { id: "nav-prep", createdAt: now, resume: { raw: "", summary: "", skills: [], evidence: [] }, job: { raw: "", title: "匿名训练", requirements: [] }, matrix: [], questions };
const session = { id: "nav-session", createdAt: now, preparation, questions, currentQuestionIndex: 0, awaitingFollowUp: false, status: "active", turns: [] };

async function nav(page: Page, name: RegExp | string) {
  const menu = page.getByRole("button", { name: "打开导航" });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole("button", { name }).first().click();
}

test("一题一屏允许保留草稿跳过、返回作答、完成训练，且跳过不发 AI 请求", async ({ page }) => {
  let modelRequests = 0;
  await page.addInitScript(value => localStorage.setItem("ai-interview-prep-history-v1", JSON.stringify([value])), session);
  await page.route("**/api/health", route => route.fulfill({ json: { modelConfigured: false } }));
  await page.route("**/api/model/chat", route => { modelRequests += 1; return route.abort(); });
  await page.goto("/");
  await nav(page, "训练记录");
  await page.getByRole("button", { name: "继续训练", exact: true }).click();
  await expect(page.getByRole("navigation", { name: "主要导航" })).toHaveCount(0);
  const answer = page.getByRole("textbox", { name: "本轮回答", exact: true });
  await answer.fill("未提交的 RAG 草稿");
  await page.getByRole("button", { name: "跳过本题", exact: true }).click();
  await expect(page.getByRole("heading", { name: "如何验证检索结果是否可靠？", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "上一题", exact: true }).click();
  await expect(answer).toHaveValue("未提交的 RAG 草稿");
  await page.getByRole("button", { name: "提交回答", exact: true }).click();
  await expect(page.getByRole("heading", { name: "AI 回答建议", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "如何验证检索结果是否可靠？", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "下一题", exact: true }).click();
  await expect(page.getByRole("heading", { name: "如何验证检索结果是否可靠？", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "跳过本题", exact: true }).click();
  await expect(page.getByText("本轮题目已处理", { exact: true })).toBeVisible();
  await expect(page.getByText(/已回答 1.*已跳过 1/)).toBeVisible();
  await page.getByRole("button", { name: "完成训练", exact: true }).click();
  await expect(page.getByText("训练总结", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "查看本轮复盘", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "查看本轮复盘", exact: true }).click();
  await expect(page.getByRole("heading", { name: "历史单轮复盘", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "导出 DOCX", exact: true })).toBeVisible();
  expect(modelRequests).toBe(0);
});

test("沉浸式训练在 1440 与 1280 桌面宽度不产生横向溢出", async ({ page }) => {
  await page.addInitScript(value => localStorage.setItem("ai-interview-prep-history-v1", JSON.stringify([value])), session);
  await page.route("**/api/health", route => route.fulfill({ json: { modelConfigured: false } }));
  await page.goto("/");
  await nav(page, "训练记录");
  await page.getByRole("button", { name: "继续训练", exact: true }).click();
  for (const width of [1440, 1280]) {
    await page.setViewportSize({ width, height: 960 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  }
});
