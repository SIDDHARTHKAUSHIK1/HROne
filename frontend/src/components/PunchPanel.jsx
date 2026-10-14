import React, { useState, useEffect, useRef } from "react";
import {
  Clock,
  LogIn,
  LogOut,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Search,
  ChevronDown,
  Moon,
  Calendar,
  Sparkles,
  ExternalLink,
} from "lucide-react";
import {
  api,
  friendlyError,
  getIstToday,
  getPreviousDateStr,
  getNextDateStr,
  getIstNowDatetimeLocal,
  istDatetimeLocalToEpochMs,
  formatIstDateTime,
  formatIstTimeOnly,
} from "../api/client";

/**
 * Helper to add minutes to an HH:MM string on a given YYYY-MM-DD date,
 * returning a "YYYY-MM-DDTHH:mm" string in IST.
 */
function buildIstDatetimeLocal(baseDateStr, hhmmStr, addMinutes = 0, addDays = 0) {
  const [y, m, d] = baseDateStr.split("-").map(Number);
  const [hh, mm] = (hhmmStr || "09:30").split(":").map(Number);
  const utcMs = Date.UTC(y, m - 1, d + addDays, hh, mm + addMinutes, 0);
  const dt = new Date(utcMs);
  const ry = dt.getUTCFullYear();
  const rm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const rd = String(dt.getUTCDate()).padStart(2, "0");
  const rhh = String(dt.getUTCHours()).padStart(2, "0");
  const rmm = String(dt.getUTCMinutes()).padStart(2, "0");
  return `${ry}-${rm}-${rd}T${rhh}:${rmm}`;
}

