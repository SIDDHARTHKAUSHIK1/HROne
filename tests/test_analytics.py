from datetime import datetime
import pytest
from app.main import IST, db


def test_leaderboard_competition_ranking_ties_and_department(client):
    # Setup test scenario for leaderboard:
    # EMP0001 (Engineering): 60 late mins
    # EMP0002 (Engineering): 60 late mins (ties with EMP0001)
    # EMP0003 (Engineering): 30 late mins
    # EMP0004 (Marketing): 60 late mins
    # EMP9999 (Orphan log - employee does not exist): 100 late mins
    db.attendance_logs.delete_many({"date": {"$gte": "2026-07-01", "$lte": "2026-07-31"}})

    db.employees.delete_one({"emp_code": "EMP0007"})
    db.employees.insert_one({
        "emp_code": "EMP0007",
        "name": "Eng Three",
        "department": "Engineering",
        "joined_on": "2026-01-01",
        "shift_start": "09:30",
        "shift_end": "18:30",
        "email": "eng3@example.com",
    })

    db.attendance_logs.insert_many([
        {"emp_code": "EMP0001", "date": "2026-07-06", "late_minutes": 60, "status": "PRESENT"},
        {"emp_code": "EMP0002", "date": "2026-07-06", "late_minutes": 60, "status": "PRESENT"},
        {"emp_code": "EMP0007", "date": "2026-07-06", "late_minutes": 30, "status": "PRESENT"},
        {"emp_code": "EMP0004", "date": "2026-07-06", "late_minutes": 60, "status": "PRESENT"},
        {"emp_code": "EMP9999", "date": "2026-07-06", "late_minutes": 100, "status": "PRESENT"},
    ])

    # 1. Global leaderboard with limit=2
    # Ranks should be: 1 (EMP0001), 1 (EMP0002), 1 (EMP0004) -> ties share rank 1! Next rank skipped!
    # With limit=2, all employees with rank <= 2 returned -> returns 3 rows!
    res = client.get("/analytics/leaderboard/late?month=2026-07&limit=2")
    assert res.status_code == 200
    items = res.json()["items"]
    assert len(items) == 3
    # Ties sorted by emp_code ascending
    assert items[0]["emp_code"] == "EMP0001" and items[0]["rank"] == 1
    assert items[1]["emp_code"] == "EMP0002" and items[1]["rank"] == 1
    assert items[2]["emp_code"] == "EMP0004" and items[2]["rank"] == 1

    # Orphan log (EMP9999) must be ignored
    emp_codes = [x["emp_code"] for x in items]
    assert "EMP9999" not in emp_codes

    # 2. Department-scoped ranking (Engineering only)
    res_dept = client.get("/analytics/leaderboard/late?month=2026-07&department=Engineering&limit=10")
    assert res_dept.status_code == 200
    d_items = res_dept.json()["items"]
    assert len(d_items) == 3
    assert d_items[0]["emp_code"] == "EMP0001" and d_items[0]["rank"] == 1
    assert d_items[1]["emp_code"] == "EMP0002" and d_items[1]["rank"] == 1
    assert d_items[2]["emp_code"] == "EMP0007" and d_items[2]["rank"] == 3


