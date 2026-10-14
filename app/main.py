"""
Employee Attendance & Analytics API

Run:  uvicorn app.main:app --port 8000
Env:  MONGO_URI, MONGO_DB (a local .env is loaded for convenience)
"""
import calendar
import os
import re
from contextlib import asynccontextmanager
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, ROUND_HALF_UP
from typing import Annotated, Any, Dict, List, Literal, Optional, Union

from bson.decimal128 import Decimal128
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Path, Query, status
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from pydantic import (
    AfterValidator,
    BaseModel,
    ConfigDict,
    Field,
    StrictInt,
    model_validator,
)
from pymongo import MongoClient, ReturnDocument
from pymongo.errors import DuplicateKeyError

load_dotenv()

MONGO_URI = os.getenv("MONGO_URI", "mongodb://localhost:27017")
MONGO_DB = os.getenv("MONGO_DB", "attendance_db")

client: MongoClient = MongoClient(MONGO_URI, tz_aware=True, serverSelectionTimeoutMS=5000)
db = client[MONGO_DB]

IST = timezone(timedelta(hours=5, minutes=30))
EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)


def ensure_indexes():
    """Ensure all required indexes are created idempotently using default index names."""
    # employees
    db.employees.create_index([("emp_code", 1)], unique=True)
    db.employees.create_index([("department", 1), ("emp_code", 1)])
    db.employees.create_index([("joined_on", 1)])

    # attendance_logs
    db.attendance_logs.create_index([("emp_code", 1), ("date", 1)], unique=True)
    db.attendance_logs.create_index([("date", -1), ("emp_code", 1)])
    db.attendance_logs.create_index([("status", 1), ("date", -1), ("emp_code", 1)])
    db.attendance_logs.create_index([("date", 1), ("late_minutes", 1)])
    db.attendance_logs.create_index([("emp_code", 1), ("punch_in", -1)])


@asynccontextmanager
async def lifespan(app: FastAPI):
    try:
        ensure_indexes()
    except Exception as exc:
        print(f"Warning: ensure_indexes failed during startup lifespan: {exc}")
    yield


app = FastAPI(
    title="Employee Attendance & Analytics API",
    version="2.0.0",
    lifespan=lifespan,
)

