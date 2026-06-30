# Analyze 扫描进度显示修复

## 问题描述

Analyze 页面在扫描时只显示 "Scanning system overview..." 和一个旋转的加载图标，用户无法看到扫描的实际进展，不知道是否正在工作。

## 根本原因

`analyze_scan` Tauri 命令使用的是 `run_mole_capture_with_timeout`（阻塞式调用），会等待整个扫描完成后才返回结果。而其他功能（如 clean、uninstall）都使用了 `run_mole_streaming_with_timeout`，可以实时发送进度事件到前端。

## 解决方案

### 后端修改 (`gui/src-tauri/src/commands/mod.rs`)

将 `analyze_scan` 从阻塞式改为流式输出：

```rust
#[tauri::command]
pub async fn analyze_scan(window: Window, path: Option<String>) -> Result<String, String> {
    let window_clone = window.clone();

    let handle = tokio::spawn(async move {
        let mut args = vec!["analyze", "--json"];
        let path_ref;
        if let Some(ref p) = path {
            path_ref = p.as_str();
            args.push(path_ref);
        }

        // Use streaming to show real-time progress
        let result = process::run_mole_streaming_with_timeout(
            &args,
            ANALYZE_TIMEOUT_SECS,
            move |line| {
                emit_mole_event(&window_clone, "mole-analyze_scan-event", &line);
            },
        )
        .await;

        match result {
            Ok(streaming) => {
                if streaming.timed_out {
                    return Err(format!(
                        "Analyze scan timed out after {}s. Showing partial results.",
                        ANALYZE_TIMEOUT_SECS
                    ));
                }
                Ok(String::new())
            }
            Err(e) => Err(e),
        }
    });

    handle.await.map_err(|e| format!("Task error: {}", e))?
}
```

**关键变化：**
1. 添加 `Window` 参数用于发送事件
2. 使用 `run_mole_streaming_with_timeout` 替代 `run_mole_capture_with_timeout`
3. 每收到一行输出就通过 `emit_mole_event` 发送到前端
4. 超时处理更加明确

### 前端修改 (`gui/src/pages/AnalyzePage.tsx`)

添加实时进度监听和显示：

```typescript
const [scanProgress, setScanProgress] = useState<string[]>([]);

const scan = useCallback(async (path?: string) => {
  setLoading(true);
  setError(null);
  setScanProgress([]);

  // Listen for streaming events from the backend
  const unlisten = await listen<{ type: string; section?: string; message?: string }>(
    "mole-analyze_scan-event",
    (event) => {
      console.log("Analyze event:", event.payload);
      if (event.payload.type === "progress") {
        const msg = event.payload.message || event.payload.section;
        if (msg) {
          setScanProgress((prev) => [...prev.slice(-9), msg]); // Keep last 10 messages
        }
      }
    }
  );

  try {
    const raw = await invoke<string>("analyze_scan", { path: path ?? null });
    
    if (raw && raw.trim()) {
      const parsed = JSON.parse(raw) as AnalyzeResult;
      setResult(parsed);
    }
  } catch (err) {
    setError(err instanceof Error ? err.message : String(err));
  } finally {
    setLoading(false);
    unlisten();
  }
}, []);
```

**UI 改进：**
```tsx
{loading && (
  <div className="py-8 space-y-4">
    <div className="flex items-center gap-3 text-sm text-surface-400">
      <div className="w-4 h-4 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
      {currentPath ? "Scanning directory..." : "Scanning system overview..."}
    </div>
    {/* Real-time progress log */}
    {scanProgress.length > 0 && (
      <div className="bg-surface-800 border border-surface-700 rounded-lg p-3 max-h-48 overflow-y-auto">
        <div className="text-xs text-surface-500 mb-2 font-medium">Scan Progress:</div>
        <div className="space-y-1">
          {scanProgress.map((msg, idx) => (
            <div key={idx} className="text-xs text-surface-300 font-mono truncate">
              {msg}
            </div>
          ))}
        </div>
      </div>
    )}
  </div>
)}
```

## 效果

现在 Analyze 页面会：
1. ✅ 显示旋转的加载图标
2. ✅ **实时显示扫描进度日志**（最近 10 条消息）
3. ✅ 用户可以清楚地看到扫描正在进行的目录和文件
4. ✅ 与 Clean、Uninstall 等其他功能的体验保持一致

## 测试方法

1. 启动 GUI 应用：`cd gui && npm run tauri dev`
2. 点击左侧导航栏的 "Analyze"
3. 观察扫描过程中是否显示实时的进度信息
4. 确认最终结果正常显示

## 注意事项

- `run_mole_capture_with_timeout` 函数现在未使用，可以考虑移除或保留以备将来需要
- 进度消息保留了最近的 10 条，避免界面过于拥挤
- 使用等宽字体显示路径，便于阅读