def test_department_summary_analytics_headcount_and_averages(client):
    # Test:
    # 1. Zero-log employee counted in headcount
    # 2. Later joiner (joined_on > month_end) excluded from headcount
    # 3. Weekend record excluded from present_days but included in late/OT
    # 4. Half day = 0.5
    # 5. avg_work_hours over records with exact Decimal128 rounding
    # 6. LEAVE and ON_DUTY counts
    db.employees.delete_many({})
    db.attendance_logs.delete_many({})

    # 3 employees in "Operations":
    # Op1 joined 2026-01-01 (has 2 records: 1 weekday full day, 1 weekend record)
    # Op2 joined 2026-07-15 (has 1 half-day record, 1 LEAVE, 1 ON_DUTY)
    # Op3 joined 2026-06-01 (ZERO logs)
    # Op4 joined 2026-08-01 (Later joiner - must be excluded)
    db.employees.insert_many([
        {"emp_code": "OP01", "name": "Op One", "department": "Operations", "joined_on": "2026-01-01", "shift_start": "09:30", "shift_end": "18:30", "email": "o1@ex.com", "created_at": datetime(2026, 1, 1, tzinfo=IST)},
        {"emp_code": "OP02", "name": "Op Two", "department": "Operations", "joined_on": "2026-07-15", "shift_start": "09:30", "shift_end": "18:30", "email": "o2@ex.com", "created_at": datetime(2026, 7, 15, tzinfo=IST)},
        {"emp_code": "OP03", "name": "Op Three", "department": "Operations", "joined_on": "2026-06-01", "shift_start": "09:30", "shift_end": "18:30", "email": "o3@ex.com", "created_at": datetime(2026, 6, 1, tzinfo=IST)},
        {"emp_code": "OP04", "name": "Op Four", "department": "Operations", "joined_on": "2026-08-01", "shift_start": "09:30", "shift_end": "18:30", "email": "o4@ex.com", "created_at": datetime(2026, 8, 1, tzinfo=IST)},
    ])

    # avg_work_hours is the mean over present-status records with work_hours (weekend included), not per-employee means.
    # Note: 2026-07-06 is Mon (weekday), 2026-07-11 is Sat (weekend), 2026-07-16 is Thu (weekday)
    db.attendance_logs.insert_many([
        # Op1: Weekday record (8.15h)
        {"emp_code": "OP01", "date": "2026-07-06", "status": "PRESENT", "half_day": False, "work_hours": 8.15, "late_minutes": 20, "overtime_minutes": 0},
        # Op1: Weekend record (Saturday) -> excluded from present_days, but late_minutes counted
        {"emp_code": "OP01", "date": "2026-07-11", "status": "PRESENT", "half_day": False, "work_hours": 4.0, "late_minutes": 15, "overtime_minutes": 0},
        # Op2: Weekday half-day record (4.42h)
        {"emp_code": "OP02", "date": "2026-07-16", "status": "WFH", "half_day": True, "work_hours": 4.42, "late_minutes": 0, "overtime_minutes": 0},
        # Op2: Leave record
        {"emp_code": "OP02", "date": "2026-07-17", "status": "LEAVE", "half_day": False, "work_hours": None, "late_minutes": 0, "overtime_minutes": 0},
        # Op2: On duty record
        {"emp_code": "OP02", "date": "2026-07-20", "status": "ON_DUTY", "half_day": False, "work_hours": None, "late_minutes": 0, "overtime_minutes": 0},
    ])

    res = client.get("/analytics/departments/summary?month=2026-07&department=Operations")
    assert res.status_code == 200
    items = res.json()["items"]
    assert len(items) == 1
    row = items[0]

    # Headcount: OP01, OP02, OP03 = 3 (OP04 excluded)
    assert row["headcount"] == 3
    # present_days: Op1 (1.0) + Op1 weekend (0.0) + Op2 half-day (0.5) + Op2 ON_DUTY (1.0) = 2.5
    assert row["present_days"] == 2.5
    # avg_work_hours: (8.15 + 4.0 + 4.42) / 3 = 16.57 / 3 = 5.5233... -> 5.52
    assert row["avg_work_hours"] == 5.52
    # Late counts & minutes: 2 late records (20 + 15 = 35 mins)
    assert row["late_count"] == 2
    assert row["total_late_minutes"] == 35
    # Leave & On duty:
    assert row["leave_count"] == 1
    assert row["on_duty_count"] == 1


