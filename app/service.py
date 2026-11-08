from __future__ import annotations

import hashlib
import math
from pathlib import Path
from uuid import uuid4

from sqlalchemy.orm import Session

from app.config import ALLOWED_EXTENSIONS, CHUNK_SIZE, MAX_FILE_SIZE, NODES_DIR, REPLICAS
from app.crypto import decrypt_bytes, encrypt_bytes
from app.models import Chunk, Node, Replica, StoredFile
from app.storage import (
    IntegrityError,
    NotFoundError,
    StorageError,
    ValidationError,
    delete_file_storage,
    read_chunk,
    save_chunk,
    select_nodes,
)


def validate_upload(filename: str, size: int) -> None:
    if size <= 0:
        raise ValidationError("файл пустой")
    if size > MAX_FILE_SIZE:
        raise ValidationError(
            f"файл больше {MAX_FILE_SIZE // (1024 * 1024)} МБ", status_code=413
        )
    extension = Path(filename).suffix.lower()
    if extension not in ALLOWED_EXTENSIONS:
        raise ValidationError(
            f"неподдерживаемый тип файла: {extension or 'без расширения'}"
        )


def create_file(
    db: Session, filename: str, content: bytes, master_key: bytes
) -> StoredFile:
    validate_upload(filename, len(content))
    encrypted = encrypt_bytes(content, master_key)
    ciphertext: bytes = encrypted["ciphertext"]
    chunk_count = max(1, math.ceil(len(ciphertext) / CHUNK_SIZE))

    online_nodes = db.query(Node).filter(Node.status == "online").count()
    if online_nodes < REPLICAS:
        raise StorageError(
            f"недостаточно узлов для {REPLICAS} реплик: доступно {online_nodes}"
        )

    file_id = str(uuid4())
    stored = StoredFile(
        id=file_id,
        name=filename,
        size_bytes=len(content),
        sha256=encrypted["sha256"],
        status="encrypted",
        key_wrapped=encrypted["key_wrapped"],
        key_nonce=encrypted["key_nonce"],
        data_nonce=encrypted["data_nonce"],
        chunk_count=chunk_count,
    )
    db.add(stored)
    db.flush()

    written_paths: list[Path] = []
    try:
        for idx in range(chunk_count):
            payload = ciphertext[idx * CHUNK_SIZE : (idx + 1) * CHUNK_SIZE]
            chunk = Chunk(
                id=str(uuid4()),
                file_id=file_id,
                idx=idx,
                size_bytes=len(payload),
                sha256=hashlib.sha256(payload).hexdigest(),
            )
            db.add(chunk)
            db.flush()

            for node in select_nodes(db, len(payload), idx):
                relative_path = save_chunk(node.id, file_id, idx, payload)
                written_paths.append(Path(relative_path))
                node.used_bytes += len(payload)
                db.add(
                    Replica(
                        id=str(uuid4()),
                        chunk_id=chunk.id,
                        node_id=node.id,
                        path=relative_path,
                        status="ok",
                    )
                )
        db.commit()
    except Exception:
        db.rollback()
        delete_file_storage(file_id)
        raise

    db.refresh(stored)
    return stored


def list_files(db: Session) -> list[StoredFile]:
    return db.query(StoredFile).order_by(StoredFile.created_at.desc()).all()


def get_file(db: Session, file_id: str) -> StoredFile:
    stored = db.get(StoredFile, file_id)
    if stored is None:
        raise NotFoundError("файл не найден")
    return stored


def download_file(db: Session, stored: StoredFile, master_key: bytes) -> bytes:
    chunks = sorted(stored.chunks, key=lambda chunk: chunk.idx)
    if not chunks:
        raise StorageError("у файла нет фрагментов")

    ciphertext = bytearray()
    for chunk in chunks:
        replicas = [replica for replica in chunk.replicas if replica.node.status == "online"]
        if not replicas:
            raise IntegrityError(
                f"нет доступных реплик для фрагмента {chunk.idx}"
            )

        payload = None
        for replica in replicas:
            try:
                candidate = read_chunk(replica.path)
            except IntegrityError:
                continue
            if hashlib.sha256(candidate).hexdigest() == chunk.sha256:
                payload = candidate
                break
        if payload is None:
            raise IntegrityError(
                f"все доступные реплики фрагмента {chunk.idx} повреждены"
            )
        ciphertext.extend(payload)

    plaintext = decrypt_bytes(
        bytes(ciphertext),
        stored.data_nonce,
        stored.key_wrapped,
        stored.key_nonce,
        master_key,
    )
    if hashlib.sha256(plaintext).hexdigest() != stored.sha256:
        raise IntegrityError("SHA-256 файла не совпадает")
    return plaintext


def delete_file(db: Session, stored: StoredFile) -> None:
    for chunk in stored.chunks:
        for replica in chunk.replicas:
            node = db.get(Node, replica.node_id)
            if node is not None:
                node.used_bytes = max(0, node.used_bytes - chunk.size_bytes)
    delete_file_storage(stored.id)
    db.delete(stored)
    db.commit()


def chunk_map(db: Session, stored: StoredFile) -> list[dict]:
    result = []
    for chunk in sorted(stored.chunks, key=lambda item: item.idx):
        replicas = []
        for replica in chunk.replicas:
            available = (
                replica.node.status == "online"
                and (NODES_DIR / replica.path).exists()
            )
            replicas.append(
                {
                    "node_id": replica.node_id,
                    "status": replica.node.status,
                    "available": available,
                }
            )
        result.append(
            {
                "idx": chunk.idx,
                "size_bytes": chunk.size_bytes,
                "sha256": chunk.sha256,
                "replicas": replicas,
            }
        )
    return result


def set_node_status(db: Session, node_id: str, status: str) -> Node:
    node = db.get(Node, node_id)
    if node is None:
        raise NotFoundError("узел не найден")
    node.status = status
    db.commit()
    db.refresh(node)
    return node
