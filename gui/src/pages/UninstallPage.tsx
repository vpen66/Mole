import { useEffect, useState } from "react";
import { useMoleCommand } from "@/hooks/useMoleCommand";
import { ProgressBar } from "@/components/shared/ProgressBar";
import { ErrorBanner } from "@/components/shared/ErrorBanner";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { formatSize } from "@/types/common";
import {
  Download,
  Play,
  CheckCircle2,
  Search,
  Square,
  CheckSquare,
  AlertTriangle,
} from "lucide-react";
import type { AppInfo } from "@/types/uninstall";

export function UninstallPage() {
  const [apps, setApps] = useState<AppInfo[]>([]);
  const [search, setSearch] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [done, setDone] = useState(false);

  const {
    status,
    progress,
    error,
    execute: runScan,
    reset,
  } = useMoleCommand<AppInfo[]>({ command: "uninstall_scan_apps" });

  useEffect(() => {
    const scanApps = async () => {
      const result = await runScan();
      if (result) {
        setApps(result);
      }
    };
    scanApps();
  }, [runScan]);

  const toggleApp = (name: string) => {
    setApps((prev) =>
      prev.map((a) => (a.name === name ? { ...a, selected: !a.selected } : a))
    );
  };

  const selectAll = () => {
    const allSelected = apps.every((a) => a.selected);
    setApps((prev) => prev.map((a) => ({ ...a, selected: !allSelected })));
  };

  const handleExecute = async () => {
    setConfirmOpen(false);
    const targets = apps.filter((a) => a.selected).map((a) => a.name);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("uninstall_execute", { targets });
      setDone(true);
    } catch (err) {
      console.error(err);
    }
  };

  const selectedApps = apps.filter((a) => a.selected);
  const selectedSizeKb = selectedApps.reduce((sum, a) => sum + a.size_kb, 0);

  const filteredApps = apps.filter((a) =>
    a.name.toLowerCase().includes(search.toLowerCase())
  );

  const scanResult = status === "preview" && apps.length === 0;

  return (
    <div className="p-8 max-w-3xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold flex items-center gap-2">
          <Download size={20} className="text-blue-400" />
          Uninstall Apps
        </h1>
        <p className="text-sm text-surface-400 mt-1">
          Select apps to remove along with their leftover files
        </p>
      </div>

      <ErrorBanner message={error} onDismiss={reset} />
      {status === "scanning" && <ProgressBar events={progress} />}

      {scanResult && (
        <div className="text-sm text-surface-400">
          Scanning installed applications...
        </div>
      )}

      {status === "preview" && apps.length > 0 && (
        <>
          {/* Search and select all */}
          <div className="flex items-center gap-3">
            <div className="relative flex-1">
              <Search
                size={14}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-400"
              />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search apps..."
                className="w-full bg-surface-800 border border-surface-600 rounded-lg pl-9 pr-3 py-2 text-sm text-surface-100 placeholder:text-surface-500 focus:outline-none focus:border-mole-600"
              />
            </div>
            <button
              onClick={selectAll}
              className="text-xs text-surface-400 hover:text-surface-200 transition-colors shrink-0"
            >
              {apps.every((a) => a.selected) ? "Deselect all" : "Select all"}
            </button>
          </div>

          {/* App list */}
          <div className="space-y-1 max-h-96 overflow-y-auto">
            {filteredApps.map((app) => (
              <button
                key={app.name}
                onClick={() => toggleApp(app.name)}
                className={`w-full flex items-center gap-3 p-3 rounded-lg text-left transition-colors ${
                  app.selected
                    ? "bg-blue-950/30 border border-blue-800/50"
                    : "bg-surface-800 border border-surface-700 hover:border-surface-500"
                }`}
              >
                <div className="shrink-0">
                  {app.selected ? (
                    <CheckSquare size={16} className="text-blue-400" />
                  ) : (
                    <Square size={16} className="text-surface-500" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium truncate">
                      {app.name}
                    </span>
                    {app.is_running && (
                      <span className="text-[10px] bg-yellow-900/40 text-yellow-400 px-1.5 py-0.5 rounded uppercase font-medium">
                        running
                      </span>
                    )}
                    {app.is_blocked && (
                      <AlertTriangle
                        size={12}
                        className="text-red-400 shrink-0"
                      />
                    )}
                  </div>
                  <div className="text-xs text-surface-500 truncate">
                    {app.bundle_id}
                  </div>
                </div>
                <span className="text-xs text-surface-400 shrink-0">
                  {formatSize(app.size_kb)}
                </span>
              </button>
            ))}
          </div>

          {/* Execute button */}
          {selectedApps.length > 0 && (
            <div className="flex items-center justify-between bg-surface-800 border border-surface-600 rounded-xl p-4">
              <div className="text-sm">
                <span className="text-surface-400">Selected: </span>
                <span className="font-medium">
                  {selectedApps.length} apps ({formatSize(selectedSizeKb)})
                </span>
              </div>
              <button
                onClick={() => setConfirmOpen(true)}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors"
              >
                <Play size={14} />
                Uninstall
              </button>
            </div>
          )}
        </>
      )}

      {done && (
        <div className="bg-mole-950/40 border border-mole-800/50 rounded-xl p-4 flex items-center gap-3">
          <CheckCircle2 size={20} className="text-mole-400 shrink-0" />
          <div className="text-sm text-mole-300">
            Uninstall complete. Apps and leftovers have been removed.
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmOpen}
        title="Uninstall Selected Apps"
        message={`This will remove ${selectedApps.length} app(s) and their associated files. App bundles will be moved to Trash.`}
        totalSizeKb={selectedSizeKb}
        totalItems={selectedApps.length}
        onConfirm={handleExecute}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}
