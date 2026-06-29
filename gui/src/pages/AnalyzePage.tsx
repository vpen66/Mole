import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { HardDrive, Folder, File, ChevronRight, ArrowLeft, Eye, Trash2, RotateCcw, CheckCircle } from "lucide-react";
import { formatBytes } from "@/types/analyze";
import type { AnalyzeResult, AnalyzeEntry, AnalyzeLargeFile, AnalyzeStreamEvent } from "@/types/analyze";
import { ErrorBanner } from "@/components/shared/ErrorBanner";
import { DeleteConfirmDialog } from "@/components/shared/DeleteConfirmDialog";

export function AnalyzePage() {
  const [result, setResult] = useState<AnalyzeResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pathStack, setPathStack] = useState<string[]>([]);
  const [entryCount, setEntryCount] = useState(0);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const currentPath = pathStack.length > 0 ? pathStack[pathStack.length - 1] : null;

  const scan = useCallback(async (path?: string) => {
    setLoading(true);
    setError(null);
    setResult(null);
    setEntryCount(0);

    // Accumulate NDJSON streaming events into an AnalyzeResult
    const entries: AnalyzeEntry[] = [];
    const largeFiles: AnalyzeLargeFile[] = [];
    let summaryPath = path ?? "/";
    let isOverview = !path;
    let totalSize = 0;
    let totalFiles: number | undefined;

    // Listen for streaming NDJSON events from the backend
    const unlisten = await listen<AnalyzeStreamEvent>(
      "mole-analyze_scan-event",
      (event) => {
        const payload = event.payload;
        switch (payload.type) {
          case "progress":
            break;
          case "entry":
            entries.push({
              name: payload.name,
              path: payload.path,
              size: payload.size,
              is_dir: payload.is_dir,
              insight: payload.insight,
              cleanable: payload.cleanable,
              last_access: payload.last_access,
            });
            setEntryCount(entries.length);
            // Update result incrementally so entries appear during scanning
            setResult({
              path: summaryPath,
              overview: isOverview,
              entries: [...entries],
              large_files: largeFiles.length > 0 ? [...largeFiles] : undefined,
              total_size: totalSize,
              total_files: totalFiles,
            });
            break;
          case "large_file":
            largeFiles.push({
              name: payload.name,
              path: payload.path,
              size: payload.size,
            });
            break;
          case "summary":
            summaryPath = payload.path;
            isOverview = payload.overview;
            totalSize = payload.total_size;
            totalFiles = payload.total_files;
            break;
        }
      }
    );

    try {
      await invoke<string>("analyze_scan", { path: path ?? null });

      // Final result from accumulated events
      setResult({
        path: summaryPath,
        overview: isOverview,
        entries,
        large_files: largeFiles.length > 0 ? largeFiles : undefined,
        total_size: totalSize,
        total_files: totalFiles,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
      unlisten();
    }
  }, []);

  useEffect(() => {
    scan();
  }, [scan]);

  const handleDrillDown = (entry: AnalyzeEntry) => {
    if (!entry.is_dir) return;
    setPathStack((prev) => [...prev, entry.path]);
    scan(entry.path);
  };

  const handleGoBack = () => {
    const newStack = pathStack.slice(0, -1);
    setPathStack(newStack);
    const parentPath = newStack.length > 0 ? newStack[newStack.length - 1] : undefined;
    scan(parentPath);
  };

  const handleRefresh = useCallback(() => {
    scan(currentPath || undefined);
  }, [scan, currentPath]);

  const handleSelectToggle = (path: string) => {
    setSelectedPaths(prev => {
      const newSet = new Set(prev);
      if (newSet.has(path)) {
        newSet.delete(path);
      } else {
        newSet.add(path);
      }
      return newSet;
    });
  };

  const handleSelectAll = () => {
    if (!result) return;
    // Select all items (both directories and files)
    const allPaths = result.entries.map(e => e.path);
    
    if (selectedPaths.size === allPaths.length && allPaths.length > 0) {
      setSelectedPaths(new Set());
    } else {
      setSelectedPaths(new Set(allPaths));
    }
  };

  const handleDelete = async () => {
    if (selectedPaths.size === 0) return;
    
    // Show confirmation dialog
    setShowDeleteConfirm(true);
  };

  const handleDeleteConfirm = async () => {
    setDeleting(true);
    setDeleteError(null);
    
    try {
      await invoke("analyze_delete", {
        paths: Array.from(selectedPaths),
      });
      
      // Clear selection after successful delete
      setSelectedPaths(new Set());
      
      // Close dialog
      setShowDeleteConfirm(false);
      
      // Refresh the current view
      setTimeout(() => {
        scan(currentPath || undefined);
      }, 500);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : String(err));
      setShowDeleteConfirm(false);
    } finally {
      setDeleting(false);
    }
  };

  const handleDeleteCancel = () => {
    setShowDeleteConfirm(false);
  };

  const sortedEntries = result
    ? [...result.entries].sort((a, b) => b.size - a.size)
    : [];

  const maxSize = sortedEntries[0]?.size ?? 1;

  return (
    <div className="p-8 max-w-4xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold flex items-center gap-2">
          <HardDrive size={20} className="text-cyan-400" />
          Disk Analyzer
        </h1>
        <p className="text-sm text-surface-400 mt-1">
          {currentPath ? (
            <span className="flex items-center gap-1">
              <button
                onClick={handleGoBack}
                className="flex items-center gap-1 text-cyan-400 hover:text-cyan-300 transition-colors"
              >
                <ArrowLeft size={13} />
                Overview
              </button>
              <ChevronRight size={12} className="text-surface-500" />
              <span className="text-surface-300 font-mono text-xs">
                {currentPath}
              </span>
            </span>
          ) : (
            "System disk overview"
          )}
        </p>
      </div>

      <ErrorBanner message={error} onDismiss={() => setError(null)} />
      {deleteError && (
        <ErrorBanner message={deleteError} onDismiss={() => setDeleteError(null)} />
      )}

      {/* Action toolbar */}
      {!loading && result && (
        <div className="flex items-center gap-2">
          {result.entries.length > 0 && (
            <button
              onClick={handleSelectAll}
              disabled={deleting}
              className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium bg-surface-800 border border-surface-700 rounded-lg hover:bg-surface-750 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <CheckCircle size={14} />
              {selectedPaths.size === result.entries.length ? 'Deselect All' : 'Select All'}
            </button>
          )}
          
          <button
            onClick={handleRefresh}
            disabled={deleting || loading}
            className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium bg-surface-800 border border-surface-700 rounded-lg hover:bg-surface-750 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <RotateCcw size={14} />
            Refresh
          </button>
          
          {selectedPaths.size > 0 && (
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium bg-red-600/20 border border-red-600/50 text-red-400 rounded-lg hover:bg-red-600/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed ml-auto"
            >
              <Trash2 size={14} />
              Delete ({selectedPaths.size})
            </button>
          )}
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      <DeleteConfirmDialog
        isOpen={showDeleteConfirm}
        itemCount={selectedPaths.size}
        onConfirm={handleDeleteConfirm}
        onCancel={handleDeleteCancel}
        title="Delete Items"
        confirmText="Move to Trash"
      />

      {loading && !result && (
        <div className="py-12 flex flex-col items-center justify-center gap-4">
          {/* Pulsing scan animation */}
          <div className="relative w-16 h-16">
            <div className="absolute inset-0 rounded-full border-2 border-cyan-400/20" />
            <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-cyan-400 animate-spin" />
            <div className="absolute inset-2 rounded-full border-2 border-transparent border-t-cyan-300 animate-spin" style={{ animationDuration: '1.5s', animationDirection: 'reverse' }} />
            <div className="absolute inset-4 rounded-full border-2 border-transparent border-t-cyan-200 animate-spin" style={{ animationDuration: '2s' }} />
            <HardDrive size={16} className="absolute inset-0 m-auto text-cyan-400" />
          </div>
          <div className="text-sm text-surface-400">
            {currentPath ? "Scanning directory..." : "Scanning system overview..."}
          </div>
        </div>
      )}

      {result && (
        <>
          {/* Scanning indicator */}
          {loading && (
            <div className="flex items-center gap-2 text-xs text-cyan-400">
              <div className="w-3 h-3 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
              <span>Scanning... {entryCount > 0 && `${entryCount} entries found`}</span>
            </div>
          )}

          {/* Summary bar (only when scan complete) */}
          {!loading && (
            <div className="bg-surface-800 border border-surface-700 rounded-xl p-4 flex items-center justify-between">
              <div className="text-sm text-surface-300">
                <span className="font-medium text-white">
                  {formatBytes(result.total_size)}
                </span>
                <span className="text-surface-400 ml-1">
                  {result.overview ? "total used" : "in this directory"}
                </span>
              </div>
              {result.total_files !== undefined && (
                <div className="text-xs text-surface-400">
                  {result.total_files.toLocaleString()} files
                </div>
              )}
            </div>
          )}

          {/* Entries list */}
          <div className="space-y-1">
            {sortedEntries.map((entry) => (
              <EntryRow
                key={entry.path}
                entry={entry}
                maxSize={maxSize}
                onDrillDown={handleDrillDown}
                isSelected={selectedPaths.has(entry.path)}
                onSelectToggle={() => handleSelectToggle(entry.path)}
              />
            ))}
          </div>

          {/* Large files section */}
          {result.large_files && result.large_files.length > 0 && (
            <div className="mt-6">
              <h2 className="text-sm font-medium text-surface-300 mb-2 flex items-center gap-2">
                <File size={14} className="text-amber-400" />
                Large Files
              </h2>
              <div className="space-y-1">
                {result.large_files
                  .sort((a, b) => b.size - a.size)
                  .map((file) => (
                    <div
                      key={file.path}
                      className="flex items-center justify-between px-3 py-2 bg-surface-800 border border-surface-700 rounded-lg text-xs"
                    >
                      <span className="text-surface-300 truncate flex-1 font-mono">
                        {file.name}
                      </span>
                      <span className="text-amber-400 ml-3 shrink-0">
                        {formatBytes(file.size)}
                      </span>
                    </div>
                  ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function EntryRow({
  entry,
  maxSize,
  onDrillDown,
  isSelected = false,
  onSelectToggle,
}: {
  entry: AnalyzeEntry;
  maxSize: number;
  onDrillDown: (e: AnalyzeEntry) => void;
  isSelected?: boolean;
  onSelectToggle?: () => void;
}) {
  const pct = maxSize > 0 ? Math.max(2, (entry.size / maxSize) * 100) : 2;
  const isDir = entry.is_dir;

  return (
    <button
      onClick={() => isDir && onDrillDown(entry)}
      disabled={!isDir}
      className={`w-full flex items-center gap-3 px-3 py-2 border rounded-lg hover:bg-surface-750 transition-colors group text-left disabled:opacity-70 disabled:cursor-default ${
        isSelected
          ? 'bg-cyan-900/30 border-cyan-500/50'
          : 'bg-surface-800 border-surface-700'
      }`}
    >
      {/* Selection checkbox or placeholder for alignment */}
      <div 
        onClick={(e) => {
          e.stopPropagation();
          onSelectToggle?.();
        }}
        className={`flex-shrink-0 w-4 h-4 rounded border flex items-center justify-center cursor-pointer transition-colors ${
          isSelected
            ? 'bg-cyan-500 border-cyan-500'
            : 'border-surface-600 hover:border-surface-500'
        }`}
      >
        {isSelected && <CheckCircle size={12} className="text-white" />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          {isDir ? (
            entry.insight ? (
              <Eye size={13} className="text-purple-400 shrink-0" />
            ) : (
              <Folder size={13} className="text-cyan-400 shrink-0" />
            )
          ) : (
            <File size={13} className="text-surface-400 shrink-0" />
          )}
          <span className="text-sm text-surface-200 truncate">{entry.name}</span>
          {entry.cleanable && (
            <span className="text-[10px] text-green-400 uppercase font-medium shrink-0">
              cleanable
            </span>
          )}
        </div>
        <div className="h-1.5 bg-surface-700 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${
              entry.insight
                ? "bg-purple-500"
                : entry.cleanable
                ? "bg-green-500"
                : "bg-cyan-500"
            }`}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <span className="text-xs font-medium text-surface-300">
          {formatBytes(entry.size)}
        </span>
        {isDir && (
          <ChevronRight
            size={13}
            className="text-surface-500 group-hover:text-surface-300 transition-colors"
          />
        )}
      </div>
    </button>
  );
}
