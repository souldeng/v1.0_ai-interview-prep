import { expect, test, type Page } from "@playwright/test";

async function openExperiences(page: Page) {
  const menu = page.getByRole("button", { name: "打开导航" });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole("button", { name: "简历与经历", exact: true }).click();
}

async function addReviewedResume(page: Page) {
  await page.getByRole("button", { name: "上传简历资料", exact: true }).click();
  await page.getByLabel("上传个人资料文件").setInputFiles({
    name: "匿名经历来源.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("本人访谈并整理需求清单，形成可追溯的确认记录。"),
  });
  const source = page.locator("article").filter({ has: page.getByRole("heading", { name: "匿名经历来源.txt", exact: true }) });
  await source.getByRole("button", { name: "核对文字", exact: true }).click();
  await source.getByRole("button", { name: "保存核对文字", exact: true }).click();
}

test.beforeEach(async ({ page }) => {
  await page.route("**/api/health", route => route.fulfill({ json: { modelConfigured: true, provider: "匿名Mock" } }));
  await page.route("**/api/model/chat", async route => {
    const profile = await page.evaluate(() => JSON.parse(localStorage.getItem("ai-interview-profile-v1")!));
    await route.fulfill({ json: { content: JSON.stringify([{
      title: "匿名需求核对", type: "工作", situation: "需求描述不完整", action: "本人访谈并整理需求清单", tools: "访谈提纲", result: "形成可追溯的确认记录", reflection: "未参与模型研发",
      sourceQuotes: [{ materialId: profile.resumes[0].id, quote: "本人访谈并整理需求清单" }],
    }]) } });
  });
});

test("G1 候选、草稿与已确认事实分别保存，并可进入简历题准备", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto("/");
  await openExperiences(page);
  await expect(page.getByRole("heading", { name: "我的经历", exact: true })).toBeVisible();
  await addReviewedResume(page);
  await page.once("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "AI 提取经历", exact: true }).click();
  await expect(page.getByText("匿名需求核对", { exact: true })).toBeVisible();
  await expect(page.getByText("候选", { exact: true }).first()).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("g1-candidate-1440.png"), fullPage: true });
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("ai-interview-profile-v1")!).experiences)).toEqual([]);

  await page.reload();
  await openExperiences(page);
  await expect(page.getByText(/已恢复.*候选/)).toBeVisible();
  await page.getByRole("button", { name: "核对经历", exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath("g1-review-1440.png"), fullPage: true });
  await page.setViewportSize({ width: 1280, height: 960 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("g1-review-1280.png"), fullPage: true });
  await page.getByLabel("经历标题", { exact: true }).fill("已编辑的匿名需求核对");
  await page.getByRole("button", { name: "保存草稿并返回", exact: true }).click();
  await expect(page.getByText("已编辑的匿名需求核对", { exact: true })).toBeVisible();
  await expect(page.getByText("草稿", { exact: true }).first()).toBeVisible();

  await page.reload();
  await openExperiences(page);
  await page.getByRole("button", { name: "继续核对", exact: true }).click();
  await page.getByRole("checkbox", { name: /我确认这张经历/ }).check();
  await page.getByRole("button", { name: "确认并保存", exact: true }).click();
  await expect(page.getByText("已确认", { exact: true }).first()).toBeVisible();
  expect((await page.evaluate(() => JSON.parse(localStorage.getItem("ai-interview-profile-v1")!).experiences))[0].confirmed).toBe(true);

  await page.getByRole("button", { name: "准备简历面试题", exact: true }).click();
  await expect(page.getByRole("heading", { name: "生成简历面试题", exact: true })).toBeVisible();
});

test("G1 将模型返回的不完整 JSON 提示为可重试失败，不保存候选", async ({ page }) => {
  await page.goto("/");
  await openExperiences(page);
  await addReviewedResume(page);
  await page.unroute("**/api/model/chat");
  await page.route("**/api/model/chat", route => route.fulfill({ json: { content: '[{"title":"匿名候选","action":"访谈' } }));
  await page.once("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "AI 提取经历", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("候选经历模型返回的 JSON 不完整或格式错误");
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("ai-interview-profile-v1")!).experienceCandidates ?? [])).toEqual([]);
});

test("G1 可以停止误触发的 AI 提取，且不会保存迟到候选", async ({ page }) => {
  let release!: () => void;
  const waitForRelease = new Promise<void>(resolve => { release = resolve; });
  let requested = false;
  await page.goto("/");
  await openExperiences(page);
  await addReviewedResume(page);
  await page.unroute("**/api/model/chat");
  await page.route("**/api/model/chat", async route => {
    requested = true;
    await waitForRelease;
    await route.fulfill({ json: { content: JSON.stringify([]) } }).catch(() => undefined);
  });
  await page.once("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "AI 提取经历", exact: true }).click();
  await expect.poll(() => requested).toBe(true);
  await page.getByRole("button", { name: "停止 AI 提取", exact: true }).click();
  await expect(page.getByText("已停止 AI 提取，现有候选和经历草稿未改变。", { exact: true })).toBeVisible();
  release();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("ai-interview-profile-v1")!).experienceCandidates ?? [])).toEqual([]);
});

test("G1 候选保存失败不显示虚假成功，候选仍留在当前页供重试", async ({ page }) => {
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) {
      if (key === "ai-interview-profile-v1" && (window as Window & { failProfileWrite?: boolean }).failProfileWrite) throw new DOMException("quota", "QuotaExceededError");
      return original.call(this, key, value);
    };
  });
  await page.goto("/");
  await openExperiences(page);
  await addReviewedResume(page);
  await page.evaluate(() => { (window as Window & { failProfileWrite?: boolean }).failProfileWrite = true; });
  await page.once("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "AI 提取经历", exact: true }).click();
  await expect(page.getByText(/候选经历保存失败/)).toBeVisible();
  await expect(page.getByText("匿名需求核对", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "重试保存候选", exact: true })).toBeVisible();
  await expect(page.getByText(/已保存.*候选经历/)).toHaveCount(0);
});

test("G1 在 1440px 与 1280px 桌面宽度不产生横向溢出", async ({ page }, testInfo) => {
  for (const width of [1440, 1280]) {
    await page.setViewportSize({ width, height: 960 });
    await page.goto("/");
    await openExperiences(page);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`g1-experiences-${width}.png`), fullPage: true });
  }
});
