import json
import re
from functools import cmp_to_key
from typing import Any
from uuid import UUID, uuid4

from psycopg import errors
from psycopg.types.json import Jsonb

from .database import pool
from .schemas import MockField, ProjectCreate, ProjectSettingsUpdate, ResourceCreate, ResourceUpdate


class NotFoundError(Exception):
    pass


class ConflictError(Exception):
    pass


class RecordValidationError(Exception):
    pass


class FlowExecutionError(Exception):
    pass


def slugify(value: str) -> str:
    return re.sub(r"(^-+|-+$)", "", re.sub(r"[^a-z0-9]+", "-", value.lower().strip()))


def available_slug(connection, requested_slug: str) -> str:
    rows = connection.execute(
        "SELECT slug FROM projects WHERE slug = %s OR slug LIKE %s",
        (requested_slug, f"{requested_slug}-%"),
    ).fetchall()
    existing = {row["slug"] for row in rows}
    if requested_slug not in existing:
        return requested_slug
    suffix = 2
    while f"{requested_slug}-{suffix}" in existing:
        suffix += 1
    return f"{requested_slug}-{suffix}"


def list_projects() -> list[dict[str, Any]]:
    with pool.connection() as connection:
        rows = connection.execute(
            """
            SELECT p.id, p.name, p.slug, p.access, p.created_at AS "createdAt",
              count(DISTINCT r.id)::int AS "resourceCount",
              count(DISTINCT rec.id)::int AS "recordCount"
            FROM projects p
            LEFT JOIN resources r ON r.project_id = p.id
            LEFT JOIN records rec ON rec.resource_id = r.id
            GROUP BY p.id
            ORDER BY p.created_at DESC
            """,
        ).fetchall()
    return rows


def get_project(slug: str) -> dict[str, Any]:
    with pool.connection() as connection:
        project = connection.execute(
            """
            SELECT p.id, p.name, p.slug, p.owner_id AS "ownerId", p.access, p.api_key AS "apiKey", p.created_at AS "createdAt"
            FROM projects p WHERE p.slug = %s
            """,
            (slug,),
        ).fetchone()
        if not project:
            raise NotFoundError("Project topilmadi.")
        resources = connection.execute(
            """
            SELECT r.id, r.name, r.created_at AS "createdAt",
              (SELECT count(*)::int FROM records rec WHERE rec.resource_id = r.id) AS "recordCount",
              COALESCE((
                SELECT json_agg(json_build_object(
                  'name', f.name, 'type', f.type, 'required', f.required
                ) ORDER BY f.position)
                FROM fields f WHERE f.resource_id = r.id
              ), '[]') AS fields
            FROM resources r
            WHERE r.project_id = %s
            ORDER BY r.created_at
            """,
            (project["id"],),
        ).fetchall()
    return {**project, "resources": resources}


def get_api_model(slug: str) -> dict[str, Any]:
    project = get_project(slug)
    methods = [
        {"method": "GET", "enabled": True},
        {"method": "POST", "enabled": True},
        {"method": "PATCH", "enabled": True},
        {"method": "DELETE", "enabled": True},
    ]
    return {
        "project": project["slug"],
        "name": project["name"],
        "access": project["access"],
        "endpoints": [
            {
                "path": f"/{resource['name']}",
                "resource": resource["name"],
                "fields": resource["fields"],
                "methods": methods,
                "recordCount": resource["recordCount"],
            }
            for resource in project["resources"]
        ],
    }


def project_row(connection, slug: str) -> dict[str, Any]:
    row = connection.execute("SELECT id, name, slug, access, api_key AS \"apiKey\" FROM projects WHERE slug = %s", (slug,)).fetchone()
    if not row:
        raise NotFoundError("Project topilmadi.")
    return row


def record_project_revision(slug: str, reason: str) -> None:
    snapshot = get_api_model(slug)
    with pool.connection() as connection:
        project = project_row(connection, slug)
        version = connection.execute(
            "SELECT COALESCE(max(version), 0) + 1 AS version FROM project_revisions WHERE project_id = %s",
            (project["id"],),
        ).fetchone()["version"]
        connection.execute(
            """
            INSERT INTO project_revisions (id, project_id, version, reason, snapshot)
            VALUES (%s, %s, %s, %s, %s)
            """,
            (uuid4(), project["id"], version, reason, Jsonb(snapshot)),
        )


