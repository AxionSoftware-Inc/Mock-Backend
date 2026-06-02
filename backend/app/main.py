from contextlib import asynccontextmanager
from typing import Any
from uuid import UUID

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .config import FRONTEND_ORIGIN
from .database import close_pool, open_pool
from .repository import (
    ConflictError,
    NotFoundError,
    RecordValidationError,
    create_project,
    create_resource,
    create_record,
    delete_project,
    delete_resource,
    delete_record,
    get_project,
    get_flow,
    get_record,
    list_projects,
    list_records,
    save_flow,
    update_resource,
    update_record,
)
from .schemas import FlowSave, ProjectCreate, ResourceCreate, ResourceUpdate


@asynccontextmanager
async def lifespan(_: FastAPI):
    open_pool()
    yield
    close_pool()


app = FastAPI(title="mockbase API", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[FRONTEND_ORIGIN],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(NotFoundError)
async def not_found_handler(_, error: NotFoundError):
    return JSONResponse(status_code=404, content={"detail": str(error)})


@app.exception_handler(ConflictError)
async def conflict_handler(_, error: ConflictError):
    return JSONResponse(status_code=409, content={"detail": str(error)})


@app.exception_handler(RecordValidationError)
async def validation_handler(_, error: RecordValidationError):
    return JSONResponse(status_code=400, content={"detail": str(error)})


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/api/flows/{key}")
def flows_retrieve(key: str):
    return get_flow(key)


@app.put("/api/flows/{key}")
def flows_update(key: str, payload: FlowSave):
    return save_flow(key, payload.model_dump())


@app.get("/api/projects")
def projects_index():
    return list_projects()


@app.post("/api/projects", status_code=201)
def projects_create(payload: ProjectCreate):
    return create_project(payload)


@app.get("/api/projects/{slug}")
def projects_retrieve(slug: str):
    return get_project(slug)


@app.delete("/api/projects/{slug}", status_code=204)
def projects_delete(slug: str):
    delete_project(slug)


@app.post("/api/projects/{slug}/resources", status_code=201)
def resources_create(slug: str, payload: ResourceCreate):
    return create_resource(slug, payload)


@app.patch("/api/projects/{slug}/resources/{resource}")
def resources_update(slug: str, resource: str, payload: ResourceUpdate):
    return update_resource(slug, resource, payload)


@app.delete("/api/projects/{slug}/resources/{resource}", status_code=204)
def resources_delete(slug: str, resource: str):
    delete_resource(slug, resource)


@app.get("/api/mock/{slug}/{resource}")
def records_index(slug: str, resource: str):
    return list_records(slug, resource)


@app.post("/api/mock/{slug}/{resource}", status_code=201)
def records_create(slug: str, resource: str, payload: dict[str, Any]):
    return create_record(slug, resource, payload)


@app.get("/api/mock/{slug}/{resource}/{record_id}")
def records_retrieve(slug: str, resource: str, record_id: UUID):
    return get_record(slug, resource, record_id)


@app.patch("/api/mock/{slug}/{resource}/{record_id}")
def records_update(slug: str, resource: str, record_id: UUID, payload: dict[str, Any]):
    return update_record(slug, resource, record_id, payload)


@app.delete("/api/mock/{slug}/{resource}/{record_id}")
def records_delete(slug: str, resource: str, record_id: UUID):
    return delete_record(slug, resource, record_id)
