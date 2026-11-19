import { expect, test, type Page } from "@playwright/test";

async function expectNoOverflow(page: Page) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
}

async function openSettings(page: Page) {
  const menu = page.getByRole("button", { name: "打开导航" });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole("button", { name: "设置与备份" }).click();
  await expect(page.getByRole("heading", { name: "设置与数据" })).toBeVisible();
  await expectNoOverflow(page);
}

test("设置中心入口、备份校验与隔离恢复流程可用", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("ai-interview-drafts-v1", JSON.stringify({ create: "existing-draft" })));
  await page.goto("/");
  await openSettings(page);
  await expect(page.getByRole("heading", { name: "备份与恢复" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "导出准备资料" })).toBeVisible();

  await page.getByRole("button", { name: "打开备份与恢复" }).click();
  await expect(page.getByText(/不包含 IndexedDB 中的原始附件 Blob/)).toBeVisible();
  await expectNoOverflow(page);
  const backupDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "下载 JSON 备份" }).click();
  expect((await backupDownload).suggestedFilename()).toMatch(/\.json$/);

  const invalidBackup = page.getByRole("textbox", { name: "待恢复的备份" });
  await invalidBackup.fill("{");
  await page.getByRole("button", { name: "校验并预览" }).click();
  await expect(page.getByRole("alert")).toContainText("不是有效的 JSON");
  expect(await page.evaluate(() => localStorage.getItem("ai-interview-drafts-v1"))).toBe(JSON.stringify({ create: "existing-draft" }));

  const validBackup = JSON.stringify({
    format: "ai-interview-prep-backup",
    version: 1,
    exportedAt: "2026-11-12T00:00:00.000Z",
    projects: [],
    history: [],
    drafts: { create: "recovered-draft" },
  });
  await page.getByLabel("选择备份文件").setInputFiles({
    name: "isolated-backup.json",
    mimeType: "application/json",
    buffer: Buffer.from(validBackup),
  });
  await expect(page.getByText("已选择：isolated-backup.json")).toBeVisible();
  await page.getByRole("button", { name: "校验并预览" }).click();
  await expect(page.getByRole("region", { name: "恢复范围预览" })).toBeVisible();
  await page.getByRole("button", { name: "确认追加为副本" }).click();
  await expect(page.getByRole("status")).toContainText("恢复完成");
  expect(await page.evaluate(() => Object.values(JSON.parse(localStorage.getItem("ai-interview-drafts-v1") ?? "{}")).includes("recovered-draft"))).toBe(true);

  await page.getByRole("button", { name: "返回设置中心" }).click();
  // 设置首页「返回上一个页面」按钮已按用户决策移除：改经侧栏回工作台。
  if (await page.getByRole("button", { name: "打开导航" }).isVisible().catch(() => false)) await page.getByRole("button", { name: "打开导航" }).click();
  await page.getByRole("button", { name: /^工作台/ }).first().click();
  // 新版工作台首页标题（用户迭代后的 Dashboard）。
  await expect(page.getByRole("heading", { name: "从真实经历或目标岗位开始" })).toBeVisible();
});

test("训练记录可以通过设置中心分别生成 DOCX 和 PDF", async ({ page }, testInfo) => {
  const now = "2026-11-12T00:00:00.000Z";
  const question = { id: "g8-question", category: "技术理解", text: "如何验证检索结果？", source: "匿名基础题", sourceType: "foundation", technical: true };
  const preparation = { id: "g8-preparation", createdAt: now, resume: { raw: "", summary: "", skills: [], evidence: [] }, job: { raw: "", title: "匿名基础训练", requirements: [] }, matrix: [], questions: [question] };
  const session = { id: "g8-session", createdAt: now, preparation, questions: [question], currentQuestionIndex: 0, awaitingFollowUp: false, status: "active", skippedQuestionIds: [], turns: [] };
  await page.addInitScript(value => localStorage.setItem("ai-interview-prep-history-v1", JSON.stringify([value])), session);
  await page.goto("/");
  await openSettings(page);
  await page.getByRole("button", { name: "选择导出内容" }).click();
  await expectNoOverflow(page);
  await page.getByRole("button", { name: "训练复盘" }).click();
  await page.getByRole("checkbox", { name: "选择训练记录：匿名基础训练" }).check();

  const exportedFiles: Array<{ path: string; name: string; expectedText: string }> = [];
  for (const format of ["DOCX", "PDF"]) {
    await page.getByRole("radio", { name: format }).check();
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: `生成 ${format}` }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(new RegExp(`\\.${format.toLowerCase()}$`));
    await expect(page.getByRole("status")).toContainText("文件已交给浏览器下载");
    const path = testInfo.outputPath(file.suggestedFilename());
    await file.saveAs(path);
    exportedFiles.push({ path, name: file.suggestedFilename(), expectedText: "匿名基础训练" });
  }

  const menu = page.getByRole("button", { name: "打开导航" });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole("button", { name: "简历与经历" }).click();
  await page.getByRole("tab", { name: "简历资料" }).click();
  await expectNoOverflow(page);
  const upload = page.getByLabel("上传个人资料文件");
  for (const file of exportedFiles) {
    await upload.setInputFiles(file.path);
    await expect.poll(() => page.evaluate(({ name }) => {
      const profile = JSON.parse(localStorage.getItem("ai-interview-profile-v1") ?? "{\"resumes\":[]}");
      return profile.resumes.find((resume: { fileName: string }) => resume.fileName === name)?.extractedText ?? "";
    }, file)).not.toBe("");
    const extractedText = await page.evaluate(({ name }) => {
      const profile = JSON.parse(localStorage.getItem("ai-interview-profile-v1") ?? "{\"resumes\":[]}");
      return profile.resumes.find((resume: { fileName: string }) => resume.fileName === name)?.extractedText ?? "";
    }, file);
    expect(extractedText).toContain(file.expectedText);
  }
});
