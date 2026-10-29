import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("**/api/health", route => route.fulfill({ json: { modelConfigured: false } }));
  await page.route("**/api/model/**", route => route.abort());
});

test("创建页核对招聘平台文字后使用 JD，不要求资料名称和分类，创建刷新可回看原件", async ({ page }, info) => {
  await page.goto("/");
  await page.getByRole("button", { name: /创建岗位/ }).first().click();
  await page.getByText("从截图或文档填写 JD", { exact: true }).click();
  const raw = "首页 职位 消息\n虚构企业 AI 应用顾问\n职责：访谈客户并整理需求。\n要求：理解 RAG；三年相关经验优先。\n回复率 95% 立即沟通";
  const clean = "虚构企业 AI 应用顾问\n职责：访谈客户并整理需求。\n要求：理解 RAG；三年相关经验优先。";
  await page.getByLabel("选择岗位资料文件").setInputFiles({ name: "匿名招聘平台JD.txt", mimeType: "text/plain", buffer: Buffer.from(raw) });
  await expect(page.getByRole("textbox", { name: "当前文件核对文字" })).toHaveValue(raw);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: info.outputPath("before-review.png"), fullPage: true });
  await expect(page.getByRole("textbox", { name: "资料名称", exact: true })).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: "保存分类" })).toHaveCount(0);
  await expect(page.getByText(/发现疑似平台信息/)).toBeVisible();
  await page.getByRole("button", { name: "使用此 JD", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "请先逐张核对" })).toBeVisible();
  await expect(page.getByPlaceholder("粘贴完整的岗位职责与任职要求")).toHaveValue("");
  await page.getByRole("textbox", { name: "当前文件核对文字" }).fill(clean);
  await page.getByRole("button", { name: "确认当前文字", exact: true }).click();
  await page.getByRole("button", { name: "使用此 JD", exact: true }).click();
  await expect(page.getByPlaceholder("粘贴完整的岗位职责与任职要求")).toHaveValue(clean);
  await expect(page.getByRole("status").filter({ hasText: "已填入岗位 JD" }).first()).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: info.outputPath("jd-applied.png"), fullPage: true });
  await page.reload(); await page.getByRole("button", { name: /创建岗位/ }).first().click();
  await expect(page.getByPlaceholder("粘贴完整的岗位职责与任职要求")).toHaveValue(clean);
  await page.getByText("查看已使用的 JD 原件与核对文字", { exact: true }).click();
  await expect(page.getByRole("link", { name: "下载原件", exact: true })).toBeVisible();
  await page.getByText("初始提取文字", { exact: true }).click();
  await expect(page.getByText(raw, { exact: true })).toBeVisible();
  await page.getByPlaceholder("例如：AI 产品经理").fill("匿名JD体验验收");
  await page.getByRole("button", { name: "创建岗位准备方案", exact: true }).click();
  await page.reload(); await page.getByRole("button", { name: "查看岗位", exact: true }).click();
  await page.getByRole("button", { name: "岗位资料", exact: true }).click();
  await page.getByText("原始岗位 JD", { exact: true }).click();
  await expect(page.getByText(clean, { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
});

test("多图按核对顺序合并，OCR未结束不能提前确认使用，原图和原始文字仍可回看", async ({ page, context, browser }, info) => {
  const surface = await browser.newPage({ viewport: { width: 620, height: 340 } });
  await surface.setContent('<html lang="zh"><body style="font:22px sans-serif;background:white;color:#222;padding:20px"><nav>首页　职位　消息</nav><h1>虚构企业 AI 应用顾问</h1><p>职责：访谈客户并整理需求。</p><p>要求：理解 RAG；三年经验优先。</p><footer>回复率 95%　立即沟通</footer></body></html>');
  const image = await surface.screenshot({ scale: "css" }); await surface.close();
  let worker = 0;
  // Substitute only the external OCR worker protocol; the real uploader/parser stays intact.
  await context.route(/tesseract.*\/worker\.min\.js/, route => {
    const text = worker++ === 0 ? "首页 职位 消息\n职责：访谈客户。\n回复率 95%" : "要求：理解 RAG；三年经验优先。\n立即沟通";
    return route.fulfill({ contentType: "application/javascript", body: `self.onmessage = ({data:m}) => { const done = () => self.postMessage({...m, status:'resolve', data:m.action==='recognize'?{text:${JSON.stringify(text)}}:{}}); if(m.action==='recognize'){self.postMessage({...m,status:'progress',data:{status:'recognizing text',progress:0.5}});setTimeout(done,1800)}else done() };` });
  });
  await page.goto("/"); await page.getByRole("button", { name: /创建岗位/ }).first().click();
  await page.getByText("从截图或文档填写 JD", { exact: true }).click();
  await page.getByLabel("选择岗位资料文件").setInputFiles([
    { name: "招聘截图1.png", mimeType: "image/png", buffer: image },
    { name: "招聘截图2.png", mimeType: "image/png", buffer: image },
  ]);
  await expect(page.getByRole("button", { name: "1. 招聘截图1.png", exact: true }).locator("../..")).toContainText("OCR 中");
  await page.getByRole("textbox", { name: "当前文件核对文字" }).fill("识别时的手工补充");
  await expect(page.getByRole("button", { name: "确认当前文字", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "使用此 JD", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "2. 招聘截图2.png", exact: true }).locator("../..")).toContainText("OCR 成功");
  await page.getByRole("button", { name: "1. 招聘截图1.png", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "当前文件核对文字" })).toHaveValue("识别时的手工补充");
  await page.getByRole("textbox", { name: "当前文件核对文字" }).fill("职责：访谈客户。");
  await page.getByRole("button", { name: "确认当前文字", exact: true }).click();
  await page.getByRole("button", { name: "2. 招聘截图2.png", exact: true }).click();
  await expect(page.getByRole("img", { name: "招聘截图2.png 原图", exact: true })).toBeVisible();
  await page.getByRole("textbox", { name: "当前文件核对文字" }).fill("要求：理解 RAG；三年经验优先。");
  await page.getByRole("button", { name: "确认当前文字", exact: true }).click();
  await page.getByRole("button", { name: "上移 招聘截图2.png", exact: true }).click();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: info.outputPath("images-reviewed-ordered.png"), fullPage: true });
  await page.getByRole("button", { name: "使用此 JD", exact: true }).click();
  await expect(page.getByPlaceholder("粘贴完整的岗位职责与任职要求")).toHaveValue("要求：理解 RAG；三年经验优先。\n\n职责：访谈客户。");
  await expect(page.getByRole("button", { name: "使用此 JD", exact: true })).toHaveCount(0);
  await page.reload(); await page.getByRole("button", { name: /创建岗位/ }).first().click();
  await page.getByText("查看已使用的 JD 原件与核对文字", { exact: true }).click();
  await expect(page.getByRole("img", { name: "招聘截图1.png 原图", exact: true })).toBeVisible();
  await page.getByText("初始提取文字", { exact: true }).first().click();
  await expect(page.getByText("要求：理解 RAG；三年经验优先。\n立即沟通", { exact: true })).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: info.outputPath("images-applied-restored.png"), fullPage: true });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
});

