import { expect, test, type Page } from "@playwright/test";
import { openDetails } from "./uiActions";

test.setTimeout(90_000);
const now = "2026-11-03T00:00:00.000Z";
const education = { id: "education", title: "匿名 AI 课程学习", type: "学习", situation: "转向 AI 应用方向", action: "完成检索增强问答课程练习并记录边界", tools: "文档检索", result: "保留学习笔记", reflection: "区分课程练习和真实项目", confirmed: true, createdAt: now, updatedAt: now };
const work = { id: "work", title: "匿名客户需求澄清", type: "工作", situation: "客户需求描述不完整", action: "本人访谈客户并整理需求清单", tools: "访谈提纲", result: "形成需求清单，未负责模型研发", reflection: "先确认问题边界", confirmed: true, createdAt: now, updatedAt: now };
const project = { id: "project", title: "匿名知识库原型", type: "项目", situation: "练习知识库方案表达", action: "本人整理公开资料并设计检索对照", tools: "Python、向量检索", result: "保留对照记录", reflection: "不把学习原型说成上线项目", confirmed: true, createdAt: now, updatedAt: now };
const crossQuestion = "客户需求澄清与知识库原型之间，你如何说明能力迁移的边界？";
const questions = [
  { text: "课程练习如何帮助你理解检索增强问答的边界？", focus: "knowledge", evidence: [{ experienceId: "education", fields: ["action", "tools"] }], whyAsk: "考察学习经历中的理解与验证边界。", capabilities: ["学习迁移", "验证思路"], angles: ["设计动机", "验证方式"], followUps: ["你如何区分课程练习与真实项目？"], missingAspects: ["业务价值"], coverage: ["education", "technical_evidence"] },
  { text: "面对不完整需求时，你先做了哪些澄清？", focus: "practice", evidence: [{ experienceId: "work", fields: ["situation", "action"] }], whyAsk: "考察已确认的需求澄清行动。", capabilities: ["需求分析"], angles: ["个人贡献", "实现流程"], followUps: ["需求清单形成后如何确认边界？"], missingAspects: ["业务价值"], coverage: ["work"] },
  { text: "知识库原型中，你如何用检索对照检查自己的理解？", focus: "practice", evidence: [{ experienceId: "project", fields: ["action", "tools"] }], whyAsk: "考察确认的技术练习与验证方式。", capabilities: ["技术实践"], angles: ["技术选型", "验证方式"], followUps: ["哪些结论还需要补充证据？"], missingAspects: ["真实Badcase"], coverage: ["project", "technical_evidence"] },
  { text: crossQuestion, focus: "practice", evidence: [{ experienceId: "work", fields: ["action"] }, { experienceId: "project", fields: ["action"] }], whyAsk: "考察跨经历能力迁移，且不混用两段事实。", capabilities: ["能力迁移", "边界表达"], angles: ["个人贡献", "设计动机"], followUps: ["两段经历中哪些结果不能互相替代？"], missingAspects: ["业务价值"], coverage: ["work", "project"] },
];

async function nav(page: Page, name: RegExp | string) {
  const menu = page.getByRole("button", { name: "打开导航" });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole("button", { name }).first().click();
}

async function seed(page: Page) {
  await page.addInitScript(profile => {
    if (!localStorage.getItem("ai-interview-profile-v1")) localStorage.setItem("ai-interview-profile-v1", JSON.stringify(profile));
  }, { version: 1, supplementaryInfo: "原始补充信息不能作为本题个人事实", resumes: [], experiences: [education, work, project, { ...project, id: "draft", title: "未确认经历", action: "完成 99 个上线项目", confirmed: false }], updatedAt: now });
  await page.route("**/api/health", route => route.fulfill({ json: { modelConfigured: true, provider: "匿名模拟" } }));
}