def test_employee_monthly_mid_month_and_weekend(client):
    db.employees.delete_many({})
    db.attendance_logs.delete_many({})

    # Mid-month joiner: joined 2026-07-20 (Mon). In July 2026 (31 days), July 20 to July 31 has 10 weekdays.
    db.employees.insert_one({
        "emp_code": "EMP0010",
        "name": "Mid Month",
        "department": "IT",
        "joined_on": "2026-07-20",
        "shift_start": "09:30",
        "shift_end": "18:30",
        "email": "mid@ex.com",
    })

    # Add 1 weekday present (half day), 1 weekend present
    db.attendance_logs.insert_many([
        {"emp_code": "EMP0010", "date": "2026-07-20", "status": "PRESENT", "half_day": True, "late_minutes": 10, "overtime_minutes": 0},
        {"emp_code": "EMP0010", "date": "2026-07-25", "status": "PRESENT", "half_day": False, "late_minutes": 5, "overtime_minutes": 30},
    ])

    res = client.get("/analytics/employees/EMP0010/monthly?month=2026-07")
    assert res.status_code == 200
    data = res.json()
    assert data["working_days"] == 10
    # Weekend record excluded from present_days:
    assert data["present_days"] == 0.5
    # Attendance % = (0.5 / 10) * 100 = 5.0%
    assert data["attendance_pct"] == 5.0
    # Weekend record included in late and overtime totals:
    assert data["late_count"] == 2
    assert data["total_late_minutes"] == 15
    assert data["total_overtime_minutes"] == 30


def test_department_trend_complete_behavior(client):
    db.employees.delete_many({})
    db.attendance_logs.delete_many({})

    # Department "HR":
    # H1 joined 2026-07-06 (Mon)
    # H2 joined 2026-07-09 (Thu) - Headcount step-up!
    db.employees.insert_many([
        {"emp_code": "H1", "name": "H One", "department": "HR", "joined_on": "2026-07-06", "shift_start": "09:30", "shift_end": "18:30", "email": "h1@ex.com"},
        {"emp_code": "H2", "name": "H Two", "department": "HR", "joined_on": "2026-07-09", "shift_start": "09:30", "shift_end": "18:30", "email": "h2@ex.com"},
    ])

    # H1 present on 2026-07-06 (full day), H1 present on 2026-07-07 (half day), 2026-07-08 NO records
    db.attendance_logs.insert_many([
        {"emp_code": "H1", "date": "2026-07-06", "status": "PRESENT", "half_day": False, "late_minutes": 0},
        {"emp_code": "H1", "date": "2026-07-07", "status": "WFH", "half_day": True, "late_minutes": 0},
    ])

    # 404 for unknown department
    res_404 = client.get("/analytics/departments/UnknownDept/trend?from=2026-07-06&to=2026-07-12")
    assert res_404.status_code == 404

    # Trend for HR: 2026-07-06 (Mon) to 2026-07-12 (Sun) -> 7 days
    res = client.get("/analytics/departments/HR/trend?from=2026-07-06&to=2026-07-12")
    assert res.status_code == 200
    items = res.json()["items"]
    assert len(items) == 7

    # 2026-07-06: Headcount 1, present 1.0 -> rate 1.0, moving_avg 1.0
    assert items[0]["date"] == "2026-07-06"
    assert items[0]["headcount"] == 1
    assert items[0]["attendance_rate"] == 1.0
    assert items[0]["moving_avg_7d"] == 1.0

    # 2026-07-07: Headcount 1, present 0.5 -> rate 0.5, moving_avg (1.0 + 0.5)/2 = 0.75
    assert items[1]["date"] == "2026-07-07"
    assert items[1]["attendance_rate"] == 0.5
    assert items[1]["moving_avg_7d"] == 0.75

    # 2026-07-08 (Wed): working day with NO records -> rate 0.0, moving_avg (1.0 + 0.5 + 0.0)/3 = 0.5
    assert items[2]["date"] == "2026-07-08"
    assert items[2]["is_working_day"] is True
    assert items[2]["attendance_rate"] == 0.0
    assert items[2]["moving_avg_7d"] == 0.5

    # 2026-07-09 (Thu): H2 joined -> Headcount steps up to 2!
    assert items[3]["date"] == "2026-07-09"
    assert items[3]["headcount"] == 2

    # 2026-07-11 (Sat) & 2026-07-12 (Sun): Weekend -> rate is null!
    assert items[5]["is_working_day"] is False
    assert items[5]["attendance_rate"] is None
    # Moving average ignores nulls and retains non-null mean:
    assert items[5]["moving_avg_7d"] is not None