test("原件存储失败不应用 JD，保留核对文字并允许重试", async ({ page }, info) => {
  await page.goto("/"); await page.getByRole("button", { name: /创建岗位/ }).first().click();
  await page.getByText("从截图或文档填写 JD", { exact: true }).click();
  await page.getByLabel("选择岗位资料文件").setInputFiles({ name: "匿名存储恢复JD.txt", mimeType: "text/plain", buffer: Buffer.from("职责：整理需求。") });
  await page.getByRole("textbox", { name: "当前文件核对文字" }).fill("职责：整理需求并确认验收范围。");
  await page.getByRole("button", { name: "确认当前文字", exact: true }).click();
  await page.evaluate(() => { const open = indexedDB.open.bind(indexedDB); let fail = true; indexedDB.open = function(...args: Parameters<IDBFactory["open"]>) { if (fail) { fail = false; throw new Error("匿名原件存储失败"); } return open(...args); }; });
  await page.getByRole("button", { name: "使用此 JD", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "匿名原件存储失败" })).toBeVisible();
  await expect(page.getByPlaceholder("粘贴完整的岗位职责与任职要求")).toHaveValue("");
  await expect(page.getByText(/已填入岗位 JD/)).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "当前文件核对文字" })).toHaveValue("职责：整理需求并确认验收范围。");
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: info.outputPath("jd-storage-failure.png"), fullPage: true });
  await page.getByRole("button", { name: "使用此 JD", exact: true }).click();
  await expect(page.getByPlaceholder("粘贴完整的岗位职责与任职要求")).toHaveValue("职责：整理需求并确认验收范围。");
});