cors_origins_env = os.getenv("CORS_ORIGINS", "*")
cors_origins = [o.strip() for o in cors_origins_env.split(",") if o.strip()] if cors_origins_env != "*" else ["*"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


# --------------------------------------------------------------------------- #
# Helpers & Business Rules (R1 - R10)
# --------------------------------------------------------------------------- #
def truncate_to_seconds(epoch_ms: int) -> int:
    """R1: Before any calculation, instants are truncated to whole seconds."""
    return (epoch_ms // 1000) * 1000


def epoch_ms_to_utc_dt(epoch_ms: int) -> datetime:
    """Convert epoch milliseconds to a UTC datetime using exact integer math."""
    return EPOCH + timedelta(milliseconds=epoch_ms)


def utc_dt_to_epoch_ms(dt: Optional[datetime]) -> Optional[int]:
    """Convert datetime to exact integer epoch milliseconds."""
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return (dt - EPOCH) // timedelta(milliseconds=1)


def get_now_ms() -> int:
    """Get current UTC instant as exact integer epoch milliseconds."""
    now = datetime.now(timezone.utc)
    return (now - EPOCH) // timedelta(milliseconds=1)


def get_attendance_date(punch_in_ms: int, shift_start: str, shift_end: str) -> str:
    """
    R1: Shift times and attendance dates are IST (UTC+05:30).
    A record's date is the IST calendar date of its punch_in instant.
    Exception - overnight shifts (shift_end <= shift_start):
    a punch-in whose IST time is *earlier than* shift_end belongs to the shift that started the previous day.
    """
    sec_ms = truncate_to_seconds(punch_in_ms)
    dt_utc = epoch_ms_to_utc_dt(sec_ms)
    dt_ist = dt_utc.astimezone(IST)

    is_overnight = shift_end <= shift_start
    if is_overnight:
        end_h, end_m = map(int, shift_end.split(":"))
        punch_time = (dt_ist.hour, dt_ist.minute, dt_ist.second)
        if punch_time < (end_h, end_m, 0):
            prev_day = (dt_ist - timedelta(days=1)).date()
            return prev_day.isoformat()
    return dt_ist.date().isoformat()


def compute_late_minutes(punch_in_ms: int, attendance_date: str, shift_start: str) -> int:
    """
    R2: Grace period is 10 minutes. Late only if punch-in is strictly more than 10:00 after shift_start.
    When late, late_minutes = whole minutes (floor) elapsed since shift_start (not since grace period).
    """
    sec_ms = truncate_to_seconds(punch_in_ms)
    dt_utc = epoch_ms_to_utc_dt(sec_ms)
    dt_ist = dt_utc.astimezone(IST)

    start_d = date.fromisoformat(attendance_date)
    sh, sm = map(int, shift_start.split(":"))
    shift_start_dt = datetime(start_d.year, start_d.month, start_d.day, sh, sm, 0, tzinfo=IST)

    diff_seconds = (dt_ist - shift_start_dt).total_seconds()
    if diff_seconds > 600:
        return int(diff_seconds // 60)
    return 0


def compute_work_hours(punch_in_ms: int, punch_out_ms: int) -> float:
    """
    R4: (punch_out - punch_in) in seconds / 3600, rounded to 2 decimals half-up.
    """
    in_sec = truncate_to_seconds(punch_in_ms) // 1000
    out_sec = truncate_to_seconds(punch_out_ms) // 1000
    diff_sec = out_sec - in_sec
    d = Decimal(diff_sec) / Decimal(3600)
    rounded = d.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    return float(rounded)


def compute_half_day(work_hours: float) -> bool:
    """R5: After punch-out, half_day = true when rounded work_hours < 4.50."""
    return work_hours < 4.50


def compute_overtime_minutes(punch_out_ms: int, attendance_date: str, shift_start: str, shift_end: str) -> int:
    """
    R3: whole minutes (floor) between shift_end and punch_out, counted only when that is >= 30; otherwise 0.
    """
    sec_ms = truncate_to_seconds(punch_out_ms)
    dt_utc = epoch_ms_to_utc_dt(sec_ms)
    dt_ist = dt_utc.astimezone(IST)

    start_d = date.fromisoformat(attendance_date)
    eh, em = map(int, shift_end.split(":"))
    is_overnight = shift_end <= shift_start
    end_d = start_d + timedelta(days=1) if is_overnight else start_d
    shift_end_dt = datetime(end_d.year, end_d.month, end_d.day, eh, em, 0, tzinfo=IST)

    diff_seconds = (dt_ist - shift_end_dt).total_seconds()
    if diff_seconds >= 1800:
        return int(diff_seconds // 60)
    return 0


def count_working_days(month_str: str, joined_on_str: str) -> int:
    """
    R7: Mon-Fri, no holiday calendar. For an employee who joined mid-month,
    working days are counted from joined_on.
    """
    year, month = map(int, month_str.split("-"))
    last_day = calendar.monthrange(year, month)[1]
    month_start = date(year, month, 1)
    month_end = date(year, month, last_day)

    joined_date = date.fromisoformat(joined_on_str)
    if joined_date > month_end:
        return 0

    start_date = max(month_start, joined_date)
    working_days = 0
    cur = start_date
    while cur <= month_end:
        if cur.weekday() < 5:  # Mon=0, Fri=4
            working_days += 1
        cur += timedelta(days=1)
    return working_days


# --------------------------------------------------------------------------- #
# Pydantic Schemas matching openapi.yaml
# --------------------------------------------------------------------------- #
StatusType = Literal["PRESENT", "ABSENT", "LEAVE", "WFH", "ON_DUTY"]
PresenceStatusType = Literal["PRESENT", "WFH", "ON_DUTY"]

EpochMs = Annotated[StrictInt, Field(ge=100000000000, le=4102444800000)]


def validate_iso_date(v: str) -> str:
    if not isinstance(v, str) or not re.match(r"^\d{4}-\d{2}-\d{2}$", v):
        raise ValueError("Date must be in YYYY-MM-DD format")
    try:
        date.fromisoformat(v)
    except ValueError:
        raise ValueError(f"Invalid calendar date: {v}")
    return v


IsoDate = Annotated[str, AfterValidator(validate_iso_date)]


def raise_validation_error(loc: tuple, msg: str):
    """Raise a 422 with FastAPI's default validation body: {"detail": [{type, loc, msg, input}]}."""
    raise RequestValidationError([{"type": "value_error", "loc": loc, "msg": msg, "input": None}])


class EmployeeCreate(BaseModel):
    emp_code: str = Field(..., pattern=r"^EMP\d{4,6}$")
    name: str = Field(..., min_length=1, max_length=100)
    email: str = Field(..., max_length=120, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
    department: str = Field(..., min_length=1, max_length=50)
    shift_start: str = Field(default="09:30", pattern=r"^([01]\d|2[0-3]):[0-5]\d$")
    shift_end: str = Field(default="18:30", pattern=r"^([01]\d|2[0-3]):[0-5]\d$")
    joined_on: IsoDate

    @model_validator(mode="after")
    def check_shift_diff(self):
        if self.shift_start == self.shift_end:
            raise ValueError("shift_start must differ from shift_end")
        return self


class EmployeeResponse(BaseModel):
    emp_code: str
    name: str
    email: str
    department: str
    shift_start: str
    shift_end: str
    joined_on: str
    created_at: int


class EmployeePage(BaseModel):
    items: List[EmployeeResponse]
    total: int
    page: int
    page_size: int


class PunchInRequest(BaseModel):
    emp_code: str
    punched_at: Optional[EpochMs] = None
    status: PresenceStatusType = "PRESENT"


class PunchOutRequest(BaseModel):
    emp_code: str
    punched_at: Optional[EpochMs] = None


class RegularizeRequest(BaseModel):
    status: Optional[StatusType] = None
    punch_in: Optional[EpochMs] = None
    punch_out: Optional[EpochMs] = None
    reason: str = Field(..., min_length=5, max_length=200)
    regularized_by: str = Field(..., min_length=1, max_length=50)


class HistoryEntry(BaseModel):
    at: int
    by: str
    reason: str
    changes: Dict[str, Dict[str, Any]]


class AttendanceRecord(BaseModel):
    emp_code: str
    date: str
    status: StatusType
    punch_in: Optional[int] = None
    punch_out: Optional[int] = None
    work_hours: Optional[float] = None
    late_minutes: int = 0
    overtime_minutes: int = 0
    half_day: bool = False
    history: List[HistoryEntry] = []


class AttendancePage(BaseModel):
    items: List[AttendanceRecord]
    total: int
    page: int
    page_size: int


class EmployeeMonthly(BaseModel):
    emp_code: str
    month: str
    working_days: int
    present_days: float
    leave_days: int
    late_count: int
    total_late_minutes: int
    total_overtime_minutes: int
    attendance_pct: Optional[float] = None


class DepartmentSummaryItem(BaseModel):
    department: str
    headcount: int
    present_days: float
    avg_work_hours: Optional[float] = None
    late_count: int
    total_late_minutes: int
    leave_count: int
    on_duty_count: int


class DepartmentSummary(BaseModel):
    month: str
    items: List[DepartmentSummaryItem]


class LeaderboardItem(BaseModel):
    rank: int
    emp_code: str
    name: str
    department: str
    total_late_minutes: int
    late_count: int


class Leaderboard(BaseModel):
    month: str
    items: List[LeaderboardItem]


class TrendItem(BaseModel):
    date: str
    is_working_day: bool
    headcount: int
    present_count: float
    late_count: int
    attendance_rate: Optional[float] = None
    moving_avg_7d: Optional[float] = None


class Trend(BaseModel):
    department: str
    items: List[TrendItem]


def doc_to_attendance_record(doc: Dict[str, Any]) -> AttendanceRecord:
    p_in = utc_dt_to_epoch_ms(doc.get("punch_in"))
    p_out = utc_dt_to_epoch_ms(doc.get("punch_out"))

    formatted_history: List[HistoryEntry] = []
    for h in doc.get("history") or []:
        h_at = utc_dt_to_epoch_ms(h.get("at")) if isinstance(h.get("at"), datetime) else h.get("at", 0)

        clean_changes: Dict[str, Dict[str, Any]] = {}
        for k, v in (h.get("changes") or {}).items():
            from_v = v.get("from")
            to_v = v.get("to")
            if isinstance(from_v, datetime):
                from_v = utc_dt_to_epoch_ms(from_v)
            if isinstance(to_v, datetime):
                to_v = utc_dt_to_epoch_ms(to_v)
            clean_changes[k] = {"from": from_v, "to": to_v}

        formatted_history.append(
            HistoryEntry(
                at=h_at,
                by=h.get("by", ""),
                reason=h.get("reason", ""),
                changes=clean_changes,
            )
        )

    return AttendanceRecord(
        emp_code=doc["emp_code"],
        date=doc["date"],
        status=doc["status"],
        punch_in=p_in,
        punch_out=p_out,
        work_hours=doc.get("work_hours"),
        late_minutes=int(doc.get("late_minutes") or 0),
        overtime_minutes=int(doc.get("overtime_minutes") or 0),
        half_day=bool(doc.get("half_day") or False),
        history=formatted_history,
    )


# --------------------------------------------------------------------------- #
# Shared Pipeline & Query Builders
# --------------------------------------------------------------------------- #
def month_bounds(month: str) -> tuple[str, str]:
    year, m = map(int, month.split("-"))
    last_day = calendar.monthrange(year, m)[1]
    return f"{month}-01", f"{month}-{last_day:02d}"


def build_attendance_list_query(
    emp_code: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    status_filter: Optional[str] = None,
) -> Dict[str, Any]:
    q: Dict[str, Any] = {}
    if status_filter:
        q["status"] = status_filter
    if emp_code:
        q["emp_code"] = emp_code
    if date_from or date_to:
        q["date"] = {}
        if date_from:
            q["date"]["$gte"] = date_from
        if date_to:
            q["date"]["$lte"] = date_to
    return q


def employee_monthly_pipeline(emp_code: str, month: str) -> List[Dict[str, Any]]:
    month_start, month_end = month_bounds(month)
    return [
        {
            "$match": {
                "emp_code": emp_code,
                "date": {"$gte": month_start, "$lte": month_end},
            }
        },
        {
            "$group": {
                "_id": None,
                "present_days": {
                    "$sum": {
                        "$cond": [
                            {
                                "$and": [
                                    {
                                        "$lte": [
                                            {
                                                "$isoDayOfWeek": {
                                                    "$dateFromString": {
                                                        "dateString": "$date",
                                                        "format": "%Y-%m-%d",
                                                    }
                                                }
                                            },
                                            5,
                                        ]
                                    },
                                    {"$in": ["$status", ["PRESENT", "WFH", "ON_DUTY"]]},
                                ]
                            },
                            {"$cond": ["$half_day", Decimal128("0.5"), Decimal128("1.0")]},
                            Decimal128("0.0"),
                        ]
                    }
                },
                "leave_days": {
                    "$sum": {"$cond": [{"$eq": ["$status", "LEAVE"]}, 1, 0]}
                },
                "late_count": {
                    "$sum": {
                        "$cond": [
                            {"$gt": [{"$ifNull": ["$late_minutes", 0]}, 0]},
                            1,
                            0,
                        ]
                    }
                },
                "total_late_minutes": {
                    "$sum": {"$ifNull": ["$late_minutes", 0]}
                },
                "total_overtime_minutes": {
                    "$sum": {"$ifNull": ["$overtime_minutes", 0]}
                },
            }
        },
    ]


def department_summary_pipeline(month: str, department: Optional[str] = None) -> List[Dict[str, Any]]:
    """
    Hybrid department summary optimization:
    - Single department: $match department in employees, then per-employee $lookup on (emp_code, date).
      Fast because only the target department's employees are looked up.
    - All departments: single pass over the month's logs via $unionWith, grouped by emp_code and merged
      with in-scope employees. Fast because it replaces ~500 separate $lookup index traverses with a
      single date-index scan.
    """
    month_start, month_end = month_bounds(month)
    emp_match: Dict[str, Any] = {"joined_on": {"$lte": month_end}}
    if department:
        emp_match["department"] = department

    is_presence = {"$in": ["$status", ["PRESENT", "WFH", "ON_DUTY"]]}
    is_weekday = {
        "$lte": [
            {"$isoDayOfWeek": {"$dateFromString": {"dateString": "$date", "format": "%Y-%m-%d"}}},
            5,
        ]
    }
    has_work_hours = {"$and": [is_presence, {"$isNumber": "$work_hours"}]}

    if department:
        # Per-employee concise $lookup for a single department
        return [
            {"$match": emp_match},
            {
                "$lookup": {
                    "from": "attendance_logs",
                    "localField": "emp_code",
                    "foreignField": "emp_code",
                    "pipeline": [
                        {"$match": {"date": {"$gte": month_start, "$lte": month_end}}},
                        {
                            "$group": {
                                "_id": None,
                                "present_days": {
                                    "$sum": {
                                        "$cond": [
                                            {"$and": [is_weekday, is_presence]},
                                            {"$cond": ["$half_day", Decimal128("0.5"), Decimal128("1.0")]},
                                            Decimal128("0.0"),
                                        ]
                                    }
                                },
                                "wh_sum": {
                                    "$sum": {"$cond": [has_work_hours, {"$toDecimal": "$work_hours"}, Decimal128("0.0")]}
                                },
                                "wh_count": {"$sum": {"$cond": [has_work_hours, 1, 0]}},
                                "late_count": {
                                    "$sum": {"$cond": [{"$gt": [{"$ifNull": ["$late_minutes", 0]}, 0]}, 1, 0]}
                                },
                                "total_late_minutes": {
                                    "$sum": {"$ifNull": ["$late_minutes", 0]}
                                },
                                "leave_count": {
                                    "$sum": {"$cond": [{"$eq": ["$status", "LEAVE"]}, 1, 0]}
                                },
                                "on_duty_count": {
                                    "$sum": {"$cond": [{"$eq": ["$status", "ON_DUTY"]}, 1, 0]}
                                },
                            }
                        },
                    ],
                    "as": "stats",
                }
            },
            {"$unwind": {"path": "$stats", "preserveNullAndEmptyArrays": True}},
            {
                "$group": {
                    "_id": "$department",
                    "headcount": {"$sum": 1},
                    "present_days": {"$sum": {"$ifNull": ["$stats.present_days", Decimal128("0.0")]}},
                    "wh_sum": {"$sum": {"$ifNull": ["$stats.wh_sum", Decimal128("0.0")]}},
                    "wh_count": {"$sum": {"$ifNull": ["$stats.wh_count", 0]}},
                    "late_count": {"$sum": {"$ifNull": ["$stats.late_count", 0]}},
                    "total_late_minutes": {"$sum": {"$ifNull": ["$stats.total_late_minutes", 0]}},
                    "leave_count": {"$sum": {"$ifNull": ["$stats.leave_count", 0]}},
                    "on_duty_count": {"$sum": {"$ifNull": ["$stats.on_duty_count", 0]}},
                }
            },
            {
                "$project": {
                    "_id": 0,
                    "department": "$_id",
                    "headcount": 1,
                    "present_days": 1,
                    "avg_work_hours": {
                        "$cond": [
                            {"$gt": ["$wh_count", 0]},
                            {"$divide": [{"$toDecimal": "$wh_sum"}, {"$toDecimal": "$wh_count"}]},
                            None,
                        ]
                    },
                    "late_count": 1,
                    "total_late_minutes": 1,
                    "leave_count": 1,
                    "on_duty_count": 1,
                }
            },
            {"$sort": {"department": 1}},
        ]

    # Single-pass $unionWith for all departments
    return [
        {"$match": emp_match},
        {"$project": {"_id": 0, "emp_code": 1, "department": 1, "is_emp": {"$literal": 1}}},
        {
            "$unionWith": {
                "coll": "attendance_logs",
                "pipeline": [
                    {"$match": {"date": {"$gte": month_start, "$lte": month_end}}},
                    {
                        "$group": {
                            "_id": "$emp_code",
                            "present_days": {
                                "$sum": {
                                    "$cond": [
                                        {"$and": [is_weekday, is_presence]},
                                        {"$cond": ["$half_day", Decimal128("0.5"), Decimal128("1.0")]},
                                        Decimal128("0.0"),
                                    ]
                                }
                            },
                            "wh_sum": {
                                "$sum": {"$cond": [has_work_hours, {"$toDecimal": "$work_hours"}, Decimal128("0.0")]}
                            },
                            "wh_count": {"$sum": {"$cond": [has_work_hours, 1, 0]}},
                            "late_count": {
                                "$sum": {"$cond": [{"$gt": [{"$ifNull": ["$late_minutes", 0]}, 0]}, 1, 0]}
                            },
                            "total_late_minutes": {"$sum": {"$ifNull": ["$late_minutes", 0]}},
                            "leave_count": {"$sum": {"$cond": [{"$eq": ["$status", "LEAVE"]}, 1, 0]}},
                            "on_duty_count": {"$sum": {"$cond": [{"$eq": ["$status", "ON_DUTY"]}, 1, 0]}},
                        }
                    },
                    {"$set": {"emp_code": "$_id"}},
                    {"$unset": "_id"},
                ],
            }
        },
        {
            "$group": {
                "_id": "$emp_code",
                "is_emp": {"$max": "$is_emp"},
                "department": {"$max": "$department"},
                "present_days": {"$sum": "$present_days"},
                "wh_sum": {"$sum": "$wh_sum"},
                "wh_count": {"$sum": "$wh_count"},
                "late_count": {"$sum": "$late_count"},
                "total_late_minutes": {"$sum": "$total_late_minutes"},
                "leave_count": {"$sum": "$leave_count"},
                "on_duty_count": {"$sum": "$on_duty_count"},
            }
        },
        {"$match": {"is_emp": 1}},
        {
            "$group": {
                "_id": "$department",
                "headcount": {"$sum": 1},
                "present_days": {"$sum": "$present_days"},
                "wh_sum": {"$sum": "$wh_sum"},
                "wh_count": {"$sum": "$wh_count"},
                "late_count": {"$sum": "$late_count"},
                "total_late_minutes": {"$sum": "$total_late_minutes"},
                "leave_count": {"$sum": "$leave_count"},
                "on_duty_count": {"$sum": "$on_duty_count"},
            }
        },
        {
            "$project": {
                "_id": 0,
                "department": "$_id",
                "headcount": 1,
                "present_days": 1,
                "avg_work_hours": {
                    "$cond": [
                        {"$gt": ["$wh_count", 0]},
                        {"$divide": [{"$toDecimal": "$wh_sum"}, {"$toDecimal": "$wh_count"}]},
                        None,
                    ]
                },
                "late_count": 1,
                "total_late_minutes": 1,
                "leave_count": 1,
                "on_duty_count": 1,
            }
        },
        {"$sort": {"department": 1}},
    ]


def late_leaderboard_pipeline(month: str, limit: int = 10, department: Optional[str] = None) -> List[Dict[str, Any]]:
    month_start, month_end = month_bounds(month)
    pipeline: List[Dict[str, Any]] = [
        {
            "$match": {
                "date": {"$gte": month_start, "$lte": month_end},
                "late_minutes": {"$gt": 0},
            }
        },
        {
            "$group": {
                "_id": "$emp_code",
                "total_late_minutes": {"$sum": "$late_minutes"},
                "late_count": {"$sum": 1},
            }
        },
        {
            "$lookup": {
                "from": "employees",
                "localField": "_id",
                "foreignField": "emp_code",
                "as": "emp",
            }
        },
        {"$unwind": "$emp"},
    ]
    if department:
        pipeline.append({"$match": {"emp.department": department}})

    pipeline.extend([
        {
            "$project": {
                "_id": 0,
                "emp_code": "$_id",
                "name": "$emp.name",
                "department": "$emp.department",
                "total_late_minutes": "$total_late_minutes",
                "late_count": "$late_count",
            }
        },
        {
            "$setWindowFields": {
                "sortBy": {"total_late_minutes": -1},
                "output": {
                    "rank": {"$rank": {}}
                },
            }
        },
        {"$match": {"rank": {"$lte": limit}}},
        {"$sort": {"total_late_minutes": -1, "emp_code": 1}},
    ])
    return pipeline


def department_trend_pipeline(department: str, from_date: str, to_date: str) -> List[Dict[str, Any]]:
    d_from = date.fromisoformat(from_date)
    d_to = date.fromisoformat(to_date)
    n_days = (d_to - d_from).days + 1
    start_utc_dt = datetime(d_from.year, d_from.month, d_from.day, 0, 0, 0, tzinfo=timezone.utc)

    return [
        {"$match": {"department": department}},
        {
            "$lookup": {
                "from": "attendance_logs",
                "localField": "emp_code",
                "foreignField": "emp_code",
                "pipeline": [
                    {"$match": {"date": {"$gte": from_date, "$lte": to_date}}},
                    {
                        "$project": {
                            "_id": 0,
                            "date": 1,
                            "w": {
                                "$cond": [
                                    {"$in": ["$status", ["PRESENT", "WFH", "ON_DUTY"]]},
                                    {"$cond": ["$half_day", Decimal128("0.5"), Decimal128("1.0")]},
                                    Decimal128("0.0"),
                                ]
                            },
                            "late": {
                                "$cond": [
                                    {"$gt": [{"$ifNull": ["$late_minutes", 0]}, 0]},
                                    1,
                                    0,
                                ]
                            },
                        }
                    },
                ],
                "as": "logs",
            }
        },
        {
            "$facet": {
                "joins": [
                    {"$group": {"_id": "$joined_on", "n": {"$sum": 1}}},
                ],
                "days": [
                    {"$unwind": "$logs"},
                    {
                        "$group": {
                            "_id": "$logs.date",
                            "present": {"$sum": "$logs.w"},
                            "late": {"$sum": "$logs.late"},
                        }
                    },
                ],
            }
        },
        {
            "$project": {
                "joins": 1,
                "days": 1,
                "date": {
                    "$map": {
                        "input": {"$range": [0, n_days]},
                        "as": "d",
                        "in": {
                            "$dateToString": {
                                "format": "%Y-%m-%d",
                                "date": {
                                    "$dateAdd": {
                                        "startDate": start_utc_dt,
                                        "unit": "day",
                                        "amount": "$$d",
                                    }
                                },
                            }
                        },
                    }
                },
            }
        },
        {"$unwind": "$date"},
        {
            "$project": {
                "date": 1,
                "is_working_day": {
                    "$lte": [
                        {
                            "$isoDayOfWeek": {
                                "$dateFromString": {"dateString": "$date", "format": "%Y-%m-%d"}
                            }
                        },
                        5,
                    ]
                },
                "headcount": {
                    "$reduce": {
                        "input": {
                            "$filter": {
                                "input": "$joins",
                                "as": "j",
                                "cond": {"$lte": ["$$j._id", "$date"]},
                            }
                        },
                        "initialValue": 0,
                        "in": {"$add": ["$$value", "$$this.n"]},
                    }
                },
                "day_stat": {
                    "$first": {
                        "$filter": {
                            "input": "$days",
                            "as": "d",
                            "cond": {"$eq": ["$$d._id", "$date"]},
                        }
                    }
                },
            }
        },
        {
            "$project": {
                "date": 1,
                "is_working_day": 1,
                "headcount": 1,
                "present_count": {"$ifNull": ["$day_stat.present", Decimal128("0.0")]},
                "late_count": {"$ifNull": ["$day_stat.late", 0]},
            }
        },
        {
            "$project": {
                "date": 1,
                "is_working_day": 1,
                "headcount": 1,
                "present_count": 1,
                "late_count": 1,
                "attendance_rate": {
                    "$cond": [
                        {
                            "$and": [
                                "$is_working_day",
                                {"$gt": ["$headcount", 0]},
                            ]
                        },
                        {
                            "$divide": [
                                {
                                    "$floor": {
                                        "$add": [
                                            {
                                                "$multiply": [
                                                    {
                                                        "$divide": [
                                                            {"$toDecimal": "$present_count"},
                                                            {"$toDecimal": "$headcount"},
                                                        ]
                                                    },
                                                    Decimal128("10000"),
                                                ]
                                            },
                                            Decimal128("0.5"),
                                        ]
                                    }
                                },
                                Decimal128("10000"),
                            ]
                        },
                        None,
                    ]
                },
            }
        },
        {
            "$setWindowFields": {
                "sortBy": {"date": 1},
                "output": {
                    "moving_avg_7d": {
                        "$avg": "$attendance_rate",
                        "window": {
                            "documents": [-6, "current"]
                        },
                    }
                },
            }
        },
        {
            "$project": {
                "_id": 0,
                "date": 1,
                "is_working_day": 1,
                "headcount": 1,
                "present_count": 1,
                "late_count": 1,
                "attendance_rate": 1,
                "moving_avg_7d": 1,
            }
        },
    ]


# --------------------------------------------------------------------------- #
# Endpoints: System, Employees & Attendance
# --------------------------------------------------------------------------- #
@app.get("/", status_code=200)
def root():
    return {
        "status": "online",
        "service": "HROne Employee Attendance & Analytics API",
        "docs": "/docs",
        "health": "/health",
    }


@app.get("/health", status_code=200)
def health():
    try:
        client.admin.command("ping")
        ensure_indexes()
        return {"status": "ok"}
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"MongoDB health check failed: {str(exc)}",
        )


@app.post("/employees", status_code=201, response_model=EmployeeResponse)
def create_employee(body: EmployeeCreate):
    now_ms = get_now_ms()
    created_at_dt = epoch_ms_to_utc_dt(now_ms)
    doc = body.model_dump()
    doc["created_at"] = created_at_dt

    try:
        db.employees.insert_one(doc)
    except DuplicateKeyError:
        raise HTTPException(status_code=409, detail="emp_code already exists")

    return EmployeeResponse(
        emp_code=doc["emp_code"],
        name=doc["name"],
        email=doc["email"],
        department=doc["department"],
        shift_start=doc["shift_start"],
        shift_end=doc["shift_end"],
        joined_on=doc["joined_on"],
        created_at=now_ms,
    )


@app.get("/employees", response_model=EmployeePage)
def list_employees(
    department: Optional[str] = Query(None, description="Exact, case-sensitive match"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
):
    q = {}
    if department:
        q["department"] = department

    total = db.employees.count_documents(q)
    skip = (page - 1) * page_size
    cursor = db.employees.find(q).sort("emp_code", 1).skip(skip).limit(page_size)

    items: List[EmployeeResponse] = []
    for d in cursor:
        items.append(
            EmployeeResponse(
                emp_code=d["emp_code"],
                name=d["name"],
                email=d["email"],
                department=d["department"],
                shift_start=d["shift_start"],
                shift_end=d["shift_end"],
                joined_on=d["joined_on"],
                created_at=utc_dt_to_epoch_ms(d.get("created_at")),
            )
        )

    return EmployeePage(items=items, total=total, page=page, page_size=page_size)


@app.post("/attendance/punch-in", status_code=201, response_model=AttendanceRecord)
def punch_in(body: PunchInRequest):
    emp = db.employees.find_one({"emp_code": body.emp_code})
    if not emp:
        raise HTTPException(status_code=404, detail="Employee not found")

    punch_ms = body.punched_at if body.punched_at is not None else get_now_ms()
    punch_ms = truncate_to_seconds(punch_ms)
    punch_dt = epoch_ms_to_utc_dt(punch_ms)

    att_date = get_attendance_date(punch_ms, emp["shift_start"], emp["shift_end"])
    late_mins = compute_late_minutes(punch_ms, att_date, emp["shift_start"])

    doc = {
        "emp_code": body.emp_code,
        "date": att_date,
        "status": body.status,
        "punch_in": punch_dt,
        "punch_out": None,
        "work_hours": None,
        "late_minutes": late_mins,
        "overtime_minutes": 0,
        "half_day": False,
        "history": [],
    }

    try:
        db.attendance_logs.insert_one(doc)
    except DuplicateKeyError:
        raise HTTPException(status_code=409, detail="already punched in for this date")

    return doc_to_attendance_record(doc)


@app.post("/attendance/punch-out", status_code=200, response_model=AttendanceRecord)
def punch_out(body: PunchOutRequest):
    emp = db.employees.find_one({"emp_code": body.emp_code})
    if not emp:
        raise HTTPException(status_code=404, detail="Employee not found")

    punch_ms = body.punched_at if body.punched_at is not None else get_now_ms()
    punch_ms = truncate_to_seconds(punch_ms)
    punch_dt = epoch_ms_to_utc_dt(punch_ms)

    target_record = db.attendance_logs.find_one(
        {"emp_code": body.emp_code, "punch_in": {"$lte": punch_dt}},
        sort=[("punch_in", -1)],
    )

    if not target_record:
        raise HTTPException(status_code=404, detail="No punch-in found for this punch-out")

    if target_record.get("punch_out") is not None:
        raise HTTPException(status_code=409, detail="That record is already punched out")

    punch_in_dt = target_record["punch_in"]
    punch_in_ms = utc_dt_to_epoch_ms(punch_in_dt)

    if punch_ms <= punch_in_ms:
        raise_validation_error(("body",), "punch_out must be strictly after punch_in")

    if (punch_ms - punch_in_ms) > 24 * 3600 * 1000:
        raise_validation_error(("body",), "punch_out cannot be more than 24 hours after punch_in")

    work_hrs = compute_work_hours(punch_in_ms, punch_ms)
    ot_mins = compute_overtime_minutes(punch_ms, target_record["date"], emp["shift_start"], emp["shift_end"])
    is_half = compute_half_day(work_hrs)

    updated = db.attendance_logs.find_one_and_update(
        {"_id": target_record["_id"], "punch_out": None},
        {
            "$set": {
                "punch_out": punch_dt,
                "work_hours": work_hrs,
                "overtime_minutes": ot_mins,
                "half_day": is_half,
            }
        },
        return_document=ReturnDocument.AFTER,
    )

    if not updated:
        raise HTTPException(status_code=409, detail="That record is already punched out")

    return doc_to_attendance_record(updated)


@app.patch("/attendance/{emp_code}/{date}", status_code=200, response_model=AttendanceRecord)
def regularize_attendance(
    emp_code: str = Path(...),
    date_str: Annotated[IsoDate, Path(..., alias="date")] = ...,
    body: RegularizeRequest = ...,
):
    emp = db.employees.find_one({"emp_code": emp_code})
    if not emp:
        raise HTTPException(status_code=404, detail="Employee not found")

    rec = db.attendance_logs.find_one({"emp_code": emp_code, "date": date_str})
    if not rec:
        raise HTTPException(status_code=404, detail="Attendance record not found for this date")

    target_status = body.status if body.status is not None else rec["status"]

    if target_status in ("ABSENT", "LEAVE"):
        if body.punch_in is not None or body.punch_out is not None:
            raise_validation_error(("body",), f"Cannot supply punch times when status is {target_status}")
        new_punch_in_ms = None
        new_punch_out_ms = None
    else:
        if body.punch_in is not None:
            new_punch_in_ms = truncate_to_seconds(body.punch_in)
        else:
            new_punch_in_ms = utc_dt_to_epoch_ms(rec.get("punch_in"))

        if new_punch_in_ms is None:
            raise_validation_error(("body",), f"Presence status {target_status} requires a punch_in")

        derived_date = get_attendance_date(new_punch_in_ms, emp["shift_start"], emp["shift_end"])
        if derived_date != date_str:
            raise_validation_error(("body",), f"punch_in falls on date {derived_date}, but record is for {date_str}")

        if body.punch_out is not None:
            new_punch_out_ms = truncate_to_seconds(body.punch_out)
        else:
            new_punch_out_ms = utc_dt_to_epoch_ms(rec.get("punch_out"))

        if new_punch_out_ms is not None:
            if new_punch_out_ms <= new_punch_in_ms:
                raise_validation_error(("body",), "punch_out must be strictly after punch_in")
            if (new_punch_out_ms - new_punch_in_ms) > 24 * 3600 * 1000:
                raise_validation_error(("body",), "punch_out cannot be more than 24 hours after punch_in")

    if target_status in ("ABSENT", "LEAVE"):
        new_work_hours = None
        new_late_minutes = 0
        new_overtime_minutes = 0
        new_half_day = False
    else:
        new_late_minutes = compute_late_minutes(new_punch_in_ms, date_str, emp["shift_start"])
        if new_punch_out_ms is not None:
            new_work_hours = compute_work_hours(new_punch_in_ms, new_punch_out_ms)
            new_overtime_minutes = compute_overtime_minutes(
                new_punch_out_ms, date_str, emp["shift_start"], emp["shift_end"]
            )
            new_half_day = compute_half_day(new_work_hours)
        else:
            new_work_hours = None
            new_overtime_minutes = 0
            new_half_day = False

    old_punch_in_ms = utc_dt_to_epoch_ms(rec.get("punch_in"))
    old_punch_out_ms = utc_dt_to_epoch_ms(rec.get("punch_out"))
    old_status = rec["status"]
    old_work_hours = rec.get("work_hours")
    old_late_minutes = rec.get("late_minutes") or 0
    old_overtime_minutes = rec.get("overtime_minutes") or 0
    old_half_day = bool(rec.get("half_day") or False)

    changes: Dict[str, Dict[str, Any]] = {}
    if target_status != old_status:
        changes["status"] = {"from": old_status, "to": target_status}
    if new_punch_in_ms != old_punch_in_ms:
        changes["punch_in"] = {"from": old_punch_in_ms, "to": new_punch_in_ms}
    if new_punch_out_ms != old_punch_out_ms:
        changes["punch_out"] = {"from": old_punch_out_ms, "to": new_punch_out_ms}
    if new_work_hours != old_work_hours:
        changes["work_hours"] = {"from": old_work_hours, "to": new_work_hours}
    if new_late_minutes != old_late_minutes:
        changes["late_minutes"] = {"from": old_late_minutes, "to": new_late_minutes}
    if new_overtime_minutes != old_overtime_minutes:
        changes["overtime_minutes"] = {"from": old_overtime_minutes, "to": new_overtime_minutes}
    if new_half_day != old_half_day:
        changes["half_day"] = {"from": old_half_day, "to": new_half_day}

    if not changes:
        raise_validation_error(("body",), "Request does not change any fields")

    now_ms = get_now_ms()
    now_dt = epoch_ms_to_utc_dt(now_ms)

    stored_changes: Dict[str, Dict[str, Any]] = {}
    for k, v in changes.items():
        f_val = v["from"]
        t_val = v["to"]
        if k in ("punch_in", "punch_out"):
            f_val = epoch_ms_to_utc_dt(f_val) if f_val is not None else None
            t_val = epoch_ms_to_utc_dt(t_val) if t_val is not None else None
        stored_changes[k] = {"from": f_val, "to": t_val}

    history_entry = {
        "at": now_dt,
        "by": body.regularized_by,
        "reason": body.reason,
        "changes": stored_changes,
    }

    new_punch_in_dt = epoch_ms_to_utc_dt(new_punch_in_ms) if new_punch_in_ms is not None else None
    new_punch_out_dt = epoch_ms_to_utc_dt(new_punch_out_ms) if new_punch_out_ms is not None else None

    current_history_len = len(rec.get("history") or [])
    cas_filter = {
        "_id": rec["_id"],
        f"history.{current_history_len}": {"$exists": False},
        "status": old_status,
        "punch_in": rec.get("punch_in"),
        "punch_out": rec.get("punch_out"),
    }

    updated = db.attendance_logs.find_one_and_update(
        cas_filter,
        {
            "$set": {
                "status": target_status,
                "punch_in": new_punch_in_dt,
                "punch_out": new_punch_out_dt,
                "work_hours": new_work_hours,
                "late_minutes": new_late_minutes,
                "overtime_minutes": new_overtime_minutes,
                "half_day": new_half_day,
            },
            "$push": {"history": history_entry},
        },
        return_document=ReturnDocument.AFTER,
    )

    if not updated:
        re_read = db.attendance_logs.find_one({"emp_code": emp_code, "date": date_str})
        if not re_read:
            raise HTTPException(status_code=404, detail="Attendance record not found for this date")
        raise HTTPException(status_code=409, detail="Concurrent modification conflict. Please retry.")

    return doc_to_attendance_record(updated)


@app.get("/attendance", response_model=AttendancePage)
def list_attendance(
    emp_code: Optional[str] = Query(None),
    date_from: Annotated[Optional[IsoDate], Query()] = None,
    date_to: Annotated[Optional[IsoDate], Query()] = None,
    status_filter: Annotated[Optional[StatusType], Query(alias="status")] = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
):
    if date_from and date_to and date_from > date_to:
        raise_validation_error(("query",), "date_from cannot be greater than date_to")

    q = build_attendance_list_query(emp_code, date_from, date_to, status_filter)

    total = db.attendance_logs.count_documents(q)
    skip = (page - 1) * page_size
    cursor = db.attendance_logs.find(q).sort([("date", -1), ("emp_code", 1)]).skip(skip).limit(page_size)

    items = [doc_to_attendance_record(d) for d in cursor]
    return AttendancePage(items=items, total=total, page=page, page_size=page_size)


# --------------------------------------------------------------------------- #
# Analytics Endpoints
# --------------------------------------------------------------------------- #
@app.get(
    "/analytics/employees/{emp_code}/monthly",
    response_model=EmployeeMonthly,
)
def employee_monthly(
    emp_code: str = Path(...),
    month: str = Query(..., pattern=r"^\d{4}-(0[1-9]|1[0-2])$"),
):
    emp = db.employees.find_one({"emp_code": emp_code})
    if not emp:
        raise HTTPException(status_code=404, detail="Employee not found")

    working_days = count_working_days(month, emp["joined_on"])
    pipeline = employee_monthly_pipeline(emp_code, month)

    agg_res = list(db.attendance_logs.aggregate(pipeline))
    if agg_res:
        stats = agg_res[0]
        raw_p = stats.get("present_days", 0)
        dec_p = raw_p.to_decimal() if hasattr(raw_p, "to_decimal") else Decimal(str(raw_p))
        present_days = float(dec_p.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))
        leave_days = int(stats.get("leave_days", 0))
        late_count = int(stats.get("late_count", 0))
        total_late = int(stats.get("total_late_minutes", 0))
        total_ot = int(stats.get("total_overtime_minutes", 0))
    else:
        present_days = 0.0
        leave_days = 0
        late_count = 0
        total_late = 0
        total_ot = 0

    if working_days > 0:
        pct = (Decimal(str(present_days)) / Decimal(str(working_days))) * Decimal("100")
        attendance_pct = float(pct.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))
    else:
        attendance_pct = None

    return EmployeeMonthly(
        emp_code=emp_code,
        month=month,
        working_days=working_days,
        present_days=present_days,
        leave_days=leave_days,
        late_count=late_count,
        total_late_minutes=total_late,
        total_overtime_minutes=total_ot,
        attendance_pct=attendance_pct,
    )


@app.get(
    "/analytics/departments/summary",
    response_model=DepartmentSummary,
)
def department_summary(
    month: str = Query(..., pattern=r"^\d{4}-(0[1-9]|1[0-2])$"),
    department: Optional[str] = Query(None),
):
    pipeline = department_summary_pipeline(month, department)
    agg_res = list(db.employees.aggregate(pipeline))
    items: List[DepartmentSummaryItem] = []

    for row in agg_res:
        headcount = int(row["headcount"])
        if headcount == 0:
            continue

        raw_p = row.get("present_days", 0)
        dec_p = raw_p.to_decimal() if hasattr(raw_p, "to_decimal") else Decimal(str(raw_p))
        p_days = float(dec_p.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))

        raw_avg = row.get("avg_work_hours")
        if raw_avg is not None:
            dec_avg = raw_avg.to_decimal() if hasattr(raw_avg, "to_decimal") else Decimal(str(raw_avg))
            avg_wh = float(dec_avg.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))
        else:
            avg_wh = None

        items.append(
            DepartmentSummaryItem(
                department=row["department"],
                headcount=headcount,
                present_days=p_days,
                avg_work_hours=avg_wh,
                late_count=int(row["late_count"]),
                total_late_minutes=int(row["total_late_minutes"]),
                leave_count=int(row["leave_count"]),
                on_duty_count=int(row["on_duty_count"]),
            )
        )

    return DepartmentSummary(month=month, items=items)


@app.get(
    "/analytics/leaderboard/late",
    response_model=Leaderboard,
)
def late_leaderboard(
    month: str = Query(..., pattern=r"^\d{4}-(0[1-9]|1[0-2])$"),
    limit: int = Query(10, ge=1, le=50),
    department: Optional[str] = Query(None),
):
    pipeline = late_leaderboard_pipeline(month, limit, department)
    agg_res = list(db.attendance_logs.aggregate(pipeline))
    items = [
        LeaderboardItem(
            rank=int(r["rank"]),
            emp_code=r["emp_code"],
            name=r["name"],
            department=r["department"],
            total_late_minutes=int(r["total_late_minutes"]),
            late_count=int(r["late_count"]),
        )
        for r in agg_res
    ]

    return Leaderboard(month=month, items=items)


@app.get(
    "/analytics/departments/{department}/trend",
    response_model=Trend,
)
def department_trend(
    department: str = Path(...),
    from_date: Annotated[IsoDate, Query(alias="from")] = ...,
    to_date: Annotated[IsoDate, Query(alias="to")] = ...,
):
    d_from = date.fromisoformat(from_date)
    d_to = date.fromisoformat(to_date)

    if d_to < d_from:
        raise_validation_error(("query",), "'to' cannot be before 'from'")

    days_count = (d_to - d_from).days + 1
    if days_count > 92:
        raise_validation_error(("query",), "Date range cannot exceed 92 days")

    dept_exists = db.employees.find_one({"department": department})
    if not dept_exists:
        raise HTTPException(status_code=404, detail=f"Department '{department}' not found")

    pipeline = department_trend_pipeline(department, from_date, to_date)
    agg_res = list(db.employees.aggregate(pipeline))
    items: List[TrendItem] = []

    for r in agg_res:
        raw_p = r["present_count"]
        dec_p = raw_p.to_decimal() if hasattr(raw_p, "to_decimal") else Decimal(str(raw_p))
        p_cnt = float(dec_p.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))

        raw_rate = r.get("attendance_rate")
        if raw_rate is not None:
            dec_rate = raw_rate.to_decimal() if hasattr(raw_rate, "to_decimal") else Decimal(str(raw_rate))
            att_rate = float(dec_rate.quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP))
        else:
            att_rate = None

        raw_m = r.get("moving_avg_7d")
        if raw_m is not None:
            dec_m = raw_m.to_decimal() if hasattr(raw_m, "to_decimal") else Decimal(str(raw_m))
            m_avg = float(dec_m.quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP))
        else:
            m_avg = None

        items.append(
            TrendItem(
                date=r["date"],
                is_working_day=r["is_working_day"],
                headcount=int(r["headcount"]),
                present_count=p_cnt,
                late_count=int(r["late_count"]),
                attendance_rate=att_rate,
                moving_avg_7d=m_avg,
            )
        )

    return Trend(department=department, items=items)


