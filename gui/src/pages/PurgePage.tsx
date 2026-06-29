import { useEffect, useState } from "react";
import { useMoleCommand } from "@/hooks/useMoleCommand";
import { ProgressBar } from "@/components/shared/ProgressBar";
import { ErrorBanner } from "@/components/shared/ErrorBanner";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { formatSize } from "@/types/common";
import {
  FolderOpen,
  Play,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Package,
} from "lucide-react";
import type { PurgeProject, PurgeResult } from "@/types/purge";

export function PurgePage() {
  const [projects, setProjects] = useState<PurgeProject[]>([]);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [done, setDone] = useState(false);
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(
    new Set()
  );

  const {
    status,
    progress,
    error,
    execute: runScan,
    reset,
  } = useMoleCommand<PurgeResult>({ command: "purge_dry_run" });

  useEffect(() => {
    runScan();
  }, [runScan]);

  const toggleProject = (name: string) => {
    setProjects((prev) =>
      prev.map((p) =>
        p.name === name ? { ...p, selected: !p.selected } : p
      )
    );
  };

  const toggleExpand = (name: string) => {
    setExpandedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const handleExecute = async () => {
    setConfirmOpen(false);
    const targets = projects.filter((p) => p.selected).map((p) => p.name);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("purge_execute", { targets });
      setDone(true);
    } catch (err) {
      console.error(err);
    }
  };

  const selectedProjects = projects.filter((p) => p.selected);
  const selectedSizeKb = selectedProjects.reduce(
    (sum, p) => sum + p.total_size_kb,
    0
  );

  // When scan completes, populate projects from the result
  useEffect(() => {
    if (status === "preview" && projects.length === 0) {
      // Projects will be populated from the command result via Tauri events
    }
  }, [status, projects.length]);

  return (
    <div className="p-8 max-w-3xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold flex items-center gap-2">
          <FolderOpen size={20} className="text-amber-400" />
          Purge Project Artifacts
        </h1>
        <p className="text-sm text-surface-400 mt-1">
          Remove build artifacts like node_modules, .gradle, target directories
        </p>
      </div>

      <ErrorBanner message={error} onDismiss={reset} />
      {status === "scanning" && <ProgressBar events={progress} />}

      {status === "preview" && projects.length > 0 && (
        <>
          <div className="flex items-center justify-between text-xs text-surface-400 pb-1 border-b border-surface-700">
            <span>
              {projects.length} projects found
            </span>
            <span className="text-amber-400 font-medium">
              {formatSize(projects.reduce((s, p) => s + p.total_size_kb, 0))}{" "}
              total
            </span>
          </div>

          <div className="space-y-2 max-h-96 overflow-y-auto">
            {projects
              .sort((a, b) => b.total_size_kb - a.total_size_kb)
              .map((project) => (
                <div
                  key={project.name}
                  className={`rounded-lg border overflow-hidden transition-colors ${
                    project.selected
                      ? "bg-amber-950/20 border-amber-800/50"
                      : "bg-surface-800 border-surface-700"
                  }`}
                >
                  <div className="flex items-center gap-3 p-3">
                    <input
                      type="checkbox"
                      checked={project.selected ?? false}
                      onChange={() => toggleProject(project.name)}
                      className="w-4 h-4 accent-amber-500"
                    />
                    <button
                      onClick={() => toggleExpand(project.name)}
                      className="flex-1 flex items-center gap-2 text-left"
                    >
                      {expandedProjects.has(project.name) ? (
                        <ChevronDown
                          size={14}
                          className="text-surface-400 shrink-0"
                        />
                      ) : (
                        <ChevronRight
                          size={14}
                          className="text-surface-400 shrink-0"
                        />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">
                          {project.name}
                        </div>
                        <div className="text-xs text-surface-500 truncate">
                          {project.path}
                        </div>
                      </div>
                      <span className="text-xs text-amber-400 font-medium shrink-0">
                        {formatSize(project.total_size_kb)}
                      </span>
                    </button>
                  </div>

                  {expandedProjects.has(project.name) &&
                    project.artifacts.length > 0 && (
                      <div className="border-t border-surface-700 divide-y divide-surface-700">
                        {project.artifacts.map((artifact, idx) => (
                          <div
                            key={idx}
                            className="flex items-center justify-between px-10 py-2 text-xs"
                          >
                            <div className="flex items-center gap-2 text-surface-300">
                              <Package size={12} className="text-surface-500" />
                              <span>{artifact.name}</span>
                            </div>
                            <span className="text-surface-500">
                              {artifact.size_human}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                </div>
              ))}
          </div>

          {selectedProjects.length > 0 && (
            <div className="flex items-center justify-between bg-surface-800 border border-surface-600 rounded-xl p-4">
              <div className="text-sm">
                <span className="text-surface-400">Selected: </span>
                <span className="font-medium">
                  {selectedProjects.length} projects (
                  {formatSize(selectedSizeKb)})
                </span>
              </div>
              <button
                onClick={() => setConfirmOpen(true)}
                className="flex items-center gap-2 px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium rounded-lg transition-colors"
              >
                <Play size={14} />
                Purge
              </button>
            </div>
          )}
        </>
      )}

      {status === "preview" && projects.length === 0 && (
        <div className="text-sm text-surface-400 bg-surface-800 border border-surface-700 rounded-xl p-6 text-center">
          No project artifacts found. Your projects are already clean.
        </div>
      )}

      {done && (
        <div className="bg-mole-950/40 border border-mole-800/50 rounded-xl p-4 flex items-center gap-3">
          <CheckCircle2 size={20} className="text-mole-400 shrink-0" />
          <div className="text-sm text-mole-300">
            Purge complete. Build artifacts have been removed.
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmOpen}
        title="Purge Project Artifacts"
        message={`This will remove build artifacts from ${selectedProjects.length} project(s). This action cannot be undone, but artifacts can be rebuilt.`}
        totalSizeKb={selectedSizeKb}
        totalItems={selectedProjects.length}
        onConfirm={handleExecute}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}
