from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


class StoredFile(Base):
    __tablename__ = "files"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    name: Mapped[str] = mapped_column(String(255))
    size_bytes: Mapped[int] = mapped_column(Integer)
    sha256: Mapped[str] = mapped_column(String(64), index=True)
    status: Mapped[str] = mapped_column(String(20), default="encrypted")
    key_wrapped: Mapped[str] = mapped_column(Text)
    key_nonce: Mapped[str] = mapped_column(String(32))
    data_nonce: Mapped[str] = mapped_column(String(32))
    chunk_count: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    chunks: Mapped[list[Chunk]] = relationship(
        back_populates="file", cascade="all, delete-orphan", order_by="Chunk.idx"
    )


class Chunk(Base):
    __tablename__ = "chunks"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    file_id: Mapped[str] = mapped_column(ForeignKey("files.id", ondelete="CASCADE"), index=True)
    idx: Mapped[int] = mapped_column(Integer)
    size_bytes: Mapped[int] = mapped_column(Integer)
    sha256: Mapped[str] = mapped_column(String(64))

    file: Mapped[StoredFile] = relationship(back_populates="chunks")
    replicas: Mapped[list[Replica]] = relationship(
        back_populates="chunk", cascade="all, delete-orphan"
    )


class Replica(Base):
    __tablename__ = "replicas"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    chunk_id: Mapped[str] = mapped_column(ForeignKey("chunks.id", ondelete="CASCADE"), index=True)
    node_id: Mapped[str] = mapped_column(ForeignKey("nodes.id"))
    path: Mapped[str] = mapped_column(String(500))
    status: Mapped[str] = mapped_column(String(20), default="ok")

    chunk: Mapped[Chunk] = relationship(back_populates="replicas")
    node: Mapped[Node] = relationship()

    __table_args__ = (UniqueConstraint("chunk_id", "node_id", name="uq_chunk_node"),)


class Node(Base):
    __tablename__ = "nodes"

    id: Mapped[str] = mapped_column(String(20), primary_key=True)
    address: Mapped[str] = mapped_column(String(100))
    status: Mapped[str] = mapped_column(String(20), default="online")
    capacity_bytes: Mapped[int] = mapped_column(Integer)
    used_bytes: Mapped[int] = mapped_column(Integer, default=0)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    @property
    def free_bytes(self) -> int:
        return self.capacity_bytes - self.used_bytes
