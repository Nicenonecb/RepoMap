# RepoMap 项目需求文档（PRD）

## 1. 背景与问题定义（Background）

随着 AI（Codex / Claude / GPT）开始参与真实工程代码修改，在 **10 万～100 万行以上代码仓**中出现了严重瓶颈：

1. AI 无法快速理解代码仓整体结构
2. AI 定位修改点高度依赖“猜关键词”，准确率低
3. 单纯的向量 RAG 在大仓库中 **召回泛化严重、入口定位不准**
4. 不同仓库结构差异巨大，Agent 缺乏“稳定先验”
5. 每次任务都重新扫描仓库，成本高、不可复现

目前缺少一个**工程级、可复用、可增量更新**的“仓库结构地图（Repo Map）”工具，作为 **AI 修改代码前的基础设施层**。

------

## 2. 产品目标（Goals）

### 2.1 核心目标

构建一个 **RepoMap CLI 工具**，用于：

- 为大型代码仓生成 **结构化仓库地图**
- 作为 **AI / Agent 修改代码前的定位与理解基础**
- 支持 **增量更新**，适配持续演进的大仓库
- 输出 **人类可读 + AI 可消费** 的标准化产物

### 2.2 非目标（Non-Goals）

以下内容**明确不在本项目一期范围内**：

- ❌ 自动修改代码
- ❌ 自动生成 PR / 提交代码
- ❌ 完整语义理解（RepoMap ≠ LLM）
- ❌ 取代 IDE / LSP
- ❌ 构建完整向量 RAG 系统（可对接，但不内置）

------

## 3. 目标用户（Target Users）

1. 使用 Codex / Claude Code / AI Agent 的工程师
2. 维护 **中大型 monorepo** 的技术团队
3. 构建 prd2code / agent workflow 的平台型开发者
4. CI / 自动化系统（只读运行）

------

## 4. 使用场景（Use Cases）

### UC-1：AI 定位改动点

> 用户：
> “帮我在这个仓库里给登录流程加 refresh token”

AI 行为：

1. 先读取 RepoMap summary
2. 决定可能涉及的模块
3. 再结合 rg / symbol / RAG 精定位

### UC-2：人类快速理解陌生仓库

- 新成员加入
- 接手遗留项目
- Review 外包代码

### UC-3：Agent 工作流前置步骤

- PRD → Spec → RepoMap → Code Locate → Patch Plan

------

## 5. 核心功能需求（Functional Requirements）

------

### FR-1：仓库扫描与模块识别（Module Index）

#### 描述

工具应扫描仓库目录结构，生成 **模块级索引**。

#### 输出

```
module_index.json
{
  "modules": [
    {
      "name": "auth",
      "path": "src/modules/auth",
      "type": "backend-module",
      "entry_files": ["controller.ts", "service.ts"],
      "keywords": ["login", "token", "refresh"],
      "language": "typescript"
    }
  ]
}
```

#### 规则

- 模块可基于目录规则、配置文件、语言约定推断
- 不强制要求准确业务语义，但必须**稳定**

#### 边界 Case

- 单文件项目（无模块目录）→ 整体视为 1 个模块
- monorepo → 每个 package 为独立模块
- 混合语言 → 分模块记录 language

------

### FR-2：入口文件与职责推断（Entry & Responsibility）

#### 描述

识别模块中的 **入口文件与职责类型**：

- Web 路由
- Controller
- Service
- CLI entry
- Job / Worker

#### 输出

```
entry_map.json
```

#### 边界 Case

- 没有明显入口 → 标记为 `unknown-entry`
- 多入口模块 → 全部列出
- 约定不统一 → 降级为文件名规则

------

### FR-3：仓库摘要生成（Human + AI Friendly）

#### 描述

生成一个 **summary.md**，作为 AI 的第一读取文件。

#### 内容要求

- 仓库整体结构说明
- Top 模块及职责
- 常见入口路径
- 核心数据模型文件
- 推荐定位顺序（例如：路由 → controller → service）

#### 边界 Case

- 超大仓库 → summary 不超过 300 行
- 信息不确定 → 使用“可能 / 推测”标注

------

### FR-4：忽略规则（Ignore Rules）

#### 描述

支持忽略不应被索引的文件/目录。

#### 支持来源

- `.gitignore`
- CLI 参数 `--ignore`
- 内置默认规则（node_modules, dist, build 等）

#### 边界 Case

- 用户显式要求索引 node_modules → 允许
- 符号链接 → 默认不追踪（可配置）

------

### FR-5：增量更新（Incremental Update）

#### 描述

支持基于文件 hash / mtime 的增量更新。

#### 行为

- 未变化文件 → 不重新分析
- 删除文件 → 从索引中移除
- 重命名 → 视为 delete + add

#### 边界 Case

- Git checkout 分支切换 → 需全量校验
- CI 环境无 git → fallback 到 mtime

------

### FR-6：查询接口（Query）

#### 描述

提供简单查询能力：

```bash
repomap query "refresh token"
```

#### 行为

- 在 module_index / entry_map / keywords 中检索
- 返回候选模块 + 文件路径

#### 非目标

- ❌ 深度语义搜索（留给 RAG）

------

## 6. 非功能需求（Non-Functional Requirements）

### NFR-1：性能

- 100 万行代码，首次扫描 ≤ 2 分钟
- 增量更新 ≤ 10 秒（常规改动）

### NFR-2：可复现性

- 同一 commit → 相同输出
- 输出顺序稳定（避免 diff 噪音）

### NFR-3：跨平台

- macOS / Linux / Windows
- CI 可运行

### NFR-4：安全

- 默认只读
- 不执行仓库内脚本
- 不解析不可信二进制

------

## 7. 配置与 CLI 设计（Interface）

```bash
repomap build
repomap update
repomap query "<text>"
```

### 参数

- `--format json|md`
- `--ignore`
- `--lang ts,py,go`
- `--out .repomap/`

------

## 8. 输出目录结构（Artifacts）

```text
.repomap/
├── module_index.json
├── entry_map.json
├── summary.md
├── meta.json        # 版本 / hash / 生成时间
```

------

## 9. 错误处理与降级策略（Edge & Failure Cases）

| 场景         | 行为                   |
| ------------ | ---------------------- |
| 仓库无源码   | 输出空模块             |
| 文件编码异常 | 跳过并记录             |
| 解析失败     | fallback 为文本模式    |
| 超时         | 输出部分结果 + warning |
| 权限不足     | 标记 skipped           |

------

## 10. 与 AI / Agent 的协作定位（意义）

RepoMap 在 AI 工作流中充当：

> **“结构先验层（Structural Prior）”**

- 在 RAG 之前使用
- 在 rg 搜索之前缩小范围
- 在 Agent 决策阶段作为稳定参考

------

## 11. 成功指标（Success Metrics）

- AI 定位文件命中率 ↑
- AI 首次改动正确率 ↑
- 人工修正次数 ↓
- 大仓库修改时间 ↓

------

## 12. 后续扩展（Future Work）

- AST 插件（TS/Go）
- symbol graph
- LSP 对接
- MCP server 形态
- 官方 Codex / Claude Skill 模板