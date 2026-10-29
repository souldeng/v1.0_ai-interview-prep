# 隔离浏览器回归

使用已安装的项目依赖，不读取日常浏览器存储，不在真实资料上测试删除或恢复：

```powershell
npx playwright install chromium
npm run test:ui
```

三视口：1440×960桌面、800×900窄屏、Pixel 5模拟手机。测试进程使用4174端口独立Vite服务，HMR关闭；不复用正在运行的用户服务。每个测试为独立匿名上下文。模型在网络边界Mock，或明确配置为不可用；不因此宣称真实技术点评合格。

覆盖：三个一级页面和岗位三个模块、资料查看/编辑/确认/安全删除、批量资料核对、来源隔离、保存分析/陈旧提示、推荐题直达/返回、手录题复练、首答/追问/重答/最终答案、失败/取消/草稿与容量整理、下载及部分axe检查。

发布收尾专项：

```powershell
npx playwright test e2e/release-candidate.spec.ts
```

专项包括短答/空白、备份范围及下载名、日常未提交首答刷新、切题取消/新轮次和存储失败。零回答会话现在也在原历史中保存，占原20条额度；满额时先整理再开始，不自动淘汰。

生产静态预览（不是带真实API的Express服务）：

```powershell
npm run build
$env:PLAYWRIGHT_PRODUCTION='1'
$env:PLAYWRIGHT_HTML_OUTPUT_DIR='playwright-report-production-local'
npx playwright test e2e/release-candidate.spec.ts --output=test-results-production-local
```

真实OCR仅在明确需要联网下载语言资源时另行设置 `RUN_LIVE_OCR=1`。默认跳过3项真实OCR，旧批量/基础学习/语音流程部分窄屏和手机用例仍跳过；跳过不算通过。麦克风、音色、中文长图准确率、系统阅读器和真实模型仍需本人验收。

公开回归使用 `test-fixtures/public-coach/` 中全新虚构的负向输入与响应；七份历史模型输出仍留在被排除的本地目录，测试已不依赖它们。Mock 不证明真实模型质量，不新增模型费用。详见[test-fixtures说明](../test-fixtures/README.md)。

截图、trace、视频和报告是本地证据，不自动批准视觉基准，也不默认进入发布白名单。保留失败证据，不用批量批准新截图的方法“通过”回归。
