import os
import sys
import pathlib
import pytest

root_dir = pathlib.Path(__file__).parent.parent
if str(root_dir) not in sys.path:
    sys.path.insert(0, str(root_dir))

# 1. Protect production DB: set MONGO_DB before loading dotenv or importing app.main
test_db_name = os.environ.get("TEST_MONGO_DB", "hrone_test")
prod_db_names = {"attendance_db", os.environ.get("PROD_MONGO_DB", "")}

if test_db_name in prod_db_names and "TEST_FORCE_PROD" not in os.environ:
    raise RuntimeError(
        f"SAFETY ABORT: TEST_MONGO_DB cannot be set to production database '{test_db_name}'!"
    )

os.environ["MONGO_DB"] = test_db_name

from dotenv import load_dotenv
load_dotenv(root_dir / ".env", override=False)

from app.main import app, db, ensure_indexes
from app.main import client as mongo_client  # aliased: the `client` fixture below would shadow it
from fastapi.testclient import TestClient
from pymongo.errors import ConnectionFailure, ServerSelectionTimeoutError

# Ping Mongo with 2s timeout
mongo_available = False
try:
    mongo_client.admin.command("ping")
    mongo_available = True
except (ConnectionFailure, ServerSelectionTimeoutError, Exception):
    mongo_available = False


@pytest.fixture(scope="session", autouse=True)
def teardown_test_db():
    yield
    if mongo_available:
        try:
            mongo_client.drop_database(test_db_name)
        except Exception:
            pass


@pytest.fixture
def api():
    """TestClient(app) WITHOUT a context manager (no lifespan, no DB connection) for validation-only tests."""
    return TestClient(app)


@pytest.fixture
def client():
    """TestClient(app) WITH context manager + clean-and-seed DB."""
    if not mongo_available:
        pytest.skip("MongoDB unreachable; skipping database-dependent test.")

    from sample_seed import here, opts
    from bson import json_util

    ensure_indexes()
    for name in ("employees", "attendance_logs"):
        docs = json_util.loads((here / f"{name}.json").read_text(), json_options=opts)
        db[name].delete_many({})
        db[name].insert_many(docs)

    with TestClient(app) as tc:
        yield tc