def list_project_revisions(slug: str) -> list[dict[str, Any]]:
    with pool.connection() as connection:
        project = project_row(connection, slug)
        rows = connection.execute(
            """
            SELECT id, version, reason, snapshot, created_at AS "createdAt"
            FROM project_revisions
            WHERE project_id = %s
            ORDER BY version DESC
            """,
            (project["id"],),
        ).fetchall()
    return rows


def create_project(payload: ProjectCreate) -> dict[str, Any]:
    requested_slug = slugify(payload.slug or payload.name)
    resource = slugify(payload.resource)
    if not requested_slug or not resource:
        raise RecordValidationError("Slug va resource nomi kerak.")
    project_id, resource_id = uuid4(), uuid4()
    try:
        with pool.connection() as connection:
            with connection.transaction():
                slug = requested_slug if payload.slug else available_slug(connection, requested_slug)
                project = connection.execute(
                    """
                    INSERT INTO projects (id, name, slug, access)
                    VALUES (%s, %s, %s, %s)
                    RETURNING id, name, slug, access, created_at AS "createdAt"
                    """,
                    (project_id, payload.name.strip(), slug, payload.access),
                ).fetchone()
                connection.execute(
                    "INSERT INTO resources (id, project_id, name) VALUES (%s, %s, %s)",
                    (resource_id, project_id, resource),
                )
                for position, field in enumerate(payload.fields):
                    connection.execute(
                        """
                        INSERT INTO fields (id, resource_id, name, type, required, position)
                        VALUES (%s, %s, %s, %s, %s, %s)
                        """,
                        (uuid4(), resource_id, field.name, field.type, field.required, position),
                    )
    except errors.UniqueViolation as error:
        raise_conflict(error)
    created = get_project(project["slug"])
    record_project_revision(created["slug"], "project.created")
    return created


def delete_project(slug: str) -> None:
    with pool.connection() as connection:
        result = connection.execute("DELETE FROM projects WHERE slug = %s", (slug,))
    if not result.rowcount:
        raise NotFoundError("Project topilmadi.")


def update_project_settings(slug: str, payload: ProjectSettingsUpdate) -> dict[str, Any]:
    with pool.connection() as connection:
        row = connection.execute(
            """
            UPDATE projects SET access = %s
            WHERE slug = %s
            RETURNING id, name, slug, owner_id AS "ownerId", access, api_key AS "apiKey", created_at AS "createdAt"
            """,
            (payload.access, slug),
        ).fetchone()
    if not row:
        raise NotFoundError("Project topilmadi.")
    record_project_revision(slug, f"project.access:{payload.access}")
    return get_project(slug)


def ensure_project_access(slug: str, api_key: str | None = None) -> None:
    with pool.connection() as connection:
        project = project_row(connection, slug)
    if project["access"] == "private" and api_key != project["apiKey"]:
        raise NotFoundError("API topilmadi.")


def create_resource(slug: str, payload: ResourceCreate) -> dict[str, Any]:
    resource = slugify(payload.name)
    if not resource:
        raise RecordValidationError("Resource nomi kerak.")
    resource_id = uuid4()
    try:
        with pool.connection() as connection:
            with connection.transaction():
                project = connection.execute(
                    "SELECT id FROM projects WHERE slug = %s", (slug,)
                ).fetchone()
                if not project:
                    raise NotFoundError("Project topilmadi.")
                connection.execute(
                    "INSERT INTO resources (id, project_id, name) VALUES (%s, %s, %s)",
                    (resource_id, project["id"], resource),
                )
                replace_fields(connection, resource_id, payload.fields)
    except errors.UniqueViolation as error:
        raise_conflict(error)
    created = find_resource(slug, resource)
    record_project_revision(slug, f"resource.created:{resource}")
    return created


