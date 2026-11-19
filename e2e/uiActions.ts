import type { Locator, Page } from "@playwright/test";

/** Explicit user actions for the simplified, opt-in panels; never changes app data. */
export async function openDetails(page: Page, title: string) {
  const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const summary = page.locator("summary").filter({ hasText: new RegExp(`^${escaped}$`) }).first();
  if (await summary.isVisible()) {
    if (await summary.locator("..").getAttribute("open") === null) await summary.click();
    return;
  }
  // shadcn Collapsible 折叠面板：触发器是带 aria-expanded 的按钮（题库样板页）。
  const trigger = page.getByRole("button", { name: new RegExp(`^${escaped}$`) }).first();
  if (await trigger.isVisible() && (await trigger.getAttribute("aria-expanded")) === "false") await trigger.click();
}

export async function libraryArea(page: Page, area: "foundation" | "job" | "recorded" = "job") {
  const name = { foundation: "AI 基础学习", job: "岗位专项训练", recorded: "手动题目与预测题" }[area];
  const entry = page.getByRole("button", { name, exact: true });
  if (await entry.isVisible()) await entry.click();
  if (area === "foundation") await openDetails(page, "我的基础题回答与复习");
}

/** 行内“更多”菜单：上移/下移/移除等次级操作默认折叠，需先展开再点击。兼容 details/summary 与 shadcn DropdownMenu 两种形态。 */
export async function openRowMenu(row: Locator) {
  const summary = row.locator("summary").filter({ hasText: /^更多$/ }).first();
  if (await summary.isVisible()) {
    if (await summary.locator("..").getAttribute("open") === null) await summary.click();
    return;
  }
  const trigger = row.getByRole("button", { name: "更多", exact: true }).first();
  if (await trigger.isVisible()) await trigger.click();
}

/** 题库单题练习入口：未练习时主操作是“练习这道题”，已确认时是“再次练习这道题”。 */
export async function practiceRecordedQuestion(page: Page) {
  const again = page.getByRole("button", { name: "再次练习这道题", exact: true });
  if (await again.isVisible()) return again.click();
  await page.getByRole("button", { name: "练习这道题", exact: true }).click();
}

/** shadcn Select 选择（题库筛选）：点击触发器后按选项文本选择；语义等同原生 selectOption，但按可见文本定位（跳过页面中隐藏的原生 option）。 */
export async function pickSelectOption(page: Page, label: string, optionText: string) {
  await page.getByRole("combobox", { name: label, exact: true }).click();
  await page.getByRole("option", { name: optionText }).locator("visible=true").first().click();
}

/** 题库详情“更多操作”菜单：拆分/导出/删除等低频操作收纳在 DropdownMenu 中。 */
export async function openLibraryActions(page: Page) {
  await page.getByRole("button", { name: "更多操作", exact: true }).click();
}
