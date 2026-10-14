import React, { useState, useEffect } from "react";
import { Sidebar, navigationItems } from "./components/Sidebar";
import { Navbar } from "./components/Navbar";
import { api, getIstCurrentMonth } from "./api/client";
import { OverviewView } from "./views/OverviewView";
import { TrendsView } from "./views/TrendsView";
import { LeaderboardView } from "./views/LeaderboardView";
import { AttendanceView } from "./views/AttendanceView";
import { EmployeesView } from "./views/EmployeesView";
import { AdminExplainView } from "./views/AdminExplainView";

export default function App() {
  const [activeTab, setActiveTab] = useState("overview");
  const [selectedMonth, setSelectedMonth] = useState(() => getIstCurrentMonth());
  const [attendanceEmpFilter, setAttendanceEmpFilter] = useState("");
  const [isOnline, setIsOnline] = useState(false);
  const [theme, setTheme] = useState(() => {
    return localStorage.getItem("hrone_theme") || "dark";
  });

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "light") {
      root.classList.add("light");
      root.classList.remove("dark");
    } else {
      root.classList.add("dark");
      root.classList.remove("light");
    }
    localStorage.setItem("hrone_theme", theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === "dark" ? "light" : "dark"));
  };

  const navigate = (tab, params = {}) => {
    if (tab === "attendance") {
      setAttendanceEmpFilter(params.emp_code || "");
    }
    setActiveTab(tab);
  };

  useEffect(() => {
    const checkHealth = async () => {
      try {
        const res = await api.getHealth();
        setIsOnline(res.status === "ok");
      } catch {
        setIsOnline(false);
      }
    };
    checkHealth();
    const interval = setInterval(checkHealth, 15000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-slate-900 font-sans">
      <Sidebar activeTab={activeTab} setActiveTab={(t) => navigate(t)} />

      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <Navbar
          isOnline={isOnline}
          selectedMonth={selectedMonth}
          setSelectedMonth={setSelectedMonth}
          theme={theme}
          toggleTheme={toggleTheme}
        />

        {/* Mobile Navigation Strip (visible at <768px including 375px width) */}
        <nav
          aria-label="Mobile Navigation"
          className="md:hidden flex items-center gap-1.5 overflow-x-auto px-3 py-2 bg-slate-950 border-b border-slate-800 shrink-0"
        >
          {navigationItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => navigate(item.id)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition cursor-pointer shrink-0 ${
                  isActive
                    ? "bg-indigo-600/15 text-indigo-400 border border-indigo-500/30"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {item.shortLabel || item.label}
              </button>
            );
          })}
        </nav>

        <main className="flex-1 overflow-y-auto p-3 sm:p-6 bg-slate-900">
          <div className="max-w-7xl mx-auto">
            {activeTab === "overview" && (
              <OverviewView
                selectedMonth={selectedMonth}
                setSelectedMonth={setSelectedMonth}
                onNavigate={navigate}
              />
            )}
            {activeTab === "trends" && <TrendsView />}
            {activeTab === "leaderboard" && <LeaderboardView selectedMonth={selectedMonth} />}
            {activeTab === "attendance" && (
              <AttendanceView
                initialEmpCode={attendanceEmpFilter}
                onClearEmpFilter={() => setAttendanceEmpFilter("")}
              />
            )}
            {activeTab === "employees" && <EmployeesView onNavigate={navigate} />}
            {activeTab === "admin" && <AdminExplainView />}
          </div>
        </main>
      </div>
    </div>
  );
}