# --------------------------------------------------------------------------- #
# Admin Explain Endpoint
# --------------------------------------------------------------------------- #
@app.get("/admin/explain/{endpoint}")
def admin_explain(
    endpoint: str = Path(..., pattern="^(attendance_list|employee_monthly|department_summary|late_leaderboard|department_trend)$"),
    emp_code: Optional[str] = Query(None),
    month: Optional[str] = Query(None, pattern=r"^\d{4}-(0[1-9]|1[0-2])$"),
    department: Optional[str] = Query(None),
    limit: Optional[int] = Query(10, ge=1, le=50),
    date_from: Annotated[Optional[IsoDate], Query()] = None,
    date_to: Annotated[Optional[IsoDate], Query()] = None,
    status_filter: Annotated[Optional[StatusType], Query(alias="status")] = None,
    from_date: Annotated[Optional[IsoDate], Query(alias="from")] = None,
    to_date: Annotated[Optional[IsoDate], Query(alias="to")] = None,
    page: Optional[int] = Query(1, ge=1),
    page_size: Optional[int] = Query(20, ge=1, le=100),
):
    import json
    from bson import json_util

    if endpoint == "attendance_list":
        if date_from and date_to and date_from > date_to:
            raise_validation_error(("query",), "date_from cannot be greater than date_to")

        q = build_attendance_list_query(emp_code, date_from, date_to, status_filter)
        skip = (page - 1) * page_size
        explain_cmd = {
            "explain": {
                "find": "attendance_logs",
                "filter": q,
                "sort": {"date": -1, "emp_code": 1},
                "skip": skip,
                "limit": page_size,
            },
            "verbosity": "executionStats",
        }
        raw_res = db.command(explain_cmd)
        clean_exp = json.loads(json_util.dumps(raw_res))
        return {
            "endpoint": endpoint,
            "collection": "attendance_logs",
            "explain": clean_exp,
        }

    elif endpoint == "employee_monthly":
        if not emp_code:
            raise_validation_error(("query",), "Missing required parameter: emp_code")
        if not month:
            raise_validation_error(("query",), "Missing required parameter: month")

        pipeline = employee_monthly_pipeline(emp_code, month)
        explain_cmd = {
            "explain": {
                "aggregate": "attendance_logs",
                "pipeline": pipeline,
                "cursor": {},
            },
            "verbosity": "executionStats",
        }
        raw_res = db.command(explain_cmd)
        clean_exp = json.loads(json_util.dumps(raw_res))
        return {
            "endpoint": endpoint,
            "collection": "attendance_logs",
            "explain": clean_exp,
        }

    elif endpoint == "department_summary":
        if not month:
            raise_validation_error(("query",), "Missing required parameter: month")

        pipeline = department_summary_pipeline(month, department)
        explain_cmd = {
            "explain": {
                "aggregate": "employees",
                "pipeline": pipeline,
                "cursor": {},
            },
            "verbosity": "executionStats",
        }
        raw_res = db.command(explain_cmd)
        clean_exp = json.loads(json_util.dumps(raw_res))
        return {
            "endpoint": endpoint,
            "collection": "employees",
            "explain": clean_exp,
        }

    elif endpoint == "late_leaderboard":
        if not month:
            raise_validation_error(("query",), "Missing required parameter: month")

        pipeline = late_leaderboard_pipeline(month, limit or 10, department)
        explain_cmd = {
            "explain": {
                "aggregate": "attendance_logs",
                "pipeline": pipeline,
                "cursor": {},
            },
            "verbosity": "executionStats",
        }
        raw_res = db.command(explain_cmd)
        clean_exp = json.loads(json_util.dumps(raw_res))
        return {
            "endpoint": endpoint,
            "collection": "attendance_logs",
            "explain": clean_exp,
        }

    elif endpoint == "department_trend":
        if not department:
            raise_validation_error(("query",), "Missing required parameter: department")
        if not from_date or not to_date:
            raise_validation_error(("query",), "Missing required parameters: from and to")

        d_from = date.fromisoformat(from_date)
        d_to = date.fromisoformat(to_date)
        if d_to < d_from:
            raise_validation_error(("query",), "'to' cannot be before 'from'")
        days_count = (d_to - d_from).days + 1
        if days_count > 92:
            raise_validation_error(("query",), "Date range cannot exceed 92 days")

        pipeline = department_trend_pipeline(department, from_date, to_date)
        explain_cmd = {
            "explain": {
                "aggregate": "employees",
                "pipeline": pipeline,
                "cursor": {},
            },
            "verbosity": "executionStats",
        }
        raw_res = db.command(explain_cmd)
        clean_exp = json.loads(json_util.dumps(raw_res))
        return {
            "endpoint": endpoint,
            "collection": "employees",
            "explain": clean_exp,
        }
