import { expect, test, type Page } from "@playwright/test";
import { createPreparation, nextTurn, startSession } from "../src/lib/interview";
import { createInterviewProject, updateProjectFromSession } from "../src/lib/projects";
import { openDetails, practiceRecordedQuestion } from "./uiActions";

/**
 * 岗位关联闭环验收（TASK A/B/C）：全部使用虚构岗位与虚构题目，
 * 只验证本地数据关系与页面感知点，不调用任何 AI 推荐或付费模型。
 */

const JOB_ID = "project-gov";
const JOB_NAME = "政府事务";
const JOB_DESCRIPTION = "政府事务岗位：负责政策研究、对外沟通与项目推进。";

function govPreparation(questionTexts: string[]) {
  const prep = createPreparation("本人负责政府事务沟通与项目推进。", JOB_DESCRIPTION);
  prep.questions = questionTexts.map((text, index) => ({
    id: `gov-q${index + 1}`, text, category: "方案与业务" as const, technical: false, sourceType: "jd" as const, source: "岗位 JD：政策研究、对外沟通与项目推进。",
  }));
  return prep;
}

/** 36 道 AI 预测题：只进入题库，不写岗位会话。 */
function questionLibrary(questionCount = 36, projectId: string | null = JOB_ID) {
  return {
    version: 1,
    favorites: [],
    reuseDrafts: [],
    recordedQuestions: Array.from({ length: questionCount }, (_, index) => ({
      id: `recorded-gov-${index + 1}`,
      question: `政府事务预测题 ${index + 1}：如何推进一项跨部门政策沟通？`,
      ...(projectId ? { projectId } : {}),
      sourceType: "ai_prediction" as const,
      category: "A. 岗位理解",
      order: index + 1,
      createdAt: "2026-11-13T09:00:00.000Z",
    })),
  };
}

/** 只有准备快照、没有训练会话的岗位：用于感知闭环与多题训练。 */
function govProjectWithoutSession() {
  const created = createInterviewProject({ company: "匿名集团", jobTitle: JOB_NAME, jobDescription: JOB_DESCRIPTION, candidateBackground: "", concerns: "" }, govPreparation([]));
  return { ...created, id: JOB_ID, questions: [], totalQuestions: 0 };
}

async function seed(page: Page, projects: unknown[], library: unknown, extra: Record<string, string> = {}) {
  await page.addInitScript(({ projects, library, extra }) => {
    if (!localStorage.getItem("ai-interview-projects-v1")) localStorage.setItem("ai-interview-projects-v1", JSON.stringify(projects));
    if (!localStorage.getItem("ai-interview-question-library-v1")) localStorage.setItem("ai-interview-question-library-v1", JSON.stringify(library));
    for (const [key, value] of Object.entries(extra)) if (!localStorage.getItem(key)) localStorage.setItem(key, value);
  }, { projects, library, extra });
  await page.route("**/api/health", route => route.fulfill({ json: { modelConfigured: false } }));
}

async function openNav(page: Page, name: RegExp) {
  const menu = page.getByRole("button", { name: "打开导航" });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole("button", { name }).first().click();
}

async function openJobTrainingModule(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "查看岗位", exact: true }).click();
  await page.getByRole("button", { name: "面试训练", exact: true }).click();
}

async function expectNoHorizontalOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
}

