from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app.database import pool
from app.main import app


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as test_client:
        yield test_client


def test_project_and_record_crud(client: TestClient):
    slug = f"pytest-{uuid4().hex}"
    try:
        project_response = client.post(
            "/api/projects",
            json={
                "name": "Pytest API",
                "slug": slug,
                "resource": "posts",
                "fields": [
                    {"name": "title", "type": "string", "required": True},
                    {"name": "published", "type": "boolean", "required": False},
                ],
            },
        )
        assert project_response.status_code == 201

        invalid_response = client.post(f"/api/mock/{slug}/posts", json={})
        assert invalid_response.status_code == 400

        create_response = client.post(
            f"/api/mock/{slug}/posts",
            json={"title": "FastAPI record", "published": False},
        )
        assert create_response.status_code == 201
        record_id = create_response.json()["id"]

        assert client.get(f"/api/mock/{slug}/posts").json()[0]["id"] == record_id
        assert client.get(f"/api/mock/{slug}/posts/{record_id}").status_code == 200

        patch_response = client.patch(
            f"/api/mock/{slug}/posts/{record_id}", json={"published": True}
        )
        assert patch_response.json()["published"] is True

        assert client.delete(f"/api/mock/{slug}/posts/{record_id}").status_code == 200
        assert client.get(f"/api/mock/{slug}/posts").json() == []
    finally:
        with pool.connection() as connection:
            connection.execute("DELETE FROM projects WHERE slug = %s", (slug,))


def test_duplicate_project_name_gets_available_slug(client: TestClient):
    name = f"Repeated {uuid4().hex}"
    try:
        first = client.post(
            "/api/projects",
            json={
                "name": name,
                "resource": "posts",
                "fields": [{"name": "title", "type": "string", "required": True}],
            },
        )
        second = client.post(
            "/api/projects",
            json={
                "name": name,
                "resource": "posts",
                "fields": [{"name": "title", "type": "string", "required": True}],
            },
        )
        assert first.status_code == 201
        assert second.status_code == 201
        assert second.json()["slug"] == f"{first.json()['slug']}-2"
    finally:
        with pool.connection() as connection:
            connection.execute("DELETE FROM projects WHERE name = %s", (name,))


def test_project_resource_management(client: TestClient):
    slug = f"resources-{uuid4().hex}"
    try:
        project = client.post(
            "/api/projects",
            json={
                "name": "Resource management",
                "slug": slug,
                "resource": "posts",
                "fields": [{"name": "title", "type": "string", "required": True}],
            },
        )
        assert project.status_code == 201
        assert project.json()["resources"][0]["name"] == "posts"

        resource = client.post(
            f"/api/projects/{slug}/resources",
            json={
                "name": "comments",
                "fields": [
                    {"name": "body", "type": "string", "required": True},
                    {"name": "approved", "type": "boolean", "required": False},
                ],
            },
        )
        assert resource.status_code == 201
        assert resource.json()["name"] == "comments"

        record = client.post(
            f"/api/mock/{slug}/comments", json={"body": "Useful", "approved": False}
        )
        assert record.status_code == 201

        invalid_schema = client.patch(
            f"/api/projects/{slug}/resources/comments",
            json={"fields": [{"name": "score", "type": "number", "required": True}]},
        )
        assert invalid_schema.status_code == 400

        valid_schema = client.patch(
            f"/api/projects/{slug}/resources/comments",
            json={
                "fields": [
                    {"name": "body", "type": "string", "required": True},
                    {"name": "approved", "type": "boolean", "required": True},
                ]
            },
        )
        assert valid_schema.status_code == 200

        detail = client.get(f"/api/projects/{slug}")
        assert detail.status_code == 200
        assert {item["name"] for item in detail.json()["resources"]} == {
            "posts",
            "comments",
        }

        assert client.delete(f"/api/projects/{slug}/resources/comments").status_code == 204
        assert client.delete(f"/api/projects/{slug}").status_code == 204
        assert client.get(f"/api/projects/{slug}").status_code == 404
    finally:
        with pool.connection() as connection:
            connection.execute("DELETE FROM projects WHERE slug = %s", (slug,))


def test_flow_save_and_load(client: TestClient):
    key = f"flow-{uuid4().hex}"
    try:
        graph = {
            "nodes": [{"id": "resource-1", "type": "resource"}],
            "edges": [{"id": "edge-1", "source": "resource-1", "target": "response-1"}],
        }
        save = client.put(f"/api/flows/{key}", json=graph)
        assert save.status_code == 200
        assert client.get(f"/api/flows/{key}").json() == graph
    finally:
        with pool.connection() as connection:
            connection.execute("DELETE FROM flows WHERE key = %s", (key,))


