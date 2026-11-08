from __future__ import annotations

from contextlib import asynccontextmanager
from functools import lru_cache
from pathlib import Path
from urllib.parse import quote

from fastapi import Depends, FastAPI, File, HTTPException, UploadFile
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import Session

from app.config import DATA_DIR, NODES_DIR
from app.crypto import load_master_key
from app.database import Base, SessionLocal, engine, get_db
from app.schemas import ChunkMapOut, FileOut, NodeOut, NodeStatusIn
from app.service import (
    chunk_map,
    create_file,
    delete_file,
    download_file,
    get_file,
    list_files,
    set_node_status,
)
from app.storage import (
    IntegrityError,
    NotFoundError,
    StorageError,
    ValidationError,
    seed_nodes,
)

BASE_DIR = Path(__file__).resolve().parent.parent
STATIC_DIR = BASE_DIR / "static"


@lru_cache(maxsize=1)
def master_key() -> bytes:
    return load_master_key()


@asynccontextmanager
async def lifespan(_: FastAPI):
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    NODES_DIR.mkdir(parents=True, exist_ok=True)
    Base.metadata.create_all(bind=engine)
    with SessionLocal() as db:
        seed_nodes(db)
    yield


app = FastAPI(
    title="DCloud API",
    version="1.0.0",
    description="Proof-of-concept децентрализованного облачного хранилища.",
    lifespan=lifespan,
)

app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.get("/", include_in_schema=False)
def index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/api/health", tags=["system"])
def health() -> dict[str, str]:
    return {"status": "ok", "service": "DCloud"}


@app.get("/api/files", response_model=list[FileOut], tags=["files"])
def files_list(db: Session = Depends(get_db)) -> list[FileOut]:
    return list_files(db)


@app.post("/api/files", response_model=FileOut, status_code=201, tags=["files"])
async def files_upload(
    file: UploadFile = File(...), db: Session = Depends(get_db)
) -> FileOut:
    content = await file.read()
    try:
        stored = create_file(db, file.filename or "file.bin", content, master_key())
    except ValidationError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    except StorageError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return stored


@app.get("/api/files/{file_id}", response_model=FileOut, tags=["files"])
def files_get(file_id: str, db: Session = Depends(get_db)) -> FileOut:
    try:
        return get_file(db, file_id)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.get("/api/files/{file_id}/chunks", response_model=ChunkMapOut, tags=["files"])
def files_chunks(file_id: str, db: Session = Depends(get_db)) -> ChunkMapOut:
    try:
        stored = get_file(db, file_id)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"file_id": stored.id, "chunks": chunk_map(db, stored)}


@app.get("/api/files/{file_id}/download", tags=["files"])
def files_download(file_id: str, db: Session = Depends(get_db)) -> Response:
    try:
        stored = get_file(db, file_id)
        content = download_file(db, stored, master_key())
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except (StorageError, IntegrityError) as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc

    filename = quote(stored.name)
    return Response(
        content=content,
        media_type="application/octet-stream",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{filename}"},
    )


@app.delete("/api/files/{file_id}", status_code=204, tags=["files"])
def files_delete(file_id: str, db: Session = Depends(get_db)) -> Response:
    try:
        stored = get_file(db, file_id)
        delete_file(db, stored)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return Response(status_code=204)


@app.get("/api/nodes", response_model=list[NodeOut], tags=["nodes"])
def nodes_list(db: Session = Depends(get_db)) -> list[NodeOut]:
    from app.models import Node

    return db.query(Node).order_by(Node.id).all()


@app.post("/api/nodes/{node_id}/status", response_model=NodeOut, tags=["nodes"])
def nodes_status(
    node_id: str, payload: NodeStatusIn, db: Session = Depends(get_db)
) -> NodeOut:
    try:
        return set_node_status(db, node_id, payload.status)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
