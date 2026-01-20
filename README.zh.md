# RepoMap

[中文](README.zh.md) | [English](README.md)

RepoMap 是一个 CLI 工具，用于生成大型仓库的稳定、可复现结构地图。
它面向超大 monorepo，帮助 AI 或人类在改代码前快速掌握结构。

## 状态

核心的 build/update/query 流程已实现，见下方快速开始。

## 背景

随着 AI (Codex / Claude / GPT) 开始参与真实工程代码修改，在 10 万到 100 万行以上代码仓中出现了严重瓶颈：

- AI 无法快速理解代码仓整体结构
- AI 定位修改点高度依赖猜关键词，准确率低
- 单纯的向量 RAG 在大仓库中召回泛化严重，入口定位不准
- 不同仓库结构差异巨大，Agent 缺乏稳定先验
- 每次任务都重新扫描仓库，成本高且不可复现

目前缺少一个工程级、可复用、可增量更新的“仓库结构地图 (Repo Map)”工具，作为 AI 修改代码前的基础设施层。

## 目标

- 为大型代码仓生成结构化仓库地图
- 作为 AI / Agent 修改代码前的定位与理解基础
- 支持增量更新，适配持续演进的大仓库
- 输出人类可读 + AI 可消费的标准化产物

## 用户

1. 使用 Codex / Claude Code / AI Agent 的工程师
2. 维护中大型 monorepo 的技术团队
3. 构建 prd2code / agent workflow 的平台型开发者
4. CI / 自动化系统 (只读运行)

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

`repomap update` 会刷新输出并写入 `file_changes.json`。

示例输出在 `examples/` 目录中。

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

## 性能 

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

## 发布 (维护者)

```bash
# 确保 packages/core 与 packages/cli 的版本已更新
pnpm -r build

cd packages/core
npm publish --access public

cd ../cli
npm publish --access public
```

## AI 使用建议

1. 先看 `summary.md` 获取整体结构
2. 用 `repomap query` 收敛到 1-3 个模块
3. 查看 `entry_map.json` 找到入口文件
4. 用 `rg` 或编辑器深入定位
