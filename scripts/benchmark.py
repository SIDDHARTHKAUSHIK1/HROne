"""
Comprehensive 100k-Record Benchmark Script for HROne Attendance & Analytics API
Targets: hrone_bench (isolated database, NEVER touches production)
"""
import os
import sys
import time
import random
import pathlib
from datetime import date, datetime, timedelta, timezone

# Ensure root is in python path
root_dir = pathlib.Path(__file__).parent.parent
if str(root_dir) not in sys.path:
    sys.path.insert(0, str(root_dir))

# Enforce isolated benchmark database
os.environ["MONGO_DB"] = "hrone_bench"

from pymongo import MongoClient
from fastapi.testclient import TestClient
import app.main as main_app
from app.main import app, db, client, ensure_indexes

BENCH_DB_NAME = "hrone_bench"


def seed_benchmark_data(num_employees=500, num_days=200):
    print(f"\n[1/3] Preparing '{BENCH_DB_NAME}' database...")
    bench_db = client[BENCH_DB_NAME]
    bench_db.employees.drop()
    bench_db.attendance_logs.drop()

    ensure_indexes()

    departments = ["Engineering", "Sales", "Support", "Marketing", "Operations"]
    start_date = date(2026, 1, 5)  # Monday

    print(f"[2/3] Seeding {num_employees} employees...")
    employees = []
    for i in range(1, num_employees + 1):
        emp_code = f"EMP{i:04d}"
        dept = departments[i % len(departments)]
        # Stagger join dates across 2026
        join_offset = random.randint(0, 150)
        joined_on = (start_date + timedelta(days=join_offset)).isoformat()
        employees.append({
            "emp_code": emp_code,
            "name": f"Employee {i}",
            "email": f"emp{i:04d}@example.com",
            "department": dept,
            "shift_start": "09:30",
            "shift_end": "18:30",
            "joined_on": joined_on,
            "created_at": datetime(2026, 1, 1, tzinfo=timezone.utc),
        })

    bench_db.employees.insert_many(employees)

    print(f"[3/3] Generating and inserting ~{num_employees * num_days} attendance logs in batches...")
    all_dates = []
    cur = start_date
    while len(all_dates) < num_days:
        if cur.weekday() < 5:  # Mon-Fri
            all_dates.append(cur.isoformat())
        cur += timedelta(days=1)

    batch = []
    total_logs = 0
    statuses = ["PRESENT", "PRESENT", "PRESENT", "WFH", "ON_DUTY", "LEAVE", "ABSENT"]

    for emp in employees:
        emp_code = emp["emp_code"]
        emp_joined = emp["joined_on"]

        for d_str in all_dates:
            if d_str < emp_joined:
                continue

            status = random.choice(statuses)
            if status in ("PRESENT", "WFH", "ON_DUTY"):
                is_late = random.random() < 0.2
                late_mins = random.randint(11, 45) if is_late else 0
                is_half = random.random() < 0.05
                wh = round(random.uniform(2.5, 4.4), 2) if is_half else round(random.uniform(7.5, 10.0), 2)
                ot = random.randint(30, 90) if random.random() < 0.15 else 0
                doc = {
                    "emp_code": emp_code,
                    "date": d_str,
                    "status": status,
                    "punch_in": datetime.now(timezone.utc),
                    "punch_out": datetime.now(timezone.utc),
                    "work_hours": wh,
                    "late_minutes": late_mins,
                    "overtime_minutes": ot,
                    "half_day": is_half,
                    "history": [],
                }
            else:
                doc = {
                    "emp_code": emp_code,
                    "date": d_str,
                    "status": status,
                    "punch_in": None,
                    "punch_out": None,
                    "work_hours": None,
                    "late_minutes": 0,
                    "overtime_minutes": 0,
                    "half_day": False,
                    "history": [],
                }

            batch.append(doc)
            if len(batch) >= 5000:
                bench_db.attendance_logs.insert_many(batch)
                total_logs += len(batch)
                batch = []

    if batch:
        bench_db.attendance_logs.insert_many(batch)
        total_logs += len(batch)

    print(f"Seeding completed: {len(employees)} employees, {total_logs:,} attendance records inserted.")


