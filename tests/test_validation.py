import pytest


def test_epoch_ms_validation_seconds_float_string_bool(api):
    # Seconds value (< 100000000000)
    res = api.post("/attendance/punch-in", json={"emp_code": "EMP0001", "punched_at": 1783312500})
    assert res.status_code == 422
    assert "detail" in res.json()

    # Float value
    res = api.post("/attendance/punch-in", json={"emp_code": "EMP0001", "punched_at": 1783312500000.0})
    assert res.status_code == 422

    # String value
    res = api.post("/attendance/punch-in", json={"emp_code": "EMP0001", "punched_at": "1783312500000"})
    assert res.status_code == 422

    # Bool value
    res = api.post("/attendance/punch-in", json={"emp_code": "EMP0001", "punched_at": True})
    assert res.status_code == 422


def test_punch_in_status_presence_only(api):
    # Status ABSENT or LEAVE rejected at punch-in (only PRESENT, WFH, ON_DUTY allowed)
    res = api.post("/attendance/punch-in", json={"emp_code": "EMP0001", "status": "ABSENT"})
    assert res.status_code == 422

    res = api.post("/attendance/punch-in", json={"emp_code": "EMP0001", "status": "LEAVE"})
    assert res.status_code == 422


def test_employee_create_shift_and_date_validation(api):
    # shift_start == shift_end must be 422
    res = api.post(
        "/employees",
        json={
            "emp_code": "EMP0099",
            "name": "Test Emp",
            "email": "test@example.com",
            "department": "Engineering",
            "shift_start": "09:30",
            "shift_end": "09:30",
            "joined_on": "2026-07-01",
        },
    )
    assert res.status_code == 422

    # joined_on = 2026-02-30 (impossible date) must be 422
    res = api.post(
        "/employees",
        json={
            "emp_code": "EMP0099",
            "name": "Test Emp",
            "email": "test@example.com",
            "department": "Engineering",
            "shift_start": "09:30",
            "shift_end": "18:30",
            "joined_on": "2026-02-30",
        },
    )
    assert res.status_code == 422


def test_list_attendance_date_validation(api):
    # date_from > date_to -> 422
    res = api.get("/attendance?date_from=2026-07-10&date_to=2026-07-01")
    assert res.status_code == 422

    # Invalid date string -> 422
    res = api.get("/attendance?date_from=2026-02-30")
    assert res.status_code == 422


def test_pagination_validation(api):
    # page_size 101 -> 422
    res = api.get("/employees?page_size=101")
    assert res.status_code == 422

    # page 0 -> 422
    res = api.get("/employees?page=0")
    assert res.status_code == 422


def test_trend_validation(api):
    # to < from -> 422
    res = api.get("/analytics/departments/Engineering/trend?from=2026-07-10&to=2026-07-01")
    assert res.status_code == 422

    # > 92 days -> 422
    res = api.get("/analytics/departments/Engineering/trend?from=2026-01-01&to=2026-05-01")
    assert res.status_code == 422

    # Bad calendar date (2026-02-30) -> 422
    res = api.get("/analytics/departments/Engineering/trend?from=2026-02-01&to=2026-02-30")
    assert res.status_code == 422


def test_leaderboard_limit_validation(api):
    # limit 51 -> 422
    res = api.get("/analytics/leaderboard/late?month=2026-07&limit=51")
    assert res.status_code == 422


def test_admin_explain_missing_required_params(api):
    # employee_monthly missing month -> 422
    res = api.get("/admin/explain/employee_monthly?emp_code=EMP0001")
    assert res.status_code == 422

    # department_summary missing month -> 422
    res = api.get("/admin/explain/department_summary")
    assert res.status_code == 422

    # department_trend missing department / dates -> 422
    res = api.get("/admin/explain/department_trend")
    assert res.status_code == 422
