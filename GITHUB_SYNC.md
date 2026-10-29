# GitHub 持续同步

日常只维护原始开发目录，通过 GitHub Desktop 提交经检查的源码。Git 忽略文件仍保留本地；公开仓库不是私人资料、浏览器数据或上传附件的备份。

## 每次提交前

在项目根目录执行：

```powershell
npm run sync:check
# 可选：与自己已经清理的副本比较，不向副本写文件
npm run sync:check -- --baseline "你的公开版目录"
```

检查器使用临时 Git 数据库验证原生忽略规则，不初始化项目仓库、不暂存、不提交、不推送、不复制文件到公开版。仅将本地报告写到已忽略的 `.local-publication-audit/`。

- `upload-files.txt`、`upload-manifest.csv`：当前存在且未被忽略的文件，附大小与 SHA-256。
- `ignored-files.csv`：每个已忽略文件及实际匹配规则。
- `comparison.csv`：与指定公开副本的新增、删除和内容差异。
- `findings.json`：仅记录路径、行号和风险类型，不记录密钥值或匹配正文。
- `scan-coverage.csv`：内容扫描与跳过范围；`summary.json` 包含 Git 状态、检查边界与阻断项。

退出码非零表示仍有待处理项；退出码零也不代替人工阅读差异、授权确认或 GitHub Desktop 的实际待提交清单。检查器不自动批准发布。

## 范围

允许经审查的源码、安装锁文件、配置、公开说明、测试与七份虚构夹具。内部 `docs/`、设计稿、真实 `.env`、费用日志、备份、原件、浏览器测试报告/录像/trace、依赖及缓存留在本地。脚本与虚构夹具按文件放行。

新功能新增文件时，同时核对 `.gitignore` 与 `release-files.json`。源码目录中新增的普通文本仍可能包含私人内容，必须检查差异；不要用 `git add -f` 绕过规则。忽略规则不能移除已跟踪文件或历史泄露内容。

## 首次使用 GitHub Desktop

1. 先处理检查报告中的密钥、资料、版权和文件完整性问题。项目根目录缺少 LICENSE 时，不把源码公开称为已获得开源复用许可；公开副本的许可证需所有者核对署名和授权后再手工采用。
2. 若目录已有 Git，在 Desktop 使用 **File → Add local repository** 选择原始开发目录。若没有 Git，该入口会提示创建本地仓库；先确认完整路径就是现有项目，不要误建同名子目录。
3. 创建本地仓库可能生成初始提交，故操作前先复核清单；不要用模板覆盖已有 `.gitignore`，不要让工具替你选择许可证。创建后核查 History 和 Changes，确认没有 `.env`、内部文档、日志、备份、真实资料等内容。
4. 对后续更改，在 Changes 阅读逐文件差异、填写说明，再由本人 **Commit to main**（或当前分支）。首次创建的初始提交也应在 History 阅读。
5. 本人决定发布时使用 **Publish repository**；检查名称、账户与可见性，保留私有选项可先发布 Private。检查完成并确认公开权利后才选择 Public。若已经有远程仓库，应先核对其地址与历史，不重复创建或强行覆盖。
6. 后续固定循环：修改源码 → 运行检查及相关测试 → Desktop 审阅差异 → Commit → **Push origin**。发布不会自动同步尚未提交的本地更改。

GitHub Desktop 的提交、推送和发布均由本人执行。首次上传前仍须自行检查账号与远程仓库；本说明不表示远程仓库已经创建。

参考：[添加本地仓库](https://docs.github.com/en/desktop/adding-and-cloning-repositories/adding-a-repository-from-your-local-computer-to-github-desktop)、[发布已有项目](https://docs.github.com/en/desktop/adding-and-cloning-repositories/adding-an-existing-project-to-github-using-github-desktop)。