test("整份确认简历一键生成后保留依据、首答、追问、参考草稿与失效保护", async ({ page }) => {
  await seed(page);
  let generation = 0;
  await page.route("**/api/model/chat", route => {
    const request = route.request().postDataJSON();
    const payload = JSON.stringify(request.messages);
    expect(payload).not.toContain("未确认经历");
    expect(payload).not.toContain("完成 99 个上线项目");
    if (request.feature === "resume_question_generation") {
      generation += 1;
      expect(payload).toContain("本人访谈客户并整理需求清单");
      expect(payload).toContain("本人整理公开资料并设计检索对照");
      return route.fulfill({ json: { content: JSON.stringify({ questions }) } });
    }
    if (request.feature === "interview_followup") return route.fulfill({ json: { content: JSON.stringify({ action: "follow_up", followUpQuestion: "请分别说明两段经历中已确认的本人行动。" }) } });
    if (request.feature === "interview_feedback") return route.fulfill({ json: { content: JSON.stringify({ strengths: ["回答涉及两段经历"], issues: ["仍可区分边界"], factRisks: [], suggestions: ["分别说明行动"], studyTopics: [], answerStructure: "分别说明行动和边界", optimizedExample: "伪造的上线成果不应出现" }) } });
    throw new Error(`unexpected feature ${request.feature}`);
  });
  await page.goto("/"); await nav(page, /AI 面试题库/); await page.getByRole("button", { name: "简历专项", exact: true }).click();
  await page.getByRole("button", { name: "生成题组", exact: true }).click();
  await expect(page.getByRole("heading", { name: crossQuestion, exact: true })).toBeVisible();
  const crossCard = page.locator("article").filter({ has: page.getByRole("heading", { name: crossQuestion, exact: true }) });
  await crossCard.getByRole("button", { name: "练习这道题", exact: true }).click();
  await page.getByRole("textbox", { name: "本轮回答", exact: true }).fill("我会分别说明：客户需求澄清中我本人访谈并整理清单；知识库原型中我整理公开资料并设计检索对照。两段经历不混用结果。");
  await page.getByRole("button", { name: "提交回答", exact: true }).click();
  await expect(page.getByRole("heading", { name: "AI 回答建议", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "请分别说明两段经历中已确认的本人行动。", exact: true })).toHaveCount(0);
  await expect(page.getByText("伪造的上线成果不应出现", { exact: true })).toHaveCount(0);
  await openDetails(page, "保存我的回答思路");
  await page.getByRole("textbox", { name: "最终确认答案", exact: true }).fill("我的最终确认回答：先分开说明两段经历中的行动，再说明没有混用的边界。");
  await page.getByRole("button", { name: "保存最终答案", exact: true }).click();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("ai-interview-prep-history-v1")!));
  expect(saved.at(-1).turns[0].answer).toContain("我会分别说明");
  expect(saved.at(-1).turns[0].finalAnswer).toContain("我的最终确认回答");
  expect(saved.at(-1).turns[0].aiCoach.optimizedExample).toContain("本人访谈客户并整理需求清单");
  expect(saved.at(-1).turns[0].aiCoach.optimizedExample).not.toContain("伪造的上线成果");
  await page.getByRole("button", { name: "下一题", exact: true }).click();
  await expect(page.getByRole("heading", { name: "请分别说明两段经历中已确认的本人行动。", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "退出训练", exact: true }).click();
  await expect(page.getByRole("heading", { name: "训练记录", exact: true })).toBeVisible();
  expect(generation).toBe(1);

  await page.evaluate(() => { const profile = JSON.parse(localStorage.getItem("ai-interview-profile-v1")!); profile.experiences.find((item: any) => item.id === "project").action = "已修改的原型行动"; localStorage.setItem("ai-interview-profile-v1", JSON.stringify(profile)); });
  await page.reload(); await nav(page, /AI 面试题库/); await page.getByRole("button", { name: "简历专项", exact: true }).click();
  await page.getByRole("button", { name: "题组管理", exact: true }).click(); await page.getByRole("button", { name: /整份简历题/ }).click();
  await expect(page.getByText("题组依据的已确认经历已变化、删除或撤销确认。历史题组与训练记录仍保留，但不能继续按旧事实训练。")).toBeVisible();
  await expect(page.locator("article").filter({ has: page.getByRole("heading", { name: crossQuestion, exact: true }) }).getByRole("button", { name: "练习这道题", exact: true })).toBeDisabled();
});

test("自我介绍练习走现有训练与历史保存流程", async ({ page }) => {
  await seed(page);
  await page.goto("/"); await nav(page, /AI 面试题库/); await page.getByRole("button", { name: "简历专项", exact: true }).click();
  await page.getByRole("button", { name: "自我介绍", exact: true }).click();
  await page.getByRole("radio", { name: /3 分钟/ }).check();
  await expect(page.getByRole("button", { name: "练习 3 分钟自我介绍", exact: true })).toBeVisible();
  await page.getByRole("radio", { name: /1 分钟/ }).check();
  await page.getByRole("button", { name: "练习 1 分钟自我介绍", exact: true }).click();
  await expect(page.getByRole("heading", { name: /请用约 1 分钟\s*做自我介绍/ })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "本轮回答", exact: true })).toBeVisible();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("ai-interview-prep-history-v1")!));
  expect(saved.at(-1).preparation.job.title).toBe("1 分钟自我介绍练习");
});