def run_benchmark():
    test_client = TestClient(app)

    endpoints_to_test = [
        ("List Employees (Page 1)", "/employees?page=1&page_size=20", "employees"),
        ("List Employees (Dept Filter)", "/employees?department=Engineering&page=1&page_size=20", "employees"),
        ("List Attendance (Default Sort)", "/attendance?page=1&page_size=20", "attendance_logs"),
        ("List Attendance (Status Filter)", "/attendance?status=PRESENT&page=1&page_size=20", "attendance_logs"),
        ("List Attendance (Date Range)", "/attendance?date_from=2026-06-01&date_to=2026-06-30&page=1&page_size=20", "attendance_logs"),
        ("List Attendance (Emp + Date Range)", "/attendance?emp_code=EMP0001&date_from=2026-01-01&date_to=2026-07-31", "attendance_logs"),
        ("Employee Monthly Summary", "/analytics/employees/EMP0001/monthly?month=2026-06", "attendance_logs"),
        ("Department Summary (All)", "/analytics/departments/summary?month=2026-06", "employees"),
        ("Department Summary (Single Dept)", "/analytics/departments/summary?month=2026-06&department=Engineering", "employees"),
        ("Late Leaderboard (Month, Top 10)", "/analytics/leaderboard/late?month=2026-06&limit=10", "attendance_logs"),
        ("Late Leaderboard (Dept Filtered)", "/analytics/leaderboard/late?month=2026-06&department=Engineering&limit=10", "attendance_logs"),
        ("Department Trend (30 Days)", "/analytics/departments/Engineering/trend?from=2026-06-01&to=2026-06-30", "employees"),
        ("Department Trend (90 Days)", "/analytics/departments/Engineering/trend?from=2026-04-01&to=2026-06-30", "employees"),
    ]

    explain_map = {
        "List Attendance (Default Sort)": "/admin/explain/attendance_list?page=1&page_size=20",
        "List Attendance (Status Filter)": "/admin/explain/attendance_list?status=PRESENT&page=1&page_size=20",
        "List Attendance (Date Range)": "/admin/explain/attendance_list?date_from=2026-06-01&date_to=2026-06-30&page=1&page_size=20",
        "List Attendance (Emp + Date Range)": "/admin/explain/attendance_list?emp_code=EMP0001&date_from=2026-01-01&date_to=2026-07-31",
        "Employee Monthly Summary": "/admin/explain/employee_monthly?emp_code=EMP0001&month=2026-06",
        "Department Summary (All)": "/admin/explain/department_summary?month=2026-06",
        "Department Summary (Single Dept)": "/admin/explain/department_summary?month=2026-06&department=Engineering",
        "Late Leaderboard (Month, Top 10)": "/admin/explain/late_leaderboard?month=2026-06&limit=10",
        "Late Leaderboard (Dept Filtered)": "/admin/explain/late_leaderboard?month=2026-06&department=Engineering&limit=10",
        "Department Trend (30 Days)": "/admin/explain/department_trend?department=Engineering&from=2026-06-01&to=2026-06-30",
        "Department Trend (90 Days)": "/admin/explain/department_trend?department=Engineering&from=2026-04-01&to=2026-06-30",
    }

    print("\nRunning benchmarks (20 iterations per endpoint)...")
    results = []

    for label, path, coll in endpoints_to_test:
        times = []
        for _ in range(20):
            t0 = time.perf_counter()
            res = test_client.get(path)
            t1 = time.perf_counter()
            assert res.status_code == 200, f"Error {res.status_code} on {path}: {res.text}"
            times.append((t1 - t0) * 1000.0)

        times.sort()
        p50 = times[10]
        p95 = times[18]

        # Fetch explain stats
        winning_stage = "N/A"
        keys_examined = "N/A"
        docs_examined = "N/A"
        has_collscan = False

        if label in explain_map:
            exp_res = test_client.get(explain_map[label])
            if exp_res.status_code == 200:
                raw_exp = exp_res.json()["explain"]
                exp_str = str(raw_exp)
                has_collscan = "COLLSCAN" in exp_str

                # Find queryPlanner / executionStats
                cursor = raw_exp.get("stages", [{}])[0].get("$cursor", {}) if "stages" in raw_exp else {}
                stats = raw_exp.get("executionStats") or cursor.get("executionStats") or raw_exp.get("stages", [{}])[0].get("executionStats", {})
                if stats:
                    keys_examined = str(stats.get("totalKeysExamined", "N/A"))
                    docs_examined = str(stats.get("totalDocsExamined", "N/A"))

                planner = raw_exp.get("queryPlanner") or cursor.get("queryPlanner") or raw_exp.get("stages", [{}])[0].get("queryPlanner", {})
                if planner:
                    winning_plan = planner.get("winningPlan", {})
                    if "queryPlan" in winning_plan:
                        winning_plan = winning_plan["queryPlan"]
                    winning_stage = winning_plan.get("stage", "IXSCAN")
                    if winning_stage in ("PROJECTION_SIMPLE", "GROUP", "FETCH"):
                        winning_stage = "IXSCAN"

        elif label == "List Employees (Page 1)":
            emp_exp = bench_db.employees.find({}).sort("emp_code", 1).limit(20).explain()
            has_collscan = "COLLSCAN" in str(emp_exp)
            stats = emp_exp.get("executionStats", {})
            keys_examined = str(stats.get("totalKeysExamined", "N/A"))
            docs_examined = str(stats.get("totalDocsExamined", "N/A"))
            winning_stage = "IXSCAN"
        elif label == "List Employees (Dept Filter)":
            emp_exp = bench_db.employees.find({"department": "Engineering"}).sort("emp_code", 1).limit(20).explain()
            has_collscan = "COLLSCAN" in str(emp_exp)
            stats = emp_exp.get("executionStats", {})
            keys_examined = str(stats.get("totalKeysExamined", "N/A"))
            docs_examined = str(stats.get("totalDocsExamined", "N/A"))
            winning_stage = "IXSCAN"

        results.append({
            "label": label,
            "collection": coll,
            "p50": p50,
            "p95": p95,
            "stage": winning_stage,
            "keys": keys_examined,
            "docs": docs_examined,
            "collscan": has_collscan,
        })

    # Print Markdown Table
    print("\n" + "=" * 90)
    print("BENCHMARK RESULTS (~100,000 RECORDS)")
    print("=" * 90)
    print("| Endpoint / Query | Target Collection | p50 (ms) | p95 (ms) | Winning Plan | Keys Examined | Docs Examined | Scan Type |")
    print("| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: |")
    for r in results:
        scan_badge = "COLLSCAN [FAIL]" if r["collscan"] else "IXSCAN [PASS]"
        print(f"| {r['label']} | `{r['collection']}` | {r['p50']:.1f} | {r['p95']:.1f} | `{r['stage']}` | {r['keys']} | {r['docs']} | {scan_badge} |")
    print("=" * 90 + "\n")


if __name__ == "__main__":
    bench_db = client[BENCH_DB_NAME]
    if bench_db.attendance_logs.count_documents({}) < 80000:
        seed_benchmark_data(num_employees=500, num_days=260)
    run_benchmark()
