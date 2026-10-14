import React, { useState, useEffect } from "react";
import { TrendingUp, RefreshCw } from "lucide-react";
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
} from "recharts";
import { api, friendlyError, getIstToday, getPreviousDateStr } from "../api/client";

export function TrendsView() {
  const [departments, setDepartments] = useState(["Engineering", "Sales", "Support"]);
  const [department, setDepartment] = useState("Engineering");
  const [fromDate, setFromDate] = useState("2026-07-06");
  const [toDate, setToDate] = useState("2026-07-19");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [trendData, setTrendData] = useState([]);

  useEffect(() => {
    api
      .fetchAllEmployeesCatalog()
      .then(({ departments: depts }) => {
        if (depts.length > 0) {
          setDepartments(depts);
          if (!depts.includes(department)) {
            setDepartment(depts[0]);
          }
        }
      })
      .catch(() => {});
  }, []);

  const handleFromDateChange = (val) => {
    setFromDate(val);
    if (!val) return;
    if (toDate && toDate < val) {
      setToDate(val);
    } else if (toDate) {
      const dFrom = new Date(val);
      const dTo = new Date(toDate);
      const diffDays = Math.ceil((dTo - dFrom) / (1000 * 60 * 60 * 24)) + 1;
      if (diffDays > 92) {
        const maxD = new Date(dFrom);
        maxD.setDate(maxD.getDate() + 91);
        setToDate(maxD.toISOString().slice(0, 10));
      }
    }
  };

  const handleToDateChange = (val) => {
    setToDate(val);
    if (!val) return;
    if (fromDate && val < fromDate) {
      setFromDate(val);
    } else if (fromDate) {
      const dFrom = new Date(fromDate);
      const dTo = new Date(val);
      const diffDays = Math.ceil((dTo - dFrom) / (1000 * 60 * 60 * 24)) + 1;
      if (diffDays > 92) {
        const minD = new Date(dTo);
        minD.setDate(minD.getDate() - 91);
        setFromDate(minD.toISOString().slice(0, 10));
      }
    }
  };

  const fetchTrend = async () => {
    if (!department || !fromDate || !toDate) return;
    if (toDate < fromDate) {
      setError("'To Date' cannot be before 'From Date'. Please adjust the range.");
      return;
    }
    const dFrom = new Date(fromDate);
    const dTo = new Date(toDate);
    const diffDays = Math.ceil((dTo - dFrom) / (1000 * 60 * 60 * 24)) + 1;
    if (diffDays > 92) {
      setError(`Date range (${diffDays} days) cannot exceed 92 days. Please choose a range within 92 days.`);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const data = await api.getDepartmentTrend(department, fromDate, toDate);
      setTrendData(data.items || []);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTrend();
  }, [department, fromDate, toDate]);

  const setCurrentWeekRange = () => {
    const today = getIstToday();
    let start = today;
    for (let i = 0; i < 6; i++) {
      start = getPreviousDateStr(start);
    }
    setFromDate(start);
    setToDate(today);
  };

  const setLast30DaysRange = () => {
    const today = getIstToday();
    let start = today;
    for (let i = 0; i < 29; i++) {
      start = getPreviousDateStr(start);
    }
    setFromDate(start);
    setToDate(today);
  };

  return (
    <div className="space-y-6">
      {/* Controls */}
      <div className="p-5 rounded-xl bg-slate-950 border border-slate-800/80 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label
              htmlFor="trend-dept-select"
              className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1"
            >
              Department
            </label>
            <select
              id="trend-dept-select"
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
              className="bg-slate-900 border border-slate-700/80 text-sm text-slate-100 rounded-lg px-3 py-1.5 outline-none font-medium cursor-pointer"
            >
              {departments.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="trend-from-date"
              className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1"
            >
              From Date
            </label>
            <input
              id="trend-from-date"
              type="date"
              value={fromDate}
              max={toDate || undefined}
              onChange={(e) => handleFromDateChange(e.target.value)}
              className="bg-slate-900 border border-slate-700/80 text-sm text-slate-100 rounded-lg px-2.5 py-1.5 outline-none font-medium"
            />
          </div>

          <div>
            <label
              htmlFor="trend-to-date"
              className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1"
            >
              To Date
            </label>
            <input
              id="trend-to-date"
              type="date"
              value={toDate}
              min={fromDate || undefined}
              onChange={(e) => handleToDateChange(e.target.value)}
              className="bg-slate-900 border border-slate-700/80 text-sm text-slate-100 rounded-lg px-2.5 py-1.5 outline-none font-medium"
            />
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={setCurrentWeekRange}
              className="btn-secondary px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-xs text-slate-200 font-semibold cursor-pointer"
            >
              Last 7 Days (IST)
            </button>
            <button
              type="button"
              onClick={setLast30DaysRange}
              className="btn-secondary px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-xs text-slate-200 font-semibold cursor-pointer"
            >
              Last 30 Days (IST)
            </button>
            <button
              type="button"
              onClick={() => {
                setFromDate("2026-07-06");
                setToDate("2026-07-19");
              }}
              className="btn-secondary px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-xs text-slate-200 font-semibold cursor-pointer"
            >
              Sample July 2026
            </button>
          </div>
        </div>

        <button
          type="button"
          onClick={fetchTrend}
          disabled={loading}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-md transition cursor-pointer disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          Analyze Trend
        </button>
      </div>

      {error && (
        <div className="p-4 rounded-lg bg-rose-950/40 border border-rose-800 text-rose-300 text-sm">
          {error}
        </div>
      )}

      {/* Interactive Chart */}
      <div className="p-6 rounded-xl bg-slate-950 border border-slate-800/80 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-base font-bold text-white flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-indigo-400" />
            Attendance Rate &amp; 7-Day Trailing Moving Average ({department})
          </h3>
          <span className="text-xs font-mono text-slate-400">
            Window: [{fromDate}, {toDate}]
          </span>
        </div>

        <div className="h-80 w-full pt-4">
          {trendData.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={trendData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="date" stroke="#64748b" tick={{ fontSize: 11 }} />
                <YAxis stroke="#64748b" tick={{ fontSize: 11 }} domain={[0, "auto"]} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#020617",
                    borderColor: "#334155",
                    borderRadius: "8px",
                    color: "#f8fafc",
                    fontSize: "12px",
                  }}
                />
                <Legend wrapperStyle={{ fontSize: "12px", paddingTop: "10px" }} />
                <Bar
                  dataKey="present_count"
                  name="Presence Count"
                  fill="#38bdf8"
                  opacity={0.6}
                  barSize={20}
                />
                <Line
                  type="monotone"
                  dataKey="attendance_rate"
                  name="Daily Attendance Rate"
                  stroke="#34d399"
                  strokeWidth={2}
                  dot={{ r: 3 }}
                />
                <Line
                  type="monotone"
                  dataKey="moving_avg_7d"
                  name="7-Day Moving Avg"
                  stroke="#818cf8"
                  strokeWidth={3}
                  strokeDasharray="4 4"
                  dot={{ r: 4 }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-full flex items-center justify-center text-slate-500 text-sm">
              No trend data available for this range.
            </div>
          )}
        </div>
      </div>

      {/* Calendar Day Breakdown Table */}
      <div className="p-6 rounded-xl bg-slate-950 border border-slate-800/80 space-y-4">
        <h3 className="text-sm font-bold text-white">Daily Series Breakdown</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-slate-300">
            <thead className="bg-slate-900/80 text-xs uppercase tracking-wider text-slate-400 border-b border-slate-800">
              <tr>
                <th className="py-3 px-4">Date</th>
                <th className="py-3 px-4">Workday</th>
                <th className="py-3 px-4">Headcount</th>
                <th className="py-3 px-4">Present Count</th>
                <th className="py-3 px-4">Late Records</th>
                <th className="py-3 px-4">Daily Rate</th>
                <th className="py-3 px-4">Moving Avg (7d)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-mono text-xs">
              {trendData.map((row) => (
                <tr key={row.date} className="hover:bg-slate-900/40 transition">
                  <td className="py-3 px-4 text-slate-100 font-semibold">{row.date}</td>
                  <td className="py-3 px-4">
                    {row.is_working_day ? (
                      <span className="text-emerald-400 font-sans font-medium">Mon–Fri</span>
                    ) : (
                      <span className="text-slate-500 font-sans font-medium">Weekend</span>
                    )}
                  </td>
                  <td className="py-3 px-4">{row.headcount}</td>
                  <td className="py-3 px-4 text-sky-400">{row.present_count}</td>
                  <td className="py-3 px-4 text-amber-400">{row.late_count}</td>
                  <td className="py-3 px-4 font-semibold text-emerald-400">
                    {row.attendance_rate !== null ? row.attendance_rate.toFixed(4) : "—"}
                  </td>
                  <td className="py-3 px-4 font-semibold text-indigo-400">
                    {row.moving_avg_7d !== null ? row.moving_avg_7d.toFixed(4) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