test("选择部分确认经历后仅发送所选事实，题组可整组进入训练", async ({ page }) => {
  await seed(page);
  await page.route("**/api/model/chat", route => {
    const request = route.request().postDataJSON();
    expect(request.feature).toBe("resume_question_generation");
    const payload = JSON.stringify(request.messages);
    expect(payload).toContain("匿名客户需求澄清");
    expect(payload).toContain("匿名知识库原型");
    expect(payload).not.toContain("匿名 AI 课程学习");
    expect(payload).not.toContain("未确认经历");
    return route.fulfill({ json: { content: JSON.stringify({ questions: questions.slice(1) }) } });
  });
  await page.goto("/"); await nav(page, /AI 面试题库/); await page.getByRole("button", { name: "简历专项", exact: true }).click();
  await page.getByRole("checkbox", { name: /匿名 AI 课程学习/ }).uncheck();
  await page.getByRole("button", { name: "生成题组", exact: true }).click();
  await expect(page.getByText(/全局简历题组 · 2 段经历/)).toBeVisible();
  await page.getByRole("button", { name: "开始训练", exact: true }).click();
  await expect(page.getByRole("heading", { name: "面对不完整需求时，你先做了哪些澄清？", exact: true })).toBeVisible();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("ai-interview-prep-history-v1")!));
  expect(saved.at(-1).questions).toHaveLength(3);
});

test("简历题组准备与管理在 1440 和 1280 桌面宽度不产生横向溢出", async ({ page }) => {
  await seed(page);
  await page.route("**/api/model/chat", route => route.fulfill({ json: { content: JSON.stringify({ questions }) } }));
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto("/"); await nav(page, /AI 面试题库/); await page.getByRole("button", { name: "简历专项", exact: true }).click();
  await expect(page.getByRole("button", { name: "整份简历题", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole("button", { name: "生成题组", exact: true }).click();
  await expect(page.getByRole("heading", { name: crossQuestion, exact: true })).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 960 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("整份简历候选题组在正式保存失败后刷新可恢复，重试不再次请求模型", async ({ page }) => {
  await seed(page);
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key: string, value: string) {
      if (key === "ai-interview-question-library-v1" && !sessionStorage.getItem("resume-candidate-failed-once")) {
        sessionStorage.setItem("resume-candidate-failed-once", "true");
        throw new Error("匿名题库写入失败");
      }
      return original.call(this, key, value);
    };
  });
  let calls = 0;
  await page.route("**/api/model/chat", route => {
    const request = route.request().postDataJSON();
    if (request.feature !== "resume_question_generation") throw new Error(`unexpected feature ${request.feature}`);
    calls += 1;
    return route.fulfill({ json: { content: JSON.stringify({ questions }) } });
  });
  await page.goto("/"); await nav(page, /AI 面试题库/); await page.getByRole("button", { name: "简历专项", exact: true }).click();
  await page.getByRole("button", { name: "生成题组", exact: true }).click();
  await expect(page.getByText(/题组保存失败：匿名题库写入失败/)).toBeVisible();
  await expect(page.getByText(/已恢复上次未保存的候选题组，共 4 道题/)).toBeVisible();
  await page.reload(); await nav(page, /AI 面试题库/); await page.getByRole("button", { name: "简历专项", exact: true }).click();
  await expect(page.getByText(/已恢复上次未保存的候选题组，共 4 道题/)).toBeVisible();
  await page.getByRole("button", { name: "重试保存", exact: true }).click();
  await expect(page.getByRole("heading", { name: crossQuestion, exact: true })).toBeVisible();
  expect(calls).toBe(1);
});

test("题库一级导航直接回到题库入口", async ({ page }) => {
  await seed(page);
  await page.goto("/"); await nav(page, /AI 面试题库/); await page.getByRole("button", { name: "AI 基础学习", exact: true }).click();
  await expect(page.getByRole("heading", { name: "AI 转岗基础题", exact: true })).toBeVisible();
  await nav(page, /AI 面试题库/);
  await expect(page.getByRole("button", { name: "简历专项", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "AI 转岗基础题", exact: true })).toHaveCount(0);
});
