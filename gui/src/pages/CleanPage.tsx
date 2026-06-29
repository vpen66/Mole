import { useEffect, useState } from "react";
import { useMoleCommand } from "@/hooks/useMoleCommand";
import { ProgressBar } from "@/components/shared/ProgressBar";
import { ErrorBanner } from "@/components/shared/ErrorBanner";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { formatSize } from "@/types/common";
import {
  Trash2,
  Play,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import type { CleanResult } from "@/types/clean";
import type { ItemEvent, SummaryEvent } from "@/types/common";

interface GroupedSection {
  name: string;
  items: ItemEvent[];
  totalKb: number;
}

export function CleanPage() {
  const [sections, setSections] = useState<GroupedSection[]>([]);
  const [, setSummary] = useState<SummaryEvent | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [done, setDone] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    new Set()
  );

  const {
    status,
    progress,
    error,
    execute: runDryRun,
    reset,
  } = useMoleCommand<CleanResult>({
    command: "clean_dry_run",
    onEvent: (event) => {
      if (event.type === "item") {
        const item = event as ItemEvent;
        setSections((prev) => {
          const existing = prev.find((s) => s.name === item.section);
          if (existing) {
            existing.items.push(item);
            existing.totalKb += item.size_kb;
            return [...prev];
          }
          return [
            ...prev,
            { name: item.section, items: [item], totalKb: item.size_kb },
          ];
        });
      } else if (event.type === "summary") {
        setSummary(event as SummaryEvent);
      }
    },
  });

  useEffect(() => {
    runDryRun();
  }, [runDryRun]);

  const toggleSection = (name: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const handleExecute = async () => {
    setConfirmOpen(false);

    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke<CleanResult>("clean_execute");
      setDone(true);
    } catch (err) {
      console.error(err);
    }
  };

  const totalSizeKb = sections.reduce((sum, s) => sum + s.totalKb, 0);
  const totalItems = sections.reduce((sum, s) => sum + s.items.length, 0);

  return (
    <div className="p-8 max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <Trash2 size={20} className="text-green-400" />
            System Clean
          </h1>
          <p className="text-sm text-surface-400 mt-1">
            Scan and remove caches, leftovers, and reclaimable files
          </p>
        </div>
        {status === "preview" && !done && (
          <button
            onClick={() => setConfirmOpen(true)}
            disabled={totalSizeKb === 0}
            className="flex items-center gap-2 px-4 py-2 bg-mole-600 hover:bg-mole-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
          >
            <Play size={14} />
            Execute Cleanup
          </button>
        )}
      </div>

      <ErrorBanner message={error} onDismiss={reset} />

      {status === "scanning" && <ProgressBar events={progress} />}

      {done && (
        <div className="bg-mole-950/40 border border-mole-800/50 rounded-xl p-4 flex items-center gap-3">
          <CheckCircle2 size={20} className="text-mole-400 shrink-0" />
          <div>
            <div className="text-sm font-medium text-mole-300">
              Cleanup complete
            </div>
            <div className="text-xs text-surface-400 mt-0.5">
              Operation finished successfully
            </div>
          </div>
        </div>
      )}

      {/* Sections list */}
      {sections.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs text-surface-400 pb-1 border-b border-surface-700">
            <span>
              {sections.length} categories, {totalItems} items
            </span>
            <span className="text-mole-400 font-medium">
              {formatSize(totalSizeKb)} reclaimable
            </span>
          </div>

          {sections.map((section) => (
            <div
              key={section.name}
              className="bg-surface-800 border border-surface-700 rounded-lg overflow-hidden"
            >
              <button
                onClick={() => toggleSection(section.name)}
                className="w-full flex items-center justify-between p-3 hover:bg-surface-750 transition-colors"
              >
                <div className="flex items-center gap-2">
                  {expandedSections.has(section.name) ? (
                    <ChevronDown size={14} className="text-surface-400" />
                  ) : (
                    <ChevronRight size={14} className="text-surface-400" />
                  )}
                  <span className="text-sm">{section.name}</span>
                  <span className="text-xs text-surface-500">
                    ({section.items.length})
                  </span>
                </div>
                <span className="text-xs font-medium text-mole-400">
                  {formatSize(section.totalKb)}
                </span>
              </button>

              {expandedSections.has(section.name) && (
                <div className="border-t border-surface-700 divide-y divide-surface-700">
                  {section.items.map((item, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between px-8 py-2 text-xs"
                    >
                      <span className="text-surface-300 truncate flex-1">
                        {item.description}
                      </span>
                      <div className="flex items-center gap-2 ml-3 shrink-0">
                        <span className="text-surface-500">
                          {item.size_human}
                        </span>
                        {item.status === "dry_run" && (
                          <span className="text-yellow-400 text-[10px] uppercase font-medium">
                            dry
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={confirmOpen}
        title="Execute Cleanup"
        message="This will permanently delete the selected items. Files will be moved to Trash where possible."
        totalSizeKb={totalSizeKb}
        totalItems={totalItems}
        onConfirm={handleExecute}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}
