from __future__ import annotations

import shutil
from pathlib import Path

from sqlalchemy.orm import Session

from app.config import NODES_DIR, NODE_CAPACITY, REPLICAS
from app.models import Node


class StorageError(Exception):
    """Недостаточно узлов или файл недоступен."""


class ValidationError(Exception):
    def __init__(self, message: str, status_code: int = 400) -> None:
        super().__init__(message)
        self.status_code = status_code


class NotFoundError(Exception):
    """Объект не найден."""


class IntegrityError(Exception):
    """Не совпал SHA-256 или нет доступной реплики."""


def seed_nodes(db: Session) -> None:
    for i in range(1, 6):
        node_id = f"node-{i}"
        if db.get(Node, node_id) is None:
            db.add(
                Node(
                    id=node_id,
                    address=f"127.0.0.1:{7000 + i}",
                    status="online",
                    capacity_bytes=NODE_CAPACITY,
                    used_bytes=0,
                )
            )
    db.commit()


def save_chunk(node_id: str, file_id: str, idx: int, data: bytes) -> str:
    target_dir = NODES_DIR / node_id / file_id
    target_dir.mkdir(parents=True, exist_ok=True)
    path = target_dir / f"{idx:06d}.bin"
    path.write_bytes(data)
    return str(path.relative_to(NODES_DIR))


def read_chunk(relative_path: str) -> bytes:
    path = NODES_DIR / relative_path
    if not path.exists():
        raise IntegrityError(f"replica file missing: {relative_path}")
    return path.read_bytes()


def delete_file_storage(file_id: str) -> None:
    if not NODES_DIR.exists():
        return
    for node_dir in NODES_DIR.iterdir():
        target = node_dir / file_id
        if target.exists():
            shutil.rmtree(target)


def node_has_space(node: Node, size: int) -> bool:
    return node.status == "online" and node.capacity_bytes - node.used_bytes >= size


def select_nodes(db: Session, chunk_size: int, idx: int) -> list[Node]:
    nodes = (
        db.query(Node)
        .filter(Node.status == "online")
        .order_by(Node.used_bytes.asc(), Node.id.asc())
        .all()
    )
    eligible = [node for node in nodes if node_has_space(node, chunk_size)]
    if len(eligible) < REPLICAS:
        raise StorageError(
            f"недостаточно узлов для {REPLICAS} реплик: доступно {len(eligible)}"
        )
    start = idx % len(eligible)
    return [eligible[(start + offset) % len(eligible)] for offset in range(REPLICAS)]
