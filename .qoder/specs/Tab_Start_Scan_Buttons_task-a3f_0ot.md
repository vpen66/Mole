# Tab 开始扫描按钮与状态持久化

## 背景

AnalyzePage 已完成改造（使用 `useScanStore` zustand store）。其余 4 个 tab 页面（Clean、Uninstall、Purge、Optimize）都使用 `useMoleCommand` hook + `useEffect` 自动执行，组件卸载时状态丢失。

## Task 1: 重写 `useTabStore.ts`

为 4 个 tab 创建统一的持久化 store，每个 tab 独立的状态切片：

```ts
interface TabState {
  status: CommandStatus;       // idle | scanning | preview | error
  error: string | null;
  progress: ProgressEvent[];
  scanned: boolean;            // 是否已完成过至少一次扫描
}
```

每个 tab 额外存储其页面特有数据：
- **clean**: `sections: GroupedSection[]`
- **uninstall**: `apps: AppInfo[]`
- **purge**: `projects: PurgeProject[]`
- **optimize**: `items: OptimizeItem[]`

Store actions 按 tab 命名空间划分：`setCleanStatus`, `setCleanSections`, `setUninstallApps` 等。

文件: `gui/src/hooks/useTabStore.ts`

## Task 2: 添加 i18n 键

在 `en.ts` 和 `zh.ts` 中为 4 个 tab 各添加：
- `{tab}.startScan` → "Start Scan" / "开始扫描"
- `{tab}.scanningInBackground` → "Scanning in background..." / "后台扫描中..."

文件: `gui/src/i18n/en.ts`, `gui/src/i18n/zh.ts`

## Task 3: 修改 CleanPage

- 移除 `useMoleCommand` 和 `useEffect` 自动执行
- 从 `useTabStore` 读取 status/error/progress/sections
- 添加 `scan()` 函数：直接 `invoke("clean_dry_run")` + `listen("mole-clean_dry_run-event")`，流式更新 sections 到 store
- 初始状态（`!scanned && !loading`）显示居中的"开始扫描"大按钮
- 扫描中且已有结果时显示"后台扫描中..."指示器
- 保留现有的 section 展开/折叠、执行清理等 UI 逻辑

文件: `gui/src/pages/CleanPage.tsx`

## Task 4: 修改 UninstallPage

- 同样移除 `useMoleCommand` + `useEffect`
- 从 store 读取 status/error/apps
- `scan()` 函数：`invoke("uninstall_scan_apps")`，结果存入 store
- 添加"开始扫描"按钮和后台扫描指示器

文件: `gui/src/pages/UninstallPage.tsx`

## Task 5: 修改 PurgePage

- 同样模式
- `scan()` 函数：`invoke("purge_dry_run")`，结果中的 projects 存入 store
- 修复当前 projects 未从 result 填充的问题

文件: `gui/src/pages/PurgePage.tsx`

## Task 6: 修改 OptimizePage

- 同样模式
- `scan()` 函数：`invoke("optimize_dry_run")`，结果中的 optimizations 存入 store

文件: `gui/src/pages/OptimizePage.tsx`

## Task 7: 构建验证

运行 `npm run build` 确保 TypeScript 编译通过，无类型错误。