test("36 道岗位关联题：工作台可见数量与已答状态，一次点击进入已筛选题库", async ({ page }) => {
  await seed(page, [govProjectWithoutSession()], questionLibrary());
  await openJobTrainingModule(page);

  const summary = page.getByRole("region", { name: "岗位关联题" });
  await expect(summary).toContainText("关联题 36 道");
  await expect(summary).toContainText("已答 0");
  await expect(summary).toContainText("未答 36");
  await expectNoHorizontalOverflow(page);

  await summary.getByRole("button", { name: "查看关联题", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "按岗位筛选" })).toContainText(JOB_NAME);
  const list = page.getByRole("region", { name: "题目列表" });
  await expect(list.locator("article")).toHaveCount(36);
  await expect(list.getByText("未练习").first()).toBeVisible();
  await expect(list.getByText(JOB_NAME).first()).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test("同岗位多题训练保留岗位归属，训练记录与复盘均显示岗位专项", async ({ page }) => {
  await seed(page, [govProjectWithoutSession()], questionLibrary());
  await page.goto("/");
  await openNav(page, /AI 面试题库/);
  await page.getByRole("button", { name: "岗位专项训练", exact: true }).click();
  await page.getByRole("button", { name: new RegExp(JOB_NAME) }).first().click();

  const list = page.getByRole("region", { name: "题目列表" });
  await expect(list.locator("article")).toHaveCount(36);
  for (let index = 0; index < 3; index += 1) await list.locator("article").nth(index).getByRole("checkbox").check();
  await page.getByRole("button", { name: "开始多题训练", exact: true }).click();
  // 岗位没有进行中的会话，因此不弹出“开始新一轮训练”确认框。
  await expect(page.getByRole("dialog", { name: "开始新一轮训练" })).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "本轮回答", exact: true })).toBeVisible();

  const stored = await page.evaluate(() => ({
    projects: JSON.parse(localStorage.getItem("ai-interview-projects-v1")!),
    history: JSON.parse(localStorage.getItem("ai-interview-prep-history-v1")!),
  }));
  const session = stored.history[0];
  expect(session.preparation.job.projectId).toBe(JOB_ID);
  expect(session.preparation.job.projectName).toBe(JOB_NAME);
  expect(session.questions).toHaveLength(3);
  // 不写回岗位会话，也不替换岗位题目列表。
  expect(stored.projects[0].session).toBeUndefined();
  expect(stored.projects[0].questions).toEqual([]);

  await page.getByRole("button", { name: "退出训练", exact: true }).click();
  await expect(page.getByText("岗位专项 · 政府事务").first()).toBeVisible();
  await page.getByRole("button", { name: "查看复盘", exact: true }).first().click();
  await expect(page.getByText("岗位专项 · 政府事务").first()).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test("岗位正在训练时插入单题练习：原题目、进度与草稿不变，单题独立记录仍可追溯岗位", async ({ page }) => {
  const texts = ["政策研究流程？", "对外沟通对象？", "跨部门协作？", "舆情回应？", "复盘方式？"];
  const prep = govPreparation(texts);
  const created = { ...createInterviewProject({ company: "匿名集团", jobTitle: JOB_NAME, jobDescription: JOB_DESCRIPTION, candidateBackground: "", concerns: "" }, prep), id: JOB_ID };
  let session = startSession(prep, 5);
  session = nextTurn(session, "第1题回答：先收集政策原文。", { action: "next" });
  session = nextTurn(session, "第2题回答：先对齐主管部门口径。", { action: "next" });
  const project = updateProjectFromSession({ ...created, totalQuestions: 5 }, session);
  const draftKey = `answer:${project.session!.id}:${project.session!.questions[2].id}`;
  await seed(page, [project], questionLibrary(), { "ai-interview-drafts-v1": JSON.stringify({ [draftKey]: "第 3 题草稿：正在整理协作流程。" }) });

  await page.goto("/");
  await openNav(page, /AI 面试题库/);
  await page.getByRole("button", { name: "岗位专项训练", exact: true }).click();
  await page.getByRole("button", { name: new RegExp(JOB_NAME) }).first().click();

  const list = page.getByRole("region", { name: "题目列表" });
  await expect(list.locator("article")).toHaveCount(41); // 36 道关联题 + 岗位原有 5 道训练题
  await list.getByRole("button").filter({ hasText: "政府事务预测题 1：" }).first().click();
  await practiceRecordedQuestion(page);
  const dialog = page.getByRole("dialog", { name: "开始新一轮训练" });
  await expect(dialog).toContainText("岗位当前训练与草稿保持原样");
  await dialog.getByRole("button", { name: "暂存并开始新练习", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "本轮回答", exact: true })).toBeVisible();

  const after = await page.evaluate(() => ({
    projects: JSON.parse(localStorage.getItem("ai-interview-projects-v1")!),
    history: JSON.parse(localStorage.getItem("ai-interview-prep-history-v1")!),
    drafts: JSON.parse(localStorage.getItem("ai-interview-drafts-v1")!),
  }));
  const kept = after.projects[0].session;
  expect(kept.questions).toHaveLength(5);
  expect(kept.turns).toHaveLength(2);
  expect(kept.currentQuestionIndex).toBe(2);
  expect(after.projects[0].questions).toHaveLength(5);
  expect(after.drafts[draftKey]).toBe("第 3 题草稿：正在整理协作流程。");
  expect(after.history).toHaveLength(1);
  expect(after.history[0].preparation.job.projectId).toBe(JOB_ID);
  expect(after.history[0].id).not.toBe(kept.id);

  // 单题记录能追溯到岗位，并且不会新建第二个岗位会话。
  await page.getByRole("button", { name: "退出训练", exact: true }).click();
  await expect(page.getByText("岗位专项 · 政府事务").first()).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("ai-interview-projects-v1")!).filter((item: { session?: unknown }) => item.session).length)).toBe(1);

  // 回到岗位仍可继续原来的 5 题训练，草稿还在。
  await openNav(page, /^准备/);
  await page.getByRole("button", { name: "查看岗位", exact: true }).click();
  await page.getByRole("button", { name: "面试训练", exact: true }).click();
  await expect(page.getByRole("region", { name: "岗位关联题" })).toContainText("关联题 36 道");
  await page.getByRole("button", { name: "继续当前训练", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "本轮回答", exact: true })).toHaveValue("第 3 题草稿：正在整理协作流程。");
  await expectNoHorizontalOverflow(page);
});

