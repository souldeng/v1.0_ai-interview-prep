import { expect, test } from "@playwright/test";

test("可选：匿名中英截图真实 OCR 与单张失败隔离", async ({ page, browser }) => {
  test.skip(process.env.RUN_LIVE_OCR !== "1", "真实 OCR 依赖首次外部语言资源下载，默认回归不访问网络");
  test.setTimeout(180_000);
  const source = await browser.newPage();
  await source.setViewportSize({ width: 1000, height: 240 });
  await source.setContent("<html lang='zh'><body style='margin:25px;background:white;font:42px sans-serif'>岗位要求 AI 产品经验 RAG</body></html>");
  const buffer = await source.screenshot({ type: "png" });
  await source.close();
  await page.goto("/");
  await page.getByRole("button", { name: /创建岗位/ }).first().click();
  await page.getByPlaceholder("例如：AI 产品经理").fill("匿名 OCR 验证岗位");
  await page.getByPlaceholder("粘贴完整的岗位职责与任职要求").fill("岗位说明仅用于创建匿名验证项目。");
  await page.getByRole("button", { name: "创建岗位准备方案" }).click();
  await page.getByRole("button", { name: "岗位资料", exact: true }).click();
  await page.locator('input[type="file"][aria-label="选择岗位资料文件"]').setInputFiles([
    { name: "匿名中英截图.png", mimeType: "image/png", buffer },
    { name: "损坏截图.png", mimeType: "image/png", buffer: Buffer.from("not a PNG image") },
  ]);
  await expect(page.getByText("OCR 成功")).toBeVisible({ timeout: 150_000 });
  await expect(page.getByText("OCR 失败")).toBeVisible({ timeout: 150_000 });
  await page.getByRole("button", { name: /匿名中英截图\.png/ }).first().click();
  const text = await page.getByRole("textbox", { name: "当前文件核对文字" }).inputValue();
  expect(text).toMatch(/AI|RAG/);
});
