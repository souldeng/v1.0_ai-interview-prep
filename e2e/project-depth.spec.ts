import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { createPreparation } from "../src/lib/interview";
import { createInterviewProject } from "../src/lib/projects";
import { emptyUserProfile, PROFILE_KEY } from "../src/lib/profileStorage";
import { deepDiveAngles } from "../src/lib/projectDeepDive";
import { openDetails } from "./uiActions";

const fixture = JSON.parse(readFileSync(new URL("../test-fixtures/public-coach/project-depth.json", import.meta.url), "utf8"));

test("岗位项目深挖先独立回答，参考/草稿/最终答案/重答保存刷新互不覆盖", async ({ page }, info) => {
  const profile = emptyUserProfile();
  profile.experiences = fixture.experiences.map((e: any) => ({ ...e, confirmed: true, createdAt: profile.updatedAt, updatedAt: profile.updatedAt }));
  const project = createInterviewProject({ company: "匿名样例", jobTitle: "AI Builder", jobDescription: fixture.jd, candidateBackground: "", concerns: "" }, createPreparation("", fixture.jd));
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.addInitScript(({ profile, project, key }) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(profile));
    if (!localStorage.getItem("ai-interview-projects-v1")) localStorage.setItem("ai-interview-projects-v1", JSON.stringify([project]));
  }, { profile, project, key: PROFILE_KEY });
  await page.route("**/api/health", r => r.fulfill({ json: { modelConfigured: true, provider: "匿名替身" } }));
  await page.route("**/api/model/chat", r => {
    const request = r.request().postDataJSON();
    const response = request.feature === "interview_question" ? { questions: [0, 1, 2].map(i => ({ text: ["你在 Bid-Writer 如何设计上下文边界？", "用 Codex 理解代码时如何验证？", "RAG 对照评测如何区分错误？"][i], experienceId: "fixture-bid", requirementQuote: fixture.jd, evidenceQuote: profile.experiences[0].action, whyAsk: "岗位需要核对项目机制与个人贡献。", angles: i === 0 ? deepDiveAngles.slice(0, 3) : i === 1 ? deepDiveAngles.slice(3, 5) : deepDiveAngles.slice(5), followUps: ["有没有真实的失败记录？"] })) }
      : request.feature === "interview_followup" ? { action: "next" }
      : { strengths: [], issues: ["还需补充具体机制"], factRisks: [], suggestions: [], answerStructure: "不应照用的自由故事", studyTopics: [], optimizedExample: "我负责上线节省80%", referenceSelection: [{ experienceId: "fixture-bid", fields: ["tools", "result"] }], missingAspects: ["真实Badcase"] };
    return r.fulfill({ json: { content: JSON.stringify(response) } });
  });
  const open = async () => { await page.goto("/"); await page.getByRole("button", { name: "查看岗位", exact: true }).click(); await page.getByRole("button", { name: "面试训练", exact: true }).click(); };
  await open(); await page.getByRole("button", { name: "开始新训练", exact: true }).click();
  await expect(page.getByRole("heading", { name: "你在 Bid-Writer 如何设计上下文边界？" })).toBeVisible();
  await expect(page.getByText(/为什么问：岗位需要核对/)).toBeVisible();
  await expect(page.getByRole("button", { name: "复制到待确认答案草稿" })).toHaveCount(0);
  const input = page.getByRole("textbox", { name: "本轮回答", exact: true });
  await input.fill("我先独立说明上下文边界，具体代码需核对。");
  await page.getByRole("button", { name: "提交回答", exact: true }).click();
  await expect(page.getByRole("heading", { name: "AI 教练反馈", exact: true })).toBeVisible();
  await openDetails(page, "提问原因与后续追问"); await expect(page.getByText("有没有真实的失败记录？", { exact: true })).toBeVisible();
  await openDetails(page, "AI 补充建议与示例（需本人核对）");
  await expect(page.getByText(/待核实：真实Badcase/)).toBeVisible();
  await page.getByRole("button", { name: "复制到待确认答案草稿", exact: true }).click();
  await openDetails(page, "保存我的回答思路");
  const final = page.getByRole("textbox", { name: "最终确认答案", exact: true });
  await expect(final).toHaveValue(/没有负责模型训练/);
  await final.fill("本人确认的最终答案，不能被AI覆盖。");
  await page.getByRole("button", { name: "保存最终答案", exact: true }).click();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("ai-interview-projects-v1")!)[0].session.turns[0].finalAnswer)).toBe("本人确认的最终答案，不能被AI覆盖。");
  await page.getByRole("textbox", { name: "同题重答", exact: true }).fill("我关闭参考后重新说明流程。");
  await page.getByRole("button", { name: "保存重答并对比", exact: true }).click();
  await page.getByRole("button", { name: "请求 AI 点评", exact: true }).click();
  await expect(page.getByRole("heading", { name: "AI 教练反馈", exact: true })).toBeVisible();
  await page.reload(); await page.getByRole("button", { name: "查看岗位", exact: true }).click(); await page.getByRole("button", { name: "面试训练", exact: true }).click();
  await openDetails(page, "保存我的回答思路"); await expect(final).toHaveValue("本人确认的最终答案，不能被AI覆盖。");
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("ai-interview-projects-v1")!)[0].session.turns[0]);
  expect(saved.answer).toBe("我先独立说明上下文边界，具体代码需核对。"); expect(saved.revisions[0].answer).toBe("我关闭参考后重新说明流程。"); expect(saved.coachReviews).toHaveLength(2);
  expect(saved.coachReviews[1].feedback.optimizedExample).not.toMatch(/80%|我负责上线/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: info.outputPath("project-depth.png"), fullPage: true }); expect(errors).toEqual([]);
});
