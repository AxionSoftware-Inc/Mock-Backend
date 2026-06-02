import re
from typing import Any
from uuid import UUID, uuid4

from psycopg import errors
from psycopg.types.json import Jsonb

from .database import pool
from .schemas import MockField, ProjectCreate, ResourceCreate, ResourceUpdate


class NotFoundError(Exception):
    pass


class ConflictError(Exception):
    pass


class RecordValidationError(Exception):
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
            SELECT p.id, p.name, p.slug, p.created_at AS "createdAt",
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
            SELECT p.id, p.name, p.slug, p.created_at AS "createdAt"
            FROM projects p WHERE p.slug = %s
            """,
            (slug,),
        ).fetchone()
        if not project:
            raise NotFoundError("Project topilmadi.")
        resources = connection.execute(
            """
            SELECT r.id, r.name, r.created_at AS "createdAt",
              count(DISTINCT rec.id)::int AS "recordCount",
              COALESCE(
                json_agg(json_build_object(
                  'name', f.name, 'type', f.type, 'required', f.required
                ) ORDER BY f.position) FILTER (WHERE f.id IS NOT NULL),
                '[]'
              ) AS fields
            FROM resources r
            LEFT JOIN fields f ON f.resource_id = r.id
            LEFT JOIN records rec ON rec.resource_id = r.id
            WHERE r.project_id = %s
            GROUP BY r.id
            ORDER BY r.created_at
            """,
            (project["id"],),
        ).fetchall()
    return {**project, "resources": resources}


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
                    INSERT INTO projects (id, name, slug)
                    VALUES (%s, %s, %s)
                    RETURNING id, name, slug, created_at AS "createdAt"
                    """,
                    (project_id, payload.name.strip(), slug),
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
    return get_project(project["slug"])


def delete_project(slug: str) -> None:
    with pool.connection() as connection:
        result = connection.execute("DELETE FROM projects WHERE slug = %s", (slug,))
    if not result.rowcount:
        raise NotFoundError("Project topilmadi.")


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
    return find_resource(slug, resource)


def update_resource(slug: str, resource: str, payload: ResourceUpdate) -> dict[str, Any]:
    found = find_resource(slug, resource)
    fields = [field.model_dump() for field in payload.fields]
    with pool.connection() as connection:
        records = connection.execute(
            "SELECT data FROM records WHERE resource_id = %s", (found["id"],)
        ).fetchall()
        for record in records:
            validate_record(fields, record["data"])
        with connection.transaction():
            connection.execute("DELETE FROM fields WHERE resource_id = %s", (found["id"],))
            replace_fields(connection, found["id"], payload.fields)
    return find_resource(slug, resource)


def delete_resource(slug: str, resource: str) -> None:
    found = find_resource(slug, resource)
    with pool.connection() as connection:
        connection.execute("DELETE FROM resources WHERE id = %s", (found["id"],))


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


def get_flow(key: str) -> dict[str, Any]:
    with pool.connection() as connection:
        row = connection.execute("SELECT graph FROM flows WHERE key = %s", (key,)).fetchone()
    return row["graph"] if row else {"nodes": [], "edges": []}


def save_flow(key: str, graph: dict[str, Any]) -> dict[str, Any]:
    if not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", key):
        raise RecordValidationError("Flow key noto'g'ri.")
    with pool.connection() as connection:
        connection.execute(
            """
            INSERT INTO flows (id, key, graph) VALUES (%s, %s, %s)
            ON CONFLICT (key) DO UPDATE SET graph = EXCLUDED.graph, updated_at = now()
            """,
            (uuid4(), key, Jsonb(graph)),
        )
    return graph
