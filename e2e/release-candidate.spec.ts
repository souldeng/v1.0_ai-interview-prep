import { libraryArea, openDetails } from "./uiActions";
import { expect, test, type Page } from "@playwright/test";

async function library(page: Page) {
  const menu = page.getByRole("button", { name: "打开导航" });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole("button", { name: /AI 面试题库/ }).first().click();
  await libraryArea(page, "foundation");
}
async function daily(page: Page, search = "大语言模型和传统规则系统") {
  await library(page);
  await page.getByRole("textbox", { name: "搜索内置题" }).fill(search);
  await page.getByRole("button", { name: "开始回答", exact: true }).click();
  await page.getByRole("button", { name: "进入回答练习", exact: true }).click();
}
test.beforeEach(async ({ page }) => {
  await page.route("**/api/health", route => route.fulfill({ json: { modelConfigured: false } }));
  await page.route("**/api/model/**", () => { throw new Error("发布收尾测试不得调用真实模型"); });
  await page.goto("/");
});

test("备份入口与下载准确说明文字和训练范围且不含原始附件", async ({ page }) => {
  await library(page);
  await page.getByRole("button", { name: "整理训练记录", exact: true }).click();
  await page.getByText("文字与训练备份及恢复", { exact: true }).click();
  await expect(page.getByText(/JSON.*不包含.*IndexedDB.*原始附件/)).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出文字与训练备份", exact: true }).click();
  expect((await download).suggestedFilename()).toMatch(/^AI面试通-文字与训练备份-.*\.json$/);
  await expect(page.getByRole("textbox", { name: "可复制的文字与训练备份" })).toHaveValue(/"version": 3/);
  await expect(page.getByText(/完整备份/)).toHaveCount(0);
});

test("有意义的短首答可以保存，空白不提交且不改变已存回答", async ({ page }, info) => {
  await daily(page);
  await page.getByRole("textbox", { name: "本轮回答", exact: true }).fill(" \n ");
  await page.getByRole("button", { name: "提交回答", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "本轮回答", exact: true })).toHaveValue(" \n ");
  await page.getByRole("textbox", { name: "本轮回答", exact: true }).fill("我不知道");
  await page.getByRole("button", { name: "提交回答", exact: true }).click();
  await expect(page.getByRole("region", { name: "当前回答反馈" })).toBeVisible();
  await openDetails(page, "历史回答与点评");
  await expect(page.getByText("我不知道", { exact: true })).toBeVisible();
  await page.getByRole("textbox", { name: "同题重答", exact: true }).fill("不会");
  await page.getByRole("button", { name: "保存重答并对比", exact: true }).click();
  await expect(page.getByText("不会", { exact: true })).toBeVisible();
  await openDetails(page, "保存我的回答思路");
  await page.getByRole("textbox", { name: "最终确认答案", exact: true }).fill("先检索再生成");
  await page.getByRole("button", { name: "保存最终答案", exact: true }).click();
  await page.screenshot({ path: info.outputPath("short-answer.png"), fullPage: true });
  await page.reload(); await library(page);
  await expect(page.getByText("我不知道", { exact: true })).toBeVisible();
  await openDetails(page, "保存我的回答思路");
  await expect(page.getByRole("textbox", { name: "最终确认答案", exact: true })).toHaveValue("先检索再生成");
});

test("日常首答未提交时刷新仍可继续原会话和草稿", async ({ page }, info) => {
  await daily(page);
  await page.getByRole("textbox", { name: "本轮回答", exact: true }).fill("匿名草稿：规则按明确条件执行，模型根据上下文生成。");
  await page.reload();
  await daily(page);
  const confirm = page.getByRole("dialog", { name: "开始新一轮训练" });
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "继续当前训练", exact: true }).click();
  await expect(page.getByRole("heading", { name: "大语言模型和传统规则系统的主要区别是什么？", exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "本轮回答", exact: true })).toHaveValue("匿名草稿：规则按明确条件执行，模型根据上下文生成。");
  await page.screenshot({ path: info.outputPath("daily-draft-refreshed.png"), fullPage: true });
});

test("日常切题取消保留草稿，明确新轮次后旧首答仍能从记录恢复", async ({ page }) => {
  await daily(page);
  await page.getByRole("textbox", { name: "本轮回答", exact: true }).fill("匿名旧首答：先解释概率生成，再说明边界。");
  await daily(page, "Token、上下文窗口");
  const confirm = page.getByRole("dialog", { name: "开始新一轮训练" });
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "保留当前训练", exact: true }).click();
  await daily(page);
  await confirm.getByRole("button", { name: "继续当前训练", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "本轮回答", exact: true })).toHaveValue("匿名旧首答：先解释概率生成，再说明边界。");
  await daily(page, "Token、上下文窗口");
  await confirm.getByRole("button", { name: "保存旧轮次并开始", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Token、上下文窗口和输出长度分别会影响什么？", exact: true })).toBeVisible();
  await page.reload(); await library(page);
  await page.getByRole("button", { name: "整理训练记录", exact: true }).click();
  const cards = page.locator("article");
  await expect(cards).toHaveCount(2);
  await cards.nth(1).getByRole("button", { name: "查看", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "本轮回答", exact: true })).toHaveValue("匿名旧首答：先解释概率生成，再说明边界。");
});

test("日常会话保存失败不假启动，替换失败保留旧草稿，重试可恢复", async ({ page }) => {
  await page.evaluate(() => {
    const set = Storage.prototype.setItem;
    (window as any).failHistory = true;
    Storage.prototype.setItem = function(key, value) { if (key === "ai-interview-prep-history-v1" && (window as any).failHistory) throw new DOMException("匿名会话写入失败", "QuotaExceededError"); return set.call(this, key, value); };
  });
  await daily(page);
  await expect(page.getByRole("alert").filter({ hasText: "匿名会话写入失败" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "本轮回答", exact: true })).toHaveCount(0);
  await page.evaluate(() => { (window as any).failHistory = false; });
  await daily(page);
  await page.getByRole("textbox", { name: "本轮回答", exact: true }).fill("匿名失败保护草稿");
  await daily(page, "Token、上下文窗口");
  await page.evaluate(() => { (window as any).failHistory = true; });
  const confirm = page.getByRole("dialog", { name: "开始新一轮训练" });
  await confirm.getByRole("button", { name: "保存旧轮次并开始", exact: true }).click();
  await expect(confirm).toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: "匿名会话写入失败" })).toBeVisible();
  await confirm.getByRole("button", { name: "继续当前训练", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "本轮回答", exact: true })).toHaveValue("匿名失败保护草稿");
});
