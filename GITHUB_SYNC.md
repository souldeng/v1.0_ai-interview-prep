# GitHub 持续同步

日常只维护原始开发目录，通过 GitHub Desktop 提交经检查的源码。Git 忽略文件仍保留本地；公开仓库不是私人资料、浏览器数据或上传附件的备份。

## 每次提交前

在项目根目录执行：

```powershell
npm run sync:check
# 可选：与自己已经清理的副本比较，不向副本写文件
npm run sync:check -- --baseline "你的公开版目录"
```

检查器使用临时 Git 数据库验证原生忽略规则，不初始化项目仓库、不暂存、不提交、不推送、不复制文件到公开版。仅将本地报告写到已忽略的 `.local-publication-audit/`。默认无需公开副本，日常只维护当前目录；`--baseline` 仅用于可选的旧副本比较。

- `upload-files.txt`、`upload-manifest.csv`：工作区候选及 SHA-256；`tracked-files.txt` 为真实 Git 跟踪范围。检查通过要求候选、发布清单与跟踪路径逐项一致。
- `ignored-files.csv`：每个已忽略文件及实际匹配规则。
- `comparison.csv`：与指定公开副本的新增、删除和内容差异。
- `findings.json`：仅记录路径、行号和风险类型，不记录密钥值或匹配正文。
- `scan-coverage.csv`：内容扫描与跳过范围；`summary.json` 包含 Git 状态、检查边界与阻断项。

退出码非零表示仍有待处理项；退出码零也不代替人工阅读差异、授权确认或 GitHub Desktop 的实际待提交清单。检查器还分别扫描暂存内容和可见历史；已经精确核查的两处虚构测试凭据单列，其他密钥及当前本地密钥完整值匹配仍阻断。检查器不自动批准发布。

## 范围

允许经审查的源码、安装锁文件、配置、公开说明、测试与七份虚构夹具。内部 `docs/`、设计稿、真实 `.env`、费用日志、备份、原件、浏览器测试报告/录像/trace、依赖及缓存留在本地。脚本与虚构夹具按文件放行。

新功能新增文件时，同时核对 `.gitignore` 与 `release-files.json`。源码目录中新增的普通文本仍可能包含私人内容，必须检查差异；不要用 `git add -f` 绕过规则。忽略规则不能移除已跟踪文件或历史泄露内容。

## 当前项目的日常操作

当前项目已有本地首次提交与 GitHub 远程仓库，继续使用这个开发目录，无需再创建仓库、复制公开副本或重新整理整个项目。

1. 在当前目录开发，运行 `npm test` 和 `npm run lint`；新增公开文件时核对 `.gitignore` 与 `release-files.json`。
2. 在 GitHub Desktop 的 Changes 逐文件阅读修改，只选择本次需要提交的文件；不要强制添加被忽略的私人文件。使用命令行时，先暂存明确需要的路径。
3. 执行 `npm run sync:check`，核对工作区候选、实际 Git 跟踪范围、暂存内容和历史。新增或删除文件时，先更新范围并暂存再检查；检查器不会替你暂存。
4. 再次阅读将提交的差异，确认没有私人材料或凭据，然后由本人执行 Commit 和 **Push origin**。工具检查通过不代替人工审阅。
5. 被忽略的本地文件与浏览器原件仍需另行备份，GitHub 源码同步不覆盖它们。

检查报告写入 `.local-publication-audit/` 并留在本地。日常检查不需要 `--baseline`，旧公开副本仅作为可选历史参照。

参考：[添加本地仓库](https://docs.github.com/en/desktop/adding-and-cloning-repositories/adding-a-repository-from-your-local-computer-to-github-desktop)、[发布已有项目](https://docs.github.com/en/desktop/adding-and-cloning-repositories/adding-an-existing-project-to-github-using-github-desktop)。
