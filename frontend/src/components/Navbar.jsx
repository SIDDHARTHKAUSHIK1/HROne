import React from "react";
import { Calendar, Sun, Moon } from "lucide-react";

export function Navbar({ isOnline, selectedMonth, setSelectedMonth, theme, toggleTheme }) {
  return (
    <header className="min-h-16 border-b border-slate-800 bg-slate-950/80 backdrop-blur-md px-3 sm:px-6 py-2 flex flex-wrap items-center justify-between gap-2 shrink-0">
      <div className="flex items-center gap-2 sm:gap-3">
        <div className="md:hidden w-7 h-7 rounded-md bg-indigo-600 flex items-center justify-center font-black text-xs text-white shrink-0">
          H1
        </div>
        <span className="hidden sm:inline text-xs uppercase tracking-wider font-semibold text-slate-400">
          Analytics Period
        </span>
        <div className="flex items-center gap-1.5 bg-slate-900 border border-slate-700/60 rounded-lg px-2.5 py-1.5 shadow-inner">
          <Calendar className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          <input
            type="month"
            aria-label="Analytics Period Month"
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            className="bg-transparent text-xs sm:text-sm text-slate-200 outline-none cursor-pointer font-medium"
          />
        </div>
      </div>

      <div className="flex items-center gap-2 sm:gap-3">
        {/* Theme Toggle Button */}
        <button
          type="button"
          onClick={toggleTheme}
          className="theme-toggle-btn flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg border border-slate-700/60 bg-slate-900 hover:bg-slate-800 text-slate-100 hover:text-white transition shadow-sm text-xs font-semibold cursor-pointer"
          title={theme === "dark" ? "Switch to Light Mode" : "Switch to Dark Mode"}
          aria-label="Toggle Theme"
        >
          {theme === "dark" ? (
            <>
              <Sun className="w-4 h-4 text-amber-400" />
              <span className="hidden sm:inline">Light Mode</span>
            </>
          ) : (
            <>
              <Moon className="w-4 h-4 text-indigo-500" />
              <span className="hidden sm:inline">Dark Mode</span>
            </>
          )}
        </button>

        {/* Backend Status Pill */}
        <div
          className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-full text-xs font-semibold border ${
            isOnline
              ? "bg-emerald-950/50 text-emerald-400 border-emerald-800/80"
              : "bg-rose-950/50 text-rose-400 border-rose-800/80"
          }`}
        >
          <span
            className={`w-2 h-2 rounded-full animate-pulse ${
              isOnline ? "bg-emerald-400" : "bg-rose-400"
            }`}
          />
          <span className="hidden xs:inline">{isOnline ? "API Connected" : "API Offline"}</span>
          <span className="xs:hidden">{isOnline ? "Online" : "Offline"}</span>
        </div>
      </div>
    </header>
  );
}
