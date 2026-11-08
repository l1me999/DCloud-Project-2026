from __future__ import annotations

import base64
import os
import shutil
import tempfile
from pathlib import Path

TEST_ROOT = Path(tempfile.mkdtemp(prefix="dcloud-test-"))
os.environ["DCLOUD_DATABASE_URL"] = f"sqlite:///{TEST_ROOT / 'test.db'}"
os.environ["DCLOUD_DATA_DIR"] = str(TEST_ROOT / "data")
os.environ["DCLOUD_MAX_FILE_SIZE"] = str(1024 * 1024)
os.environ["DCLOUD_CHUNK_SIZE"] = str(16 * 1024)
os.environ["DCLOUD_REPLICAS"] = "3"
os.environ["DCLOUD_NODE_CAPACITY"] = str(10 * 1024 * 1024)
os.environ["DCLOUD_MASTER_KEY"] = base64.b64encode(b"k" * 32).decode("ascii")

import pytest
from fastapi.testclient import TestClient

from app.database import Base, SessionLocal, engine
from app.main import app
from app.storage import seed_nodes
from app.config import NODES_DIR


@pytest.fixture()
def client() -> TestClient:
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    if NODES_DIR.exists():
        shutil.rmtree(NODES_DIR)
    NODES_DIR.mkdir(parents=True, exist_ok=True)
    with SessionLocal() as db:
        seed_nodes(db)
    with TestClient(app) as test_client:
        yield test_client