def update_resource(slug: str, resource: str, payload: ResourceUpdate) -> dict[str, Any]:
    found = find_resource(slug, resource)
    fields = [field.model_dump() for field in payload.fields]
    next_resource = slugify(payload.name) if payload.name else resource
    if not next_resource:
        raise RecordValidationError("Resource nomi kerak.")
    with pool.connection() as connection:
        records = connection.execute(
            "SELECT data FROM records WHERE resource_id = %s", (found["id"],)
        ).fetchall()
        for record in records:
            validate_record(fields, record["data"])
        try:
            with connection.transaction():
                if next_resource != resource:
                    connection.execute(
                        "UPDATE resources SET name = %s WHERE id = %s",
                        (next_resource, found["id"]),
                    )
                connection.execute("DELETE FROM fields WHERE resource_id = %s", (found["id"],))
                replace_fields(connection, found["id"], payload.fields)
        except errors.UniqueViolation as error:
            raise_conflict(error)
    updated = find_resource(slug, next_resource)
    record_project_revision(slug, f"resource.updated:{resource}->{next_resource}")
    return updated


def delete_resource(slug: str, resource: str) -> None:
    found = find_resource(slug, resource)
    with pool.connection() as connection:
        connection.execute("DELETE FROM resources WHERE id = %s", (found["id"],))
    record_project_revision(slug, f"resource.deleted:{resource}")


def replace_fields(connection, resource_id: UUID, fields: list[MockField]) -> None:
    for position, field in enumerate(fields):
        connection.execute(
            """
            INSERT INTO fields (id, resource_id, name, type, required, position)
            VALUES (%s, %s, %s, %s, %s, %s)
            """,
            (uuid4(), resource_id, field.name, field.type, field.required, position),
        )


def raise_conflict(error: errors.UniqueViolation) -> None:
    constraint = error.diag.constraint_name
    if constraint == "projects_slug_key":
        raise ConflictError("Bu slug band. Boshqa project nomini tanlang.") from error
    if constraint == "resources_project_id_name_key":
        raise ConflictError("Bu resource project ichida mavjud.") from error
    if constraint == "fields_resource_id_name_key":
        raise ConflictError("Field nomlari takrorlanmasligi kerak.") from error
    raise ConflictError("Bu qiymat oldin ishlatilgan.") from error


def find_resource(slug: str, resource: str) -> dict[str, Any]:
    with pool.connection() as connection:
        row = connection.execute(
            """
            SELECT r.id, r.name, r.created_at AS "createdAt",
              (SELECT count(*)::int FROM records rec WHERE rec.resource_id = r.id) AS "recordCount",
              COALESCE(
              json_agg(json_build_object(
                'name', f.name, 'type', f.type, 'required', f.required
              ) ORDER BY f.position) FILTER (WHERE f.id IS NOT NULL),
              '[]'
            ) AS fields
            FROM resources r
            JOIN projects p ON p.id = r.project_id
            LEFT JOIN fields f ON f.resource_id = r.id
            WHERE p.slug = %s AND r.name = %s
            GROUP BY r.id
            """,
            (slug, resource),
        ).fetchone()
    if not row:
        raise NotFoundError("API topilmadi.")
    return row


def validate_record(
    fields: list[dict[str, Any]], payload: dict[str, Any], partial: bool = False
) -> dict[str, Any]:
    known_fields = {field["name"]: field for field in fields}
    unknown_fields = set(payload) - set(known_fields)
    if unknown_fields:
        raise RecordValidationError(f"Noma'lum field: {sorted(unknown_fields)[0]}")
    output: dict[str, Any] = {}
    expected_types = {"string": str, "number": (int, float), "boolean": bool}
    for name, field in known_fields.items():
        if name not in payload:
            if field["required"] and not partial:
                raise RecordValidationError(f"{name} majburiy field.")
            continue
        value = payload[name]
        expected_type = expected_types[field["type"]]
        if isinstance(value, bool) and field["type"] == "number":
            raise RecordValidationError(f"{name} {field['type']} bo'lishi kerak.")
        if not isinstance(value, expected_type):
            raise RecordValidationError(f"{name} {field['type']} bo'lishi kerak.")
        output[name] = value
    return output


def list_records(slug: str, resource: str) -> list[dict[str, Any]]:
    found = find_resource(slug, resource)
    with pool.connection() as connection:
        rows = connection.execute(
            "SELECT id, data FROM records WHERE resource_id = %s ORDER BY created_at",
            (found["id"],),
        ).fetchall()
    return [{"id": row["id"], **row["data"]} for row in rows]


