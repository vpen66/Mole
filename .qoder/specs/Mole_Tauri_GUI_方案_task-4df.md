# Mole GUI 应用实现方案

## Context

用户希望将 Mole CLI 工具包装为带 GUI 的桌面应用，避免在终端操作。Mole 的 Go 组件（analyze/status）已有 `--json` 输出，但 Shell 组件（clean/uninstall/purge/optimize）仅支持终端彩色文本输出，需要为 GUI 场景添加机器可读的 JSON 输出模式。

## 核心架构决策

**方案**: Tauri v2 (Rust 后端) + React 18 + TypeScript + Vite + TailwindCSS/shadcn

**关键决策**:
- Shell 命令添加 `--json` flag（不改变现有 CLI 行为），输出 NDJSON 流式数据
- Tauri Rust 后端通过 `tokio::process::Command` 调用 Mole CLI，逐行解析 NDJSON 并通过 Tauri 事件推送到前端
- GUI 不捆绑 Mole CLI，检测系统已安装版本（启动时版本检查）
- sudo 认证复用现有 `lib/core/sudo.sh` 的 GUI 模式（自动触发 osascript 对话框）

## Task 1: Shell 层 JSON 输出基础设施

### 1.1 创建 `lib/core/json_output.sh`（新增 ~150 行）

JSON 序列化辅助函数库，参考现有 `lib/core/history.sh` 的 `history_json_string` 等模式：
- `json_escape` / `json_string_field` / `json_number_field` / `json_bool_field`
- `json_array_start` / `json_array_end` / `json_object_start` / `json_object_end`
- `json_progress_event` -- 输出单行 NDJSON 进度事件（用于流式输出）

### 1.2 为 `bin/clean.sh` 添加 `--json`

- 新增 `JSON_OUTPUT=false` 变量，`main()` 的 case 块处理 `--json`
- 修改 `start_section` / `end_section`：JSON 模式时输出 section 事件
- 修改 `safe_clean()`（第 883-966 行结果输出分支）：JSON 模式时收集到全局数组
- 修改 `perform_cleanup()` 总结阶段：JSON 模式时输出完整 JSON 总结

JSON 结构示例：
```json
{"type":"progress","section":"System","message":"Scanning..."}
{"type":"item","section":"App caches","description":"Chrome cache","size_kb":524288,"status":"cleaned"}
{"type":"summary","total_size_kb":2097152,"total_items":156,"sections":[...]}
```

### 1.3 为 `bin/uninstall.sh` 添加两阶段 `--json`

拆分为两步命令（替代终端交互菜单）：
- **阶段 1** `mole uninstall --json`：仅扫描，返回应用列表 JSON
- **阶段 2** `mole uninstall --json --dry-run --targets "App1|App2"`：预览选定应用的卸载计划
- **阶段 3** `mole uninstall --json --targets "App1|App2"`：实际执行

### 1.4 为 `bin/optimize.sh` 添加 `--json`

改动最小，已有 `health_json.sh` 基础设施。

### 1.5 为 `bin/purge.sh` 添加 `--json`

中等复杂度，输出扫描到的项目及其构建产物列表。

### 1.6 编写 Bats 测试

验证每个命令的 `--json` 输出是合法 JSON，且 dry-run 模式正确。

## Task 2: Tauri 项目初始化 + Rust 后端

### 2.1 项目结构

在 Mole 仓库内创建 `gui/` 子目录：

```
gui/
├── src/                          # React 前端
├── src-tauri/
│   ├── src/
│   │   ├── main.rs               # 入口
│   │   ├── lib.rs                # 命令注册
│   │   ├── commands/             # Tauri IPC 命令
│   │   │   ├── clean.rs
│   │   │   ├── uninstall.rs
│   │   │   ├── purge.rs
│   │   │   ├── optimize.rs
│   │   │   └── history.rs
│   │   ├── mole/
│   │   │   ├── process.rs        # 进程管理：spawn, NDJSON stream, kill
│   │   │   ├── json_parser.rs    # NDJSON 流解析
│   │   │   └── sudo.rs           # sudo 会话检测
│   │   └── error.rs
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   └── capabilities/default.json
├── package.json
├── vite.config.ts
└── tailwind.config.ts
```

### 2.2 核心 Rust 模块

**`mole/process.rs`** - 进程管理：
- 自动检测 Mole 安装路径（PATH / Homebrew / ~/.local/bin）
- `run_streaming()` 方法：异步执行命令 + 逐行读取 stdout + NDJSON 解析回调
- 支持取消（tokio CancellationToken + SIGTERM）

**Tauri IPC 命令清单**:

| 命令 | 对应 CLI |
|------|---------|
| `clean_dry_run` / `clean_execute` | `mole clean --dry-run --json` / `mole clean --json` |
| `uninstall_scan_apps` | `mole uninstall --json` |
| `uninstall_preview` / `uninstall_execute` | `mole uninstall --json --dry-run --targets` / `mole uninstall --json --targets` |
| `purge_dry_run` / `purge_execute` | `mole purge --dry-run --json` / `mole purge --json` |
| `optimize_dry_run` / `optimize_execute` | `mole optimize --dry-run --json` / `mole optimize --json` |
| `get_history` | `mole history --json` |
| `get_mole_version` / `check_sudo_session` | 版本和权限检查 |

## Task 3: 前端开发

### 3.1 核心交互流程（状态机）

```
IDLE → SCANNING (dry-run) → PREVIEW (展示结果) → CONFIRMING (确认对话框)
  → EXECUTING (真实执行) → COMPLETE (摘要)
```

### 3.2 核心 Hook: `useMoleCommand`

封装 Tauri `invoke()` + 事件监听，返回 `{ data, isLoading, progress, error, execute, cancel }`。

### 3.3 页面路由

| 路径 | 功能 |
|------|------|
| `/` | Dashboard：磁盘空间、上次清理时间、快速操作 |
| `/clean` | Clean：自动 dry-run 扫描 → 按 section 分组展示 → 确认执行 |
| `/uninstall` | Uninstall：应用网格/列表 → 勾选 → 卸载预览 → 确认执行 |
| `/purge` | Purge：项目列表 → 展开查看产物 → 确认执行 |
| `/optimize` | Optimize：系统健康面板 + 优化项开关列表 → 确认执行 |
| `/history` | 操作历史日志 |

### 3.4 技术栈

- React 18 + TypeScript + Vite
- shadcn/ui + TailwindCSS（UI 组件）
- TanStack Query v5（异步状态管理）
- React Router v7

## Task 4: 打包与分发

- Tauri 原生 DMG 打包
- 启动时检测 Mole CLI 是否已安装，未安装则展示安装引导
- Apple Developer 签名 + 公证
- `.github/workflows/gui-release.yml` CI/CD

## 预估工时

| 阶段 | 时间 |
|------|------|
| Shell 层 `--json` 输出 | 2-3 周 |
| Tauri 后端 + 项目初始化 | 2 周 |
| 前端开发 | 3-4 周 |
| 打包与发布 | 1 周 |
| **总计** | **8-10 周** |

## 风险与注意事项

- Shell `safe_clean()` 内部混合了输出与逻辑，需仔细分离输出分支
- Uninstall 两阶段间应用状态可能变化（被启动/关闭），执行前需重新检查
- sudo 在 WKWebView 进程中的 osascript 对话框行为需要实际测试
- 大量清理项的高频 NDJSON 事件需要前端节流处理
- 遵循 AGENTS.md 产品方向：GUI 是 CLI 的补充界面，不添加 CLI 不支持的功能
