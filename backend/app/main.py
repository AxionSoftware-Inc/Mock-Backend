from contextlib import asynccontextmanager
import json
from typing import Any
from uuid import UUID

from fastapi import FastAPI, Header
from fastapi.encoders import jsonable_encoder
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response

from .config import FRONTEND_ORIGIN
from .database import close_pool, initialize_schema, open_pool
from .repository import (
    ConflictError,
    FlowExecutionError,
    NotFoundError,
    RecordValidationError,
    create_project,
    create_resource,
    create_record,
    delete_project,
    delete_resource,
    delete_record,
    execute_flow,
    ensure_project_access,
    get_api_model,
    get_project,
    get_flow,
    get_record,
    list_projects,
    list_project_revisions,
    list_records,
    save_flow,
    update_project_settings,
    update_resource,
    update_record,
    validate_flow,
)
from .schemas import FlowSave, ProjectCreate, ProjectSettingsUpdate, ResourceCreate, ResourceUpdate


@asynccontextmanager
async def lifespan(_: FastAPI):
    open_pool()
    initialize_schema()
    yield
    close_pool()


app = FastAPI(title="mockbase API", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[FRONTEND_ORIGIN],
    allow_methods=["*"],
    allow_headers=["*"],
)


def clean_json_response(body: Any, status: int) -> Response:
    return Response(
        content=json.dumps(jsonable_encoder(body), ensure_ascii=False, indent=2),
        media_type="application/json",
        status_code=status,
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


@app.exception_handler(FlowExecutionError)
async def flow_execution_handler(_, error: FlowExecutionError):
    return JSONResponse(status_code=400, content={"detail": str(error)})


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/api/flows/{key}")
def flows_retrieve(key: str):
    return get_flow(key)


@app.get("/api/flows/{key}/validate")
def flows_validate(key: str):
    return validate_flow(key)


@app.put("/api/flows/{key}")
def flows_update(key: str, payload: FlowSave):
    return save_flow(key, payload.model_dump())


@app.get("/api/node-flows/{key}")
def node_flows_get(key: str, x_api_key: str | None = Header(default=None)):
    body, status = execute_flow(key, "GET", api_key=x_api_key)
    return clean_json_response(body, status)


@app.get("/api/node-flows/{key}/{path:path}")
def node_flows_get_path(key: str, path: str, x_api_key: str | None = Header(default=None)):
    body, status = execute_flow(key, "GET", path=path, api_key=x_api_key)
    return clean_json_response(body, status)


@app.post("/api/node-flows/{key}")
def node_flows_post(key: str, payload: dict[str, Any], x_api_key: str | None = Header(default=None)):
    body, status = execute_flow(key, "POST", payload, api_key=x_api_key)
    return clean_json_response(body, status)


@app.post("/api/node-flows/{key}/{path:path}")
def node_flows_post_path(key: str, path: str, payload: dict[str, Any], x_api_key: str | None = Header(default=None)):
    body, status = execute_flow(key, "POST", payload, path=path, api_key=x_api_key)
    return clean_json_response(body, status)


@app.patch("/api/node-flows/{key}")
def node_flows_patch(key: str, payload: dict[str, Any], x_api_key: str | None = Header(default=None)):
    record_id = payload.pop("id", None)
    body, status = execute_flow(key, "PATCH", payload, UUID(record_id) if record_id else None, api_key=x_api_key)
    return clean_json_response(body, status)


@app.patch("/api/node-flows/{key}/{path:path}")
def node_flows_patch_path(key: str, path: str, payload: dict[str, Any], x_api_key: str | None = Header(default=None)):
    record_id = payload.pop("id", None)
    body, status = execute_flow(key, "PATCH", payload, UUID(record_id) if record_id else None, path=path, api_key=x_api_key)
    return clean_json_response(body, status)


@app.delete("/api/node-flows/{key}")
def node_flows_delete(key: str, record_id: UUID | None = None, x_api_key: str | None = Header(default=None)):
    body, status = execute_flow(key, "DELETE", record_id=record_id, api_key=x_api_key)
    return clean_json_response(body, status)


@app.delete("/api/node-flows/{key}/{path:path}")
def node_flows_delete_path(key: str, path: str, record_id: UUID | None = None, x_api_key: str | None = Header(default=None)):
    body, status = execute_flow(key, "DELETE", record_id=record_id, path=path, api_key=x_api_key)
    return clean_json_response(body, status)


@app.get("/api/projects")
def projects_index():
    return list_projects()


@app.post("/api/projects", status_code=201)
def projects_create(payload: ProjectCreate):
    return create_project(payload)


@app.get("/api/projects/{slug}")
def projects_retrieve(slug: str):
    return get_project(slug)


@app.get("/api/projects/{slug}/model")
def projects_model(slug: str):
    return get_api_model(slug)


@app.get("/api/projects/{slug}/revisions")
def projects_revisions(slug: str):
    return list_project_revisions(slug)


@app.patch("/api/projects/{slug}/settings")
def projects_settings_update(slug: str, payload: ProjectSettingsUpdate):
    return update_project_settings(slug, payload)


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
def records_index(slug: str, resource: str, x_api_key: str | None = Header(default=None)):
    ensure_project_access(slug, x_api_key)
    return list_records(slug, resource)


@app.post("/api/mock/{slug}/{resource}", status_code=201)
def records_create(slug: str, resource: str, payload: dict[str, Any], x_api_key: str | None = Header(default=None)):
    ensure_project_access(slug, x_api_key)
    return create_record(slug, resource, payload)


@app.get("/api/mock/{slug}/{resource}/{record_id}")
def records_retrieve(slug: str, resource: str, record_id: UUID, x_api_key: str | None = Header(default=None)):
    ensure_project_access(slug, x_api_key)
    return get_record(slug, resource, record_id)


@app.patch("/api/mock/{slug}/{resource}/{record_id}")
def records_update(slug: str, resource: str, record_id: UUID, payload: dict[str, Any], x_api_key: str | None = Header(default=None)):
    ensure_project_access(slug, x_api_key)
    return update_record(slug, resource, record_id, payload)


@app.delete("/api/mock/{slug}/{resource}/{record_id}")
def records_delete(slug: str, resource: str, record_id: UUID, x_api_key: str | None = Header(default=None)):
    ensure_project_access(slug, x_api_key)
    return delete_record(slug, resource, record_id)
