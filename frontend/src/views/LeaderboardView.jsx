import React, { useState, useEffect } from "react";
import { Trophy, RefreshCw } from "lucide-react";
import { api, friendlyError } from "../api/client";

export function LeaderboardView({ selectedMonth }) {
  const [departments, setDepartments] = useState(["Engineering", "Sales", "Support"]);
  const [department, setDepartment] = useState("");
  const [limit, setLimit] = useState(10);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [leaderboard, setLeaderboard] = useState([]);

  useEffect(() => {
    api
      .fetchAllEmployeesCatalog()
      .then(({ departments: depts }) => {
        if (depts.length > 0) {
          setDepartments(depts);
        }
      })
      .catch(() => {});
  }, []);

  const fetchLeaderboard = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getLeaderboard(selectedMonth, limit, department || null);
      setLeaderboard(data.items || []);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLeaderboard();
  }, [selectedMonth, limit, department]);

  return (
    <div className="space-y-6">
      {/* Filters Bar */}
      <div className="p-5 rounded-xl bg-slate-950 border border-slate-800/80 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-6">
          <div>
            <label
              htmlFor="leaderboard-dept-filter"
              className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1"
            >
              Filter Department
            </label>
            <select
              id="leaderboard-dept-filter"
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
              className="bg-slate-900 border border-slate-700/80 text-sm text-slate-100 rounded-lg px-3 py-1.5 outline-none font-medium cursor-pointer"
            >
              <option value="">All Departments</option>
              {departments.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="leaderboard-limit-range"
              className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1"
            >
              Rank Cutoff (Limit: {limit})
            </label>
            <input
              id="leaderboard-limit-range"
              type="range"
              min="1"
              max="50"
              value={limit}
              onChange={(e) => setLimit(Number(e.target.value))}
              className="cursor-pointer accent-indigo-500 w-36"
            />
          </div>
        </div>

        <button
          type="button"
          onClick={fetchLeaderboard}
          disabled={loading}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-md transition cursor-pointer disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh Leaderboard
        </button>
      </div>

      {error && (
        <div className="p-4 rounded-lg bg-rose-950/40 border border-rose-800 text-rose-300 text-sm">
          {error}
        </div>
      )}

      {/* Leaderboard Table */}
      <div className="p-6 rounded-xl bg-slate-950 border border-slate-800/80 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-base font-bold text-white flex items-center gap-2">
            <Trophy className="w-4 h-4 text-amber-400" />
            Late-Comers Competition Ranking ({selectedMonth})
          </h3>
          <span className="text-xs text-slate-400 font-mono">
            Standard Competition (1, 2, 2, 4) • Ties preserved at cutoff
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-slate-300">
            <thead className="bg-slate-900/80 text-xs uppercase tracking-wider text-slate-400 border-b border-slate-800">
              <tr>
                <th className="py-3 px-4">Rank</th>
                <th className="py-3 px-4">Employee</th>
                <th className="py-3 px-4">Department</th>
                <th className="py-3 px-4">Total Late Minutes</th>
                <th className="py-3 px-4">Late Incidents</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-mono text-xs">
              {leaderboard.length === 0 ? (
                <tr>
                  <td colSpan="5" className="text-center py-8 text-slate-500 font-sans">
                    🎉 Excellent attendance! No late-comers found for {selectedMonth}.
                  </td>
                </tr>
              ) : (
                leaderboard.map((row) => (
                  <tr key={row.emp_code} className="hover:bg-slate-900/40 transition">
                    <td className="py-3 px-4">
                      <span
                        className={`inline-flex items-center justify-center w-7 h-7 rounded-lg font-bold text-xs ${
                          row.rank === 1
                            ? "rank-badge-1 bg-amber-500/20 text-amber-400 border border-amber-500/40"
                            : row.rank === 2
                            ? "rank-badge-2 bg-slate-300/20 text-slate-200 border border-slate-400/40"
                            : row.rank === 3
                            ? "rank-badge-3 bg-amber-700/20 text-amber-500 border border-amber-700/40"
                            : "rank-badge-other bg-slate-800 text-slate-400 border border-slate-700"
                        }`}
                      >
                        #{row.rank}
                      </span>
                    </td>
                    <td className="py-3 px-4 font-sans font-semibold text-slate-100">
                      <div>{row.name}</div>
                      <div className="text-[11px] font-mono text-slate-400 font-normal">
                        {row.emp_code}
                      </div>
                    </td>
                    <td className="py-3 px-4 font-sans text-slate-300">{row.department}</td>
                    <td className="py-3 px-4 text-amber-400 font-bold text-sm">
                      {row.total_late_minutes} min
                    </td>
                    <td className="py-3 px-4 text-slate-400">{row.late_count}</td>
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
