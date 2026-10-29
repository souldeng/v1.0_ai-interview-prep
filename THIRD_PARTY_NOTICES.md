# 第三方依赖与素材

本文件不授予本项目的开源许可。依赖的条款以锁文件对应版本和实际分发的上游 LICENSE、NOTICE 为准，不能用项目许可证替代。

- React、Base UI、Motion、Vite、Tailwind 等保留各包许可；安装源码依赖时不要删去包内通知。
- Geist 字体使用 OFL-1.1，Lucide 图标包含 ISC 及部分 Feather 来源 MIT 通知。
- PDF.js 使用 Apache-2.0；PDF CMap 有独立 Adobe 条款。现有构建插件复制 CMap 及其 LICENSE 到构建目录，分发构建产物时保留。
- Tesseract.js、引擎及语言数据各有自己的许可。OCR 首次从外部资源下载；如另行镜像或打包，应核对实际资源版本与通知。
- axe-core 等开发工具含 MPL-2.0；rimraf 使用 BlueOak-1.0.0。其他直接及间接依赖请查阅 `package-lock.json` 与实际安装包。
- 本仓库发布源码与安装配置，不提交 `node_modules`、`dist`、OCR 模型镜像或私人材料。依赖扫描不是完整许可认证。
- `test-fixtures/public-coach/` 是明确标记虚构的测试反例；历史模型输出留在本地，不作为公开分发材料。
- 若源码采用了第三方模板、生成器或共同作者成果，所有者应核实并保留必要署名。源码路径与扫描结果不能证明完整权属。

项目自身的许可选择与版权主体由所有者确认；请参阅 [README](README.md) 与 [持续同步说明](GITHUB_SYNC.md)。
