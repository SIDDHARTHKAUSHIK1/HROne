import React, { useState, useEffect } from "react";
import {
  Users,
  RefreshCw,
  UserPlus,
  Clock,
  ExternalLink,
  Moon,
  CheckCircle2,
  X,
} from "lucide-react";
import { api, friendlyError } from "../api/client";
import { AddEmployeeModal } from "../components/AddEmployeeModal";
import { PunchPanel } from "../components/PunchPanel";

export function EmployeesView({ onNavigate }) {
  const [employees, setEmployees] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [suggestedEmpCode, setSuggestedEmpCode] = useState("EMP0007");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [department, setDepartment] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);

  // Add Employee modal & newly created highlight / toast
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [toastMsg, setToastMsg] = useState(null);
  const [highlightedEmpCode, setHighlightedEmpCode] = useState(null);

  // Per-row expandable PunchPanel state
  const [activePunchEmpCode, setActivePunchEmpCode] = useState(null);

  const loadCatalogMetadata = async () => {
    try {
      const { departments: depts, nextEmpCode } = await api.fetchAllEmployeesCatalog();
      setDepartments(depts);
      setSuggestedEmpCode(nextEmpCode);
    } catch {
      // Keep current list on error
    }
  };

  const fetchEmployees = async () => {
    setLoading(true);
    setError(null);
    try {
      const params = { page, page_size: 15 };
      if (department) params.department = department;
      const data = await api.getEmployees(params);
      setEmployees(data.items || []);
      setTotal(data.total || 0);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCatalogMetadata();
  }, []);

  useEffect(() => {
    fetchEmployees();
  }, [page, department]);

  const handleEmployeeCreated = async (createdEmp) => {
    setToastMsg(`Employee ${createdEmp.emp_code} (${createdEmp.name}) created!`);
    setHighlightedEmpCode(createdEmp.emp_code);
    await loadCatalogMetadata();
    await fetchEmployees();
    // Automatically open the PunchPanel for the newly created employee so lifecycle continues seamlessly
    setActivePunchEmpCode(createdEmp.emp_code);
  };

  return (
    <div className="space-y-6">
      {/* Success Toast */}
      {toastMsg && (
        <div
          role="status"
          className="p-4 rounded-xl bg-emerald-950/50 border border-emerald-800 text-emerald-400 text-sm flex items-center justify-between gap-3 shadow-md"
        >
          <div className="flex items-center gap-2 font-semibold">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{toastMsg}</span>
          </div>
          <button
            type="button"
            onClick={() => setToastMsg(null)}
            aria-label="Dismiss notification"
            className="p-1 text-slate-400 hover:text-slate-200 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Top Filter & Actions Bar */}
      <div className="p-5 rounded-xl bg-slate-950 border border-slate-800/80 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-4">
          <div>
            <label
              htmlFor="emp-dept-filter"
              className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1"
            >
              Department Filter
            </label>
            <select
              id="emp-dept-filter"
              value={department}
              onChange={(e) => {
                setDepartment(e.target.value);
                setPage(1);
              }}
              className="bg-slate-900 border border-slate-700/80 text-sm text-slate-100 rounded-lg px-3 py-1.5 outline-none font-medium cursor-pointer"
            >
              <option value="">All Departments</option>
              {departments.map((dept) => (
                <option key={dept} value={dept}>
                  {dept}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => {
              loadCatalogMetadata();
              fetchEmployees();
            }}
            disabled={loading}
            className="btn-secondary inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-100 text-xs font-semibold border border-slate-700 transition cursor-pointer shadow-sm disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            Refresh Directory
          </button>

          <button
            type="button"
            onClick={() => setAddModalOpen(true)}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-md transition cursor-pointer"
          >
            <UserPlus className="w-3.5 h-3.5" />
            Add Employee
          </button>
        </div>
      </div>

      {error && (
        <div className="p-4 rounded-lg bg-rose-950/40 border border-rose-800 text-rose-300 text-sm">
          {error}
        </div>
      )}

      {/* Employees Table */}
      <div className="p-6 rounded-xl bg-slate-950 border border-slate-800/80 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-base font-bold text-white flex items-center gap-2">
            <Users className="w-4 h-4 text-indigo-400" />
            Employee Directory ({total} registered)
          </h3>
          <span className="text-xs text-slate-400">
            Click <strong>Punch In / Out</strong> on any row to log attendance or <strong>View attendance</strong> to inspect logs
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-slate-300">
            <thead className="bg-slate-900/80 text-xs uppercase tracking-wider text-slate-400 border-b border-slate-800">
              <tr>
                <th className="py-3 px-4">Employee Code</th>
                <th className="py-3 px-4">Full Name</th>
                <th className="py-3 px-4">Email</th>
                <th className="py-3 px-4">Department</th>
                <th className="py-3 px-4">Shift Schedule</th>
                <th className="py-3 px-4">Joining Date</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-mono text-xs">
              {employees.map((emp) => {
                const isOvernight = emp.shift_end <= emp.shift_start;
                const isHighlighted = highlightedEmpCode === emp.emp_code;
                const isPunchExpanded = activePunchEmpCode === emp.emp_code;

                return (
                  <React.Fragment key={emp.emp_code}>
                    <tr
                      className={`transition ${
                        isHighlighted
                          ? "bg-indigo-600/15"
                          : "hover:bg-slate-900/40"
                      }`}
                    >
                      <td className="py-3 px-4 font-bold text-indigo-400">
                        <div className="flex items-center gap-1.5">
                          <span>{emp.emp_code}</span>
                          {isHighlighted && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-sans bg-emerald-950/50 border border-emerald-800 text-emerald-400">
                              NEW
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-4 font-sans font-semibold text-slate-100">
                        {emp.name}
                      </td>
                      <td className="py-3 px-4 text-slate-400 font-sans">{emp.email}</td>
                      <td className="py-3 px-4 font-sans text-slate-300">
                        {emp.department}
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2">
                          <span className="text-sky-400">
                            {emp.shift_start} – {emp.shift_end} (IST)
                          </span>
                          {isOvernight && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-sans font-semibold bg-indigo-950/50 border border-indigo-800 text-indigo-400 inline-flex items-center gap-1">
                              <Moon className="w-2.5 h-2.5" /> Overnight
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-emerald-400">{emp.joined_on}</td>
                      <td className="py-3 px-4 text-right">
                        <div className="inline-flex items-center justify-end gap-2 font-sans">
                          <button
                            type="button"
                            onClick={() =>
                              setActivePunchEmpCode(
                                isPunchExpanded ? null : emp.emp_code
                              )
                            }
                            className={`action-btn inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-semibold border transition cursor-pointer ${
                              isPunchExpanded
                                ? "bg-indigo-600 text-white border-indigo-500"
                                : "bg-slate-800 hover:bg-slate-700 text-slate-100 border-slate-700"
                            }`}
                          >
                            <Clock className="w-3.5 h-3.5 text-indigo-400" />
                            {isPunchExpanded ? "Close Punch" : "Punch In / Out"}
                          </button>

                          <button
                            type="button"
                            onClick={() =>
                              onNavigate?.("attendance", { emp_code: emp.emp_code })
                            }
                            className="btn-secondary inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-slate-900 hover:bg-slate-800 text-slate-200 text-xs font-semibold border border-slate-700/80 transition cursor-pointer"
                          >
                            <ExternalLink className="w-3 h-3" />
                            View attendance
                          </button>
                        </div>
                      </td>
                    </tr>

                    {isPunchExpanded && (
                      <tr>
                        <td colSpan="7" className="p-4 bg-slate-900/30 font-sans">
                          <PunchPanel
                            lockedEmployee={emp}
                            compact
                            onNavigate={onNavigate}
                          />
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add Employee Modal */}
      <AddEmployeeModal
        isOpen={addModalOpen}
        onClose={() => setAddModalOpen(false)}
        onSuccess={handleEmployeeCreated}
        existingDepartments={departments}
        suggestedEmpCode={suggestedEmpCode}
      />
    </div>
  );
}