def test_department_summary_hybrid_parity(client):
    db.employees.delete_many({})
    db.attendance_logs.delete_many({})

    # 2 departments: "Engineering" and "HR"
    # Month: "2026-07" (2026-07-01 to 2026-07-31)
    db.employees.insert_many([
        # Engineering employees:
        # ENG01: joined 2026-01-01 (active, has weekday full day, weekend full day, weekday half day)
        {"emp_code": "ENG01", "name": "Eng One", "department": "Engineering", "joined_on": "2026-01-01", "shift_start": "09:30", "shift_end": "18:30", "email": "e1@ex.com"},
        # ENG02: joined 2026-06-01 (active, has LEAVE and ON_DUTY records)
        {"emp_code": "ENG02", "name": "Eng Two", "department": "Engineering", "joined_on": "2026-06-01", "shift_start": "09:30", "shift_end": "18:30", "email": "e2@ex.com"},
        # ENG03: joined 2026-06-15 (active, ZERO logs - must count in headcount)
        {"emp_code": "ENG03", "name": "Eng Three", "department": "Engineering", "joined_on": "2026-06-15", "shift_start": "09:30", "shift_end": "18:30", "email": "e3@ex.com"},
        # ENG04: joined 2026-08-01 (later joiner after 2026-07-31 - must be excluded)
        {"emp_code": "ENG04", "name": "Eng Four", "department": "Engineering", "joined_on": "2026-08-01", "shift_start": "09:30", "shift_end": "18:30", "email": "e4@ex.com"},
        # HR employees:
        # HR01: joined 2026-02-01 (active, has weekday records)
        {"emp_code": "HR01", "name": "HR One", "department": "HR", "joined_on": "2026-02-01", "shift_start": "09:30", "shift_end": "18:30", "email": "h1@ex.com"},
        # HR02: joined 2026-03-01 (active, ZERO logs - must count in headcount)
        {"emp_code": "HR02", "name": "HR Two", "department": "HR", "joined_on": "2026-03-01", "shift_start": "09:30", "shift_end": "18:30", "email": "h2@ex.com"},
    ])

    # 2026-07-06: Mon (weekday)
    # 2026-07-11: Sat (weekend)
    # 2026-07-13: Mon (weekday)
    # 2026-07-14: Tue (weekday)
    # 2026-07-15: Wed (weekday)
    # 2026-07-07: Tue (weekday)
    # 2026-07-08: Wed (weekday)
    db.attendance_logs.insert_many([
        # ENG01: Weekday full day (8.005h), late 15 mins
        {"emp_code": "ENG01", "date": "2026-07-06", "status": "PRESENT", "half_day": False, "work_hours": 8.005, "late_minutes": 15, "overtime_minutes": 0},
        # ENG01: Weekend full day (4.0h), late 10 mins -> weekend excluded from present_days, but work_hours & late counted
        {"emp_code": "ENG01", "date": "2026-07-11", "status": "PRESENT", "half_day": False, "work_hours": 4.0, "late_minutes": 10, "overtime_minutes": 0},
        # ENG01: Weekday half day (4.0h), on time
        {"emp_code": "ENG01", "date": "2026-07-13", "status": "WFH", "half_day": True, "work_hours": 4.0, "late_minutes": 0, "overtime_minutes": 0},
        # ENG02: LEAVE record (work_hours None)
        {"emp_code": "ENG02", "date": "2026-07-14", "status": "LEAVE", "half_day": False, "work_hours": None, "late_minutes": 0, "overtime_minutes": 0},
        # ENG02: ON_DUTY record (work_hours None, present_days 1.0)
        {"emp_code": "ENG02", "date": "2026-07-15", "status": "ON_DUTY", "half_day": False, "work_hours": None, "late_minutes": 0, "overtime_minutes": 0},
        # HR01: Weekday full day
        {"emp_code": "HR01", "date": "2026-07-07", "status": "PRESENT", "half_day": False, "work_hours": 7.50, "late_minutes": 0, "overtime_minutes": 0},
        # HR01: Weekday full day, late 5 mins
        {"emp_code": "HR01", "date": "2026-07-08", "status": "PRESENT", "half_day": False, "work_hours": 8.51, "late_minutes": 5, "overtime_minutes": 0},
        # Orphan log (emp_code not in employees) - must be completely ignored
        {"emp_code": "ORPHAN99", "date": "2026-07-20", "status": "PRESENT", "half_day": False, "work_hours": 9.0, "late_minutes": 25, "overtime_minutes": 0},
    ])

    # 1. Global summary (no department) -> uses $unionWith
    res_all = client.get("/analytics/departments/summary?month=2026-07")
    assert res_all.status_code == 200
    all_items = res_all.json()["items"]
    assert len(all_items) == 2

    # 2. Scoped summaries -> uses concise per-employee $lookup
    res_eng = client.get("/analytics/departments/summary?month=2026-07&department=Engineering")
    assert res_eng.status_code == 200
    eng_items = res_eng.json()["items"]
    assert len(eng_items) == 1

    res_hr = client.get("/analytics/departments/summary?month=2026-07&department=HR")
    assert res_hr.status_code == 200
    hr_items = res_hr.json()["items"]
    assert len(hr_items) == 1

    # 3. Assert parity: row from global call equals row from scoped call
    assert all_items[0] == eng_items[0]
    assert all_items[1] == hr_items[0]

    # 4. Explicit assertions on expected fields:
    # Engineering:
    # - Headcount: ENG01, ENG02, ENG03 = 3 (ENG04 excluded)
    # - present_days: 1.0 (weekday full) + 0.0 (weekend) + 0.5 (half day) + 0.0 (LEAVE) + 1.0 (ON_DUTY) = 2.5
    # - avg_work_hours: (8.005 + 4.0 + 4.0) / 3 = 16.005 / 3 = 5.335 -> half-up rounds to 5.34
    # - late_count: 2 (15 + 10 mins = 25 mins)
    # - leave_count: 1, on_duty_count: 1
    eng_row = eng_items[0]
    assert eng_row["department"] == "Engineering"
    assert eng_row["headcount"] == 3
    assert eng_row["present_days"] == 2.5
    assert eng_row["avg_work_hours"] == 5.34
    assert eng_row["late_count"] == 2
    assert eng_row["total_late_minutes"] == 25
    assert eng_row["leave_count"] == 1
    assert eng_row["on_duty_count"] == 1

    # HR:
    # - Headcount: HR01, HR02 = 2
    # - present_days: 1.0 + 1.0 = 2.0
    # - avg_work_hours: (7.50 + 8.51) / 2 = 16.01 / 2 = 8.005 -> half-up rounds to 8.01
    # - late_count: 1 (5 mins)
    # - leave_count: 0, on_duty_count: 0
    hr_row = hr_items[0]
    assert hr_row["department"] == "HR"
    assert hr_row["headcount"] == 2
    assert hr_row["present_days"] == 2.0
    assert hr_row["avg_work_hours"] == 8.01
    assert hr_row["late_count"] == 1
    assert hr_row["total_late_minutes"] == 5
    assert hr_row["leave_count"] == 0
    assert hr_row["on_duty_count"] == 0
