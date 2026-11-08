from __future__ import annotations

import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = Path(os.getenv("DCLOUD_DATA_DIR", str(BASE_DIR / "data")))
DATABASE_URL = os.getenv(
    "DCLOUD_DATABASE_URL",
    "postgresql+psycopg://postgres@localhost:5432/dcloud",
)

MAX_FILE_SIZE = int(os.getenv("DCLOUD_MAX_FILE_SIZE", str(20 * 1024 * 1024)))
CHUNK_SIZE = int(os.getenv("DCLOUD_CHUNK_SIZE", str(16 * 1024)))
REPLICAS = int(os.getenv("DCLOUD_REPLICAS", "3"))
NODE_CAPACITY = int(os.getenv("DCLOUD_NODE_CAPACITY", str(100 * 1024 * 1024)))

ALLOWED_EXTENSIONS = {
    ".txt",
    ".md",
    ".csv",
    ".json",
    ".pdf",
    ".png",
    ".jpg",
    ".jpeg",
    ".zip",
    ".docx",
    ".xlsx",
    ".bin",
}

MASTER_KEY_FILE = DATA_DIR / "master.key"
NODES_DIR = DATA_DIR / "nodes"
