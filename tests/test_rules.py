from datetime import datetime, timezone, timedelta
import pytest
from app.main import (
    truncate_to_seconds,
    epoch_ms_to_utc_dt,
    utc_dt_to_epoch_ms,
    get_attendance_date,
    compute_late_minutes,
    compute_work_hours,
    compute_half_day,
    compute_overtime_minutes,
    count_working_days,
    IST,
)


def test_rule_r1_second_truncation():
    # 09:40:00.900 ms should truncate to 09:40:00.000 ms
    t = int(datetime(2026, 7, 6, 9, 40, 0, 900000, tzinfo=IST).timestamp() * 1000)
    truncated = truncate_to_seconds(t)
    dt_trunc = datetime.fromtimestamp(truncated / 1000, tz=timezone.utc).astimezone(IST)
    assert dt_trunc.microsecond == 0
    assert dt_trunc.second == 0
    assert truncated % 1000 == 0


def test_rule_r1_overnight_shift_date():
    # Shift: 22:00 to 06:00
    # At 05:59:59 IST on 2026-07-07 (< 06:00 shift_end) belongs to previous day (2026-07-06)
    t_prev = int(datetime(2026, 7, 7, 5, 59, 59, tzinfo=IST).timestamp() * 1000)
    assert get_attendance_date(t_prev, "22:00", "06:00") == "2026-07-06"

    # At 06:00:00 IST on 2026-07-07 (not earlier than 06:00) belongs to 2026-07-07
    t_curr = int(datetime(2026, 7, 7, 6, 0, 0, tzinfo=IST).timestamp() * 1000)
    assert get_attendance_date(t_curr, "22:00", "06:00") == "2026-07-07"

    # Punch-in at 22:15 on 2026-07-06 IST belongs to 2026-07-06
    t_start = int(datetime(2026, 7, 6, 22, 15, 0, tzinfo=IST).timestamp() * 1000)
    assert get_attendance_date(t_start, "22:00", "06:00") == "2026-07-06"


def test_rule_r2_late_minutes_grace_period():
    # Shift 09:30:
    # 09:40:00 -> 0 (inside 10 min grace period)
    # 09:40:01 -> 10 (strictly > 10:00 elapsed)
    # 10:15:59 -> 45
    d = "2026-07-06"
    t1 = int(datetime(2026, 7, 6, 9, 40, 0, tzinfo=IST).timestamp() * 1000)
    t2 = int(datetime(2026, 7, 6, 9, 40, 1, tzinfo=IST).timestamp() * 1000)
    t3 = int(datetime(2026, 7, 6, 10, 15, 59, tzinfo=IST).timestamp() * 1000)

    assert compute_late_minutes(t1, d, "09:30") == 0
    assert compute_late_minutes(t2, d, "09:30") == 10
    assert compute_late_minutes(t3, d, "09:30") == 45

    # Overnight late: 23:00 for a 22:00 shift -> 60 minutes late
    t_overnight_late = int(datetime(2026, 7, 6, 23, 0, 0, tzinfo=IST).timestamp() * 1000)
    assert compute_late_minutes(t_overnight_late, "2026-07-06", "22:00") == 60


def test_rule_r3_overtime_threshold():
    # Shift 09:30 to 18:30:
    # 18:59:59 -> 29:59 -> 0 (< 30 min minimum)
    # 19:00:00 -> 30:00 -> 30 (>= 30 min)
    d = "2026-07-06"
    t_29m = int(datetime(2026, 7, 6, 18, 59, 59, tzinfo=IST).timestamp() * 1000)
    t_30m = int(datetime(2026, 7, 6, 19, 0, 0, tzinfo=IST).timestamp() * 1000)

    assert compute_overtime_minutes(t_29m, d, "09:30", "18:30") == 0
    assert compute_overtime_minutes(t_30m, d, "09:30", "18:30") == 30

    # Overnight overtime: shift 22:00 to 06:00, punch out at next-day 06:40 IST -> 40 min overtime
    t_ot_overnight = int(datetime(2026, 7, 7, 6, 40, 0, tzinfo=IST).timestamp() * 1000)
    assert compute_overtime_minutes(t_ot_overnight, "2026-07-06", "22:00", "06:00") == 40


def test_rule_r4_work_hours_half_up_rounding():
    # 4h 00m 18s -> 14418 s / 3600 = 4.005 -> 4.01 half up (Python round() gives 4.0)
    t_start = 0
    t_end = (4 * 3600 + 18) * 1000
    wh = compute_work_hours(t_start, t_end)
    assert wh == 4.01


def test_rule_r5_half_day():
    # 4h 29m 42s -> 16182 s / 3600 = 4.495 -> rounds to 4.50 -> half_day False
    wh_false = compute_work_hours(0, (4 * 3600 + 29 * 60 + 42) * 1000)
    assert wh_false == 4.50
    assert compute_half_day(wh_false) is False

    # 4h 29m 41s -> 16181 s / 3600 = 4.4947... -> rounds to 4.49 -> half_day True
    wh_true = compute_work_hours(0, (4 * 3600 + 29 * 60 + 41) * 1000)
    assert wh_true == 4.49
    assert compute_half_day(wh_true) is True


def test_rule_r7_working_days():
    # Feb 2026: 28 days total, starts on Sun, ends on Sat -> 20 working days
    assert count_working_days("2026-02", "2026-01-01") == 20

    # Joined on a Saturday mid-month: e.g. Feb 7, 2026 is Saturday -> 15 working days remaining
    assert count_working_days("2026-02", "2026-02-07") == 15

    # Joined after month end -> 0 working days
    assert count_working_days("2026-02", "2026-03-01") == 0


def test_epoch_ms_exact_round_trip():
    # Microsecond precision datetime converted to epoch ms and back
    dt = datetime(2026, 7, 6, 12, 34, 56, 789000, tzinfo=timezone.utc)
    ms = utc_dt_to_epoch_ms(dt)
    assert ms == 1783341296789
    dt_back = epoch_ms_to_utc_dt(ms)
    assert dt_back == datetime(2026, 7, 6, 12, 34, 56, 789000, tzinfo=timezone.utc)
