from __future__ import annotations

import hashlib
from pathlib import Path

from fastapi.testclient import TestClient

from app.config import NODES_DIR
from app.database import SessionLocal
from app.models import Chunk, StoredFile
from app.storage import NODES_DIR as STORAGE_NODES_DIR


def upload(client: TestClient, name: str = "test.txt", data: bytes | None = None):
    payload = data if data is not None else (b"DCloud test payload " * 1200)
    return client.post("/api/files", files={"file": (name, payload, "text/plain")})


def test_health(client: TestClient) -> None:
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "service": "DCloud"}


def test_upload_list_download_and_encryption(client: TestClient) -> None:
    data = b"DCloud encrypted payload " * 4000
    response = upload(client, "report.txt", data)
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["sha256"] == hashlib.sha256(data).hexdigest()
    assert body["chunk_count"] >= 2

    listing = client.get("/api/files").json()
    assert len(listing) == 1
    assert listing[0]["name"] == "report.txt"

    file_id = body["id"]
    chunk_response = client.get(f"/api/files/{file_id}/chunks")
    assert chunk_response.status_code == 200
    chunks = chunk_response.json()["chunks"]
    assert len(chunks) == body["chunk_count"]
    for chunk in chunks:
        assert len(chunk["replicas"]) == 3
        assert len({replica["node_id"] for replica in chunk["replicas"]}) == 3

    download = client.get(f"/api/files/{file_id}/download")
    assert download.status_code == 200
    assert download.content == data

    node_files = list(NODES_DIR.rglob("*.bin"))
    assert len(node_files) == len(chunks) * 3
    for path in node_files:
        blob = path.read_bytes()
        assert data not in blob
    assert not list(NODES_DIR.rglob("master.key"))


def test_validation(client: TestClient) -> None:
    too_big = b"x" * (1024 * 1024 + 1)
    assert upload(client, "big.txt", too_big).status_code == 413
    assert upload(client, "virus.exe", b"x").status_code == 400
    assert upload(client, "empty.txt", b"").status_code == 400


def test_node_failure_and_recovery(client: TestClient) -> None:
    data = b"recovery payload " * 3000
    file_id = upload(client, "recovery.txt", data).json()["id"]

    assert client.post("/api/nodes/node-1/status", json={"status": "offline"}).status_code == 200
    assert client.get(f"/api/files/{file_id}/download").content == data

    chunk_map = client.get(f"/api/files/{file_id}/chunks").json()["chunks"]
    offline_replicas = [
        replica
        for chunk in chunk_map
        for replica in chunk["replicas"]
        if replica["node_id"] == "node-1"
    ]
    assert offline_replicas
    assert all(replica["available"] is False for replica in offline_replicas)

    for node in range(1, 6):
        client.post(f"/api/nodes/node-{node}/status", json={"status": "offline"})
    assert client.get(f"/api/files/{file_id}/download").status_code == 409

    for node in range(1, 6):
        client.post(f"/api/nodes/node-{node}/status", json={"status": "online"})
    assert client.get(f"/api/files/{file_id}/download").status_code == 200


def test_corrupted_replicas_return_conflict(client: TestClient) -> None:
    file_id = upload(client, "corrupt.txt", b"corrupt me " * 4000).json()["id"]
    with SessionLocal() as db:
        stored = db.get(StoredFile, file_id)
        chunk = db.query(Chunk).filter(Chunk.file_id == stored.id, Chunk.idx == 0).one()
        for replica in chunk.replicas:
            (STORAGE_NODES_DIR / replica.path).write_bytes(b"broken")
    response = client.get(f"/api/files/{file_id}/download")
    assert response.status_code == 409
    assert "фрагмент" in response.json()["detail"].lower()


def test_delete_file_and_chunks(client: TestClient) -> None:
    file_id = upload(client, "delete.txt", b"delete me " * 1000).json()["id"]
    assert client.delete(f"/api/files/{file_id}").status_code == 204
    assert client.get("/api/files").json() == []
    assert not list(NODES_DIR.rglob("*.bin"))


def test_download_missing_file(client: TestClient) -> None:
    assert client.get("/api/files/unknown/download").status_code == 404
