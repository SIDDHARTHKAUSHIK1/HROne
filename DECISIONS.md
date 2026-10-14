# DECISIONS.md

### 1. Indexes
All indexes are idempotently registered via `ensure_indexes()` using default MongoDB index names:

* **`employees`**:
  * `{emp_code: 1}` (unique): Serves employee identity lookups (`GET /employees/{emp_code}`, `POST /attendance/punch-in`, `POST /attendance/punch-out`, `PATCH /attendance/{emp_code}/{date}`, `/analytics/employees/{emp_code}/monthly`), uniqueness guarantees on employee creation, and default sorting in `list_employees`.
  * `{department: 1, emp_code: 1}`: Serves filtered `list_employees` (IXSCAN on department filter + emp_code sort) and department matching in `department_summary` and `department_trend`.
  * `{joined_on: 1}`: Serves monthly headcount filtering in `department_summary` when no department filter is specified (`joined_on <= month_end`).

* **`attendance_logs`**:
  * `{emp_code: 1, date: 1}` (unique): Authoritative natural key serving point lookups in `regularize_attendance`, monthly aggregations in `employee_monthly`, and the target foreign index for concise `$lookup`s. Guarantees single punch-in per date at the storage engine level.
  * `{date: -1, emp_code: 1}`: Serves default attendance listing (`GET /attendance`) and date-range queries (`date_from`, `date_to`) allowing sort and filter pushdown without in-memory sorting.
  * `{status: 1, date: -1, emp_code: 1}`: Added specifically so queries filtered by `status` (e.g. `status=PRESENT`) execute filter, sort, and pagination count (`count_documents`) entirely on an index scan (`IXSCAN`), eliminating collection scans.
  * `{date: 1, late_minutes: 1}`: Serves `late_leaderboard` initial stage (`date` in month range and `late_minutes > 0`).
  * `{emp_code: 1, punch_in: -1}`: Added specifically for `POST /attendance/punch-out`, which resolves the employee's most recent open record whose `punch_in <= punched_at` sorted descending. Eliminates in-memory sorting on unindexed punch times.

---

### 2. Punch-in Race Condition
When concurrent punch-in requests arrive for the same employee and attendance date, both compute the identical IST attendance date (`R1`). We intentionally avoid check-then-insert (`find_one` followed by `insert_one`), because two simultaneous requests would both find no document and attempt duplicate insertions.

Instead, we rely directly on MongoDB's unique compound index on `attendance_logs(emp_code, date)`:
* Exactly one request acquires the insertion lock at the WiredTiger storage engine level and returns `HTTP 201`.
* All concurrent duplicate attempts immediately fail with a `DuplicateKeyError` (E11000).
* The application intercepts `DuplicateKeyError` and converts it into `HTTP 409 Conflict`.
* To defend against index erasure if the database is reseeded via `mongoimport --drop` or `collection.drop()`, `ensure_indexes()` is invoked at application startup (with non-fatal logging) and re-verified on every `/health` check probe before test runners execute.

---

### 3. Ties in Late Leaderboard
Standard competition ranking ($1, 2, 2, 4$) is implemented using MongoDB 5.0+ `$setWindowFields` with the `$rank` operator:
* Records in the requested month with `late_minutes > 0` are pre-filtered and grouped by `emp_code`.
* If a `department` query parameter is provided, it is applied **before** the ranking window so that competition ranks are computed strictly within that department.
* Ranking is computed over `total_late_minutes` descending. Tied employees share the same rank, and subsequent ranks are skipped (e.g., two employees tied for rank 1 will cause the next employee to receive rank 3).
* The pagination filter `{"$match": {"rank": {"$lte": limit}}}` is applied **after** ranking. When multiple candidates tie at or below the cutoff limit, all tied candidates are returned, allowing the response count to legitimately exceed `limit`.
* The final result is ordered deterministically by `total_late_minutes` descending, then `emp_code` ascending.

---

### 4. Headcount Preservation (Zero-Log Employees)
Rule R9 mandates that every employee who joined on or before the period end (`joined_on <= month_end`) is included in department headcount, regardless of whether they have any attendance logs.

To enforce this:
1. The aggregation pipeline starts from the `employees` collection with `{"$match": {"joined_on": {"$lte": month_end}}}`.
2. Each matched employee becomes a row `{emp_code, department, is_emp: 1}`.
3. A `$unionWith` on `attendance_logs` reads the month's logs once (IXSCAN on `date`) and groups them by `emp_code` into one stats row per employee.
4. A `$group` by `emp_code` merges each employee row with its stats row, and `$match {is_emp: 1}` keeps only in-scope employees. An employee with zero logs keeps its row (stats default to 0). Logs of later joiners, other departments, or deleted employees have no employee row and are dropped.
5. A final `$group` by department computes `headcount` as `{"$sum": 1}`, so zero-log employees count while record-level averages stay correct.

We use a hybrid pipeline architecture: when a single department is specified, we execute concise per-employee `$lookup`s on `(emp_code, date)` because evaluating only that department's employees (~100 in benchmark) is fast (~132 ms p50) and skips unrelated department records entirely. For company-wide summaries (no department specified), we execute a single-pass `$unionWith` that reads the entire month's logs once via the date index (~193 ms p50), avoiding the high cumulative overhead of ~500 individual index lookups.

---

### 5. Architecture for 100x Data Scale (~10 Million Records)
At $100\times$ volume (~10M attendance records and ~50k employees), running on-the-fly cross-collection `$lookup` aggregations across millions of raw punch documents incurs unacceptable I/O and working-set pressure.

The single primary architectural change would be **write-time incremental daily rollups**:
* Introduce materialized rollup collections: `daily_dept_stats` and `monthly_emp_stats`.
* Inside a MongoDB multi-document ACID transaction encompassing `punch-in`, `punch-out`, or `PATCH` regularizations, we atomically update the rollup collections using `$inc`:
  * `punch-in`: increments daily presence count and adds `late_minutes`.
  * `punch-out`: increments total work hours and overtime minutes.
  * `regularize (PATCH)`: calculates the delta between the old and new derived fields (`new_work_hours - old_work_hours`, etc.) and applies the exact delta with `$inc`.
* Analytics endpoints then query small, bounded pre-aggregated tables:
  * `department_summary`: reads at most 1 document per department.
  * `department_trend`: reads at most 31 to 92 daily rollup documents.
  * `employee_monthly`: reads exactly 1 document.
* **Trade-offs**: Write amplification on punch operations is minimized because rollups are small key-value counter updates. To guarantee eventual consistency against unexpected failures, a lightweight background reconciliation job runs nightly to verify rollup integrity against raw audit logs.
* Sharding on `{emp_code: "hashed", date: 1}` and Redis caching would be secondary optimizations applied only after materialized rollups.
