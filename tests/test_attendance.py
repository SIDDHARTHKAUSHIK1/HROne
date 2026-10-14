from datetime import datetime, timezone, timedelta
import pytest
from app.main import IST, db


def test_health_check(client):
    res = client.get("/health")
    assert res.status_code == 200
    assert res.json() == {"status": "ok"}


def test_employee_crud_and_pagination(client):
    # Total respects filters
    res_eng = client.get("/employees?department=Engineering")
    assert res_eng.status_code == 200
    eng_total = res_eng.json()["total"]

    res_all = client.get("/employees")
    assert res_all.status_code == 200
    assert res_all.json()["total"] >= eng_total

    # Page 1 starts at first record (EMP0001)
    res_p1 = client.get("/employees?page=1&page_size=2")
    assert res_p1.status_code == 200
    items = res_p1.json()["items"]
    assert len(items) == 2
    assert items[0]["emp_code"] == "EMP0001"
    assert "_id" not in items[0] and "id" not in items[0]


def test_punch_in_defaults_and_duplicate(client):
    # Punch in with defaults (no punched_at, default status PRESENT)
    res = client.post("/attendance/punch-in", json={"emp_code": "EMP0001"})
    assert res.status_code == 201
    data = res.json()
    assert data["emp_code"] == "EMP0001"
    assert data["status"] == "PRESENT"
    assert "_id" not in data and "id" not in data
    assert data["punch_out"] is None
    assert data["work_hours"] is None
    assert data["history"] == []

    # Duplicate punch-in for same date -> 409
    res_dup = client.post("/attendance/punch-in", json={"emp_code": "EMP0001"})
    assert res_dup.status_code == 409

    # Unknown employee -> 404
    res_unknown = client.post("/attendance/punch-in", json={"emp_code": "EMP9999"})
    assert res_unknown.status_code == 404


def test_overnight_punch_in_and_out(client):
    # EMP0005 has overnight shift 22:00 to 06:00
    # Punch-in at 21:55 IST on 2026-07-20
    t_in = int(datetime(2026, 7, 20, 21, 55, 0, tzinfo=IST).timestamp() * 1000)
    res_in = client.post(
        "/attendance/punch-in",
        json={"emp_code": "EMP0005", "punched_at": t_in, "status": "PRESENT"},
    )
    assert res_in.status_code == 201
    assert res_in.json()["date"] == "2026-07-20"
    assert res_in.json()["late_minutes"] == 0

    # Punch-out next day at 06:40 IST (40 min past 06:00)
    t_out = int(datetime(2026, 7, 21, 6, 40, 0, tzinfo=IST).timestamp() * 1000)
    res_out = client.post(
        "/attendance/punch-out",
        json={"emp_code": "EMP0005", "punched_at": t_out},
    )
    assert res_out.status_code == 200
    out_data = res_out.json()
    assert out_data["date"] == "2026-07-20"
    assert out_data["overtime_minutes"] == 40
    assert out_data["work_hours"] == 8.75
    assert out_data["half_day"] is False


def test_punch_out_errors(client):
    # Punch out when employee has no punch-in -> 404
    client.post("/employees", json={
        "emp_code": "EMP0090",
        "name": "No Punch",
        "email": "nopunch@example.com",
        "department": "Engineering",
        "shift_start": "09:30",
        "shift_end": "18:30",
        "joined_on": "2026-07-01",
    })
    res_no_in = client.post(
        "/attendance/punch-out",
        json={"emp_code": "EMP0090", "punched_at": int(datetime(2026, 7, 25, 18, 0, 0, tzinfo=IST).timestamp() * 1000)},
    )
    assert res_no_in.status_code == 404

    # Setup a punch-in
    t_in = int(datetime(2026, 7, 25, 9, 30, 0, tzinfo=IST).timestamp() * 1000)
    client.post("/attendance/punch-in", json={"emp_code": "EMP0002", "punched_at": t_in})

    # punch-out <= punch_in -> 422
    res_before = client.post("/attendance/punch-out", json={"emp_code": "EMP0002", "punched_at": t_in})
    assert res_before.status_code == 422

    # punch-out > 24 hours after punch-in -> 422
    t_too_late = t_in + (25 * 3600 * 1000)
    res_24h = client.post("/attendance/punch-out", json={"emp_code": "EMP0002", "punched_at": t_too_late})
    assert res_24h.status_code == 422

    # Normal punch-out -> 200
    t_out = t_in + (9 * 3600 * 1000)
    res_ok = client.post("/attendance/punch-out", json={"emp_code": "EMP0002", "punched_at": t_out})
    assert res_ok.status_code == 200

    # Punch-out on already closed record -> 409
    res_closed = client.post("/attendance/punch-out", json={"emp_code": "EMP0002", "punched_at": t_out + 1000})
    assert res_closed.status_code == 409


