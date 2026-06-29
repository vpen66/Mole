import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Trash2,
  Download,
  FolderOpen,
  Zap,
  HardDrive,
  Clock,
} from "lucide-react";
import { formatSize } from "@/types/common";
import type { MoleVersion } from "@/types/common";
import { useNavigate } from "react-router-dom";

const quickActions = [
  {
    icon: Trash2,
    label: "Clean System",
    desc: "Remove caches and leftovers",
    to: "/clean",
    color: "text-green-400",
    bg: "bg-green-950/30",
  },
  {
    icon: Download,
    label: "Uninstall Apps",
    desc: "Remove apps and remnants",
    to: "/uninstall",
    color: "text-blue-400",
    bg: "bg-blue-950/30",
  },
  {
    icon: FolderOpen,
    label: "Purge Projects",
    desc: "Clean build artifacts",
    to: "/purge",
    color: "text-amber-400",
    bg: "bg-amber-950/30",
  },
  {
    icon: Zap,
    label: "Optimize",
    desc: "System maintenance tasks",
    to: "/optimize",
    color: "text-purple-400",
    bg: "bg-purple-950/30",
  },
  {
    icon: HardDrive,
    label: "Analyze Disk",
    desc: "Explore disk usage visually",
    to: "/analyze",
    color: "text-cyan-400",
    bg: "bg-cyan-950/30",
  },
];

export function DashboardPage() {
  const navigate = useNavigate();
  const [version, setVersion] = useState<MoleVersion | null>(null);
  const [freeSpace, setFreeSpace] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    
    async function fetchData() {
      try {
        const versionData = await invoke<MoleVersion>("get_mole_version");
        if (mounted) {
          setVersion(versionData);
        }
      } catch (err) {
        console.error("Failed to get Mole version:", err);
        // Don't set to null on error - keep existing state or show loading
      }
      
      try {
        const spaceData = await invoke<number>("get_free_space_kb");
        if (mounted) {
          setFreeSpace(spaceData);
        }
      } catch (err) {
        console.error("Failed to get free space:", err);
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }
    
    fetchData();
    
    return () => {
      mounted = false;
    };
  }, []);

  return (
    <div className="p-8 space-y-8 max-w-4xl">
      <div>
        <h1 className="text-xl font-semibold">Welcome to Mole</h1>
        <p className="text-sm text-surface-400 mt-1">
          macOS system cleanup and optimization toolkit
        </p>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-surface-800 border border-surface-700 rounded-xl p-4 flex items-center gap-3">
          <div className="w-10 h-10 bg-surface-700 rounded-lg flex items-center justify-center">
            <HardDrive size={18} className="text-surface-300" />
          </div>
          <div>
            <div className="text-xs text-surface-400">Free Disk Space</div>
            <div className="text-sm font-semibold">
              {freeSpace !== null ? formatSize(freeSpace) : "--"}
            </div>
          </div>
        </div>

        <div className="bg-surface-800 border border-surface-700 rounded-xl p-4 flex items-center gap-3">
          <div className="w-10 h-10 bg-surface-700 rounded-lg flex items-center justify-center">
            <Clock size={18} className="text-surface-300" />
          </div>
          <div>
            <div className="text-xs text-surface-400">Mole CLI</div>
            <div className="text-sm font-semibold">
              {loading ? (
                <span className="text-surface-500">Loading...</span>
              ) : version?.installed ? (
                `v${version.version}`
              ) : (
                "Not installed"
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Quick actions */}
      <div>
        <h2 className="text-sm font-medium text-surface-300 mb-3">
          Quick Actions
        </h2>
        <div className="grid grid-cols-2 gap-3">
          {quickActions.map(({ icon: Icon, label, desc, to, color, bg }) => (
            <button
              key={to}
              onClick={() => navigate(to)}
              className="bg-surface-800 border border-surface-700 rounded-xl p-4 flex items-start gap-3 text-left hover:border-surface-500 hover:bg-surface-750 transition-all group"
            >
              <div
                className={`w-9 h-9 ${bg} rounded-lg flex items-center justify-center shrink-0`}
              >
                <Icon size={16} className={color} />
              </div>
              <div>
                <div className="text-sm font-medium group-hover:text-white transition-colors">
                  {label}
                </div>
                <div className="text-xs text-surface-400 mt-0.5">{desc}</div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {!loading && !version?.installed && (
        <div className="bg-yellow-950/30 border border-yellow-800/40 rounded-xl p-4 text-sm text-yellow-300">
          <strong>Mole CLI not found.</strong> Please install Mole first:
          <code className="block mt-2 text-xs bg-surface-900 p-2 rounded font-mono">
            /bin/bash -c "$(curl -fsSL
            https://raw.githubusercontent.com/tw93/Mole/main/install.sh)"
          </code>
        </div>
      )}
    </div>
  );
}
