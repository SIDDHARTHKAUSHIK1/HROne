import React, { useState, useEffect } from "react";
import {
  Users,
  Clock,
  AlertTriangle,
  CalendarCheck,
  Briefcase,
  RefreshCw,
  Sparkles,
  ArrowRight,
} from "lucide-react";
import { api, friendlyError } from "../api/client";
import { PunchPanel } from "../components/PunchPanel";

export function OverviewView({ selectedMonth, setSelectedMonth, onNavigate }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [summaryData, setSummaryData] = useState([]);

  const fetchSummary = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getDepartmentSummary(selectedMonth);
      setSummaryData(data.items || []);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSummary();
  }, [selectedMonth]);

  const totalHeadcount = summaryData.reduce((acc, d) => acc + d.headcount, 0);
  const totalPresentDays = summaryData.reduce((acc, d) => acc + d.present_days, 0);
  const totalLateMinutes = summaryData.reduce((acc, d) => acc + d.total_late_minutes, 0);

  const avgWorkHours =
    summaryData.filter((d) => d.avg_work_hours !== null).length > 0
      ? (
          summaryData.reduce((acc, d) => acc + (d.avg_work_hours || 0), 0) /
          summaryData.filter((d) => d.avg_work_hours !== null).length
        ).toFixed(2)
      : "N/A";

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight">Executive Attendance Overview</h2>
          <p className="text-sm text-slate-400">
            Monthly aggregate telemetry across all departments for {selectedMonth}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          {selectedMonth !== "2026-07" && setSelectedMonth && (
            <button
              type="button"
              onClick={() => setSelectedMonth("2026-07")}
              className="btn-secondary inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-200 text-xs font-semibold border border-slate-700 transition cursor-pointer"
            >
              Load Sample Month (2026-07)
            </button>
          )}
          <button
            type="button"
            onClick={fetchSummary}
            disabled={loading}
            className="btn-secondary inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-100 text-xs font-semibold border border-slate-700 transition cursor-pointer shadow-sm disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            Refresh Metrics
          </button>
        </div>
      </div>

      {/* Interactive Demo Lifecycle Flow Hint Card */}
      <div className="p-4 rounded-xl bg-slate-950 border border-slate-800/80 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 text-xs">
          <span className="px-2 py-1 rounded-md bg-indigo-950/50 border border-indigo-800 text-indigo-400 font-bold inline-flex items-center gap-1 shrink-0">
            <Sparkles className="w-3.5 h-3.5" /> Demo Flow
          </span>
          <div className="flex flex-wrap items-center gap-1.5 text-slate-300 font-medium">
            <button
              type="button"
              onClick={() => onNavigate?.("employees")}
              className="hover:text-indigo-400 underline decoration-indigo-500/40 cursor-pointer"
            >
              1) Add employee
            </button>
            <ArrowRight className="w-3 h-3 text-slate-500" />
            <span>2) Punch in at a custom late time</span>
            <ArrowRight className="w-3 h-3 text-slate-500" />
            <span>3) Punch out after shift end</span>
            <ArrowRight className="w-3 h-3 text-slate-500" />
            <button
              type="button"
              onClick={() => onNavigate?.("leaderboard")}
              className="hover:text-indigo-400 underline decoration-indigo-500/40 cursor-pointer"
            >
              4) Check Leaderboard &amp; Trends
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="p-4 rounded-lg bg-rose-950/40 border border-rose-800/80 text-rose-300 text-sm">
          {error}
        </div>
      )}

      {/* Metric Cards Deck */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-5 rounded-xl bg-slate-950 border border-slate-800/80 flex items-center justify-between">
          <div>
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Total Headcount</span>
            <div className="text-2xl font-black text-white mt-1">{totalHeadcount}</div>
            <span className="text-[11px] text-slate-500 font-medium">Includes zero-log employees (R9)</span>
          </div>
          <div className="icon-badge icon-badge-indigo w-11 h-11 rounded-xl bg-indigo-500/15 border border-indigo-500/30 flex items-center justify-center text-indigo-400 shrink-0 shadow-xs">
            <Users className="w-5 h-5" />
          </div>
        </div>

        <div className="p-5 rounded-xl bg-slate-950 border border-slate-800/80 flex items-center justify-between">
          <div>
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Present Days</span>
            <div className="text-2xl font-black text-emerald-400 mt-1">{totalPresentDays.toFixed(1)}</div>
            <span className="text-[11px] text-slate-500 font-medium">Mon–Fri working days (half-day: 0.5)</span>
          </div>
          <div className="icon-badge icon-badge-emerald w-11 h-11 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shrink-0 shadow-xs">
            <CalendarCheck className="w-5 h-5" />
          </div>
        </div>

        <div className="p-5 rounded-xl bg-slate-950 border border-slate-800/80 flex items-center justify-between">
          <div>
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Avg Work Hours</span>
            <div className="text-2xl font-black text-sky-400 mt-1">{avgWorkHours}</div>
            <span className="text-[11px] text-slate-500 font-medium">Record-level mean (Half-up R4)</span>
          </div>
          <div className="icon-badge icon-badge-sky w-11 h-11 rounded-xl bg-sky-500/15 border border-sky-500/30 flex items-center justify-center text-sky-400 shrink-0 shadow-xs">
            <Clock className="w-5 h-5" />
          </div>
        </div>

        <div className="p-5 rounded-xl bg-slate-950 border border-slate-800/80 flex items-center justify-between">
          <div>
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Total Late Time</span>
            <div className="text-2xl font-black text-amber-400 mt-1">{totalLateMinutes} m</div>
            <span className="text-[11px] text-slate-500 font-medium">Over 10m grace period (R2)</span>
          </div>
          <div className="icon-badge icon-badge-amber w-11 h-11 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0 shadow-xs">
            <AlertTriangle className="w-5 h-5" />
          </div>
        </div>
      </div>

      {/* Reusable Punch In / Punch Out Panel */}
      <PunchPanel onChange={fetchSummary} onNavigate={onNavigate} />

      {/* Department Breakdown Table */}
      <div className="p-6 rounded-xl bg-slate-950 border border-slate-800/80 space-y-4">
        <h3 className="text-base font-bold text-white flex items-center gap-2">
          <Briefcase className="w-4 h-4 text-indigo-400" />
          Department Rollup Statistics ({selectedMonth})
        </h3>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-slate-300">
            <thead className="bg-slate-900/80 text-xs uppercase tracking-wider text-slate-400 border-b border-slate-800">
              <tr>
                <th className="py-3 px-4">Department</th>
                <th className="py-3 px-4">Headcount</th>
                <th className="py-3 px-4">Present Days</th>
                <th className="py-3 px-4">Avg Work Hours</th>
                <th className="py-3 px-4">Late Records</th>
                <th className="py-3 px-4">Total Late (min)</th>
                <th className="py-3 px-4">Leaves</th>
                <th className="py-3 px-4">On Duty</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-mono text-xs">
              {summaryData.length === 0 ? (
                <tr>
                  <td colSpan="8" className="text-center py-6 text-slate-500 font-sans">
                    No department data found for {selectedMonth}.
                  </td>
                </tr>
              ) : (
                summaryData.map((d) => (
                  <tr key={d.department} className="hover:bg-slate-900/40 transition">
                    <td className="py-3 px-4 font-sans font-semibold text-slate-100">{d.department}</td>
                    <td className="py-3 px-4">{d.headcount}</td>
                    <td className="py-3 px-4 text-emerald-400 font-semibold">{d.present_days.toFixed(2)}</td>
                    <td className="py-3 px-4 text-sky-400">
                      {d.avg_work_hours !== null ? d.avg_work_hours.toFixed(2) : "—"}
                    </td>
                    <td className="py-3 px-4">{d.late_count}</td>
                    <td className="py-3 px-4 text-amber-400 font-semibold">{d.total_late_minutes}</td>
                    <td className="py-3 px-4 text-slate-400">{d.leave_count}</td>
                    <td className="py-3 px-4 text-indigo-400">{d.on_duty_count}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
