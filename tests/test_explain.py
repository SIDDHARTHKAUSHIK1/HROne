import json
import pytest


def test_explain_attendance_list_all_filter_variants(client):
    variants = [
        "/admin/explain/attendance_list",
        "/admin/explain/attendance_list?emp_code=EMP0001",
        "/admin/explain/attendance_list?status=PRESENT",
        "/admin/explain/attendance_list?date_from=2026-07-01&date_to=2026-07-31",
        "/admin/explain/attendance_list?emp_code=EMP0001&date_from=2026-07-01&date_to=2026-07-31",
    ]
    for url in variants:
        res = client.get(url)
        assert res.status_code == 200
        data = res.json()
        assert data["collection"] == "attendance_logs"
        exp_str = json.dumps(data["explain"])
        assert "IXSCAN" in exp_str, f"IXSCAN missing in {url}"
        assert "COLLSCAN" not in exp_str, f"COLLSCAN found in {url}"


def test_explain_employee_monthly(client):
    url = "/admin/explain/employee_monthly?emp_code=EMP0001&month=2026-07"
    res = client.get(url)
    assert res.status_code == 200
    data = res.json()
    assert data["collection"] == "attendance_logs"
    exp_str = json.dumps(data["explain"])
    assert "IXSCAN" in exp_str
    assert "COLLSCAN" not in exp_str


def test_explain_department_summary(client):
    # Without department filter
    res1 = client.get("/admin/explain/department_summary?month=2026-07")
    assert res1.status_code == 200
    data1 = res1.json()
    assert data1["collection"] == "employees"
    exp_str1 = json.dumps(data1["explain"])
    assert "IXSCAN" in exp_str1
    assert "COLLSCAN" not in exp_str1

    # With department filter
    res2 = client.get("/admin/explain/department_summary?month=2026-07&department=Engineering")
    assert res2.status_code == 200
    data2 = res2.json()
    assert data2["collection"] == "employees"
    exp_str2 = json.dumps(data2["explain"])
    assert "IXSCAN" in exp_str2
    assert "COLLSCAN" not in exp_str2


def test_explain_late_leaderboard(client):
    # Without department filter
    res1 = client.get("/admin/explain/late_leaderboard?month=2026-07")
    assert res1.status_code == 200
    data1 = res1.json()
    assert data1["collection"] == "attendance_logs"
    exp_str1 = json.dumps(data1["explain"])
    assert "IXSCAN" in exp_str1
    assert "COLLSCAN" not in exp_str1

    # With department filter
    res2 = client.get("/admin/explain/late_leaderboard?month=2026-07&department=Engineering")
    assert res2.status_code == 200
    data2 = res2.json()
    assert data2["collection"] == "attendance_logs"
    exp_str2 = json.dumps(data2["explain"])
    assert "IXSCAN" in exp_str2
    assert "COLLSCAN" not in exp_str2


def test_explain_department_trend(client):
    url = "/admin/explain/department_trend?department=Engineering&from=2026-07-06&to=2026-07-12"
    res = client.get(url)
    assert res.status_code == 200
    data = res.json()
    assert data["collection"] == "employees"
    exp_str = json.dumps(data["explain"])
    assert "IXSCAN" in exp_str
    assert "COLLSCAN" not in exp_str
