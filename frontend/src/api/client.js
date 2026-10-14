const API_BASE = (import.meta.env?.VITE_API_BASE_URL || "http://localhost:8000").replace(/\/$/, "");

/**
 * Formats FastAPI error detail (either a string or a 422 validation array).
 */
export function formatErrorDetail(detail, fallbackStatus) {
  if (!detail) {
    return `Request failed with status ${fallbackStatus}`;
  }
  if (typeof detail === "string") {
    return detail;
  }
  if (Array.isArray(detail)) {
    return detail
      .map((item) => {
        if (!item || typeof item !== "object") return String(item);
        const locArr = Array.isArray(item.loc) ? item.loc : [];
        const lastLoc = locArr.length > 0 ? String(locArr[locArr.length - 1]) : "";
        const msg = item.msg || "Invalid value";
        return lastLoc && lastLoc !== "body" && lastLoc !== "query"
          ? `${lastLoc}: ${msg}`
          : msg;
      })
      .join("; ");
  }
  return JSON.stringify(detail);
}

/**
 * Maps API errors and status codes to clear, human-friendly messages.
 */
export function friendlyError(err, context = "") {
  if (!err) return "An unexpected error occurred";

  // Network / fetch failure (no HTTP status attached)
  if (
    !err.status ||
    err.name === "TypeError" ||
    (typeof err.message === "string" &&
      (err.message.includes("Failed to fetch") ||
        err.message.includes("NetworkError") ||
        err.message.includes("Load failed")))
  ) {
    return "API is offline — check the backend / Render cold start";
  }

  const status = err.status;
  const rawMsg = (err.message || "").toLowerCase();

  if (status === 409) {
    if (context === "create" || rawMsg.includes("emp_code")) {
      return "Employee code already exists";
    }
    if (context === "punch-in" || rawMsg.includes("punched in")) {
      return "Already punched in for this attendance day";
    }
    if (context === "punch-out" || rawMsg.includes("punched out")) {
      return "Already punched out";
    }
    return err.message || "Conflict: resource already exists or was modified";
  }

  if (status === 404) {
    if (rawMsg.includes("no punch-in")) {
      return "No open punch-in found";
    }
    if (context === "punch-in" || context === "punch-out") {
      return rawMsg.includes("employee") ? "Employee not found" : "No open punch-in found";
    }
    return err.message || "Resource not found";
  }

  if (status === 422) {
    return err.message || "Validation error — please check your input";
  }

  return err.message || `Request failed (${status})`;
}

/**
 * Extracts field-level error map from a 422 error's raw detail array.
 */
export function extractFieldErrors(err) {
  const fieldErrors = {};
  if (err && Array.isArray(err.detail)) {
    for (const item of err.detail) {
      if (item && Array.isArray(item.loc) && item.loc.length > 0) {
        const field = String(item.loc[item.loc.length - 1]);
        if (field && field !== "body" && field !== "query") {
          fieldErrors[field] = item.msg || "Invalid value";
        }
      }
    }
  }
  return fieldErrors;
}

// ---------------------------------------------------------------------------
// IST Date & Time Formatting Helpers (Asia/Kolkata, UTC+05:30)
// ---------------------------------------------------------------------------

/**
 * Returns today's calendar date in IST as "YYYY-MM-DD".
 */
export function getIstToday() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const y = parts.find((p) => p.type === "year")?.value;
  const m = parts.find((p) => p.type === "month")?.value;
  const d = parts.find((p) => p.type === "day")?.value;
  return `${y}-${m}-${d}`;
}

/**
 * Returns the current IST calendar month as "YYYY-MM".
 */
export function getIstCurrentMonth() {
  return getIstToday().slice(0, 7);
}

/**
 * Given a "YYYY-MM-DD" date string, returns the previous calendar day "YYYY-MM-DD".
 */
export function getPreviousDateStr(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - 1);
  const py = dt.getUTCFullYear();
  const pm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const pd = String(dt.getUTCDate()).padStart(2, "0");
  return `${py}-${pm}-${pd}`;
}

/**
 * Given a "YYYY-MM-DD" date string, returns the next calendar day "YYYY-MM-DD".
 */
export function getNextDateStr(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + 1);
  const ny = dt.getUTCFullYear();
  const nm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const nd = String(dt.getUTCDate()).padStart(2, "0");
  return `${ny}-${nm}-${nd}`;
}

/**
 * Returns current IST date-time formatted for <input type="datetime-local"> ("YYYY-MM-DDTHH:mm").
 */
export function getIstNowDatetimeLocal() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const y = parts.find((p) => p.type === "year")?.value;
  const m = parts.find((p) => p.type === "month")?.value;
  const d = parts.find((p) => p.type === "day")?.value;
  let hh = parts.find((p) => p.type === "hour")?.value || "09";
  if (hh === "24") hh = "00";
  const mm = parts.find((p) => p.type === "minute")?.value || "30";
  return `${y}-${m}-${d}T${hh}:${mm}`;
}

/**
 * Converts a datetime-local string ("YYYY-MM-DDTHH:mm" or "YYYY-MM-DDTHH:mm:ss")
 * explicitly interpreted as IST (+05:30) into an integer epoch milliseconds value.
 */