def create_record(slug: str, resource: str, payload: dict[str, Any]) -> dict[str, Any]:
    found = find_resource(slug, resource)
    record = validate_record(found["fields"], payload)
    record_id = uuid4()
    with pool.connection() as connection:
        connection.execute(
            "INSERT INTO records (id, resource_id, data) VALUES (%s, %s, %s)",
            (record_id, found["id"], Jsonb(record)),
        )
    return {"id": record_id, **record}


def get_record(slug: str, resource: str, record_id: UUID) -> dict[str, Any]:
    found = find_resource(slug, resource)
    with pool.connection() as connection:
        row = connection.execute(
            "SELECT id, data FROM records WHERE id = %s AND resource_id = %s",
            (record_id, found["id"]),
        ).fetchone()
    if not row:
        raise NotFoundError("Record topilmadi.")
    return {"id": row["id"], **row["data"]}


def update_record(
    slug: str, resource: str, record_id: UUID, payload: dict[str, Any]
) -> dict[str, Any]:
    found = find_resource(slug, resource)
    patch = validate_record(found["fields"], payload, partial=True)
    with pool.connection() as connection:
        row = connection.execute(
            """
            UPDATE records SET data = data || %s, updated_at = now()
            WHERE id = %s AND resource_id = %s RETURNING id, data
            """,
            (Jsonb(patch), record_id, found["id"]),
        ).fetchone()
    if not row:
        raise NotFoundError("Record topilmadi.")
    return {"id": row["id"], **row["data"]}


def delete_record(slug: str, resource: str, record_id: UUID) -> dict[str, Any]:
    found = find_resource(slug, resource)
    with pool.connection() as connection:
        row = connection.execute(
            "DELETE FROM records WHERE id = %s AND resource_id = %s RETURNING id, data",
            (record_id, found["id"]),
        ).fetchone()
    if not row:
        raise NotFoundError("Record topilmadi.")
    return {"id": row["id"], **row["data"]}


def flow_layout(graph: dict[str, Any], layout: dict[str, Any] | None = None) -> dict[str, Any]:
    if layout:
        return layout
    return {
        "nodePositions": {
            node["id"]: node.get("position", {"x": 0, "y": 0})
            for node in graph.get("nodes", [])
            if node.get("id")
        }
    }


def flow_metadata(metadata: dict[str, Any] | None = None) -> dict[str, Any]:
    return {"schemaVersion": 1, "source": "manual", **(metadata or {})}


def flow_payload(graph: dict[str, Any], layout: dict[str, Any] | None = None, metadata: dict[str, Any] | None = None) -> dict[str, Any]:
    runtime_graph = {"nodes": graph.get("nodes", []), "edges": graph.get("edges", [])}
    return {
        **runtime_graph,
        "layout": flow_layout(runtime_graph, layout),
        "metadata": flow_metadata(metadata),
    }


def get_flow(key: str) -> dict[str, Any]:
    with pool.connection() as connection:
        row = connection.execute("SELECT graph, layout, metadata FROM flows WHERE key = %s", (key,)).fetchone()
    if not row:
        return flow_payload({"nodes": [], "edges": []}, metadata={"source": "empty"})
    return flow_payload(row["graph"], row["layout"], row["metadata"])


def save_flow(key: str, graph: dict[str, Any]) -> dict[str, Any]:
    if not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", key):
        raise RecordValidationError("Flow key noto'g'ri.")
    payload = flow_payload(graph, graph.get("layout"), graph.get("metadata"))
    runtime_graph = {"nodes": payload["nodes"], "edges": payload["edges"]}
    with pool.connection() as connection:
        connection.execute(
            """
            INSERT INTO flows (id, key, graph, layout, metadata) VALUES (%s, %s, %s, %s, %s)
            ON CONFLICT (key) DO UPDATE SET
              graph = EXCLUDED.graph,
              layout = EXCLUDED.layout,
              metadata = EXCLUDED.metadata,
              updated_at = now()
            """,
            (uuid4(), key, Jsonb(runtime_graph), Jsonb(payload["layout"]), Jsonb(payload["metadata"])),
        )
    return payload


