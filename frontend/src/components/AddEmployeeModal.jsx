import React, { useState, useEffect, useRef } from "react";
import {
  UserPlus,
  X,
  AlertCircle,
  Moon,
  Sparkles,
  Check,
  ChevronDown,
} from "lucide-react";
import {
  api,
  friendlyError,
  extractFieldErrors,
  getIstToday,
} from "../api/client";

const EMP_CODE_REGEX = /^EMP\d{4,6}$/;
const EMAIL_REGEX = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export function AddEmployeeModal({
  isOpen,
  onClose,
  onSuccess,
  existingDepartments = [],
  suggestedEmpCode = "EMP0007",
}) {
  const [empCode, setEmpCode] = useState(suggestedEmpCode);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [department, setDepartment] = useState("");
  const [shiftStart, setShiftStart] = useState("09:30");
  const [shiftEnd, setShiftEnd] = useState("18:30");
  const [joinedOn, setJoinedOn] = useState(getIstToday());

  const [departmentsList, setDepartmentsList] = useState(existingDepartments);
  const [deptDropdownOpen, setDeptDropdownOpen] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});
  const [generalError, setGeneralError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const modalRef = useRef(null);
  const firstInputRef = useRef(null);
  const deptContainerRef = useRef(null);

  // Sync suggested code and departments when modal opens
  useEffect(() => {
    if (!isOpen) return;

    setEmpCode(suggestedEmpCode || "EMP0007");
    setName("");
    setEmail("");
    setDepartment(existingDepartments[0] || "Engineering");
    setShiftStart("09:30");
    setShiftEnd("18:30");
    setJoinedOn(getIstToday());
    setFieldErrors({});
    setGeneralError(null);
    setSubmitting(false);

    // Refresh catalog in background to get the freshest suggested code and departments
    let cancelled = false;
    api
      .fetchAllEmployeesCatalog()
      .then(({ departments, nextEmpCode }) => {
        if (cancelled) return;
        if (departments.length > 0) {
          setDepartmentsList(departments);
        }
        if (nextEmpCode) {
          setEmpCode(nextEmpCode);
        }
      })
      .catch(() => {
        // Fallback to props if offline
      });

    // Focus first input on open
    const timer = setTimeout(() => {
      firstInputRef.current?.focus();
    }, 30);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [isOpen, suggestedEmpCode]);

  // Close department combobox dropdown on outside click
  useEffect(() => {
    if (!deptDropdownOpen) return;
    const handleClickOutside = (e) => {
      if (deptContainerRef.current && !deptContainerRef.current.contains(e.target)) {
        setDeptDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [deptDropdownOpen]);

  // Keyboard accessibility: Escape closes & Tab focus trap
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        if (!submitting) onClose();
        return;
      }

      if (e.key === "Tab" && modalRef.current) {
        const focusable = modalRef.current.querySelectorAll(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, submitting, onClose]);

  if (!isOpen) return null;

  // Check if department differs only in case from an existing department
  const caseMismatchDept = departmentsList.find(
    (d) =>
      d.toLowerCase() === department.trim().toLowerCase() &&
      d !== department.trim()
  );

  const isOvernightShift =
    TIME_REGEX.test(shiftStart) &&
    TIME_REGEX.test(shiftEnd) &&
    shiftStart !== shiftEnd &&
    shiftEnd <= shiftStart;

  const isSameShiftTime =
    TIME_REGEX.test(shiftStart) &&
    TIME_REGEX.test(shiftEnd) &&
    shiftStart === shiftEnd;

  const validateForm = () => {
    const errs = {};
    const cleanCode = empCode.trim().toUpperCase();
    const cleanName = name.trim();
    const cleanEmail = email.trim();
    const cleanDept = department.trim();

    if (!cleanCode) {
      errs.emp_code = "Employee code is required";
    } else if (!EMP_CODE_REGEX.test(cleanCode)) {
      errs.emp_code = "Must be EMP followed by 4–6 digits (e.g. EMP0007)";
    }

    if (!cleanName) {
      errs.name = "Full name is required (1–100 characters)";
    } else if (cleanName.length > 100) {
      errs.name = "Name cannot exceed 100 characters";
    }

    if (!cleanEmail) {
      errs.email = "Email address is required";
    } else if (cleanEmail.length > 120) {
      errs.email = "Email cannot exceed 120 characters";
    } else if (!EMAIL_REGEX.test(cleanEmail)) {
      errs.email = "Enter a valid email address (e.g. priya@hrone.com)";
    }

    if (!cleanDept) {
      errs.department = "Department is required (1–50 characters)";
    } else if (cleanDept.length > 50) {
      errs.department = "Department cannot exceed 50 characters";
    }

    if (!TIME_REGEX.test(shiftStart)) {
      errs.shift_start = "Valid 24-hour time HH:MM is required";
    }
    if (!TIME_REGEX.test(shiftEnd)) {
      errs.shift_end = "Valid 24-hour time HH:MM is required";
    }
    if (TIME_REGEX.test(shiftStart) && TIME_REGEX.test(shiftEnd) && shiftStart === shiftEnd) {
      errs.shift_end = "Shift end time must differ from shift start time";
    }

    if (!joinedOn || !DATE_REGEX.test(joinedOn)) {
      errs.joined_on = "Valid joining date (YYYY-MM-DD) is required";
    }

    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (submitting) return;
    setGeneralError(null);

    if (!validateForm()) {
      return;
    }

    setSubmitting(true);
    const payload = {
      emp_code: empCode.trim().toUpperCase(),
      name: name.trim(),
      email: email.trim(),
      department: department.trim(),
      shift_start: shiftStart,
      shift_end: shiftEnd,
      joined_on: joinedOn,
    };

    try {
      const created = await api.createEmployee(payload);
      onSuccess?.(created);
      onClose();
    } catch (err) {
      const friendly = friendlyError(err, "create");
      const serverFieldErrs = extractFieldErrors(err);

      if (err.status === 409) {
        setFieldErrors((prev) => ({
          ...prev,
          emp_code: "Employee code already exists",
        }));
      } else if (Object.keys(serverFieldErrs).length > 0) {
        setFieldErrors((prev) => ({
          ...prev,
          ...serverFieldErrs,
        }));
      }
      setGeneralError(friendly);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-employee-modal-title"
    >
      <div
        ref={modalRef}
        className="bg-slate-950 border border-slate-800 rounded-xl max-w-lg w-full p-6 space-y-5 shadow-2xl my-auto"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-3.5">
          <div className="flex items-center gap-2.5">
            <div className="icon-badge icon-badge-indigo w-9 h-9 rounded-lg bg-indigo-500/15 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
              <UserPlus className="w-4 h-4" />
            </div>
            <div>
              <h3 id="add-employee-modal-title" className="font-bold text-white text-base">
                Register New Employee
              </h3>
              <p className="text-xs text-slate-400">
                Assign unique employee code, department & IST shift schedule
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            aria-label="Close modal"
            className="btn-secondary p-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-slate-200 border border-slate-800 transition cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {generalError && (
          <div
            role="alert"
            className="p-3.5 rounded-lg bg-rose-950/40 border border-rose-800 text-rose-300 text-xs flex items-start gap-2"
          >
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            <span>{generalError}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          {/* Employee Code & Joining Date */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <div className="flex items-center justify-between mb-1">
                <label
                  htmlFor="add-emp-code"
                  className="block text-xs font-semibold text-slate-300 uppercase tracking-wider"
                >
                  Employee Code *
                </label>
                <span className="text-[11px] font-mono text-indigo-400 flex items-center gap-1">
                  <Sparkles className="w-3 h-3" /> Next free
                </span>
              </div>
              <input
                ref={firstInputRef}
                id="add-emp-code"
                type="text"
                required
                maxLength={9}
                value={empCode}
                onChange={(e) => {
                  const val = e.target.value.toUpperCase();
                  setEmpCode(val);
                  if (fieldErrors.emp_code) {
                    setFieldErrors((p) => ({ ...p, emp_code: null }));
                  }
                }}
                placeholder="EMP0007"
                aria-invalid={Boolean(fieldErrors.emp_code)}
                className="w-full bg-slate-900 border border-slate-700 px-3 py-2 rounded-lg text-sm font-mono text-slate-100 outline-none focus:border-indigo-500"
              />
              {fieldErrors.emp_code ? (
                <p className="mt-1 text-xs text-rose-400 flex items-center gap-1">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  {fieldErrors.emp_code}
                </p>
              ) : (
                <p className="mt-1 text-[11px] text-slate-500">
                  Format: <code className="font-mono">EMP</code> + 4–6 digits
                </p>
              )}
            </div>

            <div>
              <label
                htmlFor="add-emp-joined"
                className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1"
              >
                Joining Date (IST) *
              </label>
              <input
                id="add-emp-joined"
                type="date"
                required
                value={joinedOn}
                onChange={(e) => {
                  setJoinedOn(e.target.value);
                  if (fieldErrors.joined_on) {
                    setFieldErrors((p) => ({ ...p, joined_on: null }));
                  }
                }}
                aria-invalid={Boolean(fieldErrors.joined_on)}
                className="w-full bg-slate-900 border border-slate-700 px-3 py-2 rounded-lg text-sm text-slate-100 outline-none focus:border-indigo-500"
              />
              {fieldErrors.joined_on && (
                <p className="mt-1 text-xs text-rose-400 flex items-center gap-1">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  {fieldErrors.joined_on}
                </p>
              )}
            </div>
          </div>

          {/* Full Name */}
          <div>
            <label
              htmlFor="add-emp-name"
              className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1"
            >
              Full Name *
            </label>
            <input
              id="add-emp-name"
              type="text"
              required
              maxLength={100}
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (fieldErrors.name) {
                  setFieldErrors((p) => ({ ...p, name: null }));
                }
              }}
              placeholder="e.g. Vikramaditya Rao"
              aria-invalid={Boolean(fieldErrors.name)}
              className="w-full bg-slate-900 border border-slate-700 px-3 py-2 rounded-lg text-sm text-slate-100 outline-none focus:border-indigo-500"
            />
            {fieldErrors.name && (
              <p className="mt-1 text-xs text-rose-400 flex items-center gap-1">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                {fieldErrors.name}
              </p>
            )}
          </div>

          {/* Email */}
          <div>
            <label
              htmlFor="add-emp-email"
              className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1"
            >
              Work Email *
            </label>
            <input
              id="add-emp-email"
              type="email"
              required
              maxLength={120}
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (fieldErrors.email) {
                  setFieldErrors((p) => ({ ...p, email: null }));
                }
              }}
              placeholder="vikram@hrone.com"
              aria-invalid={Boolean(fieldErrors.email)}
              className="w-full bg-slate-900 border border-slate-700 px-3 py-2 rounded-lg text-sm text-slate-100 outline-none focus:border-indigo-500"
            />
            {fieldErrors.email && (
              <p className="mt-1 text-xs text-rose-400 flex items-center gap-1">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                {fieldErrors.email}
              </p>
            )}
          </div>

          {/* Department Combobox */}
          <div ref={deptContainerRef} className="relative">
            <label
              htmlFor="add-emp-department"
              className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1"
            >
              Department (Select existing or type new) *
            </label>
            <div className="relative flex items-center">
              <input
                id="add-emp-department"
                type="text"
                required
                maxLength={50}
                value={department}
                onFocus={() => setDeptDropdownOpen(true)}
                onChange={(e) => {
                  setDepartment(e.target.value);
                  setDeptDropdownOpen(true);
                  if (fieldErrors.department) {
                    setFieldErrors((p) => ({ ...p, department: null }));
                  }
                }}
                placeholder="Engineering, Sales, Support, or custom..."
                aria-invalid={Boolean(fieldErrors.department)}
                className="w-full bg-slate-900 border border-slate-700 pl-3 pr-9 py-2 rounded-lg text-sm text-slate-100 outline-none focus:border-indigo-500"
              />
              <button
                type="button"
                tabIndex={-1}
                onClick={() => setDeptDropdownOpen((o) => !o)}
                aria-label="Toggle department options"
                className="absolute right-2 p-1 text-slate-400 hover:text-slate-200 cursor-pointer"
              >
                <ChevronDown className="w-4 h-4" />
              </button>
            </div>

            {deptDropdownOpen && departmentsList.length > 0 && (
              <div className="absolute z-20 mt-1 w-full rounded-lg bg-slate-900 border border-slate-700 shadow-xl py-1 max-h-40 overflow-y-auto">
                <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  Existing Departments
                </div>
                {departmentsList.map((dept) => (
                  <button
                    key={dept}
                    type="button"
                    onClick={() => {
                      setDepartment(dept);
                      setDeptDropdownOpen(false);
                      setFieldErrors((p) => ({ ...p, department: null }));
                    }}
                    className="w-full text-left px-3 py-1.5 text-xs text-slate-200 hover:bg-indigo-600/20 flex items-center justify-between cursor-pointer"
                  >
                    <span>{dept}</span>
                    {department.trim() === dept && (
                      <Check className="w-3.5 h-3.5 text-indigo-400" />
                    )}
                  </button>
                ))}
              </div>
            )}

            {caseMismatchDept && (
              <div className="mt-1.5 p-2 rounded-lg bg-amber-950/50 border border-amber-800 text-amber-400 text-xs flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  Case-sensitive match: <strong>{caseMismatchDept}</strong> already exists.
                </span>
                <button
                  type="button"
                  onClick={() => setDepartment(caseMismatchDept)}
                  className="btn-secondary px-2 py-0.5 rounded bg-slate-800 text-slate-100 text-[11px] font-semibold border border-slate-700 cursor-pointer shrink-0"
                >
                  Use "{caseMismatchDept}"
                </button>
              </div>
            )}

            {fieldErrors.department && (
              <p className="mt-1 text-xs text-rose-400 flex items-center gap-1">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                {fieldErrors.department}
              </p>
            )}
          </div>

          {/* Shift Start & Shift End */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
                Shift Schedule (24h IST) *
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    setShiftStart("09:30");
                    setShiftEnd("18:30");
                    setFieldErrors((p) => ({ ...p, shift_start: null, shift_end: null }));
                  }}
                  className="btn-secondary px-2 py-0.5 rounded text-[11px] bg-slate-900 border border-slate-700 text-slate-300 hover:text-white cursor-pointer"
                >
                  Day (09:30–18:30)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShiftStart("22:00");
                    setShiftEnd("06:00");
                    setFieldErrors((p) => ({ ...p, shift_start: null, shift_end: null }));
                  }}
                  className="btn-secondary px-2 py-0.5 rounded text-[11px] bg-slate-900 border border-slate-700 text-slate-300 hover:text-white cursor-pointer"
                >
                  Overnight (22:00–06:00)
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="add-emp-shift-start" className="block text-[11px] text-slate-400 mb-1">
                  Shift Start (HH:MM)
                </label>
                <input
                  id="add-emp-shift-start"
                  type="time"
                  required
                  value={shiftStart}
                  onChange={(e) => {
                    setShiftStart(e.target.value);
                    setFieldErrors((p) => ({ ...p, shift_start: null, shift_end: null }));
                  }}
                  className="w-full bg-slate-900 border border-slate-700 px-3 py-2 rounded-lg text-sm font-mono text-slate-100 outline-none focus:border-indigo-500"
                />
                {fieldErrors.shift_start && (
                  <p className="mt-1 text-xs text-rose-400 flex items-center gap-1">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                    {fieldErrors.shift_start}
                  </p>
                )}
              </div>

              <div>
                <label htmlFor="add-emp-shift-end" className="block text-[11px] text-slate-400 mb-1">
                  Shift End (HH:MM)
                </label>
                <input
                  id="add-emp-shift-end"
                  type="time"
                  required
                  value={shiftEnd}
                  onChange={(e) => {
                    setShiftEnd(e.target.value);
                    setFieldErrors((p) => ({ ...p, shift_start: null, shift_end: null }));
                  }}
                  className="w-full bg-slate-900 border border-slate-700 px-3 py-2 rounded-lg text-sm font-mono text-slate-100 outline-none focus:border-indigo-500"
                />
                {fieldErrors.shift_end && (
                  <p className="mt-1 text-xs text-rose-400 flex items-center gap-1">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                    {fieldErrors.shift_end}
                  </p>
                )}
              </div>
            </div>

            {isSameShiftTime && !fieldErrors.shift_end && (
              <p className="text-xs text-rose-400 flex items-center gap-1.5">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                Shift start and shift end cannot be identical.
              </p>
            )}

            {isOvernightShift && (
              <div className="p-2.5 rounded-lg bg-indigo-950/50 border border-indigo-800/80 text-indigo-400 text-xs flex items-center gap-2">
                <Moon className="w-4 h-4 shrink-0" />
                <span>
                  Overnight shift — punches before <strong>{shiftEnd}</strong> count toward the previous day (R1).
                </span>
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-3 border-t border-slate-800">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="btn-secondary px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-100 text-xs font-semibold border border-slate-700 cursor-pointer transition disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || isSameShiftTime}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-md cursor-pointer transition disabled:opacity-50"
            >
              <UserPlus className="w-3.5 h-3.5" />
              {submitting ? "Creating Employee..." : "Create Employee"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