export function istDatetimeLocalToEpochMs(dtLocalStr) {
  if (!dtLocalStr || typeof dtLocalStr !== "string") return null;
  const trimmed = dtLocalStr.trim();
  // Match YYYY-MM-DDTHH:mm or YYYY-MM-DDTHH:mm:ss
  const hasSeconds = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(trimmed);
  const isoWithOffset = hasSeconds ? `${trimmed}+05:30` : `${trimmed}:00+05:30`;
  const ms = Date.parse(isoWithOffset);
  return Number.isNaN(ms) ? null : Math.trunc(ms);
}

/**
 * Formats an epoch-ms timestamp to a readable IST date & time string.
 */
export function formatIstDateTime(epochMs) {
  if (epochMs === null || epochMs === undefined) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  }).format(new Date(epochMs));
}

/**
 * Formats an epoch-ms timestamp to a compact IST time string (e.g., "09:35:00 am IST").
 */
export function formatIstTimeOnly(epochMs) {
  if (epochMs === null || epochMs === undefined) return "—";
  const timeStr = new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  }).format(new Date(epochMs));
  return `${timeStr} IST`;
}

// ---------------------------------------------------------------------------
// Core HTTP Request Wrapper
// ---------------------------------------------------------------------------

async function request(path, options = {}) {
  const isVercelProd =
    typeof window !== "undefined" &&
    window.location &&
    window.location.hostname.endsWith(".vercel.app");

  const primaryUrl = isVercelProd ? `/api${path}` : `${API_BASE}${path}`;
  const fallbackUrl = isVercelProd ? `${API_BASE}${path}` : `/api${path}`;

  const config = {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  };

  try {
    let res;
    try {
      res = await fetch(primaryUrl, config);
    } catch (networkErr) {
      // If primary URL fails due to ISP/network block, try fallback URL
      if (typeof window !== "undefined" && fallbackUrl !== primaryUrl) {
        res = await fetch(fallbackUrl, config);
      } else {
        throw networkErr;
      }
    }

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const formattedMsg = formatErrorDetail(data.detail, res.status);
      const err = new Error(formattedMsg);
      err.status = res.status;
      err.detail = data.detail;
      throw err;
    }
    return data;
  } catch (err) {
    console.error(`API Error on ${path}:`, err);
    throw err;
  }
}

export const api = {
  // System Health
  getHealth: () => request("/health"),

  // Employees
  getEmployees: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/employees${query ? `?${query}` : ""}`);
  },
  createEmployee: (payload) =>
    request("/employees", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  /**
   * Pages through GET /employees (page_size=100) until all employees are loaded.
   * Returns { items, departments, nextEmpCode }.
   */
  fetchAllEmployeesCatalog: async () => {
    const allItems = [];
    let page = 1;
    const pageSize = 100;
    while (true) {
      const data = await api.getEmployees({ page, page_size: pageSize });
      const items = data.items || [];
      allItems.push(...items);
      if (allItems.length >= (data.total || 0) || items.length < pageSize) {
        break;
      }
      page += 1;
      if (page > 50) break; // safety guard
    }

    const deptSet = new Set();
    let maxCodeNum = 0;
    for (const emp of allItems) {
      if (emp.department) {
        deptSet.add(emp.department);
      }
      const match = /^EMP(\d{4,6})$/.exec(emp.emp_code || "");
      if (match) {
        const num = parseInt(match[1], 10);
        if (num > maxCodeNum) maxCodeNum = num;
      }
    }

    const departments = Array.from(deptSet).sort((a, b) => a.localeCompare(b));
    const nextNum = maxCodeNum + 1;
    const nextEmpCode = `EMP${String(nextNum).padStart(4, "0")}`;

    return {
      items: allItems,
      departments,
      nextEmpCode,
    };
  },

  // Attendance
  getAttendance: (params = {}) => {
    const cleanParams = {};
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== "") {
        cleanParams[k] = v;
      }
    });
    const query = new URLSearchParams(cleanParams).toString();
    return request(`/attendance${query ? `?${query}` : ""}`);
  },
  punchIn: (payload) =>
    request("/attendance/punch-in", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  punchOut: (payload) =>
    request("/attendance/punch-out", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  regularize: (emp_code, date, payload) =>
    request(`/attendance/${encodeURIComponent(emp_code)}/${encodeURIComponent(date)}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),

  // Analytics
  getEmployeeMonthly: (emp_code, month) =>
    request(`/analytics/employees/${encodeURIComponent(emp_code)}/monthly?month=${encodeURIComponent(month)}`),

  getDepartmentSummary: (month, department = null) => {
    const params = new URLSearchParams({ month });
    if (department) params.append("department", department);
    return request(`/analytics/departments/summary?${params.toString()}`);
  },

  getLeaderboard: (month, limit = 10, department = null) => {
    const params = new URLSearchParams({ month, limit });
    if (department) params.append("department", department);
    return request(`/analytics/leaderboard/late?${params.toString()}`);
  },

  getDepartmentTrend: (department, from, to) =>
    request(`/analytics/departments/${encodeURIComponent(department)}/trend?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`),

  // Explain
  getAdminExplain: (endpoint, params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/admin/explain/${endpoint}${query ? `?${query}` : ""}`);
  },
};
