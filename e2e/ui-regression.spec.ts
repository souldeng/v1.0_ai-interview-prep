import { libraryArea, openDetails } from "./uiActions";
import { createRequire } from "node:module";
import { expect, test, type Browser, type Page, type TestInfo } from "@playwright/test";

const require = createRequire(import.meta.url);
const axeSource = require.resolve("axe-core/axe.min.js");

async function capture(page: Page, testInfo: TestInfo, name: string) {
  await testInfo.attach(`${name}.png`, {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });
}

async function expectNoPageOverflow(page: Page) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
}

async function auditA11y(page: Page, testInfo: TestInfo, name: string) {
  await page.addScriptTag({ path: axeSource });
  const results = await page.evaluate(async () => (window as typeof window & { axe: { run: (node: Document, options: unknown) => Promise<unknown> } }).axe.run(document, {
    runOnly: { type: "rule", values: ["button-name", "color-contrast", "input-image-alt", "label", "link-name"] },
  }));
  await testInfo.attach(`${name}-axe.json`, { body: Buffer.from(JSON.stringify(results, null, 2)), contentType: "application/json" });
  expect((results as { violations: unknown[] }).violations).toEqual([]);
}

async function openPrimaryPage(page: Page, name: string) {
  const menu = page.getByRole("button", { name: "打开导航" });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole("button", { name: new RegExp(name) }).first().click();
  if (name === "AI 面试题库") await libraryArea(page, "job");
}

async function createAnonymousProject(page: Page) {
  await openPrimaryPage(page, "我的岗位");
  await page.getByRole("button", { name: /创建岗位/ }).first().click();
  await page.getByPlaceholder("例如：AI 产品经理").fill("匿名 UI 巡检岗位");
  await page.getByPlaceholder("粘贴完整的岗位职责与任职要求").fill("负责产品需求分析、跨团队协作与项目推进。");
  await page.getByRole("button", { name: "创建岗位准备方案" }).click();
  await expect(page.getByRole("button", { name: "岗位资料" })).toBeVisible();
}

async function anonymousBrowserPdf(browser: Browser, text: string) {
  const pdfPage = await browser.newPage();
  await pdfPage.setContent(`<!doctype html><html lang="zh-CN"><body><p>${text}</p></body></html>`);
  const pdf = await pdfPage.pdf({ format: "A4" });
  await pdfPage.close();
  return pdf;
}

