import React, { useState, useEffect } from "react";
import { Edit3, RefreshCw, X, Filter } from "lucide-react";
import { api, friendlyError, formatIstTimeOnly } from "../api/client";

export function AttendanceView({ initialEmpCode = "", onClearEmpFilter }) {
  const [logs, setLogs] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);

  // Filters
  const [empFilter, setEmpFilter] = useState(initialEmpCode || "");
  const [statusFilter, setStatusFilter] = useState("");

  // Regularize modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedRecord, setSelectedRecord] = useState(null);
  const [regStatus, setRegStatus] = useState("PRESENT");
  const [regReason, setRegReason] = useState("");
  const [regBy, setRegBy] = useState("HR Operations");
  const [actionMsg, setActionMsg] = useState("");

  useEffect(() => {
    setEmpFilter(initialEmpCode || "");
    setPage(1);
  }, [initialEmpCode]);

  useEffect(() => {
    api
      .fetchAllEmployeesCatalog()
      .then(({ items }) => setEmployees(items))
      .catch(() => {});
  }, []);

  const fetchLogs = async () => {
    setLoading(true);
    setError(null);
    try {
      const params = { page, page_size: 15 };
      if (empFilter) params.emp_code = empFilter;
      if (statusFilter) params.status = statusFilter;
      const data = await api.getAttendance(params);
      setLogs(data.items || []);
      setTotal(data.total || 0);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, [page, empFilter, statusFilter]);

  const openRegularize = (record) => {
    setSelectedRecord(record);
    setRegStatus(record.status);
    setRegReason("");
    setActionMsg("");
    setModalOpen(true);
  };

  const submitRegularize = async (e) => {
    e.preventDefault();
    setActionMsg("");
    try {
      await api.regularize(selectedRecord.emp_code, selectedRecord.date, {
        status: regStatus,
        reason: regReason,
        regularized_by: regBy,
      });
      setActionMsg("✅ Regularization applied and recorded in audit history!");
      setTimeout(() => {
        setModalOpen(false);
        fetchLogs();
      }, 900);
    } catch (err) {
      setActionMsg(`❌ ${friendlyError(err)}`);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Controls & Filters */}
      <div className="p-5 rounded-xl bg-slate-950 border border-slate-800/80 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight">Attendance Logs &amp; Corrections</h2>
          <p className="text-sm text-slate-400">
            Total {total} attendance records {empFilter ? `for ${empFilter}` : "stored"}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div>
            <label
              htmlFor="att-emp-filter"
              className="block text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1"
            >
              Employee Filter
            </label>
            <select
              id="att-emp-filter"
              value={empFilter}
              onChange={(e) => {
                setEmpFilter(e.target.value);
                setPage(1);
                if (!e.target.value) onClearEmpFilter?.();
              }}
              className="bg-slate-900 border border-slate-700/80 text-xs text-slate-100 rounded-lg px-3 py-2 outline-none font-medium cursor-pointer"
            >
              <option value="">All Employees</option>
              {employees.map((e) => (
                <option key={e.emp_code} value={e.emp_code}>
                  {e.emp_code} — {e.name}
                </option>
              ))}
              {empFilter && !employees.some((e) => e.emp_code === empFilter) && (
                <option value={empFilter}>{empFilter}</option>
              )}
            </select>
          </div>

          <div>
            <label
              htmlFor="att-status-filter"
              className="block text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1"
            >
              Status Filter
            </label>
            <select
              id="att-status-filter"
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                setPage(1);
              }}
              className="bg-slate-900 border border-slate-700/80 text-xs text-slate-100 rounded-lg px-3 py-2 outline-none font-medium cursor-pointer"
            >
              <option value="">All Statuses</option>
              <option value="PRESENT">PRESENT</option>
              <option value="WFH">WFH</option>
              <option value="ON_DUTY">ON_DUTY</option>
              <option value="LEAVE">LEAVE</option>
              <option value="ABSENT">ABSENT</option>
            </select>
          </div>

          {(empFilter || statusFilter) && (
            <button
              type="button"
              onClick={() => {
                setEmpFilter("");
                setStatusFilter("");
                setPage(1);
                onClearEmpFilter?.();
              }}
              className="btn-secondary mt-4 inline-flex items-center gap-1 px-3 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 text-xs font-semibold border border-slate-700 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
              Clear Filters
            </button>
          )}

          <button
            type="button"
            onClick={fetchLogs}
            disabled={loading}
            className="btn-secondary mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-100 text-xs font-semibold border border-slate-700 transition cursor-pointer shadow-sm disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            Refresh Records
          </button>
        </div>
      </div>

      {error && (
        <div className="p-4 rounded-lg bg-rose-950/40 border border-rose-800 text-rose-300 text-sm">
          {error}
        </div>
      )}

      {/* Logs Table */}
      <div className="p-6 rounded-xl bg-slate-950 border border-slate-800/80 space-y-4">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-slate-300">
            <thead className="bg-slate-900/80 text-xs uppercase tracking-wider text-slate-400 border-b border-slate-800">
              <tr>
                <th className="py-3 px-4">Date</th>
                <th className="py-3 px-4">Employee</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">Punch In / Out (IST)</th>
                <th className="py-3 px-4">Work Hours</th>
                <th className="py-3 px-4">Late (min)</th>
                <th className="py-3 px-4">Overtime (min)</th>
                <th className="py-3 px-4">Half Day</th>
                <th className="py-3 px-4">History</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-mono text-xs">
              {logs.length === 0 ? (
                <tr>
                  <td colSpan="10" className="text-center py-8 text-slate-500 font-sans">
                    No attendance records found matching the selected filters.
                  </td>
                </tr>
              ) : (
                logs.map((row) => (
                  <tr key={`${row.emp_code}-${row.date}`} className="hover:bg-slate-900/40 transition">
                    <td className="py-3 px-4 text-slate-100 font-semibold">{row.date}</td>
                    <td className="py-3 px-4 font-sans font-semibold text-indigo-400">
                      {row.emp_code}
                    </td>
                    <td className="py-3 px-4">
                      <span
                        className={`px-2 py-0.5 rounded text-[11px] font-sans font-semibold ${
                          row.status === "PRESENT"
                            ? "bg-emerald-950 text-emerald-400 border border-emerald-800"
                            : row.status === "WFH"
                            ? "bg-sky-950 text-sky-400 border border-sky-800"
                            : row.status === "ON_DUTY"
                            ? "bg-indigo-950 text-indigo-400 border border-indigo-800"
                            : "bg-rose-950 text-rose-400 border border-rose-800"
                        }`}
                      >
                        {row.status}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-[11px] text-slate-300">
                      {row.punch_in ? formatIstTimeOnly(row.punch_in) : "—"}
                      {" → "}
                      {row.punch_out ? formatIstTimeOnly(row.punch_out) : "Open"}
                    </td>
                    <td className="py-3 px-4 text-sky-400 font-semibold">
                      {row.work_hours !== null ? `${row.work_hours} hrs` : "—"}
                    </td>
                    <td className="py-3 px-4 text-amber-400">{row.late_minutes}</td>
                    <td className="py-3 px-4 text-indigo-400">{row.overtime_minutes}</td>
                    <td className="py-3 px-4">
                      {row.half_day ? (
                        <span className="text-amber-400 font-sans font-medium">Yes</span>
                      ) : (
                        <span className="text-slate-500 font-sans">No</span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-slate-400">{row.history?.length || 0} audits</td>
                    <td className="py-3 px-4 text-right">
                      <button
                        type="button"
                        onClick={() => openRegularize(row)}
                        className="action-btn inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-100 font-sans text-xs font-semibold border border-slate-700/80 transition cursor-pointer shadow-sm"
                      >
                        <Edit3 className="w-3.5 h-3.5 text-indigo-400" />
                        Regularize
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Regularize Modal */}
      {modalOpen && selectedRecord && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-950 border border-slate-800 rounded-xl max-w-lg w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="font-bold text-white text-base">
                Regularize Attendance: {selectedRecord.emp_code} ({selectedRecord.date})
              </h3>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="text-slate-400 hover:text-slate-200 transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={submitRegularize} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">
                  Adjust Status
                </label>
                <select
                  value={regStatus}
                  onChange={(e) => setRegStatus(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 px-3 py-2 rounded-lg text-sm text-slate-200 outline-none"
                >
                  <option value="PRESENT">PRESENT</option>
                  <option value="WFH">WFH</option>
                  <option value="ON_DUTY">ON_DUTY</option>
                  <option value="LEAVE">LEAVE (clears punch times)</option>
                  <option value="ABSENT">ABSENT (clears punch times)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">
                  Audit Reason (min 5 chars)
                </label>
                <input
                  type="text"
                  required
                  minLength={5}
                  value={regReason}
                  onChange={(e) => setRegReason(e.target.value)}
                  placeholder="Manager approved regularization"
                  className="w-full bg-slate-900 border border-slate-700 px-3 py-2 rounded-lg text-sm text-slate-200 outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">
                  Regularized By
                </label>
                <input
                  type="text"
                  required
                  value={regBy}
                  onChange={(e) => setRegBy(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 px-3 py-2 rounded-lg text-sm text-slate-200 outline-none"
                />
              </div>

              {actionMsg && (
                <div className="p-3 rounded bg-slate-900 text-xs font-mono text-slate-300 border border-slate-800">
                  {actionMsg}
                </div>
              )}

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="btn-secondary px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-100 text-xs font-semibold border border-slate-700 cursor-pointer transition shadow-sm"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-md cursor-pointer transition"
                >
                  Save &amp; Append Audit Entry
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
