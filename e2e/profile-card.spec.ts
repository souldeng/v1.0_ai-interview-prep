import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { cjkTextPdf } from "./fixtures/cjkPdf";
import { emptyUserProfile, PROFILE_KEY, saveUserProfile } from "../src/lib/profileStorage";

// Use full Chromium for the native PDF viewer, not the PDF-less headless shell.
test.use({ channel: "chromium", launchOptions: { args: ["--disable-features=PdfOopif"] } });

async function openProfile(page: Page) {
  const menu = page.getByRole("button", { name: "打开导航" });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole("button", { name: "个人资料 简历与经历" }).click();
}

test("PDF卡片在应用内预览，下载原件保持字节，默认警告简短", async ({ page, browser }, info) => {
  await page.goto("/"); await openProfile(page);
  const source = await browser.newPage();
  await source.setContent('<html lang="zh-CN"><body style="font:24px sans-serif;padding:40px"><h1>匿名预览简历</h1><p>本人负责客户访谈和需求分析，没有负责模型研发或上线。</p></body></html>');
  const pdf = await source.pdf({ format: "A4" }); await source.close();
  await page.getByLabel("上传个人资料文件").setInputFiles({ name: "匿名预览.pdf", mimeType: "application/pdf", buffer: pdf });
  const card = page.locator("article").filter({ has: page.getByRole("heading", { name: "匿名预览.pdf", exact: true }) });
  await expect(card).toContainText("PDF ·"); await expect(card).toContainText("KB · 待核对");
  await expect(page.getByRole("status")).toContainText("PDF 文字可能不完整，请核对后使用");
  await expect(page.getByRole("status")).not.toContainText("不保证正文完整");
  await card.screenshot({ path: info.outputPath("compact-card.png") });
  await card.getByRole("button", { name: "预览 PDF", exact: true }).click();
  await expect(card.locator('iframe[title="匿名预览.pdf PDF 预览"]')).toHaveAttribute("src", /^blob:/);
  await expect(card.getByText("PDF 文字可能不完整，请核对后使用", { exact: true })).toBeVisible();
  await expect(card.getByText(/PDF 仅提取可读取的文字层/)).not.toBeVisible();
  await expect(card.getByRole("link", { name: "打开 PDF 预览" })).toBeVisible();
  const download = page.waitForEvent("download"); await card.getByRole("link", { name: "下载原文件" }).click();
  expect(await readFile((await (await download).path())!)).toEqual(pdf);
  if (info.project.name === "desktop") {
    await expect(card.frameLocator("iframe").locator('embed[type="application/pdf"]')).toBeVisible();
  }
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  await card.locator("iframe").scrollIntoViewIfNeeded();
  // The browser's native PDF renderer exposes no page-paint event to web content.
  // Allow paint time for visual evidence; this delay is not the success assertion.
  await page.waitForTimeout(1500);
  await card.screenshot({ path: info.outputPath("pdf-preview.png") });
});

test("卡片用右上角图标收起，删除藏在可键盘操作的更多菜单，取消不删", async ({ page }, info) => {
  await page.goto("/"); await openProfile(page);
  await page.getByLabel("上传个人资料文件").setInputFiles({ name: "匿名操作.txt", mimeType: "text/plain", buffer: Buffer.from("本人负责需求访谈。") });
  const card = page.locator("article").filter({ has: page.getByRole("heading", { name: "匿名操作.txt", exact: true }) });
  await expect(card.getByRole("button", { name: "删除资料", exact: true })).toHaveCount(0);
  const more = card.getByRole("button", { name: "更多操作", exact: true });
  await more.focus(); await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("menuitem", { name: "删除资料" })).toBeFocused();
  await page.keyboard.press("Escape"); await expect(more).toBeFocused();
  await more.click(); await page.getByRole("menuitem", { name: "删除资料" }).click();
  const dialog = page.getByRole("dialog", { name: "删除个人资料" });
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: "核对文字", exact: true }).click();
  const collapse = card.getByRole("button", { name: "收起", exact: true });
  await expect(collapse).toHaveText(""); await expect(collapse).toHaveAttribute("aria-expanded", "true");
  await collapse.click(); await expect(card.getByRole("textbox")).toHaveCount(0);
  await more.click();
  await page.screenshot({ path: info.outputPath("more-menu.png") });
  await page.getByRole("menuitem", { name: "删除资料" }).click();
  await dialog.getByRole("button", { name: "确认删除", exact: true }).click();
  await expect(card).toHaveCount(0); await page.reload(); await openProfile(page); await expect(card).toHaveCount(0);
});

test("不支持内嵌PDF时明确提供打开与下载替代，原件不变", async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, "pdfViewerEnabled", { get: () => false }));
  await page.goto("/"); await openProfile(page);
  const pdf = cjkTextPdf();
  await page.getByLabel("上传个人资料文件").setInputFiles({ name: "匿名兼容.pdf", mimeType: "application/pdf", buffer: pdf });
  await page.getByRole("button", { name: "预览 PDF", exact: true }).click();
  await expect(page.getByText("当前浏览器不支持内嵌 PDF 预览，请打开或下载原文件。", { exact: true })).toBeVisible();
  await expect(page.locator("iframe")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "打开 PDF 预览" })).toHaveAttribute("href", /^blob:/);
  const download = page.waitForEvent("download"); await page.getByRole("link", { name: "下载原文件" }).click();
  expect(await readFile((await (await download).path())!)).toEqual(pdf);
});

test("旧资料没有原件时不假装预览，仍能核对保存并刷新恢复", async ({ page }, info) => {
  const now = new Date().toISOString();
  const data = new Map<string, string>();
  // Build a valid legacy fixture through the public storage interface in Node.
  // Production preview deliberately does not expose /src modules to browsers.
  saveUserProfile({ ...emptyUserProfile(), resumes: [{ id: "anonymous-old-material", fileName: "匿名旧资料.pdf", mimeType: "application/pdf", size: 1000, extractedText: "旧资料文字，原件从未保存。", parser: "pdf", createdAt: now }] }, {
    getItem: key => data.get(key) ?? null,
    setItem: (key, value) => { data.set(key, value); },
    removeItem: key => { data.delete(key); },
  });
  await page.addInitScript(({ key, value }) => { if (!localStorage.getItem(key)) localStorage.setItem(key, value); }, { key: PROFILE_KEY, value: data.get(PROFILE_KEY)! });
  await page.goto("/"); await openProfile(page);
  await page.getByRole("button", { name: "预览 PDF", exact: true }).click();
  await expect(page.getByText("原文件未保存，请重新上传。", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "下载原文件" })).toHaveCount(0);
  await page.getByRole("button", { name: "核对文字", exact: true }).click();
  const editor = page.getByRole("textbox", { name: "当前可编辑文字" });
  await expect(editor).toHaveValue("旧资料文字，原件从未保存。");
  await editor.fill("人工核对：本人负责访谈，没有负责模型研发。");
  await page.screenshot({ path: info.outputPath("review-text.png"), fullPage: true });
  await page.getByRole("button", { name: "保存核对文字" }).click();
  await page.reload(); await openProfile(page);
  await expect(page.locator("article")).toContainText("已核对");
  await page.getByRole("button", { name: "核对文字", exact: true }).click();
  await expect(editor).toHaveValue("人工核对：本人负责访谈，没有负责模型研发。");
});
