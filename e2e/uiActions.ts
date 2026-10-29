import type { Page } from "@playwright/test";

/** Explicit user actions for the simplified, opt-in panels; never changes app data. */
export async function openDetails(page: Page, title: string) {
  const summary = page.locator("summary").filter({ hasText: new RegExp(`^${title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`) }).first();
  if (await summary.isVisible() && await summary.locator("..").getAttribute("open") === null) await summary.click();
}

export async function libraryArea(page: Page, area: "foundation" | "job" | "recorded" = "job") {
  const name = { foundation: "AI 基础学习", job: "岗位专项训练", recorded: "真实面试题复练" }[area];
  const entry = page.getByRole("button", { name, exact: true });
  if (await entry.isVisible()) await entry.click();
  if (area === "foundation") await openDetails(page, "我的基础题回答与复习");
}
