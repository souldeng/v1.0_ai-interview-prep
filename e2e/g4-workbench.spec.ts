import { expect, test, type Page } from "@playwright/test";

async function chooseNavigation(page: Page, name: RegExp | string) {
  const menu = page.getByRole("button", { name: "打开导航" });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole("button", { name }).first().click();
}

test.beforeEach(async ({ page }) => {
  await page.route("**/api/health", route => route.fulfill({ json: { modelConfigured: false } }));
  await page.route("**/api/model/**", route => route.abort());
});

test("G4 侧栏以真实入口连接工作台、准备、题库、训练记录和资料", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /接下来，完成一件最重要的事/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /工作台/ }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: /准备/ }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: /题库/ }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: /训练记录/ }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "个人资料 简历与经历", exact: true })).toBeVisible();
  // 「JD 与面经」侧栏入口已按用户决策移除（与「准备」重复）；断言其不再出现。
  await expect(page.getByRole("button", { name: "JD 与面经 面经与知识", exact: true })).toHaveCount(0);

  await chooseNavigation(page, "准备");
  await expect(page.getByRole("heading", { name: "准备", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /创建岗位/ }).first()).toBeVisible();
  await chooseNavigation(page, "题库");
  // 题库页大标题已按用户决策移除：以题库分类入口为页面标识。
  await expect(page.getByRole("button", { name: "手动题目与预测题", exact: true })).toBeVisible();
  await chooseNavigation(page, "训练记录");
  await expect(page.getByRole("heading", { name: "训练记录", exact: true })).toBeVisible();
  await chooseNavigation(page, "个人资料 简历与经历");
  await expect(page.getByRole("heading", { name: /把真实经历整理成可练习的素材/ })).toBeVisible();
});

test("工作台只根据已确认经历和题组状态显示下一步，不把候选当作事实", async ({ page }) => {
  const now = "2026-11-08T00:00:00.000Z";
  await page.addInitScript(profile => localStorage.setItem("ai-interview-profile-v1", JSON.stringify(profile)), {
    version: 1,
    supplementaryInfo: "",
    resumes: [],
    experiences: [
      { id: "confirmed", title: "匿名需求澄清", type: "工作", situation: "需求不完整", action: "本人访谈并整理需求", tools: "访谈提纲", result: "形成需求清单", reflection: "先核对范围", confirmed: true, createdAt: now, updatedAt: now },
      { id: "candidate", title: "未确认候选", situation: "", action: "模型候选", result: "", reflection: "", confirmed: false, createdAt: now, updatedAt: now },
    ],
    updatedAt: now,
  });
  await page.goto("/");
  await expect(page.getByText("1 段经历已确认，还没有简历题组", { exact: true })).toBeVisible();
  await expect(page.getByText("未确认候选", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "生成简历面试题", exact: true }).click();
  await expect(page.getByRole("heading", { name: "准备面试题", exact: true })).toBeVisible();
});

test("工作台能从真实未完成岗位训练继续，岗位列表仍可切换和编辑", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /创建岗位/ }).first().click();
  await page.getByPlaceholder("例如：AI 产品经理").fill("匿名 G4 岗位");
  await page.getByPlaceholder("粘贴完整的岗位职责与任职要求").fill("负责需求澄清、AI 应用设计和跨团队协作。");
  await page.getByRole("button", { name: "创建岗位准备方案", exact: true }).click();
  await page.getByRole("tab", { name: "面试训练", exact: true }).click();
  await page.getByRole("button", { name: "开始新训练", exact: true }).click();
  await expect(page.getByRole("heading", { name: /请|如何|面对/ }).first()).toBeVisible();
  await page.getByRole("button", { name: "退出训练", exact: true }).click();
  await chooseNavigation(page, "工作台");
  await expect(page.getByRole("button", { name: "继续训练", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "继续训练", exact: true }).click();
  await expect(page.getByRole("heading", { name: /请|如何|面对/ }).first()).toBeVisible();
  await page.getByRole("button", { name: "退出训练", exact: true }).click();
  await chooseNavigation(page, "准备");
  await expect(page.getByRole("heading", { name: "匿名 G4 岗位", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "编辑岗位", exact: true }).click();
  await expect(page.getByRole("heading", { name: "编辑岗位", exact: true })).toBeVisible();
});

test("1440 与 1280 桌面宽度不产生横向溢出", async ({ page }, testInfo) => {
  for (const width of [1440, 1280]) {
    await page.setViewportSize({ width, height: 960 });
    await page.goto("/");
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`g4-dashboard-${width}.png`), fullPage: true });
    await chooseNavigation(page, "准备");
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`g4-prepare-${width}.png`), fullPage: true });
  }
});