def validate_flow_graph(graph: dict[str, Any]) -> dict[str, Any]:
    issues: list[dict[str, Any]] = []
    nodes = graph.get("nodes", [])
    edges = graph.get("edges", [])
    node_ids = {node.get("id") for node in nodes}

    def issue(code: str, message: str, node_id: str | None = None, severity: str = "error", fix: str | None = None) -> None:
        issues.append({"code": code, "severity": severity, "nodeId": node_id, "message": message, "fix": fix})

    for node in nodes:
        node_id_value = node.get("id")
        data = node.get("data", {})
        kind = data.get("kind")
        config = data.get("config", {})
        if kind == "request":
            path = config.get("path")
            method = config.get("method", "GET")
            if method not in {"GET", "POST", "PATCH", "DELETE"}:
                issue("request.method", "Request method noto'g'ri.", node_id_value, fix="GET, POST, PATCH yoki DELETE tanlang.")
            if not path or not str(path).startswith("/"):
                issue("request.path", "Request path '/' bilan boshlanishi kerak.", node_id_value, fix="Masalan: /posts")
        if kind == "resource":
            if not config.get("project"):
                issue("resource.project", "Resource node project slug talab qiladi.", node_id_value)
            if not config.get("resource"):
                issue("resource.name", "Resource node resource nomi talab qiladi.", node_id_value)
        if kind == "response":
            contracts = config.get("contracts")
            if contracts:
                try:
                    parsed = json.loads(contracts) if isinstance(contracts, str) else contracts
                    for method in ("GET", "POST", "PATCH", "DELETE"):
                        if method not in parsed:
                            issue("response.contract", f"{method} response contract yo'q.", node_id_value, "warning")
                except Exception:
                    issue("response.contract_json", "Response contracts JSON noto'g'ri.", node_id_value, fix="Valid JSON object kiriting.")

    for edge in edges:
        if edge.get("source") not in node_ids:
            issue("edge.source", "Edge source node topilmadi.", edge.get("source"))
        if edge.get("target") not in node_ids:
            issue("edge.target", "Edge target node topilmadi.", edge.get("target"))

    request_nodes = [node for node in nodes if node.get("data", {}).get("kind") == "request"]
    for request in request_nodes:
        request_id = request.get("id")
        path = request.get("data", {}).get("config", {}).get("path")
        method = request.get("data", {}).get("config", {}).get("method", "GET")
        try:
            runtime_group(graph, method, path)
        except FlowExecutionError as error:
            issue("flow.unreachable", str(error), request_id, fix="Request -> Resource -> Output ulanishini tekshiring.")

    return {"ok": not any(item["severity"] == "error" for item in issues), "issues": issues}


def validate_flow(key: str) -> dict[str, Any]:
    graph = get_flow(key)
    if not graph.get("nodes"):
        raise NotFoundError("Flow topilmadi yoki bo'sh.")
    return validate_flow_graph(graph)


def node_config(graph: dict[str, Any], kind: str, active_ids: set[str] | None = None) -> dict[str, Any]:
    for node in graph.get("nodes", []):
        if active_ids is not None and node.get("id") not in active_ids:
            continue
        data = node.get("data", {})
        if data.get("kind") == kind:
            return data.get("config", {})
    return {}


def graph_has_node(graph: dict[str, Any], kind: str) -> bool:
    return any(node.get("data", {}).get("kind") == kind for node in graph.get("nodes", []))


def node_id(graph: dict[str, Any], kind: str, method: str | None = None) -> str | None:
    for node in graph.get("nodes", []):
        data = node.get("data", {})
        if data.get("kind") != kind:
            continue
        if method and data.get("config", {}).get("method", "GET") != method:
            continue
        return node.get("id")
    return None


def node_by_id(graph: dict[str, Any], node_id_value: str | None) -> dict[str, Any] | None:
    for node in graph.get("nodes", []):
        if node.get("id") == node_id_value:
            return node
    return None


def config_by_id(graph: dict[str, Any], node_id_value: str | None) -> dict[str, Any]:
    node = node_by_id(graph, node_id_value)
    return node.get("data", {}).get("config", {}) if node else {}


def edge_group(edge: dict[str, Any]) -> str | None:
    data = edge.get("data")
    return data.get("group") if isinstance(data, dict) else None


