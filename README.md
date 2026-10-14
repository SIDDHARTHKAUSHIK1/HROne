# Employee Attendance & Analytics Engine (HROne Assessment)

[![Live Dashboard](https://img.shields.io/badge/Live_Dashboard-Vercel-black?style=for-the-badge&logo=vercel)](https://hr-one-two.vercel.app)
[![API Backend](https://img.shields.io/badge/Live_API-Render-46E3B7?style=for-the-badge&logo=render)](https://hrone-backend-v5ft.onrender.com)
[![Swagger Docs](https://img.shields.io/badge/API_Docs-Swagger_UI-85EA2D?style=for-the-badge&logo=swagger)](https://hrone-backend-v5ft.onrender.com/docs)
[![Database](https://img.shields.io/badge/Database-MongoDB_Atlas-47A248?style=for-the-badge&logo=mongodb)](https://www.mongodb.com/cloud/atlas)
[![Walkthrough Video](https://img.shields.io/badge/Walkthrough_Video-1080p_HD-E11D48?style=for-the-badge&logo=youtube&logoColor=white)](./HROne_Senior_Engineering_Walkthrough.mp4)

> 🎥 **Senior Engineering Walkthrough Video**: [**Watch / Download Video (`HROne_Senior_Engineering_Walkthrough.mp4`)**](./HROne_Senior_Engineering_Walkthrough.mp4)  
> 🚀 **Live Production Application**: [**https://hr-one-two.vercel.app**](https://hr-one-two.vercel.app)  
> 📖 **Live Interactive API Documentation**: [**https://hrone-backend-v5ft.onrender.com/docs**](https://hrone-backend-v5ft.onrender.com/docs)  
> 💚 **Live API Health Check**: [**https://hrone-backend-v5ft.onrender.com/health**](https://hrone-backend-v5ft.onrender.com/health)

---

## 🎥 Senior Engineering Walkthrough Video

For the evaluation committee and engineering leadership, a comprehensive 1080p systems walkthrough video is included directly in this repository:

🎬 **[▶️ Click to Watch / Download `HROne_Senior_Engineering_Walkthrough.mp4`](./HROne_Senior_Engineering_Walkthrough.mp4)** *(1080p Full HD, 3m 52s)*

| Chapter | Timestamp | Core Focus & Engineering Demonstrations |
| :--- | :--- | :--- |
| **Scene 1: Architecture Overview** | `0:00 – 0:38` | FastAPI + MongoDB 7.0 + React 19 stack, zero-loss concurrency under simultaneous punch traffic, sub-200ms aggregations. |
| **Scene 2: Contract Rigor (R1–R10)** | `0:38 – 1:21` | Exact IEEE 754 half-up rounding via BSON `Decimal128`, overnight shift origin attribution, strict Pydantic Gregorian calendar validation. |
| **Scene 3: Storage-Level Concurrency** | `1:21 – 2:06` | WiredTiger compound unique index `(emp_code, date)` lock deflecting simultaneous punches with `HTTP 409 Conflict`, atomic CAS regularizations. |
| **Scene 4: 100k Benchmark & Aggregation** | `2:06 – 2:51` | 102,500 record benchmark with 100% IXSCAN (0 COLLSCAN), adaptive hybrid pipeline reducing company-wide latency from 630ms to 200ms via `$unionWith`. |
| **Scene 5: Interactive UI & DevOps** | `2:51 – 3:32` | React 19 dashboard, 7-day moving averages, live MongoDB Query Explain Inspector HUD, keep-alive production workflow. |
| **Scene 6: Conclusion & Verification** | `3:32 – 3:52` | 38/38 automated tests passing (0 skips), production readiness across Render and Vercel. |

---

An enterprise-grade, concurrency-safe, mathematically rigorous attendance management and workforce analytics service engineered for the **HROne Technical Assessment**.

Implemented strictly within [`app/main.py`](app/main.py) with zero external module dependencies. Supported by MongoDB 6.0+ aggregation pipelines, an automated 38-case Pytest harness, isolated benchmark tooling, and an interactive React 19 analytics dashboard with Light & Dark modes.

---

## 1. Quickstart & Local Setup

```bash
# 1. Install dependencies
pip install -r requirements.txt

# 2. Seed database (requires MongoDB 6.0+ running on localhost:27017 or set MONGO_URI)
python sample_seed.py

# 3. Start API service (starts on http://localhost:8000)
uvicorn app.main:app --port 8000 --reload
```

- **API Service**: [http://localhost:8000](http://localhost:8000)
- **Interactive Swagger Docs**: [http://localhost:8000/docs](http://localhost:8000/docs)
- **Readiness Health Check**: [http://localhost:8000/health](http://localhost:8000/health)
- **Run Automated Test Suite**:
  ```bash
  pytest -v
  ```

---

## 2. Submission Artifacts

- **[`app/main.py`](app/main.py)**: The complete single-file implementation covering all 10 assignment endpoints, startup index creation, business rules R1–R10, atomic concurrency controls, shared query builders with `/admin/explain`, and CORS support.
- **[`HROne_Senior_Engineering_Walkthrough.mp4`](HROne_Senior_Engineering_Walkthrough.mp4)**: Complete 1080p Full HD Senior Engineering Walkthrough Video presentation with synchronized neural voiceover and dynamic animations.
- **[`REVIEW.md`](REVIEW.md)**: Comprehensive code review of the starter codebase detailing all **15 starter defects identified** plus **Self-Review Hardening (A1–A5, B7–B8, D13–D14)**.
- **[`DECISIONS.md`](DECISIONS.md)**: Detailed technical answers to all 5 system design and architecture questions:
  1. Compound and unique indexes created for fast execution and race prevention.
  2. Concurrency handling on duplicate punch-ins using database-level uniqueness (`DuplicateKeyError` $\rightarrow$ `HTTP 409`).
  3. Standard competition ranking ($1, 2, 2, 4$) with ties preserved at the pagination cutoff.
  4. Preservation of zero-log employee headcounts via MongoDB `$lookup` with `preserveNullAndEmptyArrays`.
  5. Scalability roadmap for $100\times$ traffic volume (materialized summaries and sharding).
- **[`requirements.txt`](requirements.txt)**: Core dependencies (`fastapi`, `uvicorn`, `pymongo`, `pydantic`, `python-dotenv`, `pytest`, `httpx`).

---

## 3. Core Business Rules (R1 – R10)

| Rule | Description | Implementation |
| :--- | :--- | :--- |
| **R1** | **Time Zone, Attendance Date & Truncation** | All shift times and dates are IST (UTC+05:30). Instants are truncated to whole seconds before any calculation, and the truncated value is stored. A record's `date` is the IST date of `punch_in`; for overnight shifts (`shift_end <= shift_start`), a punch-in strictly earlier than `shift_end` belongs to the previous day's shift. |
| **R2** | **Late Minutes (10-min Grace)** | Measured against each employee's own `shift_start`. Late only if punch-in is *strictly more than* 10:00 after shift start; then `late_minutes` = floor of minutes since `shift_start` (e.g. shift 09:30: 09:40:00 $\rightarrow$ 0, 09:40:01 $\rightarrow$ 10, 10:15:59 $\rightarrow$ 45). Overnight late shifts properly offset. |
| **R3** | **Overtime (30-min Minimum)** | Floor of minutes between `shift_end` and `punch_out`, credited only when $\ge 30$; otherwise 0. Overnight shifts end on the next calendar day. |
| **R4** | **Work Hours Rounding** | $(\text{punch\_out} - \text{punch\_in})$ seconds $/ 3600$, rounded half-up to 2 decimals using Python `Decimal` (`ROUND_HALF_UP`), never banker's rounding. `null` until punch-out. |
| **R5** | **Half Day** | After punch-out, `half_day = true` when the *rounded* `work_hours` $< 4.50$. A half day counts as 0.5 of a present day. |
| **R6** | **Presence** | `PRESENT`, `WFH` and `ON_DUTY` count as present; `ABSENT` and `LEAVE` do not. |
| **R7** | **Working Days** | Mon–Fri, no holiday calendar. Mid-month joiners are counted from `joined_on`. `present_days` counts only weekday records (weekend records still add to late/overtime totals). |
| **R8** | **Reported Number Rounding** | Reported numbers rounded 2 decimals half-up; rates 4 decimals half-up. All aggregation division executed in BSON Decimal128 and Python Decimal half-up (no MongoDB `$round` Banker's rounding). |
| **R9** | **Headcount (Zero-Log Preservation)** | Every employee with `joined_on` on or before the period end is counted, with or without logs. Aggregations start from `employees` and `$lookup` logs with `preserveNullAndEmptyArrays`. |
| **R10** | **Pagination** | `page` starts at 1, `page_size` defaults to 20 (max 100), and `total` always reflects the applied filters. |

---

## 4. Automated Testing Suite

An automated Pytest test suite validates all business rules, concurrency races, validation edge cases, and query plans:

```bash
# Run all tests (automatically isolates into TEST_MONGO_DB="hrone_test")
python -m pytest -v
```

> 🛡️ **Production Database Protection**: `tests/conftest.py` strictly prevents testing against the production database (`attendance_db`). The test suite defaults to `hrone_test` (configurable via `TEST_MONGO_DB`), drops the test database upon completion, and validates connectivity with a 2-second timeout.

**Test Results: 38 passed, 1 warning in 1.38s**
- **`tests/test_rules.py`**: Pure unit tests for R1 second truncation, overnight date attribution, R2 grace period and overnight late calculations, R3 overtime thresholds, R4 half-up rounding (e.g. `4.005` $\rightarrow$ `4.01`), R5 rounded half-day thresholds, R7 mid-month/weekend working days, and exact epoch millisecond round-tripping.
- **`tests/test_validation.py`**: Validates all HTTP 422 conditions: seconds-looking/float/string/bool `punched_at`, `status=ABSENT` at punch-in, equal shift start/end, impossible calendar dates (`2026-02-30`), inverted date ranges, out-of-range pagination, trends exceeding 92 days, leaderboard limits $> 50$, and missing explain parameters.
- **`tests/test_attendance.py`**: Validates CRUD pagination, overnight punch cycles, atomic punch-out error states (404, 409, 422), complete regularizations (PATCH) with audit history, derived field recalculation, ABSENT punch time clearing, legacy record compatibility, and absence of internal `_id` / `id` fields in responses.
- **`tests/test_concurrency.py`**: Multithreaded stress testing using 20-thread `threading.Barrier` instances verifying:
  - Concurrent duplicate employee creation: exactly one 201, 19 409s.
  - Concurrent duplicate punch-ins: exactly one 201, 19 409s, exactly 1 document in the database.
  - Concurrent duplicate punch-outs: exactly one 200, 19 409s.
  - Concurrent distinct regularizations (PATCH): zero history entries lost, loser updates receive 409.
  - Punch-out racing against regularization: punch-out is never silently overwritten.
- **`tests/test_analytics.py`**: Comprehensive aggregation verification for leaderboard competition ties (1, 1, 3), orphan log filtering, department-scoped rankings, zero-log headcounts, later-joiner exclusions, mid-month joiners, Decimal128 record-level average work hours, gap-filled moving average trends, and single-department vs. all-departments hybrid aggregation parity.
- **`tests/test_explain.py`**: Directly asserts that every endpoint and filter permutation contains `IXSCAN` and **zero `COLLSCAN`** operations.

---

## 5. Query Optimization & 100k-Record Benchmark

All query paths are backed by compound indexes created automatically via `ensure_indexes()`. Both the live endpoints and `/admin/explain/{endpoint}` share the exact same underlying pipeline builders to guarantee complete plan parity.

A standalone benchmark script seeds ~100k attendance records into an isolated database (`hrone_bench`) and times each endpoint over 20 runs:

```bash
python scripts/benchmark.py
```

### Benchmark Results (~102,500 Records, 500 Employees)

| Endpoint / Query | Target Collection | p50 (ms) | p95 (ms) | Winning Plan | Keys Examined | Docs Examined | Scan Type |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| List Employees (Page 1) | `employees` | 7.4 | 8.5 | `IXSCAN` | 20 | 20 | IXSCAN [PASS] |
| List Employees (Dept Filter) | `employees` | 6.5 | 7.4 | `IXSCAN` | 20 | 20 | IXSCAN [PASS] |
| List Attendance (Default Sort) | `attendance_logs` | 54.5 | 60.8 | `LIMIT` | 20 | 20 | IXSCAN [PASS] |
| List Attendance (Status Filter) | `attendance_logs` | 27.9 | 33.2 | `LIMIT` | 20 | 20 | IXSCAN [PASS] |
| List Attendance (Date Range) | `attendance_logs` | 12.7 | 16.4 | `LIMIT` | 20 | 20 | IXSCAN [PASS] |
| List Attendance (Emp + Date Range) | `attendance_logs` | 8.1 | 8.8 | `LIMIT` | 20 | 20 | IXSCAN [PASS] |
| Employee Monthly Summary | `attendance_logs` | 7.0 | 8.4 | `IXSCAN` | 22 | 22 | IXSCAN [PASS] |
| Department Summary (All) | `employees` | 202.9 | 226.0 | `PROJECTION_DEFAULT` | 500 | 500 | IXSCAN [PASS] |
| Department Summary (Single Dept) | `employees` | 120.5 | 132.5 | `IXSCAN` | 100 | 100 | IXSCAN [PASS] |
| Late Leaderboard (Month, Top 10) | `attendance_logs` | 79.6 | 94.5 | `IXSCAN` | 1579 | 1557 | IXSCAN [PASS] |
| Late Leaderboard (Dept Filtered) | `attendance_logs` | 129.2 | 141.2 | `IXSCAN` | 1579 | 1557 | IXSCAN [PASS] |
| Department Trend (30 Days) | `employees` | 110.9 | 120.9 | `IXSCAN` | 100 | 100 | IXSCAN [PASS] |
| Department Trend (90 Days) | `employees` | 107.6 | 147.6 | `IXSCAN` | 100 | 100 | IXSCAN [PASS] |

*Benchmark Environment: 102,500 attendance records, 500 employees | MongoDB v8.0.10 Community | Windows 11 (AMD64 / Intel64 Family 6 Model 154 Stepping 3) | October 14, 2026*

**Key Findings:**
1. **Zero COLLSCAN**: Every single list and analytics operation utilizes indexed scans (`IXSCAN`).
2. **Sub-150ms Targeted Analytics**: Single-department summaries, 30-day trends, and late leaderboards execute well under 150ms p95 on over 100,000 documents; full-company cross-department summaries across all 500 employees complete in ~213ms p95 (down from ~677ms).
3. **Index-Covered Status Filtering**: Adding `{status: 1, date: -1, emp_code: 1}` allows status-filtered list queries and document counts to execute on `IXSCAN` without scanning the collection.

---

## 6. Interactive Frontend Dashboard

An enterprise dashboard built with React 19, Tailwind CSS v4, and Recharts:

```bash
cd frontend
npm install
npm run dev
# Open http://localhost:5173
```

- **Theme Switcher**: Dynamic Light Mode and Dark Mode toggle button with high-contrast typography.
- **Analytics KPI Cards**: Executive workforce indicators (Total Employees, Attendance Rate, Late Incidents, Overtime Hours).
- **Interactive Trends**: Gap-filled daily attendance chart with a 7-day moving average overlay.
- **Late-Comers Leaderboard**: Department-filtered competition ranking with tie badges.
- **Daily Attendance & Regularization Modal**: Full daily punch log with an inline correction modal writing immutable audit histories.
- **Query Explain Inspector**: Live visualization of MongoDB index plans and execution statistics.
