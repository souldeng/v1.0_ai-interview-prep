import assert from "node:assert/strict";
import test from "node:test";
import type { InterviewProject } from "./domain";
import { deleteProject, loadProjects, saveProject, MAX_PROJECTS, type StorageLike } from "./projectStorage";

function memoryStorage(): StorageLike {
  const values = new Map<string, string>();
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: key => { values.delete(key); },
  };
}

function project(id: string, updatedAt: string): InterviewProject {
  return {
    id,
    company: "示例公司",
    jobTitle: "AI 产品经理",
    jobDescription: "岗位 JD",
    candidateBackground: "个人经历",
    concerns: "",
    analysis: null,
    questions: [],
    status: "ready",
    completedQuestions: 0,
    totalQuestions: 0,
    createdAt: updatedAt,
    updatedAt,
    lastPracticedAt: null,
  };
}

test("项目存储支持新增、更新排序和删除", () => {
  const storage = memoryStorage();
  saveProject(project("a", "2026-09-18T10:00:00.000Z"), storage);
  saveProject(project("b", "2026-09-18T11:00:00.000Z"), storage);
  assert.deepEqual(loadProjects(storage).map(item => item.id), ["b", "a"]);
  saveProject({ ...project("a", "2026-09-18T12:00:00.000Z"), company: "更新后公司" }, storage);
  assert.deepEqual(loadProjects(storage).map(item => item.id), ["a", "b"]);
  assert.equal(loadProjects(storage)[0].company, "更新后公司");
  deleteProject("a", storage);
  assert.deepEqual(loadProjects(storage).map(item => item.id), ["b"]);
});

test("损坏或非项目数据不会让工作台崩溃", () => {
  const storage = memoryStorage();
  storage.setItem("ai-interview-projects-v1", JSON.stringify([null, { id: "broken" }, project("valid", "2026-09-18T10:00:00.000Z")]));
  assert.deepEqual(loadProjects(storage).map(item => item.id), ["valid"]);
  storage.setItem("ai-interview-projects-v1", "{invalid-json");
  assert.deepEqual(loadProjects(storage), []);
});

test("超出项目上限拒绝新增而不是静默删掉旧项目，更新已有项目仍成功", () => {
  const storage = memoryStorage();
  for (let index = 0; index < MAX_PROJECTS; index++) saveProject(project(`p${index}`, "2026-09-18T10:00:00.000Z"), storage);
  const before = storage.getItem("ai-interview-projects-v1");
  assert.throws(() => saveProject(project("overflow", "2026-09-18T11:00:00.000Z"), storage), /上限/);
  assert.equal(storage.getItem("ai-interview-projects-v1"), before);
  assert.equal(saveProject(project("p0", "2026-09-18T12:00:00.000Z"), storage).length, MAX_PROJECTS);
});

test("写入配额失败保留原始存储，异常交由界面显示", () => {
  const storage = memoryStorage();
  saveProject(project("a", "2026-09-18T10:00:00.000Z"), storage);
  const failing: StorageLike = { ...storage, setItem: () => { throw new Error("QuotaExceeded"); } };
  assert.throws(() => saveProject(project("b", "2026-09-18T11:00:00.000Z"), failing), /QuotaExceeded/);
  assert.deepEqual(loadProjects(storage).map(value => value.id), ["a"]);
});