def test_regularize_attendance_features(client):
    # Setup open record on 2026-07-28
    t_in = int(datetime(2026, 7, 28, 9, 30, 0, tzinfo=IST).timestamp() * 1000)
    client.post("/attendance/punch-in", json={"emp_code": "EMP0001", "punched_at": t_in})

    # 1. PATCH with punch_out recomputes derived fields and sets history
    t_out = int(datetime(2026, 7, 28, 19, 30, 0, tzinfo=IST).timestamp() * 1000)
    patch_res = client.patch(
        "/attendance/EMP0001/2026-07-28",
        json={
            "punch_out": t_out,
            "reason": "Forgot to punch out",
            "regularized_by": "manager1",
        },
    )
    assert patch_res.status_code == 200
    pdata = patch_res.json()
    assert pdata["work_hours"] == 10.0
    assert pdata["overtime_minutes"] == 60
    assert len(pdata["history"]) == 1
    assert "punch_out" in pdata["history"][0]["changes"]
    assert pdata["history"][0]["changes"]["punch_out"]["to"] == t_out
    assert "_id" not in pdata and "id" not in pdata

    # 2. PATCH to ABSENT clears times and derived values
    absent_res = client.patch(
        "/attendance/EMP0001/2026-07-28",
        json={
            "status": "ABSENT",
            "reason": "Marked absent retroactively",
            "regularized_by": "hr_admin",
        },
    )
    assert absent_res.status_code == 200
    adata = absent_res.json()
    assert adata["status"] == "ABSENT"
    assert adata["punch_in"] is None
    assert adata["punch_out"] is None
    assert adata["work_hours"] is None
    assert adata["late_minutes"] == 0
    assert adata["overtime_minutes"] == 0
    assert adata["half_day"] is False
    assert len(adata["history"]) == 2

    # 3. PATCH 422: supplying punch time with ABSENT/LEAVE
    err_times = client.patch(
        "/attendance/EMP0001/2026-07-28",
        json={
            "status": "ABSENT",
            "punch_in": t_in,
            "reason": "Invalid punch with absent",
            "regularized_by": "hr_admin",
        },
    )
    assert err_times.status_code == 422

    # 4. PATCH 422: setting presence without punch_in (since record is currently ABSENT)
    err_presence = client.patch(
        "/attendance/EMP0001/2026-07-28",
        json={
            "status": "PRESENT",
            "reason": "Missing punch in",
            "regularized_by": "hr_admin",
        },
    )
    assert err_presence.status_code == 422

    # 5. PATCH 422: punch_in moved to another date
    t_diff_date = int(datetime(2026, 7, 29, 9, 30, 0, tzinfo=IST).timestamp() * 1000)
    err_date = client.patch(
        "/attendance/EMP0001/2026-07-28",
        json={
            "status": "PRESENT",
            "punch_in": t_diff_date,
            "reason": "Moved date",
            "regularized_by": "hr_admin",
        },
    )
    assert err_date.status_code == 422

    # 6. PATCH 422: no-op (no changes)
    err_noop = client.patch(
        "/attendance/EMP0001/2026-07-28",
        json={
            "status": "ABSENT",
            "reason": "Nothing changed",
            "regularized_by": "hr_admin",
        },
    )
    assert err_noop.status_code == 422

    # 7. PATCH 404 for unknown employee or date
    err_404_emp = client.patch(
        "/attendance/EMP9999/2026-07-28",
        json={"reason": "Unknown employee", "regularized_by": "hr_admin"},
    )
    assert err_404_emp.status_code == 404

    err_404_date = client.patch(
        "/attendance/EMP0001/2026-01-01",
        json={"reason": "Unknown date", "regularized_by": "hr_admin"},
    )
    assert err_404_date.status_code == 404


def test_regularize_legacy_record(client):
    # In seeded data, EMP0002 on 2026-07-14 is a legacy record (no history, no half_day)
    patch_res = client.patch(
        "/attendance/EMP0002/2026-07-14",
        json={
            "status": "WFH",
            "reason": "WFH approval retroactive",
            "regularized_by": "team_lead",
        },
    )
    assert patch_res.status_code == 200
    rec = patch_res.json()
    assert rec["status"] == "WFH"
    assert len(rec["history"]) == 1
    assert rec["history"][0]["changes"]["status"]["from"] == "PRESENT"
    assert rec["history"][0]["changes"]["status"]["to"] == "WFH"