def test_node_flow_executes_against_real_records(client: TestClient):
    slug = f"node-flow-{uuid4().hex}"
    key = f"flow-{uuid4().hex}"
    try:
        project = client.post(
            "/api/projects",
            json={
                "name": "Node Flow Runtime",
                "slug": slug,
                "resource": "posts",
                "fields": [
                    {"name": "title", "type": "string", "required": True},
                    {"name": "published", "type": "boolean", "required": False},
                ],
            },
        )
        assert project.status_code == 201
        client.post(f"/api/mock/{slug}/posts", json={"title": "Visible", "published": True})
        client.post(f"/api/mock/{slug}/posts", json={"title": "Hidden", "published": False})
        graph = {
            "nodes": [
                {"id": "request", "data": {"kind": "request", "config": {"method": "GET", "path": "/posts"}}},
                {"id": "resource", "data": {"kind": "resource", "config": {"project": slug, "resource": "posts"}}},
                {"id": "filter", "data": {"kind": "filter", "config": {"field": "published", "operator": "=", "value": "true"}}},
                {"id": "response", "data": {"kind": "response", "config": {"status": "200"}}},
            ],
            "edges": [],
        }
        assert client.put(f"/api/flows/{key}", json=graph).status_code == 200

        response = client.get(f"/api/node-flows/{key}")
        assert response.status_code == 200
        assert [item["title"] for item in response.json()] == ["Visible"]
    finally:
        with pool.connection() as connection:
            connection.execute("DELETE FROM flows WHERE key = %s", (key,))
            connection.execute("DELETE FROM projects WHERE slug = %s", (slug,))


def test_node_flow_post_creates_real_record(client: TestClient):
    slug = f"node-post-{uuid4().hex}"
    key = f"flow-{uuid4().hex}"
    try:
        client.post(
            "/api/projects",
            json={
                "name": "Node Flow Post",
                "slug": slug,
                "resource": "posts",
                "fields": [{"name": "title", "type": "string", "required": True}],
            },
        )
        graph = {
            "nodes": [
                {"id": "request", "data": {"kind": "request", "config": {"method": "POST", "path": "/posts"}}},
                {"id": "resource", "data": {"kind": "resource", "config": {"project": slug, "resource": "posts"}}},
                {"id": "response", "data": {"kind": "response", "config": {"status": "201"}}},
            ],
            "edges": [],
        }
        client.put(f"/api/flows/{key}", json=graph)

        response = client.post(f"/api/node-flows/{key}", json={"title": "Created by flow"})
        assert response.status_code == 201
        assert response.json()["title"] == "Created by flow"
        assert client.get(f"/api/mock/{slug}/posts").json()[0]["title"] == "Created by flow"
    finally:
        with pool.connection() as connection:
            connection.execute("DELETE FROM flows WHERE key = %s", (key,))
            connection.execute("DELETE FROM projects WHERE slug = %s", (slug,))


def test_node_flow_patch_and_delete_use_request_node_record_id(client: TestClient):
    slug = f"node-crud-{uuid4().hex}"
    key = f"flow-{uuid4().hex}"
    try:
        client.post(
            "/api/projects",
            json={
                "name": "Node Flow CRUD",
                "slug": slug,
                "resource": "posts",
                "fields": [
                    {"name": "title", "type": "string", "required": True},
                    {"name": "published", "type": "boolean", "required": False},
                ],
            },
        )
        record = client.post(
            f"/api/mock/{slug}/posts", json={"title": "Before", "published": False}
        ).json()
        patch_graph = {
            "nodes": [
                {
                    "id": "request",
                    "data": {
                        "kind": "request",
                        "config": {"method": "PATCH", "path": "/posts", "recordId": record["id"]},
                    },
                },
                {"id": "resource", "data": {"kind": "resource", "config": {"project": slug, "resource": "posts"}}},
                {"id": "response", "data": {"kind": "response", "config": {"status": "200"}}},
            ],
            "edges": [],
        }
        client.put(f"/api/flows/{key}", json=patch_graph)
        patched = client.patch(f"/api/node-flows/{key}", json={"title": "After", "published": True})
        assert patched.status_code == 200
        assert patched.json()["title"] == "After"

        delete_graph = {
            **patch_graph,
            "nodes": [
                {
                    "id": "request",
                    "data": {
                        "kind": "request",
                        "config": {"method": "DELETE", "path": "/posts", "recordId": record["id"]},
                    },
                },
                patch_graph["nodes"][1],
                patch_graph["nodes"][2],
            ],
        }
        client.put(f"/api/flows/{key}", json=delete_graph)
        deleted = client.delete(f"/api/node-flows/{key}")
        assert deleted.status_code == 200
        assert client.get(f"/api/mock/{slug}/posts").json() == []
    finally:
        with pool.connection() as connection:
            connection.execute("DELETE FROM flows WHERE key = %s", (key,))
            connection.execute("DELETE FROM projects WHERE slug = %s", (slug,))