def node_group(graph: dict[str, Any], node_id_value: str | None) -> str | None:
    node = node_by_id(graph, node_id_value)
    data = node.get("data", {}) if node else {}
    group = data.get("group")
    return group if isinstance(group, str) else None


def reachable_response_id(graph: dict[str, Any], resource_id: str, group: str | None = None) -> tuple[str | None, set[str]]:
    adjacency: dict[str, list[str]] = {}
    for edge in graph.get("edges", []):
        if edge.get("sourceHandle") == "records" and edge.get("targetHandle") == "records":
            if group and edge_group(edge) not in (group, None):
                continue
            adjacency.setdefault(edge["source"], []).append(edge["target"])

    seen = {resource_id}
    stack = [resource_id]
    while stack:
        current = stack.pop()
        current_node = node_by_id(graph, current)
        if current_node and current_node.get("data", {}).get("kind") == "response":
            if group and node_group(graph, current) not in (group, None):
                continue
            return current, seen
        for target in adjacency.get(current, []):
            if target not in seen:
                seen.add(target)
                stack.append(target)
    return None, seen


def normalize_runtime_path(path: str | None) -> str | None:
    if not path:
        return None
    clean = path.strip("/")
    return f"/{clean}" if clean else None


def runtime_group(graph: dict[str, Any], method: str, path: str | None = None) -> tuple[str, str, str, set[str]]:
    expected_path = normalize_runtime_path(path)
    for request_id in [
        node.get("id")
        for node in graph.get("nodes", [])
        if node.get("data", {}).get("kind") == "request"
        and node.get("data", {}).get("config", {}).get("method", "GET") == method
    ]:
        request_config = config_by_id(graph, request_id)
        if expected_path and normalize_runtime_path(request_config.get("path")) != expected_path:
            continue
        group = node_group(graph, request_id)
        resource_id = None
        for edge in graph.get("edges", []):
            if (
                edge.get("source") == request_id
                and edge.get("sourceHandle") == "request"
                and edge.get("targetHandle") == "request"
                and (not group or edge_group(edge) in (group, None))
            ):
                target = node_by_id(graph, edge.get("target"))
                if target and target.get("data", {}).get("kind") == "resource":
                    resource_id = edge.get("target")
                    break
        if not resource_id:
            continue
        response_id, active_ids = reachable_response_id(graph, resource_id, group)
        if response_id:
            active_ids.add(request_id)
            return request_id, resource_id, response_id, active_ids
    scope = f" {expected_path}" if expected_path else ""
    raise FlowExecutionError(f"{method}{scope} uchun ulangan Request -> Resource -> JSON Response group topilmadi.")


def node_id_legacy(graph: dict[str, Any], kind: str) -> str | None:
    for node in graph.get("nodes", []):
        if node.get("data", {}).get("kind") == kind:
            return node.get("id")
    return None


def connected_flow_ids(graph: dict[str, Any]) -> set[str]:
    request_id = node_id_legacy(graph, "request")
    resource_id = node_id_legacy(graph, "resource")
    response_id = node_id_legacy(graph, "response")
    if not request_id or not resource_id or not response_id:
        raise FlowExecutionError("Request, Resource va JSON Response node'lari kerak.")

    edges = graph.get("edges", [])
    request_connected = any(
        edge.get("source") == request_id
        and edge.get("target") == resource_id
        and edge.get("sourceHandle") == "request"
        and edge.get("targetHandle") == "request"
        for edge in edges
    )
    if not request_connected:
        raise FlowExecutionError("HTTP Request node Resource node'ga ulanmagan.")

    adjacency: dict[str, list[str]] = {}
    for edge in edges:
        if edge.get("sourceHandle") == "records" and edge.get("targetHandle") == "records":
            adjacency.setdefault(edge["source"], []).append(edge["target"])

    seen = {resource_id}
    stack = [resource_id]
    while stack:
        current = stack.pop()
        for target in adjacency.get(current, []):
            if target not in seen:
                seen.add(target)
                stack.append(target)
    if response_id not in seen:
        raise FlowExecutionError("Flow JSON Response node bilan tugashi kerak.")
    return seen


def graph_has_active_node(graph: dict[str, Any], active_ids: set[str], kind: str) -> bool:
    return any(
        node.get("id") in active_ids and node.get("data", {}).get("kind") == kind
        for node in graph.get("nodes", [])
    )


