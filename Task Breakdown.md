# RepoMap 开发任务拆解（Task Breakdown）

> 目标：
> **在不依赖 AI 的前提下，先交付一个“巨大仓库可用、稳定、可复现”的 RepoMap CLI**
> 再逐步为 AI / Agent 工作流提供接口与生态。

------

## 总体阶段划分（Milestones）

- **M0：项目骨架 & 规范**
- **M1：基础扫描 + 模块索引（MVP 可用）**
- **M2：入口识别 + Summary 生成（AI 友好）**
- **M3：增量更新 + 稳定性**
- **M4：查询能力（辅助定位）**
- **M5：工程化 & 开源准备**
- **M6：Agent / Skill 生态适配（可选）**

你可以 **M1–M3 就开源**，已经非常有价值。

------

## M0：项目骨架与工程规范（必须先做）

### T0.1 初始化仓库结构

**目标**：明确这是一个 CLI 工具，而不是脚本合集

- 创建 monorepo 或单 repo
- 明确语言（建议 Node/TS）
- 目录结构：

```text
repomap/
├─ packages/
│  ├─ cli/
│  ├─ core/
│  └─ plugins/
├─ docs/
├─ examples/
└─ README.md
```

**验收标准**

- 能 `npm run dev` 启动 CLI
- 能输出 help 信息

------

### T0.2 CLI 框架搭建

**目标**：确定命令形态，后续不反复改接口

- 选择 CLI 框架（如 commander）
- 定义基础命令：
  - `repomap build`
  - `repomap update`
  - `repomap query`
- 定义全局参数：
  - `--out`
  - `--format`
  - `--ignore`

**验收标准**

- `repomap build --help` 正常
- 参数解析稳定

------

### T0.3 基础配置与版本元信息

**目标**：保证输出可复现、可追踪

- 定义 `meta.json` 结构
- 记录：
  - tool version
  - repo root
  - git commit（若存在）
  - 生成时间
  - hash 算法

------

## M1：仓库扫描 + 模块索引（核心 MVP）

### T1.1 文件系统扫描器（File Walker）

**目标**：稳定、高性能遍历巨大仓库

- 支持：
  - 忽略 `.gitignore`
  - 忽略默认目录（node_modules 等）
  - 自定义 ignore
- 支持符号链接处理策略（默认跳过）

**边界 Case**

- 权限不足文件
- 编码异常
- 超长路径（Windows）

**验收标准**

- 100 万行仓库扫描不崩
- 输出文件列表稳定

------

### T1.2 模块识别逻辑（Module Detector）

**目标**：把“文件堆”变成“模块集合”

- 基于：
  - 目录深度
  - 特征文件（package.json、go.mod、pyproject）
  - monorepo 规则（packages/*）
- 生成 module 基本信息：
  - name
  - path
  - language
  - 文件数量

**边界 Case**

- 单文件仓库
- 混合语言仓库
- 不规则目录结构

**可优化点（后续）**

- workspace 配置解析更完整（turbo.json、project.json 等），支持完整 glob/negate 语义与 brace 展开
- 模块命名读取更多来源（go.mod 的 module 名、pyproject 的 project.name），并支持自定义覆盖
- 语言识别引入文件体积权重与忽略生成目录规则，提高 mixed/unknown 判定准确性
- 模块边界可配置（深度上限、显式 include/exclude、嵌套模块优先级）
- 超大仓库优化为流式单遍分配与更细粒度缓存

------

### T1.3 模块关键词抽取（Keyword Extractor）

**目标**：为后续 AI / 查询提供最小语义锚点

- 从：
  - 文件名
  - 导出符号
  - 路由/接口名（规则匹配）
- 生成关键词列表（不追求语义完美）

**验收标准**

- 每个模块有 ≥3 个关键词（若可能）

------

### T1.4 输出 module_index.json

**目标**：第一个可用产物

- 定义稳定 schema
- 排序规则固定
- 输出到 `.repomap/`

------

## M2：入口识别 + Summary 生成（AI 友好层）

### T2.1 入口文件识别（Entry Detector）

**目标**：回答“从哪里开始看代码”

- 识别类型：
  - Web route
  - controller
  - cli entry
  - job / worker
- 使用启发式规则（文件名 / 路径）

**边界 Case**

- 无明显入口 → unknown
- 多入口模块 → 全部记录

------

### T2.2 Summary 生成器（Human + AI）

**目标**：让 AI 第一眼不迷路

- summary.md 内容结构固定：
  - 仓库概览
  - Top 模块
  - 常见入口
  - 推荐阅读顺序
- 行数限制（≤300）

**验收标准**

- AI 只读 summary 就能说出“这仓库是干嘛的”

------

## M3：增量更新与稳定性（工程关键）

### T3.1 文件变更检测（Hash / mtime）

**目标**：避免全量重跑

- 记录每个文件 hash
- 对比上次 meta
- 标记 add / modify / delete

------

### T3.2 增量模块重建

**目标**：只重算受影响模块

- 文件变更 → 模块变更
- 模块未变 → 直接复用

**边界 Case**

- 模块移动 / 重命名
- 大规模 git checkout

------

### T3.3 输出稳定性保障

**目标**：避免无意义 diff

- JSON key 顺序固定
- 列表排序规则固定
- 时间字段集中在 meta

------

## M4：查询能力（辅助定位）

### T4.1 Query Engine（非语义）

**目标**：快速定位“可能相关模块”

- 在 module_index / entry_map / keywords 搜索
- 返回模块 + 路径

```bash
repomap query "refresh token"
```

------

### T4.2 Query 输出格式

- human-readable（终端）
- json（给 agent）

------

## M5：工程化 & 开源准备

### T5.1 README（30 秒上手）

必须包含：

- 安装
- build / update
- 输出示例
- AI 使用建议

------

### T5.2 Examples（真实仓库）

- 中型 repo
- monorepo 示例
- 输出对比

------

### T5.3 CI / Lint / Release

- lint
- basic tests
- GitHub Actions
- version bump

------

## M6（可选）：Agent / Skill 生态适配

### T6.1 Codex Skill 模板

- `.codex/skills/repomap/SKILL.md`
- 说明何时调用 repomap

------

### T6.2 MCP Server（高级）

- 读 `.repomap/`
- 提供 `getModules / query` 接口

------

## 最终交付物清单（Checklist）

-  repomap CLI 可安装
-  `.repomap/` 输出稳定
-  100 万行可跑
-  summary.md AI 友好
-  增量更新可用
-  README 清晰

------

> RepoMap 的第一目标不是“聪明”，而是“稳定 + 可复现”。**
> 一旦 AI 信任它的结构输出，你这个工具就会变成“基础设施”。
