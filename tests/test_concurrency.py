import threading
from datetime import datetime
import pytest
from app.main import IST, db


def test_concurrent_employee_creation(client):
    barrier = threading.Barrier(20)
    results = []

    payload = {
        "emp_code": "EMP0888",
        "name": "Concurrent Guy",
        "email": "concurrent@example.com",
        "department": "Engineering",
        "shift_start": "09:30",
        "shift_end": "18:30",
        "joined_on": "2026-07-01",
    }

    def worker():
        barrier.wait()
        res = client.post("/employees", json=payload)
        results.append(res.status_code)

    threads = [threading.Thread(target=worker) for _ in range(20)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    # Exactly one 201, rest 409
    assert results.count(201) == 1
    assert results.count(409) == 19
    assert db.employees.count_documents({"emp_code": "EMP0888"}) == 1


def test_concurrent_punch_in(client):
    barrier = threading.Barrier(20)
    results = []
    t_in = int(datetime(2026, 7, 29, 9, 30, 0, tzinfo=IST).timestamp() * 1000)

    payload = {
        "emp_code": "EMP0001",
        "punched_at": t_in,
        "status": "PRESENT",
    }

    def worker():
        barrier.wait()
        res = client.post("/attendance/punch-in", json=payload)
        results.append(res.status_code)

    threads = [threading.Thread(target=worker) for _ in range(20)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert results.count(201) == 1
    assert results.count(409) == 19
    assert db.attendance_logs.count_documents({"emp_code": "EMP0001", "date": "2026-07-29"}) == 1


def test_concurrent_punch_out(client):
    t_in = int(datetime(2026, 7, 30, 9, 30, 0, tzinfo=IST).timestamp() * 1000)
    client.post("/attendance/punch-in", json={"emp_code": "EMP0001", "punched_at": t_in})

    barrier = threading.Barrier(20)
    results = []
    t_out = int(datetime(2026, 7, 30, 18, 30, 0, tzinfo=IST).timestamp() * 1000)

    def worker():
        barrier.wait()
        res = client.post("/attendance/punch-out", json={"emp_code": "EMP0001", "punched_at": t_out})
        results.append(res.status_code)

    threads = [threading.Thread(target=worker) for _ in range(20)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert results.count(200) == 1
    assert results.count(409) == 19

    doc = db.attendance_logs.find_one({"emp_code": "EMP0001", "date": "2026-07-30"})
    assert doc["punch_out"] is not None
    assert doc["work_hours"] == 9.0


def test_concurrent_patches(client):
    t_in = int(datetime(2026, 7, 31, 9, 30, 0, tzinfo=IST).timestamp() * 1000)
    base_out = int(datetime(2026, 7, 31, 18, 30, 0, tzinfo=IST).timestamp() * 1000)
    client.post("/attendance/punch-in", json={"emp_code": "EMP0001", "punched_at": t_in})

    barrier = threading.Barrier(20)
    results = []

    def worker(idx):
        barrier.wait()
        # Each thread provides a distinct punch_out time so each attempt is an actual modification
        res = client.patch(
            "/attendance/EMP0001/2026-07-31",
            json={
                "punch_out": base_out + (idx + 1) * 60000,
                "reason": f"Concurrent correction #{idx}",
                "regularized_by": f"admin_{idx}",
            },
        )
        results.append(res.status_code)

    threads = [threading.Thread(target=worker, args=(i,)) for i in range(20)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    successes = results.count(200)
    conflicts = results.count(409)
    assert successes >= 1
    assert successes + conflicts == 20

    doc = db.attendance_logs.find_one({"emp_code": "EMP0001", "date": "2026-07-31"})
    assert len(doc["history"]) == successes


def test_patch_racing_punch_out(client):
    # Setup an open punch-in record
    t_in = int(datetime(2026, 7, 24, 9, 30, 0, tzinfo=IST).timestamp() * 1000)
    client.post("/attendance/punch-in", json={"emp_code": "EMP0001", "punched_at": t_in})

    barrier = threading.Barrier(2)
    results = {}

    def punch_out_worker():
        barrier.wait()
        t_out = int(datetime(2026, 7, 24, 18, 30, 0, tzinfo=IST).timestamp() * 1000)
        res = client.post("/attendance/punch-out", json={"emp_code": "EMP0001", "punched_at": t_out})
        results["punch_out"] = res.status_code

    def patch_worker():
        barrier.wait()
        res = client.patch(
            "/attendance/EMP0001/2026-07-24",
            json={
                "status": "WFH",
                "reason": "Change status while punching out",
                "regularized_by": "supervisor",
            },
        )
        results["patch"] = res.status_code

    t1 = threading.Thread(target=punch_out_worker)
    t2 = threading.Thread(target=patch_worker)
    t1.start()
    t2.start()
    t1.join()
    t2.join()

    # The punch-out must NEVER be silently lost
    doc = db.attendance_logs.find_one({"emp_code": "EMP0001", "date": "2026-07-24"})
    assert doc["punch_out"] is not None
    assert doc["work_hours"] is not None
