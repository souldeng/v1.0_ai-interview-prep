import { expect, test, type Page } from "@playwright/test";

const NOW = "2026-11-14T00:00:00.000Z";

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

test("UX-20261114-01 三个关键页面在隔离数据下可见且无横向溢出", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.route("**/api/health", route => route.fulfill({ json: { modelConfigured: false } }));
  await page.route("**/api/model/**", route => route.abort());
  await page.addInitScript(now => localStorage.setItem("ai-interview-profile-v1", JSON.stringify({
    version: 1, supplementaryInfo: "", resumes: [], updatedAt: now,
    experiences: [
      { id: "confirmed-experience", title: "匿名客户需求澄清", type: "工作", situation: "客户目标不清晰", action: "本人组织访谈并整理需求", tools: "访谈提纲", result: "形成可验证的需求清单", reflection: "先确认范围", confirmed: true, createdAt: now, updatedAt: now },
      { id: "draft-experience", title: "待核对的项目经历", situation: "资料待确认", action: "", result: "", reflection: "", confirmed: false, createdAt: now, updatedAt: now },
    ],
  })), NOW);
  await page.goto("/");
  await createFixtureProject(page);
  await expect(page.getByRole("tab", { name: "岗位分析", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "匿名 AI 产品经理", exact: true })).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(150);
  await page.screenshot({ path: "audit-evidence/first-fold/02-after/workbench-1366.png" });

  await chooseNavigation(page, "工作台");
  await expect(page.getByRole("heading", { name: "继续准备「匿名 AI 产品经理」", exact: true })).toBeVisible();
  await page.screenshot({ path: "audit-evidence/first-fold/02-after/dashboard-1366.png" });

  await chooseNavigation(page, "个人资料");
  await expect(page.getByRole("heading", { name: "个人资料", exact: true })).toBeVisible();
  await page.screenshot({ path: "audit-evidence/first-fold/02-after/profile-1366.png" });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
});

test("UX-20261114-02 岗位分析分别验证未分析、已分析与资料不足", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.route("**/api/health", route => route.fulfill({ json: { modelConfigured: true, provider: "匿名 Mock" } }));
  await page.route("**/api/model/chat", route => route.fulfill({ json: { content: JSON.stringify({ requirements: [{ requirement: "客户需求分析", status: "direct", evidenceQuote: "本人组织访谈", reason: "已有确认经历", studyTopic: "需求验证", practiceQuestion: "如何核对客户需求？" }] }) } }));
  await page.addInitScript(now => localStorage.setItem("ai-interview-profile-v1", JSON.stringify({ version: 1, supplementaryInfo: "", resumes: [], updatedAt: now, experiences: [{ id: "analysis-experience", title: "匿名需求访谈", situation: "客户目标不清晰", action: "本人组织访谈", result: "形成需求清单", reflection: "先确认范围", confirmed: true, createdAt: now, updatedAt: now }] })), NOW);
  await page.goto("/");
  await createFixtureProject(page);
  await expect(page.getByRole("heading", { name: "把岗位要求变成准备重点", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "开始岗位分析", exact: true })).toBeVisible();
  await page.screenshot({ path: "audit-evidence/job-analysis-hifi/02-after/empty-1366.png" });
  await page.getByRole("button", { name: "开始岗位分析", exact: true }).click();
  await expect(page.getByRole("heading", { name: "客户需求分析", exact: true })).toBeVisible();
  await page.screenshot({ path: "audit-evidence/job-analysis-hifi/02-after/analysed-1366.png" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: "audit-evidence/job-analysis-hifi/02-after/analysed-1440.png" });
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.evaluate(() => {
    const key = "ai-interview-projects-v1";
    const items = JSON.parse(localStorage.getItem(key) || "[]");
    items[0].jobDescription = "";
    items[0].materials = [];
    items[0].aiAnalyses = [];
    localStorage.setItem(key, JSON.stringify(items));
  });
  await page.reload();
  await chooseNavigation(page, "准备");
  await page.getByRole("button", { name: "查看岗位", exact: true }).first().click();
  await page.getByRole("tab", { name: "岗位分析", exact: true }).click();
  await expect(page.getByRole("heading", { name: "补充岗位 JD，再开始分析", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "补充岗位 JD", exact: true })).toBeVisible();
  await page.screenshot({ path: "audit-evidence/job-analysis-hifi/02-after/insufficient-1366.png" });
  await page.setViewportSize({ width: 393, height: 851 });
  const closeNavigation = page.getByRole("button", { name: "关闭导航" });
  await closeNavigation.click({ force: true, timeout: 2_000 });
  await expect(page.getByRole("button", { name: "关闭导航遮罩" })).toBeHidden();
  await page.screenshot({ path: "audit-evidence/job-analysis-hifi/02-after/insufficient-393.png" });
  await page.getByRole("button", { name: "补充岗位 JD", exact: true }).click();
  await expect(page.getByRole("tab", { name: "岗位资料", exact: true })).toHaveAttribute("aria-selected", "true");
});

test("UX-20261114-01 393px 手机端重排三个关键页面", async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 852 });
  await page.route("**/api/health", route => route.fulfill({ json: { modelConfigured: false } }));
  await page.route("**/api/model/**", route => route.abort());
  await page.addInitScript(now => localStorage.setItem("ai-interview-profile-v1", JSON.stringify({ version: 1, supplementaryInfo: "", resumes: [], updatedAt: now, experiences: [{ id: "confirmed-mobile", title: "匿名需求访谈", situation: "目标不清", action: "本人访谈", result: "需求清单", reflection: "先确认范围", confirmed: true, createdAt: now, updatedAt: now }] })), NOW);
  await page.goto("/");
  await createFixtureProject(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(page.getByRole("heading", { name: "匿名 AI 产品经理", exact: true })).toBeVisible();
  await page.screenshot({ path: "audit-evidence/job-analysis-hifi/02-after/empty-393.png" });
  await page.reload();
  await expect(page.getByRole("heading", { name: "继续准备「匿名 AI 产品经理」", exact: true })).toBeVisible();
  await page.screenshot({ path: "audit-evidence/first-fold/02-after/mobile-dashboard-393.png" });
  await chooseNavigation(page, "个人资料");
  await expect(page.getByRole("heading", { name: "个人资料", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "关闭导航遮罩" })).toBeHidden();
  await page.screenshot({ path: "audit-evidence/first-fold/02-after/mobile-profile-393.png" });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
});
