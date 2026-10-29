import assert from "node:assert/strict";
import test from "node:test";
import { canOpenWorkbenchModule, isJobWorkbenchModule } from "./JobWorkbench";

test("岗位准备只接受三个预定义模块", () => {
  assert.equal(isJobWorkbenchModule("materials"), true);
  assert.equal(isJobWorkbenchModule("training"), true);
  assert.equal(isJobWorkbenchModule("overview"), false);
  assert.equal(isJobWorkbenchModule("unknown"), false);
});

test("岗位准备入口不把缺失的训练材料伪装成可用", () => {
  assert.equal(canOpenWorkbenchModule("materials", false, false, false), true);
  assert.equal(canOpenWorkbenchModule("analysis", false, false, false), false);
  assert.equal(canOpenWorkbenchModule("training", true, false, false), true);
});
