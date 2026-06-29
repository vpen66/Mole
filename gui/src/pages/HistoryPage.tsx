import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { History, Trash2, Download, FolderOpen, Zap } from "lucide-react";

interface HistorySession {
  command: string;
  started_at: string;
  ended_at: string;
  items: number;
  size: string;
  operation_count: number;
  actions: {
    removed: number;
    trashed: number;
    skipped: number;
    failed: number;
  };
}

interface HistoryData {
  sessions: HistorySession[];
  total_sessions: number;
}

const commandIcons: Record<string, React.ElementType> = {
  clean: Trash2,
  uninstall: Download,
  purge: FolderOpen,
  optimize: Zap,
};

export function HistoryPage() {
  const [sessions, setSessions] = useState<HistorySession[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    invoke<HistoryData>("get_history", { limit: 50 })
      .then((data) => {
        setSessions(data.sessions ?? []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  return (
    <div className="p-8 max-w-3xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold flex items-center gap-2">
          <History size={20} className="text-surface-300" />
          Operation History
        </h1>
        <p className="text-sm text-surface-400 mt-1">
          Recent cleanup and optimization sessions
        </p>
      </div>

      {loading && (
        <div className="text-sm text-surface-400">Loading history...</div>
      )}

      {!loading && sessions.length === 0 && (
        <div className="text-sm text-surface-400 bg-surface-800 border border-surface-700 rounded-xl p-6 text-center">
          No operation history yet. Run a cleanup or optimization to get started.
        </div>
      )}

      {sessions.length > 0 && (
        <div className="space-y-2">
          {sessions.map((session, idx) => {
            const Icon = commandIcons[session.command] ?? History;
            return (
              <div
                key={idx}
                className="bg-surface-800 border border-surface-700 rounded-lg p-3 flex items-center gap-3"
              >
                <div className="w-8 h-8 bg-surface-700 rounded-lg flex items-center justify-center shrink-0">
                  <Icon size={14} className="text-surface-300" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium capitalize">
                      {session.command}
                    </span>
                    <span className="text-xs text-surface-500">
                      {session.started_at}
                    </span>
                  </div>
                  <div className="text-xs text-surface-400 mt-0.5">
                    {session.items} items, {session.operation_count} operations
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-sm font-medium text-mole-400">
                    {session.size}
                  </div>
                  <div className="text-xs text-surface-500">
                    {session.actions.trashed} trashed, {session.actions.removed}{" "}
                    removed
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
