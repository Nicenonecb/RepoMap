# RepoMap

[中文](README.zh.md) | [English](README.md)

RepoMap 是一个 CLI 工具，用于生成大型仓库的稳定、可复现结构地图。
它帮助 AI 或人类在改代码前快速理解仓库结构。

## 概览

在 10 万到 100 万行以上的大型仓库中，AI 和开发者会遇到明显瓶颈：

- 难以快速理解整体结构
- 定位改动点高度依赖猜关键词
- 单纯依靠向量 RAG 容易召回泛化、入口不准
- 仓库结构差异大，缺少稳定先验
- 每次全量扫描成本高且不可复现

RepoMap 提供工程级、可增量的“仓库结构地图”，
作为改代码前的基础设施层。

## 这个工具能帮你做什么

- 为大型仓库生成稳定、可复现的结构地图
- 在改动之前快速定位可能的模块与入口
- 用增量方式持续更新仓库地图
- 同时输出人类可读与工具可消费的产物

## 适用人群

1. 使用 Codex / Claude Code / AI Agent 的工程师
2. 维护中大型 monorepo 与平台代码的团队
3. 构建 prd2code 或 agent workflow 的平台型开发者
4. 在 CI 或自动化系统中进行只读分析的场景

## 特性

- 输出顺序稳定，避免无意义 diff
- 支持增量更新并记录文件变化
- 模块识别 + 关键词抽取
- 入口识别 (路由、控制器、服务、CLI、任务/Worker)
- query/show/explain 提供人类输出与 JSON
- 支持 .gitignore + 默认忽略 + CLI ignore
- 统一 POSIX 路径输出

## 安装 (npm)

```bash
npm i -g @repo-map/repomap
repomap build --out .repomap
repomap query "refresh token" --out .repomap
```

## 快速开始 (源码)

```bash
pnpm install
pnpm -r build
node packages/cli/dist/index.js build --out .repomap
node packages/cli/dist/index.js query "refresh token" --out .repomap
```

## CLI 命令

- `repomap build`: 生成新的 RepoMap
- `repomap update`: 增量更新 (复用稳定输出)
- `repomap query "<text>"`: 按 name/path/keywords/entry 路径查询
- `repomap show`: 列出模块 + 入口 + 关键词
- `repomap explain "<text>"`: 基于 query 展开模块详情

全局参数：

- `--out <path>` 输出目录 (默认 `.repomap`)
- `--format <name>` 输出格式 (`json` 或 `human`，query/show/explain 默认 `human`)
- `--ignore <pattern>` 忽略规则 (可重复)
- `--limit <count>` query 结果上限
- `--min-score <score>` query 最低分
- `--max-keywords <count>` 人类输出中每模块的关键词数量上限
- `--max-entries <count>` 人类输出中每入口类型的路径数量上限

Show 参数：

- `--module <path>` 按模块路径精确过滤 (可重复)
- `--path-prefix <prefix>` 按模块路径前缀过滤

## 输出产物

`repomap build` 会生成：

- `meta.json`: 运行元信息 (版本、repoRoot、commit)
- `file_index.json`: 稳定文件列表 + 内容哈希
- `module_index.json`: 模块 + 关键词 + 文件数
- `entry_map.json`: 模块入口文件
- `summary.md`: AI 友好摘要

输出目录结构：

```text
.repomap/
├── meta.json
├── file_index.json
├── module_index.json
├── entry_map.json
└── summary.md
```

`repomap update` 会刷新输出并写入 `file_changes.json`。

## 示例流程

```bash
repomap build --out .repomap
repomap show --out .repomap --path-prefix packages/
repomap query "refresh token" --out .repomap
repomap explain "refresh token" --out .repomap --format json
```

## 手动验证 (无 CI)

```bash
pnpm -r build
node packages/cli/dist/index.js build --out .repomap
node packages/cli/dist/index.js query "auth token" --out .repomap

cd examples/medium-repo
GIT_DIR=/dev/null GIT_CEILING_DIRECTORIES="$(pwd)" \
  node ../../packages/cli/dist/index.js build --out output-tmp \
  --ignore "output/**" --ignore "output-tmp/**"
diff -u output/module_index.json output-tmp/module_index.json
diff -u output/entry_map.json output-tmp/entry_map.json
diff -u output/summary.md output-tmp/summary.md

cd ../monorepo
GIT_DIR=/dev/null GIT_CEILING_DIRECTORIES="$(pwd)" \
  node ../../packages/cli/dist/index.js build --out output-tmp \
  --ignore "output/**" --ignore "output-tmp/**"
diff -u output/module_index.json output-tmp/module_index.json
diff -u output/entry_map.json output-tmp/entry_map.json
diff -u output/summary.md output-tmp/summary.md
```

预期：`diff` 命令无输出。

## 性能 (示例)

Repo: microsoft/vscode @ e08522417da0fb5500b053f45a67ee4825f63de4
Files: 8,694 (`rg --files | wc -l`)
Machine: macOS 14.3 (Darwin 24.3.0, arm64)
Node: v22.17.1
RepoMap: 0.1.0

命令：
```
/usr/bin/time -p repomap build --out .repomap
```

结果：
```
real 1.16
user 0.92
sys  0.62
```

输出哈希 (SHA-256)：
- module_index.json: d267fb6274947538a26460a927670bc4bce62ad923f4dbdd8c3f67fa45a52a54
- entry_map.json: 0cfaf7396087a5e2a3aea8b57ff14cf49f619fcd7f0002d87ac011ff08711ce9
- summary.md: 29ebca4c364470e56fa53ea9560bc1e79dcab95b38d1d15be5478faa9475054a

注：耗时因硬件与仓库规模而异；哈希用于说明输出稳定。

## 路线图

- 优化入口识别规则与数据模型提示
- 增强 query 的人类可读性与定位能力
- 补充真实仓库示例与对比
- 可选的 CI 工作流，保证可复现

## 发布 (维护者)

```bash
# 确保 packages/core 与 packages/cli 的版本已更新
pnpm -r build

cd packages/core
npm publish --access public

cd ../cli
npm publish --access public
```

## 贡献

欢迎提交 issue 和 PR，请包含：

- 变更描述
- 复现步骤或测试方式
- 如有行为变化，请更新文档

## License

MIT，见 `LICENSE`。

## AI 使用建议

1. 先看 `summary.md` 获取整体结构
2. 用 `repomap query` 收敛到 1-3 个模块
3. 查看 `entry_map.json` 找到入口文件
4. 用 `rg` 或编辑器深入定位