test.describe("浅色工作台 UI 回归", () => {
  test("三个一级导航和窄屏布局可访问", async ({ page }, testInfo) => {
    const consoleErrors: string[] = [];
    page.on("console", message => { if (message.type() === "error") consoleErrors.push(message.text()); });
    page.on("pageerror", error => consoleErrors.push(error.message));
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "我的岗位" })).toBeVisible();
    for (const name of ["我的岗位", "个人资料", "AI 面试题库"]) {
      await openPrimaryPage(page, name);
      await expect(page.locator("h1", { hasText: name })).toBeVisible();
      await expectNoPageOverflow(page);
    }
    await page.getByRole("button", { name: "设置" }).click();
    await expect(page.getByRole("alert")).toContainText("设置将在后续阶段完善");
    await capture(page, testInfo, "primary-navigation");
    await auditA11y(page, testInfo, "primary-navigation");
    expect(consoleErrors).toEqual([]);
  });

  test("岗位内部三个模块和 OCR 上传入口可打开", async ({ page }, testInfo) => {
    const consoleErrors: string[] = [];
    page.on("console", message => { if (message.type() === "error") consoleErrors.push(message.text()); });
    page.on("pageerror", error => consoleErrors.push(error.message));
    await page.goto("/");
    await createAnonymousProject(page);
    for (const module of ["岗位资料", "岗位分析", "面试训练"]) {
      await page.getByRole("button", { name: module, exact: true }).click();
      await expectNoPageOverflow(page);
    }
    await page.getByRole("button", { name: "岗位资料", exact: true }).click();
    await expect(page.getByRole("heading", { name: "添加岗位资料" })).toBeVisible();
    const ocrInput = page.getByRole("textbox", { name: "直接粘贴岗位资料文字" });
    await expect(ocrInput).toHaveCount(1);
    await ocrInput.fill("匿名岗位材料");
    await page.getByRole("button", { name: "加入核对" }).click();
    await expect(page.getByText("文字已加入待核对资料")).toBeVisible();
    await capture(page, testInfo, "job-workbench-materials");
    await auditA11y(page, testInfo, "job-workbench-materials");
    expect(consoleErrors).toEqual([]);
  });

  test("删除岗位对话框清晰可读，取消和 Escape 不改动隔离数据", async ({ page }, testInfo) => {
    const consoleErrors: string[] = [];
    page.on("console", message => { if (message.type() === "error") consoleErrors.push(message.text()); });
    page.on("pageerror", error => consoleErrors.push(error.message));
    await page.goto("/");
    await createAnonymousProject(page);
    await page.getByRole("button", { name: "返回岗位列表" }).click();
    const deleteButton = page.getByRole("button", { name: "删除项目" });
    await deleteButton.focus();
    await deleteButton.click();
    const dialog = page.getByRole("dialog", { name: "删除“匿名 UI 巡检岗位”？" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("匿名 UI 巡检岗位")).toBeVisible();
    await expect(dialog.getByText(/独立训练记录不会删除/)).toBeVisible();
    const colors = await dialog.evaluate(element => {
      const style = getComputedStyle(element);
      return { background: style.backgroundColor, color: style.color };
    });
    expect(colors.background).not.toBe(colors.color);
    await capture(page, testInfo, "delete-project-dialog");
    await auditA11y(page, testInfo, "delete-project-dialog");
    await page.getByRole("button", { name: "取消" }).click();
    await expect(dialog).toBeHidden();
    await expect(deleteButton).toBeFocused();
    await expect(page.getByRole("heading", { name: "匿名 UI 巡检岗位" }).first()).toBeVisible();
    await deleteButton.click();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(deleteButton).toBeFocused();
    await expect(page.getByRole("heading", { name: "匿名 UI 巡检岗位" }).first()).toBeVisible();
    await expectNoPageOverflow(page);
    expect(consoleErrors).toEqual([]);
  });

  test("隔离数据中确认删除会更新岗位列表和当前选择", async ({ page }, testInfo) => {
    await page.goto("/");
    await createAnonymousProject(page);
    await page.getByRole("button", { name: "返回岗位列表" }).click();
    await page.getByRole("button", { name: "删除项目" }).click();
    await page.getByRole("button", { name: "确认删除该项目" }).click();
    await expect(page.getByRole("heading", { name: "还没有岗位项目" })).toBeVisible();
    await expect(page.getByRole("alert")).toContainText("已删除选定项目");
    await capture(page, testInfo, "delete-project-confirmed");
    await expectNoPageOverflow(page);
  });

  test("AI 面试题库统一汇总岗位题目", async ({ page }, testInfo) => {
    await page.goto("/");
    await createAnonymousProject(page);
    await openPrimaryPage(page, "AI 面试题库");
    await expect(page.getByRole("heading", { name: "AI 面试题库" })).toBeVisible();
    await expect(page.getByRole("button", { name: /匿名 UI 巡检岗位/ }).first()).toBeVisible();
    await expectNoPageOverflow(page);
    await capture(page, testInfo, "question-library");
    await auditA11y(page, testInfo, "question-library");
  });

  test("本地训练点评与 DOCX 导出在隔离上下文可用", async ({ page }, testInfo) => {
    const consoleErrors: string[] = [];
    page.on("console", message => { if (message.type() === "error") consoleErrors.push(message.text()); });
    page.on("pageerror", error => consoleErrors.push(error.message));
    await page.goto("/");
    await createAnonymousProject(page);
    await page.getByRole("button", { name: "面试训练", exact: true }).click();
    await page.getByRole("button", { name: "开始新训练", exact: true }).click();
    await page.getByRole("textbox", { name: "本轮回答" }).fill("这是匿名测试回答，说明了本人贡献、结果和需要继续核对的边界。");
    await page.getByRole("button", { name: "提交回答" }).click();
    await expect(page.getByRole("heading", { name: "点评 → 重答 → 对比" })).toBeVisible();
    const downloadPromise = page.waitForEvent("download");
  await openDetails(page, "导出准备记录");
    await page.getByRole("button", { name: "导出 DOCX" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe("AI面试通-准备记录.docx");
    const pdfDownloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "导出 PDF" }).click();
    const pdfDownload = await pdfDownloadPromise;
    expect(pdfDownload.suggestedFilename()).toBe("AI面试通-准备记录.pdf");
    await expectNoPageOverflow(page);
    await capture(page, testInfo, "answer-review-and-docx-export");
    await auditA11y(page, testInfo, "answer-review-and-docx-export");
    expect(consoleErrors).toEqual([]);
  });

  test("匿名中文文字型 PDF 由同源 Worker 提取、预览并保存，扫描版给出明确反馈", async ({ page, browser }, testInfo) => {
    const consoleErrors: string[] = [];
    page.on("console", message => { if (message.type() === "error") consoleErrors.push(message.text()); });
    page.on("pageerror", error => consoleErrors.push(error.message));
    await page.goto("/");
    await openPrimaryPage(page, "个人资料");
    const pdfInput = page.locator('input[type="file"][accept*=".docx"]');
    await pdfInput.setInputFiles({ name: "匿名中文简历.pdf", mimeType: "application/pdf", buffer: await anonymousBrowserPdf(browser, "匿名候选人具备人工智能产品需求分析经验") });
    await expect(page.getByText(/匿名中文简历.pdf 已导入/)).toBeVisible();
    await page.getByRole("button", { name: "核对文字", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "当前可编辑文字" })).toHaveValue("匿名候选人具备人工智能产品需求分析经验");
    await expect(page.getByRole("heading", { name: "匿名中文简历.pdf" })).toBeVisible();
    await pdfInput.setInputFiles({ name: "扫描版.pdf", mimeType: "application/pdf", buffer: await anonymousBrowserPdf(browser, "") });
    await expect(page.getByText(/扫描版.pdf：未从 PDF 读取到可用文字/)).toBeVisible();
    await expectNoPageOverflow(page);
    await capture(page, testInfo, "pdf-worker-upload");
    await auditA11y(page, testInfo, "pdf-worker-upload");
    expect(consoleErrors).toEqual([]);
  });
});
