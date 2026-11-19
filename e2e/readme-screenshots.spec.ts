import { expect, test, type Page } from "@playwright/test";

/**
 * README 截图生成：完全虚构的匿名数据与 Mock 模型响应，不含任何真实个人资料。
 * 输出到 docs/screenshots/，随 README 一并公开；重跑命令：npx playwright test e2e/readme-screenshots.spec.ts
 */
const NOW = "2026-11-19T00:00:00.000Z";

async function chooseNavigation(page: Page, name: string) {
  const menu = page.getByRole("button", { name: "打开导航" });
  if (await menu.isVisible()) await menu.click();
  const labels: Record<string, string> = { "工作台": "工作台 今日任务", "准备": "准备 岗位 · 资料 · 题组", "个人资料": "个人资料 简历与经历" };
  await page.getByRole("button", { name: labels[name] ?? new RegExp(name) }).click();
  await expect(page.getByRole("button", { name: "关闭导航遮罩" })).toBeHidden();
}

async function createFixtureProject(page: Page) {
  await chooseNavigation(page, "准备");
  await page.getByRole("button", { name: /创建岗位/ }).first().click();
  await page.getByPlaceholder("例如：AI 产品经理").fill("匿名 AI 产品经理");
  await page.getByPlaceholder("粘贴完整的岗位职责与任职要求").fill("负责企业 AI 产品规划、客户需求分析及跨团队交付，能够用数据持续改善产品效果。");
  await page.getByRole("button", { name: "创建岗位准备方案" }).click();
}

test("生成 README 公开截图：工作台、岗位分析、个人资料（匿名 Mock 数据）", async ({ page }) => {
  test.skip(test.info().project.name !== "desktop", "README 截图只需桌面视口");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.route("**/api/health", route => route.fulfill({ json: { modelConfigured: true, provider: "匿名 Mock" } }));
  await page.route("**/api/model/chat", route => route.fulfill({ json: { content: JSON.stringify({ requirements: [{ requirement: "客户需求分析", status: "direct", evidenceQuote: "本人组织访谈并整理需求", reason: "已有确认经历", studyTopic: "需求验证", practiceQuestion: "如何核对客户需求？" }] }) } }));
  await page.addInitScript(now => localStorage.setItem("ai-interview-profile-v1", JSON.stringify({
    version: 1, supplementaryInfo: "", resumes: [], updatedAt: now,
    experiences: [
      { id: "confirmed-experience", title: "匿名客户需求澄清", type: "工作", situation: "客户目标不清晰", action: "本人组织访谈并整理需求", tools: "访谈提纲", result: "形成可验证的需求清单", reflection: "先确认范围", confirmed: true, createdAt: now, updatedAt: now },
    ],
  })), NOW);
  await page.goto("/");
  await createFixtureProject(page);
  await expect(page.getByRole("tab", { name: "岗位分析", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "开始岗位分析", exact: true }).click();
  await expect(page.getByRole("heading", { name: "客户需求分析", exact: true })).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(200);
  await page.screenshot({ path: "docs/screenshots/workbench-analysis.png" });

  await chooseNavigation(page, "工作台");
  await expect(page.getByRole("heading", { name: "继续准备「匿名 AI 产品经理」", exact: true })).toBeVisible();
  await page.screenshot({ path: "docs/screenshots/dashboard.png" });

  await chooseNavigation(page, "个人资料");
  await expect(page.getByRole("heading", { name: "个人资料", exact: true })).toBeVisible();
  await page.screenshot({ path: "docs/screenshots/profile.png" });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
});