export function PunchPanel({
  initialEmpCode = "",
  lockedEmployee = null,
  employeesCatalog = null,
  onChange,
  onNavigate,
  compact = false,
}) {
  const [employees, setEmployees] = useState(employeesCatalog || []);
  const [selectedEmpCode, setSelectedEmpCode] = useState(
    lockedEmployee?.emp_code || initialEmpCode || "EMP0001"
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);

  const [status, setStatus] = useState("PRESENT");
  const [timeMode, setTimeMode] = useState("now"); // "now" | "custom"
  const [customDtLocal, setCustomDtLocal] = useState(getIstNowDatetimeLocal());

  const [currentRecord, setCurrentRecord] = useState(null);
  const [loadingState, setLoadingState] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [lastActionResult, setLastActionResult] = useState(null); // { type: "in" | "out", record }
  const [errorMsg, setErrorMsg] = useState(null);

  const pickerRef = useRef(null);

  // Load employees catalog if not supplied by parent
  useEffect(() => {
    if (lockedEmployee) {
      setEmployees([lockedEmployee]);
      setSelectedEmpCode(lockedEmployee.emp_code);
      return;
    }
    if (Array.isArray(employeesCatalog) && employeesCatalog.length > 0) {
      setEmployees(employeesCatalog);
      if (initialEmpCode) {
        setSelectedEmpCode(initialEmpCode);
      } else if (!employeesCatalog.some((e) => e.emp_code === selectedEmpCode)) {
        setSelectedEmpCode(employeesCatalog[0].emp_code);
      }
      return;
    }

    let cancelled = false;
    api
      .fetchAllEmployeesCatalog()
      .then(({ items }) => {
        if (cancelled) return;
        setEmployees(items);
        if (initialEmpCode && items.some((e) => e.emp_code === initialEmpCode)) {
          setSelectedEmpCode(initialEmpCode);
        } else if (items.length > 0 && !items.some((e) => e.emp_code === selectedEmpCode)) {
          setSelectedEmpCode(items[0].emp_code);
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [lockedEmployee, employeesCatalog, initialEmpCode]);

  // Close searchable employee dropdown on outside click
  useEffect(() => {
    if (!pickerOpen) return;
    const handleOutside = (e) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target)) {
        setPickerOpen(false);
      }
    };
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [pickerOpen]);

  const selectedEmployee =
    lockedEmployee ||
    employees.find((e) => e.emp_code === selectedEmpCode) ||
    null;

  const isOvernight =
    selectedEmployee &&
    selectedEmployee.shift_end <= selectedEmployee.shift_start;

  // Target reference date in IST (today if "now", or the date portion of customDtLocal)
  const targetDateIst =
    timeMode === "custom" && customDtLocal && customDtLocal.length >= 10
      ? customDtLocal.slice(0, 10)
      : getIstToday();

  // Fetch today's (and yesterday's for overnight shifts) attendance record for selectedEmpCode
  const refreshEmployeeAttendanceState = async (empCodeToCheck = selectedEmpCode) => {
    if (!empCodeToCheck) return;
    setLoadingState(true);
    try {
      const todayIst = targetDateIst;
      const yesterdayIst = getPreviousDateStr(todayIst);
      const data = await api.getAttendance({
        emp_code: empCodeToCheck,
        date_from: yesterdayIst,
        date_to: todayIst,
        page: 1,
        page_size: 10,
      });
      const items = data.items || [];

      // 1. Prioritize any open record (punch_out === null) on today or yesterday (for overnight shift)
      const openRec = items.find((r) => r.punch_in !== null && r.punch_out === null);
      if (openRec) {
        setCurrentRecord(openRec);
        return;
      }

      // 2. Otherwise check if there is a record for todayIst
      const todayRec = items.find((r) => r.date === todayIst);
      setCurrentRecord(todayRec || null);
    } catch {
      setCurrentRecord(null);
    } finally {
      setLoadingState(false);
    }
  };

  useEffect(() => {
    setErrorMsg(null);
    refreshEmployeeAttendanceState(selectedEmpCode);
  }, [selectedEmpCode, targetDateIst]);

  const filteredEmployees = employees.filter((e) => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return true;
    return (
      e.emp_code.toLowerCase().includes(q) ||
      e.name.toLowerCase().includes(q) ||
      (e.department && e.department.toLowerCase().includes(q))
    );
  });

  const handlePunchIn = async () => {
    if (submitting || !selectedEmpCode) return;
    setErrorMsg(null);
    setSubmitting(true);

    const payload = {
      emp_code: selectedEmpCode,
      status,
    };

    if (timeMode === "custom") {
      const epochMs = istDatetimeLocalToEpochMs(customDtLocal);
      if (!epochMs) {
        setErrorMsg("Please enter a valid custom IST date and time");
        setSubmitting(false);
        return;
      }
      payload.punched_at = epochMs;
    }

    try {
      const res = await api.punchIn(payload);
      setLastActionResult({ type: "in", record: res });
      setCurrentRecord(res);
      onChange?.(res);
    } catch (err) {
      setErrorMsg(friendlyError(err, "punch-in"));
    } finally {
      setSubmitting(false);
    }
  };

  const handlePunchOut = async () => {
    if (submitting || !selectedEmpCode) return;
    setErrorMsg(null);
    setSubmitting(true);

    const payload = {
      emp_code: selectedEmpCode,
    };

    if (timeMode === "custom") {
      const epochMs = istDatetimeLocalToEpochMs(customDtLocal);
      if (!epochMs) {
        setErrorMsg("Please enter a valid custom IST date and time");
        setSubmitting(false);
        return;
      }
      payload.punched_at = epochMs;
    }

    try {
      const res = await api.punchOut(payload);
      setLastActionResult({ type: "out", record: res });
      setCurrentRecord(res);
      onChange?.(res);
    } catch (err) {
      setErrorMsg(friendlyError(err, "punch-out"));
    } finally {
      setSubmitting(false);
    }
  };

  // Preset helper buttons for Custom Time (IST)
  const applyPreset = (presetType) => {
    const emp = selectedEmployee;
    const baseDate = currentRecord?.date || targetDateIst || getIstToday();
    const sStart = emp?.shift_start || "09:30";
    const sEnd = emp?.shift_end || "18:30";
    const overnight = sEnd <= sStart;

    if (presetType === "on_time") {
      setTimeMode("custom");
      setCustomDtLocal(buildIstDatetimeLocal(baseDate, sStart, 0, 0));
    } else if (presetType === "late_25m") {
      setTimeMode("custom");
      setCustomDtLocal(buildIstDatetimeLocal(baseDate, sStart, 25, 0));
    } else if (presetType === "early_5m") {
      setTimeMode("custom");
      setCustomDtLocal(buildIstDatetimeLocal(baseDate, sStart, -5, 0));
    } else if (presetType === "shift_end") {
      setTimeMode("custom");
      setCustomDtLocal(buildIstDatetimeLocal(baseDate, sEnd, 0, overnight ? 1 : 0));
    } else if (presetType === "ot_40m") {
      setTimeMode("custom");
      setCustomDtLocal(buildIstDatetimeLocal(baseDate, sEnd, 40, overnight ? 1 : 0));
    }
  };

  const isOpenRecord =
    currentRecord &&
    currentRecord.punch_in !== null &&
    currentRecord.punch_out === null;

  const isClosedRecord =
    currentRecord &&
    currentRecord.punch_in !== null &&
    currentRecord.punch_out !== null;

  return (
    <div
      className={`${
        compact
          ? "p-4 rounded-xl bg-slate-900/70 border border-slate-800 space-y-4"
          : "p-6 rounded-xl bg-slate-950 border border-slate-800/80 space-y-5"
      }`}
    >
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="icon-badge icon-badge-indigo w-9 h-9 rounded-lg bg-indigo-500/15 border border-indigo-500/30 flex items-center justify-center text-indigo-400 shrink-0">
            <Clock className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              Biometric Punch In / Punch Out Console
            </h3>
            <p className="text-xs text-slate-400">
              Real-time IST attendance lifecycle with late (R2), work hours (R4) & overtime (R3) calculation
            </p>
          </div>
        </div>

        {selectedEmployee && (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="px-2.5 py-1 rounded-md bg-slate-900 border border-slate-800 text-slate-300 font-mono">
              Shift: <strong>{selectedEmployee.shift_start}</strong> –{" "}
              <strong>{selectedEmployee.shift_end}</strong> IST
            </span>
            {isOvernight && (
              <span className="px-2.5 py-1 rounded-md bg-indigo-950/50 border border-indigo-800 text-indigo-400 font-semibold inline-flex items-center gap-1">
                <Moon className="w-3 h-3" /> Overnight Shift
              </span>
            )}
          </div>
        )}
      </div>

      {/* Controls Grid */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-start">
        {/* 1. Searchable Employee Picker */}
        {!lockedEmployee && (
          <div ref={pickerRef} className="md:col-span-4 relative">
            <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">
              Employee
            </label>
            <button
              type="button"
              onClick={() => setPickerOpen((o) => !o)}
              className="btn-secondary w-full flex items-center justify-between gap-2 bg-slate-900 border border-slate-700/80 px-3 py-2 rounded-lg text-sm text-slate-100 cursor-pointer"
            >
              <span className="truncate font-medium">
                {selectedEmployee
                  ? `${selectedEmployee.emp_code} — ${selectedEmployee.name} (${selectedEmployee.department})`
                  : selectedEmpCode}
              </span>
              <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />
            </button>

            {pickerOpen && (
              <div className="absolute z-30 mt-1 w-full rounded-xl bg-slate-950 border border-slate-700 shadow-2xl overflow-hidden">
                <div className="p-2 border-b border-slate-800 flex items-center gap-2 bg-slate-900">
                  <Search className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search code, name, or dept..."
                    className="w-full bg-transparent text-xs text-slate-100 outline-none"
                    autoFocus
                  />
                </div>
                <div className="max-h-52 overflow-y-auto divide-y divide-slate-800/40">
                  {filteredEmployees.length === 0 ? (
                    <div className="px-3 py-3 text-xs text-slate-500 text-center">
                      No matching employees
                    </div>
                  ) : (
                    filteredEmployees.map((emp) => {
                      const empOvernight = emp.shift_end <= emp.shift_start;
                      return (
                        <button
                          key={emp.emp_code}
                          type="button"
                          onClick={() => {
                            setSelectedEmpCode(emp.emp_code);
                            setPickerOpen(false);
                            setSearchQuery("");
                            setLastActionResult(null);
                          }}
                          className={`w-full text-left px-3 py-2 text-xs hover:bg-indigo-600/15 flex items-center justify-between gap-2 cursor-pointer ${
                            emp.emp_code === selectedEmpCode ? "bg-indigo-600/15" : ""
                          }`}
                        >
                          <div className="min-w-0">
                            <div className="font-semibold text-slate-100 truncate">
                              <span className="font-mono text-indigo-400 mr-1.5">
                                {emp.emp_code}
                              </span>
                              {emp.name}
                            </div>
                            <div className="text-[11px] text-slate-400">
                              {emp.department} • {emp.shift_start}–{emp.shift_end}
                            </div>
                          </div>
                          {empOvernight && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] bg-indigo-950 text-indigo-400 border border-indigo-800 shrink-0">
                              Overnight
                            </span>
                          )}
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* 2. Presence Status Selector (only relevant before punch-in) */}
        <div className={lockedEmployee ? "md:col-span-3" : "md:col-span-3"}>
          <label
            htmlFor={`punch-status-${selectedEmpCode}`}
            className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1"
          >
            Work Mode (Status)
          </label>
          <select
            id={`punch-status-${selectedEmpCode}`}
            value={status}
            disabled={isOpenRecord}
            onChange={(e) => setStatus(e.target.value)}
            className="w-full bg-slate-900 border border-slate-700/80 px-3 py-2 rounded-lg text-sm text-slate-100 outline-none font-medium cursor-pointer disabled:opacity-50"
          >
            <option value="PRESENT">PRESENT (On-Site)</option>
            <option value="WFH">WFH (Remote)</option>
            <option value="ON_DUTY">ON_DUTY (Field Duty)</option>
          </select>
        </div>

        {/* 3. Timestamp Mode (Now vs Custom IST Time) */}
        <div className={lockedEmployee ? "md:col-span-9" : "md:col-span-5"}>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
              Punch Timestamp (IST)
            </span>
            <div className="inline-flex rounded-lg p-0.5 bg-slate-900 border border-slate-800">
              <button
                type="button"
                onClick={() => setTimeMode("now")}
                className={`px-2.5 py-0.5 rounded-md text-[11px] font-semibold cursor-pointer transition ${
                  timeMode === "now"
                    ? "bg-indigo-600 text-white"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                Now (Server Clock)
              </button>
              <button
                type="button"
                onClick={() => {
                  setTimeMode("custom");
                  if (!customDtLocal) setCustomDtLocal(getIstNowDatetimeLocal());
                }}
                className={`px-2.5 py-0.5 rounded-md text-[11px] font-semibold cursor-pointer transition ${
                  timeMode === "custom"
                    ? "bg-indigo-600 text-white"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                Custom Time (IST)
              </button>
            </div>
          </div>

          {timeMode === "now" ? (
            <div className="px-3 py-2 rounded-lg bg-slate-900/60 border border-slate-800 text-xs text-slate-400 flex items-center justify-between">
              <span>Omits <code className="font-mono text-slate-300">punched_at</code> — server uses current UTC/IST instant</span>
              <span className="font-mono text-indigo-400">{getIstToday()}</span>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <input
                  type="datetime-local"
                  value={customDtLocal}
                  onChange={(e) => setCustomDtLocal(e.target.value)}
                  aria-label="Custom IST punch date and time"
                  className="w-full bg-slate-900 border border-slate-700 px-3 py-1.5 rounded-lg text-sm font-mono text-slate-100 outline-none focus:border-indigo-500"
                />
                <span className="px-2 py-1.5 rounded bg-indigo-950/50 border border-indigo-800 text-indigo-400 font-mono text-xs font-semibold shrink-0">
                  +05:30 IST
                </span>
              </div>

              {/* Quick Demo Presets for Late / Overtime / Overnight */}
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] text-slate-400 flex items-center gap-1 mr-1">
                  <Sparkles className="w-3 h-3 text-indigo-400" /> Presets:
                </span>
                {!isOpenRecord ? (
                  <>
                    <button
                      type="button"
                      onClick={() => applyPreset("early_5m")}
                      className="btn-secondary px-2 py-0.5 rounded text-[11px] bg-slate-900 border border-slate-700 text-slate-300 cursor-pointer"
                    >
                      5m Early ({selectedEmployee?.shift_start || "09:30"} - 5m)
                    </button>
                    <button
                      type="button"
                      onClick={() => applyPreset("on_time")}
                      className="btn-secondary px-2 py-0.5 rounded text-[11px] bg-slate-900 border border-slate-700 text-slate-300 cursor-pointer"
                    >
                      Shift Start ({selectedEmployee?.shift_start || "09:30"})
                    </button>
                    <button
                      type="button"
                      onClick={() => applyPreset("late_25m")}
                      className="btn-secondary px-2 py-0.5 rounded text-[11px] bg-slate-900 border border-slate-700 text-amber-400 cursor-pointer"
                    >
                      +25m Late (R2)
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => applyPreset("shift_end")}
                      className="btn-secondary px-2 py-0.5 rounded text-[11px] bg-slate-900 border border-slate-700 text-slate-300 cursor-pointer"
                    >
                      Shift End ({selectedEmployee?.shift_end || "18:30"})
                    </button>
                    <button
                      type="button"
                      onClick={() => applyPreset("ot_40m")}
                      className="btn-secondary px-2 py-0.5 rounded text-[11px] bg-slate-900 border border-slate-700 text-indigo-400 cursor-pointer"
                    >
                      +40m Overtime (R3)
                    </button>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* State & Action Bar */}
      <div className="pt-3 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-4">
        {/* Current Day Attendance State */}
        <div className="flex flex-wrap items-center gap-3 text-xs">
          {loadingState ? (
            <span className="text-slate-400">Checking attendance status...</span>
          ) : !currentRecord ? (
            <span className="text-slate-400 flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5 text-slate-500" />
              No attendance record yet for <strong className="font-mono text-slate-200">{targetDateIst}</strong>
            </span>
          ) : isOpenRecord ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="px-2.5 py-1 rounded-md bg-emerald-950/50 border border-emerald-800 text-emerald-400 font-semibold flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                Open Shift ({currentRecord.date})
              </span>
              <span className="text-slate-300">
                Punched in at{" "}
                <strong className="font-mono text-slate-100">
                  {formatIstTimeOnly(currentRecord.punch_in)}
                </strong>
              </span>
              {currentRecord.late_minutes > 0 && (
                <span className="px-2 py-0.5 rounded bg-amber-950/50 border border-amber-800 text-amber-400 font-mono">
                  Late: {currentRecord.late_minutes}m
                </span>
              )}
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <span className="px-2.5 py-1 rounded-md bg-indigo-950/50 border border-indigo-800 text-indigo-400 font-semibold flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5" />
                Shift Completed ({currentRecord.date})
              </span>
              <span className="font-mono text-slate-300">
                In: {formatIstTimeOnly(currentRecord.punch_in)} • Out:{" "}
                {formatIstTimeOnly(currentRecord.punch_out)}
              </span>
              <span className="px-2 py-0.5 rounded bg-sky-950/50 border border-sky-800 text-sky-400 font-mono font-semibold">
                {currentRecord.work_hours} hrs
              </span>
              {currentRecord.late_minutes > 0 && (
                <span className="px-2 py-0.5 rounded bg-amber-950/50 border border-amber-800 text-amber-400 font-mono">
                  Late: {currentRecord.late_minutes}m
                </span>
              )}
              {currentRecord.overtime_minutes > 0 && (
                <span className="px-2 py-0.5 rounded bg-indigo-950/50 border border-indigo-800 text-indigo-400 font-mono">
                  OT: {currentRecord.overtime_minutes}m
                </span>
              )}
              {currentRecord.half_day && (
                <span className="px-2 py-0.5 rounded bg-amber-950/50 border border-amber-800 text-amber-400 font-semibold">
                  Half Day
                </span>
              )}
            </div>
          )}
        </div>

        {/* Context-Aware Action Buttons */}
        <div className="flex items-center gap-2.5">
          {!currentRecord && (
            <button
              type="button"
              onClick={handlePunchIn}
              disabled={submitting}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold cursor-pointer shadow-sm transition disabled:opacity-50"
            >
              <LogIn className="w-3.5 h-3.5" />
              {submitting ? "Punching In..." : "Punch In"}
            </button>
          )}

          {isOpenRecord && (
            <button
              type="button"
              onClick={handlePunchOut}
              disabled={submitting}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold cursor-pointer shadow-sm transition disabled:opacity-50"
            >
              <LogOut className="w-3.5 h-3.5" />
              {submitting ? "Punching Out..." : "Punch Out"}
            </button>
          )}

          {onNavigate && selectedEmpCode && (
            <button
              type="button"
              onClick={() => onNavigate("attendance", { emp_code: selectedEmpCode })}
              className="btn-secondary inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-100 text-xs font-semibold border border-slate-700 cursor-pointer transition"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              View Logs
            </button>
          )}
        </div>
      </div>

      {/* Error Banner */}
      {errorMsg && (
        <div
          role="alert"
          className="p-3.5 rounded-lg bg-rose-950/40 border border-rose-800 text-rose-300 text-xs flex items-center justify-between gap-3"
        >
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
            <span className="font-medium">{errorMsg}</span>
          </div>
          <button
            type="button"
            onClick={() => setErrorMsg(null)}
            className="text-xs text-slate-400 hover:text-slate-200 underline cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Action Result Card */}
      {lastActionResult && lastActionResult.record && (
        <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-bold text-emerald-400">
              <CheckCircle2 className="w-4 h-4" />
              {lastActionResult.type === "in"
                ? `Punch-In Recorded for ${lastActionResult.record.emp_code}`
                : `Punch-Out Completed for ${lastActionResult.record.emp_code}`}
            </div>

            {/* Duplicate / Concurrency 409 Test Buttons */}
            <div className="flex items-center gap-2">
              {lastActionResult.type === "in" && (
                <button
                  type="button"
                  onClick={handlePunchIn}
                  disabled={submitting}
                  title="Send duplicate punch-in request to verify 409 Conflict handling"
                  className="btn-secondary px-2.5 py-1 rounded text-[11px] bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-semibold cursor-pointer transition"
                >
                  Test Duplicate Punch-In (409)
                </button>
              )}
              {lastActionResult.type === "out" && (
                <button
                  type="button"
                  onClick={handlePunchOut}
                  disabled={submitting}
                  title="Send duplicate punch-out request to verify 409 Conflict handling"
                  className="btn-secondary px-2.5 py-1 rounded text-[11px] bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-semibold cursor-pointer transition"
                >
                  Test Duplicate Punch-Out (409)
                </button>
              )}
            </div>
          </div>

          {lastActionResult.type === "in" ? (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
              <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800">
                <span className="text-slate-400 block text-[11px] uppercase">Attendance Date (R1)</span>
                <span className="font-mono font-bold text-slate-100 text-sm">
                  {lastActionResult.record.date}
                </span>
              </div>
              <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800">
                <span className="text-slate-400 block text-[11px] uppercase">Punch-In Time (IST)</span>
                <span className="font-mono font-bold text-sky-400 text-sm">
                  {formatIstDateTime(lastActionResult.record.punch_in)}
                </span>
              </div>
              <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800">
                <span className="text-slate-400 block text-[11px] uppercase">Late Arrival (R2)</span>
                {lastActionResult.record.late_minutes > 0 ? (
                  <span className="font-mono font-bold text-amber-400 text-sm inline-flex items-center gap-1">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    {lastActionResult.record.late_minutes} min late
                  </span>
                ) : (
                  <span className="font-mono font-bold text-emerald-400 text-sm">
                    0 min (On Time)
                  </span>
                )}
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 text-xs">
              <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800">
                <span className="text-slate-400 block text-[11px] uppercase">Attendance Date</span>
                <span className="font-mono font-bold text-slate-100 text-sm">
                  {lastActionResult.record.date}
                </span>
              </div>
              <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800">
                <span className="text-slate-400 block text-[11px] uppercase">Work Hours (R4)</span>
                <span className="font-mono font-bold text-sky-400 text-sm">
                  {lastActionResult.record.work_hours} hrs
                </span>
              </div>
              <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800">
                <span className="text-slate-400 block text-[11px] uppercase">Overtime (R3)</span>
                <span className="font-mono font-bold text-indigo-400 text-sm">
                  {lastActionResult.record.overtime_minutes} min
                </span>
              </div>
              <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800">
                <span className="text-slate-400 block text-[11px] uppercase">Day Classification (R5)</span>
                {lastActionResult.record.half_day ? (
                  <span className="inline-block mt-0.5 px-2 py-0.5 rounded bg-amber-950/50 border border-amber-800 text-amber-400 font-semibold text-xs">
                    Half Day (&lt; 4.50h)
                  </span>
                ) : (
                  <span className="inline-block mt-0.5 px-2 py-0.5 rounded bg-emerald-950/50 border border-emerald-800 text-emerald-400 font-semibold text-xs">
                    Full Day (≥ 4.50h)
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
