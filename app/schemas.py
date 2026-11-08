from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict


class NodeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    address: str
    status: str
    capacity_bytes: int
    used_bytes: int
    free_bytes: int
    last_seen_at: datetime


class NodeStatusIn(BaseModel):
    status: Literal["online", "offline"]


class FileOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    size_bytes: int
    sha256: str
    status: str
    chunk_count: int
    created_at: datetime


class ReplicaOut(BaseModel):
    node_id: str
    status: str
    available: bool


class ChunkOut(BaseModel):
    idx: int
    size_bytes: int
    sha256: str
    replicas: list[ReplicaOut]


class ChunkMapOut(BaseModel):
    file_id: str
    chunks: list[ChunkOut]