def compare_values(left: Any, operator: str, right: str) -> bool:
    if isinstance(left, bool):
        parsed_right: Any = right.lower() == "true"
    elif isinstance(left, (int, float)):
        try:
            parsed_right = float(right)
        except ValueError:
            parsed_right = right
    else:
        parsed_right = right
    if operator == "=":
        return left == parsed_right
    if operator == "!=":
        return left != parsed_right
    try:
        if operator == ">":
            return left > parsed_right
        if operator == ">=":
            return left >= parsed_right
        if operator == "<":
            return left < parsed_right
        if operator == "<=":
            return left <= parsed_right
    except TypeError:
        return False
    return False


def apply_flow_transforms(graph: dict[str, Any], records: list[dict[str, Any]], active_ids: set[str]) -> list[dict[str, Any]]:
    output = records
    if graph_has_active_node(graph, active_ids, "filter"):
        config = node_config(graph, "filter", active_ids)
        field = config.get("field")
        operator = config.get("operator", "=")
        value = str(config.get("value", ""))
        output = [
            record
            for record in output
            if field in record and compare_values(record[field], operator, value)
        ]
    if graph_has_active_node(graph, active_ids, "sort"):
        config = node_config(graph, "sort", active_ids)
        field = config.get("field")
        reverse = config.get("direction", "desc") == "desc"
        output = sorted(
            output,
            key=cmp_to_key(
                lambda a, b: (str(a.get(field, "")) > str(b.get(field, "")))
                - (str(a.get(field, "")) < str(b.get(field, "")))
            ),
            reverse=reverse,
        )
    if graph_has_active_node(graph, active_ids, "select"):
        fields = [
            field.strip()
            for field in node_config(graph, "select", active_ids).get("fields", "").split(",")
            if field.strip()
        ]
        if fields:
            output = [{field: record[field] for field in fields if field in record} for record in output]
    if graph_has_active_node(graph, active_ids, "limit"):
        count = int(node_config(graph, "limit", active_ids).get("count", "10"))
        output = output[:count]
    if graph_has_active_node(graph, active_ids, "paginate"):
        size = int(node_config(graph, "paginate", active_ids).get("size", "20"))
        output = output[:size]
    return output


def execute_flow(key: str, method: str, payload: dict[str, Any] | None = None, record_id: UUID | None = None, path: str | None = None, api_key: str | None = None) -> tuple[dict[str, Any] | list[dict[str, Any]], int]:
    graph = get_flow(key)
    if not graph.get("nodes"):
        raise NotFoundError("Flow topilmadi yoki bo'sh.")
    try:
        request_id, resource_id, _, active_ids = runtime_group(graph, method, path)
        request_config = config_by_id(graph, request_id)
        resource_config = config_by_id(graph, resource_id)
    except FlowExecutionError:
        request_config = node_config(graph, "request")
        expected_method = request_config.get("method", "GET")
        if method != expected_method:
            raise FlowExecutionError(f"Flow {expected_method} kutyapti, lekin {method} keldi.")
        active_ids = connected_flow_ids(graph)
        resource_config = node_config(graph, "resource")
    project = resource_config.get("project")
    resource = resource_config.get("resource")
    if not project or not resource:
        raise FlowExecutionError("Resource node ichida project va resource kerak.")
    ensure_project_access(project, api_key)
    if method == "GET":
        records = list_records(project, resource)
        return apply_flow_transforms(graph, records, active_ids), 200
    if method == "POST":
        return create_record(project, resource, payload or {}), 201
    if method == "PATCH":
        record_id = record_id or (UUID(request_config["recordId"]) if request_config.get("recordId") else None)
        if not record_id:
            raise FlowExecutionError("PATCH uchun record id kerak.")
        return update_record(project, resource, record_id, payload or {}), 200
    if method == "DELETE":
        record_id = record_id or (UUID(request_config["recordId"]) if request_config.get("recordId") else None)
        if not record_id:
            raise FlowExecutionError("DELETE uchun record id kerak.")
        return delete_record(project, resource, record_id), 200
    raise FlowExecutionError("Bu method qo'llab-quvvatlanmaydi.")