test("信息层级：正常态不出现异常条，题库详情只有一个主操作，长内容默认折叠", async ({ page }, info) => {
  await seed(page, [govProjectWithoutSession()], questionLibrary(2));
  await page.goto("/");
  await openNav(page, /AI 面试题库/);
  await page.getByRole("button", { name: "面试资料收集", exact: true }).click();

  // 说明文字默认折叠：未展开处理说明前隐私说明正文不可见（details 内容仍在 DOM 中，断言可见性而不是数量）。
  await expect(page.getByText(/整理只发送本批已识别的文字/)).toBeHidden();
  await openDetails(page, "查看处理说明");
  await expect(page.getByText(/整理只发送本批已识别的文字/)).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.getByRole("button", { name: "返回题库分类", exact: true }).click();
  await page.getByRole("button", { name: "岗位专项训练", exact: true }).click();
  await page.getByRole("button", { name: new RegExp(JOB_NAME) }).first().click();
  // 详情侧栏（按内容定位，避免命中左侧导航的 aside）。手机端详情在底部抽屉中，点第一道题打开后再断言，断言强度不变。
  if (info.project.name === "mobile") await page.getByRole("region", { name: "题目列表" }).locator("article").first().getByRole("button").first().click();
  const aside = page.locator("aside").filter({ hasText: "最终确认答案" });
  // 只有一个主操作按钮；原回答与来源说明默认折叠。
  await expect(aside.locator('[data-cta="primary"]')).toHaveCount(1);
  await expect(aside.getByRole("button", { name: "练习这道题", exact: true })).toBeVisible();
  await expect(page.getByText(/AI 预测题；仅供练习/)).toBeHidden();
  await openDetails(page, "原回答");
  await expect(page.getByText("（未填写）")).toBeVisible();
  await expectNoHorizontalOverflow(page);
});
