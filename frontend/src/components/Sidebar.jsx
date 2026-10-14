import React from "react";
import {
  LayoutDashboard,
  TrendingUp,
  Trophy,
  Users,
  Clock,
  Terminal,
} from "lucide-react";

export const navigationItems = [
  { id: "overview", label: "Executive Overview", shortLabel: "Overview", icon: LayoutDashboard },
  { id: "trends", label: "Department Trends", shortLabel: "Trends", icon: TrendingUp },
  { id: "leaderboard", label: "Late Leaderboard", shortLabel: "Leaderboard", icon: Trophy },
  { id: "attendance", label: "Daily Attendance & Logs", shortLabel: "Attendance", icon: Clock },
  { id: "employees", label: "Employees Directory", shortLabel: "Employees", icon: Users },
  { id: "admin", label: "Query Explain (IXSCAN)", shortLabel: "Explain", icon: Terminal },
];

export function Sidebar({ activeTab, setActiveTab }) {
  return (
    <aside className="hidden md:flex w-64 bg-slate-950 border-r border-slate-800 flex-col shrink-0">
      <div className="p-5 border-b border-slate-800 flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg bg-indigo-600 flex items-center justify-center font-black text-lg text-white shadow-md shadow-indigo-500/20">
          H1
        </div>
        <div>
          <h1 className="font-bold text-white text-base leading-tight">HROne Suite</h1>
          <span className="text-xs text-slate-400 font-medium tracking-wide">Enterprise Analytics</span>
        </div>
      </div>

      <nav className="p-3 space-y-1 flex-1">
        {navigationItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveTab(item.id)}
              className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-sm font-medium transition-all duration-150 cursor-pointer ${
                isActive
                  ? "bg-indigo-600/15 text-indigo-400 border border-indigo-500/30 shadow-sm"
                  : "text-slate-400 hover:text-slate-200 hover:bg-slate-900"
              }`}
            >
              <Icon className={`w-4 h-4 ${isActive ? "text-indigo-400" : "text-slate-500"}`} />
              {item.label}
            </button>
          );
        })}
      </nav>

      <div className="p-4 border-t border-slate-800/80 bg-slate-950/60">
        <div className="text-xs text-slate-500 flex justify-between items-center font-mono">
          <span>Engine v2.0</span>
          <span>Mongo 7.0+</span>
        </div>
      </div>
    </aside>
  );
}
