# Analyze GUI 新增功能

## 概述

为 Mole GUI 的 Analyze（磁盘分析）页面添加了多选、删除和刷新功能，与 CLI 版本 `mo analyze` 的快捷键行为保持一致。

**重要安全特性**：所有删除操作都需要二次确认弹窗，防止误删文件。

## 新增功能

### 1. 多选功能 (Multi-select)
- **复选框选择**：每个条目（目录和文件）左侧显示复选框，点击可选择/取消选择
- **全选/取消全选**：工具栏提供 "Select All" / "Deselect All" 按钮
- **选中状态视觉反馈**：选中的条目背景色变为青色高亮
- **支持文件和目录**：所有条目都可以选择和删除

### 2. 删除功能 (Delete)
- **批量删除**：点击 "Delete" 按钮删除所有选中的项目
- **移动到废纸篓**：使用 `mo delete` 命令将文件移动到 Trash（而非永久删除）
- **安全操作**：删除后自动刷新当前视图
- **错误处理**：显示删除操作的错误信息
- **⚠️ 二次确认**：删除前必须通过确认对话框，防止误操作

### 3. 刷新功能 (Refresh)
- **重新扫描**：点击 "Refresh" 按钮重新扫描当前目录
- **对应 CLI 快捷键**：等同于 CLI 中按 `r` 键的行为
- **清除缓存**：强制重新读取文件系统，不使用缓存数据

## 技术实现

### 后端 (Rust/Tauri)
- 新增 `analyze_delete` Tauri 命令
- 调用 `mo delete <paths...>` 执行实际删除操作
- 流式输出删除进度到前端

### 前端 (React/TypeScript)
- 添加 `selectedPaths` 状态管理选中的路径集合
- 添加 `deleting`、`deleteError` 和 `showDeleteConfirm` 状态跟踪删除操作
- 扩展 `EntryRow` 组件支持复选框交互
- 添加工具栏包含三个操作按钮

### 共享组件 (Reusable Components)
- **DeleteConfirmDialog**: 通用的删除确认对话框组件
  - 位置: `gui/src/components/shared/DeleteConfirmDialog.tsx`
  - 特性:
    - 可自定义标题、消息、按钮文本
    - 显示选中项目数量
    - 加载状态指示器
    - 键盘友好（支持 Enter 确认，Esc 取消）
    - 动画效果（淡入、缩放）
  
- **已使用的页面**:
  - ✅ CleanPage - 使用 ConfirmDialog
  - ✅ UninstallPage - 使用 ConfirmDialog  
  - ✅ PurgePage - 使用 ConfirmDialog
  - ✅ OptimizePage - 使用 ConfirmDialog
  - ✅ AnalyzePage - 使用 DeleteConfirmDialog（新增）

## UI 设计

### 工具栏布局
```
[✓ Select All]  [ Refresh]                    [🗑 Delete (n)]
```

- **所有层级都显示**：概览层和子目录层都会显示工具栏
- 仅当有目录时才显示 "Select All" 按钮
- 删除按钮仅在有选中项时显示
- 操作期间禁用相关按钮防止重复操作

### 条目行样式
```
□ 📁 Application Support    [████████░░] 15GB >
  📄 .DS_Store               [░░░░░░░░░░] 8KB
```

- **对齐布局**：文件和目录的名称、图标完全对齐
- **未选中**：默认深色背景 + 灰色边框
- **已选中**：青色半透明背景 + 青色边框
- **复选框**：所有条目都显示复选框，选中时显示对勾图标

### 删除确认对话框
```
─────────────────────────────────────┐
│ 🗑  Delete Items              ✕     │
├─────────────────────────────────────┤
│ Are you sure you want to move       │
│ 3 items to Trash? This action can   │
│ be undone.                          │
├─────────────────────────────────────┤
│                  [Cancel] [Move to  │
│                                   Trash] │
─────────────────────────────────────┘
```

- 全屏遮罩层（黑色半透明 + 模糊效果）
- 红色主题强调危险操作
- 显示具体数量和说明
- 确认按钮带加载动画
- 支持键盘操作（Enter 确认，Esc 取消）

## 与 CLI 的一致性

| 功能 | CLI (`mo analyze`) | GUI |
|------|-------------------|-----|
| 刷新 | 按 `r` 键 | 点击 "Refresh" 按钮 |
| 多选 | 按空格键切换 | 点击复选框 |
| 删除 | 按 Delete/Backspace | 点击 "Delete" 按钮 |
| 全选 | - | 点击 "Select All" 按钮 |

## 使用场景

1. **清理大文件夹**：扫描磁盘 → 选择多个占用空间大的目录 → 批量删除
2. **精确文件清理**：选择特定大文件（如日志、缓存）→ 单独删除
3. **混合选择**：同时选择文件和目录 → 一次性清理
4. **快速刷新**：修改文件系统后 → 点击刷新查看最新状态

## 注意事项

- **⚠️ 二次确认**：所有删除操作都需要通过确认对话框，防止误删
- 删除操作会将文件移动到废纸篓，可在 Finder 中恢复
- 删除后立即刷新视图以反映最新状态
- **支持所有层级**：在概览层和任意子目录下都可以选择、删除和刷新
- 删除过程中工具栏按钮会被禁用以防止重复操作
- 确认对话框支持键盘快捷操作（Enter 确认，Esc 取消）

## 代码复用

所有需要删除确认的页面都使用了统一的确认对话框组件：

```typescript
// 示例：AnalyzePage 中使用
<DeleteConfirmDialog
  isOpen={showDeleteConfirm}
  itemCount={selectedPaths.size}
  onConfirm={handleDeleteConfirm}
  onCancel={handleDeleteCancel}
  title="Delete Items"
  message={`Are you sure you want to move ${count} items to Trash?`}
/>
```

这种设计确保了：
1. **一致性**：所有页面的删除确认体验统一
2. **可维护性**：修改一处即可影响所有页面
3. **安全性**：强制二次确认，减少误操作风险
4. **可扩展性**：轻松添加新的确认场景
