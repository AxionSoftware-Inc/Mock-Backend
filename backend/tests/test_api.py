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
                "name": "reviews",
                "fields": [
                    {"name": "body", "type": "string", "required": True},
                    {"name": "approved", "type": "boolean", "required": True},
                ]
            },
        )
        assert valid_schema.status_code == 200
        assert valid_schema.json()["name"] == "reviews"
        assert client.get(f"/api/mock/{slug}/comments").status_code == 404
        renamed_records = client.get(f"/api/mock/{slug}/reviews")
        assert renamed_records.status_code == 200
        assert renamed_records.json()[0]["body"] == "Useful"

        detail = client.get(f"/api/projects/{slug}")
        assert detail.status_code == 200
        assert {item["name"] for item in detail.json()["resources"]} == {
            "posts",
            "reviews",
        }

        assert client.delete(f"/api/projects/{slug}/resources/reviews").status_code == 204
        assert client.delete(f"/api/projects/{slug}").status_code == 204
        assert client.get(f"/api/projects/{slug}").status_code == 404
    finally:
        with pool.connection() as connection:
            connection.execute("DELETE FROM projects WHERE slug = %s", (slug,))


def test_project_model_exposes_canonical_endpoints(client: TestClient):
    slug = f"model-{uuid4().hex}"
    try:
        client.post(
            "/api/projects",
            json={
                "name": "Canonical Model",
                "slug": slug,
                "resource": "posts",
                "fields": [{"name": "title", "type": "string", "required": True}],
            },
        )

        model = client.get(f"/api/projects/{slug}/model")
        assert model.status_code == 200
        body = model.json()
        assert body["project"] == slug
        assert body["endpoints"][0]["path"] == "/posts"
        assert [item["method"] for item in body["endpoints"][0]["methods"]] == [
            "GET",
            "POST",
            "PATCH",
            "DELETE",
        ]

        update = client.patch(
            f"/api/projects/{slug}/resources/posts",
            json={
                "name": "articles",
                "fields": [
                    {"name": "title", "type": "string", "required": True},
                    {"name": "published", "type": "boolean", "required": False},
                ],
            },
        )
        assert update.status_code == 200
        refreshed = client.get(f"/api/projects/{slug}/model").json()
        assert refreshed["endpoints"][0]["path"] == "/articles"
        assert [field["name"] for field in refreshed["endpoints"][0]["fields"]] == [
            "title",
            "published",
        ]
    finally:
        with pool.connection() as connection:
            connection.execute("DELETE FROM projects WHERE slug = %s", (slug,))


def test_project_revisions_track_model_changes(client: TestClient):
    slug = f"revisions-{uuid4().hex}"
    try:
        created = client.post(
            "/api/projects",
            json={
                "name": "Revisioned API",
                "slug": slug,
                "resource": "posts",
                "fields": [{"name": "title", "type": "string", "required": True}],
            },
        )
        assert created.status_code == 201
        client.patch(
            f"/api/projects/{slug}/resources/posts",
            json={
                "name": "articles",
                "fields": [{"name": "title", "type": "string", "required": True}],
            },
        )

        revisions = client.get(f"/api/projects/{slug}/revisions")
        assert revisions.status_code == 200
        body = revisions.json()
        assert [item["version"] for item in body] == [2, 1]
        assert body[0]["reason"] == "resource.updated:posts->articles"
        assert body[0]["snapshot"]["endpoints"][0]["path"] == "/articles"
    finally:
        with pool.connection() as connection:
            connection.execute("DELETE FROM projects WHERE slug = %s", (slug,))


def test_private_project_requires_api_key(client: TestClient):
    slug = f"private-{uuid4().hex}"
    try:
        project = client.post(
            "/api/projects",
            json={
                "name": "Private API",
                "slug": slug,
                "access": "private",
                "resource": "posts",
                "fields": [{"name": "title", "type": "string", "required": True}],
            },
        )
        assert project.status_code == 201
        api_key = project.json()["apiKey"]

        blocked = client.get(f"/api/mock/{slug}/posts")
        assert blocked.status_code == 404
        allowed = client.get(f"/api/mock/{slug}/posts", headers={"x-api-key": api_key})
        assert allowed.status_code == 200

        public = client.patch(f"/api/projects/{slug}/settings", json={"access": "public"})
        assert public.status_code == 200
        assert client.get(f"/api/mock/{slug}/posts").status_code == 200
    finally:
        with pool.connection() as connection:
            connection.execute("DELETE FROM projects WHERE slug = %s", (slug,))


def test_private_project_node_flow_requires_api_key(client: TestClient):
    slug = f"private-node-{uuid4().hex}"
    key = f"project-{slug}-flow"
    try:
        project = client.post(
            "/api/projects",
            json={
                "name": "Private Node Flow",
                "slug": slug,
                "access": "private",
                "resource": "posts",
                "fields": [{"name": "title", "type": "string", "required": True}],
            },
        )
        assert project.status_code == 201
        api_key = project.json()["apiKey"]
        client.post(f"/api/mock/{slug}/posts", json={"title": "Secret"}, headers={"x-api-key": api_key})
        graph = {
            "nodes": [
                {"id": "request", "data": {"kind": "request", "config": {"method": "GET", "path": "/posts"}}},
                {"id": "resource", "data": {"kind": "resource", "config": {"project": slug, "resource": "posts"}}},
                {"id": "response", "data": {"kind": "response", "config": {}}},
            ],
            "edges": [
                {"id": "e1", "source": "request", "sourceHandle": "request", "target": "resource", "targetHandle": "request"},
                {"id": "e2", "source": "resource", "sourceHandle": "records", "target": "response", "targetHandle": "records"},
            ],
        }
        assert client.put(f"/api/flows/{key}", json=graph).status_code == 200

        assert client.get(f"/api/node-flows/{key}/posts").status_code == 404
        allowed = client.get(f"/api/node-flows/{key}/posts", headers={"x-api-key": api_key})
        assert allowed.status_code == 200
        assert allowed.json()[0]["title"] == "Secret"
    finally:
        with pool.connection() as connection:
            connection.execute("DELETE FROM flows WHERE key = %s", (key,))
            connection.execute("DELETE FROM projects WHERE slug = %s", (slug,))


def test_flow_save_and_load(client: TestClient):
    key = f"flow-{uuid4().hex}"
    try:
        graph = {
            "nodes": [{"id": "resource-1", "type": "resource", "position": {"x": 12, "y": 34}}],
            "edges": [{"id": "edge-1", "source": "resource-1", "target": "response-1"}],
            "metadata": {"source": "test"},
        }
        save = client.put(f"/api/flows/{key}", json=graph)
        assert save.status_code == 200
        loaded = client.get(f"/api/flows/{key}").json()
        assert loaded["nodes"] == graph["nodes"]
        assert loaded["edges"] == graph["edges"]
        assert loaded["layout"]["nodePositions"]["resource-1"] == {"x": 12, "y": 34}
        assert loaded["metadata"] == {"schemaVersion": 1, "source": "test"}
    finally:
        with pool.connection() as connection:
            connection.execute("DELETE FROM flows WHERE key = %s", (key,))


def test_flow_save_accepts_explicit_layout(client: TestClient):
    key = f"flow-{uuid4().hex}"
    try:
        graph = {
            "nodes": [{"id": "request", "data": {"kind": "request"}}],
            "edges": [],
            "layout": {"nodePositions": {"request": {"x": 200, "y": 80}}, "viewport": {"x": 0, "y": 0, "zoom": 1}},
            "metadata": {"schemaVersion": 2, "source": "node-editor"},
        }
        response = client.put(f"/api/flows/{key}", json=graph)
        assert response.status_code == 200

        loaded = client.get(f"/api/flows/{key}").json()
        assert loaded["layout"] == graph["layout"]
        assert loaded["metadata"] == graph["metadata"]
        assert loaded["nodes"] == graph["nodes"]
    finally:
        with pool.connection() as connection:
            connection.execute("DELETE FROM flows WHERE key = %s", (key,))


def test_flow_validation_returns_structured_issues(client: TestClient):
    key = f"flow-{uuid4().hex}"
    try:
        graph = {
            "nodes": [
                {"id": "request", "data": {"kind": "request", "config": {"method": "GET", "path": "posts"}}},
                {"id": "resource", "data": {"kind": "resource", "config": {"project": "", "resource": ""}}},
            ],
            "edges": [{"id": "e1", "source": "missing", "target": "resource"}],
        }
        client.put(f"/api/flows/{key}", json=graph)
        response = client.get(f"/api/flows/{key}/validate")
        assert response.status_code == 200
        body = response.json()
        assert body["ok"] is False
        codes = {item["code"] for item in body["issues"]}
        assert {"request.path", "resource.project", "resource.name", "edge.source"} <= codes
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
                {"id": "response", "data": {"kind": "response", "config": {}}},
            ],
            "edges": [
                {"id": "e1", "source": "request", "sourceHandle": "request", "target": "resource", "targetHandle": "request"},
                {"id": "e2", "source": "resource", "sourceHandle": "records", "target": "filter", "targetHandle": "records"},
                {"id": "e3", "source": "filter", "sourceHandle": "records", "target": "response", "targetHandle": "records"},
            ],
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
                {"id": "response", "data": {"kind": "response", "config": {}}},
            ],
            "edges": [
                {"id": "e1", "source": "request", "sourceHandle": "request", "target": "resource", "targetHandle": "request"},
                {"id": "e2", "source": "resource", "sourceHandle": "records", "target": "response", "targetHandle": "records"},
            ],
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


def test_node_flow_requires_connected_response(client: TestClient):
    slug = f"node-disconnected-{uuid4().hex}"
    key = f"flow-{uuid4().hex}"
    try:
        client.post(
            "/api/projects",
            json={
                "name": "Node Flow Disconnected",
                "slug": slug,
                "resource": "posts",
                "fields": [{"name": "title", "type": "string", "required": True}],
            },
        )
        client.post(f"/api/mock/{slug}/posts", json={"title": "Should not leak"})
        graph = {
            "nodes": [
                {"id": "request", "data": {"kind": "request", "config": {"method": "GET", "path": "/posts"}}},
                {"id": "resource", "data": {"kind": "resource", "config": {"project": slug, "resource": "posts"}}},
                {"id": "response", "data": {"kind": "response", "config": {}}},
            ],
            "edges": [
                {"id": "e1", "source": "request", "sourceHandle": "request", "target": "resource", "targetHandle": "request"},
            ],
        }
        client.put(f"/api/flows/{key}", json=graph)

        response = client.get(f"/api/node-flows/{key}")
        assert response.status_code == 400
        assert "JSON Response" in response.json()["detail"]
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
                {"id": "response", "data": {"kind": "response", "config": {}}},
            ],
            "edges": [
                {"id": "e1", "source": "request", "sourceHandle": "request", "target": "resource", "targetHandle": "request"},
                {"id": "e2", "source": "resource", "sourceHandle": "records", "target": "response", "targetHandle": "records"},
            ],
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


def test_node_flow_can_execute_matching_method_group(client: TestClient):
    slug = f"node-multi-{uuid4().hex}"
    key = f"flow-{uuid4().hex}"
    try:
        client.post(
            "/api/projects",
            json={
                "name": "Node Flow Multi Group",
                "slug": slug,
                "resource": "posts",
                "fields": [{"name": "title", "type": "string", "required": True}],
            },
        )
        client.post(f"/api/mock/{slug}/posts", json={"title": "Existing"})
        graph = {
            "nodes": [
                {"id": "posts-get-request", "data": {"kind": "request", "group": "posts-get", "config": {"method": "GET", "path": "/posts"}}},
                {"id": "posts-resource", "data": {"kind": "resource", "config": {"project": slug, "resource": "posts"}}},
                {"id": "posts-get-response", "data": {"kind": "response", "group": "posts-get", "config": {}}},
                {"id": "posts-post-request", "data": {"kind": "request", "group": "posts-post", "config": {"method": "POST", "path": "/posts"}}},
                {"id": "posts-post-response", "data": {"kind": "response", "group": "posts-post", "config": {}}},
            ],
            "edges": [
                {"id": "get-e1", "source": "posts-get-request", "sourceHandle": "request", "target": "posts-resource", "targetHandle": "request", "data": {"group": "posts-get"}},
                {"id": "get-e2", "source": "posts-resource", "sourceHandle": "records", "target": "posts-get-response", "targetHandle": "records", "data": {"group": "posts-get"}},
                {"id": "post-e1", "source": "posts-post-request", "sourceHandle": "request", "target": "posts-resource", "targetHandle": "request", "data": {"group": "posts-post"}},
                {"id": "post-e2", "source": "posts-resource", "sourceHandle": "records", "target": "posts-post-response", "targetHandle": "records", "data": {"group": "posts-post"}},
            ],
        }
        client.put(f"/api/flows/{key}", json=graph)

        read = client.get(f"/api/node-flows/{key}")
        assert read.status_code == 200
        assert [item["title"] for item in read.json()] == ["Existing"]

        created = client.post(f"/api/node-flows/{key}", json={"title": "Created from POST group"})
        assert created.status_code == 201
        assert created.json()["title"] == "Created from POST group"
    finally:
        with pool.connection() as connection:
            connection.execute("DELETE FROM flows WHERE key = %s", (key,))
            connection.execute("DELETE FROM projects WHERE slug = %s", (slug,))


def test_node_flow_routes_by_method_and_path(client: TestClient):
    slug = f"node-path-{uuid4().hex}"
    key = f"flow-{uuid4().hex}"
    try:
        client.post(
            "/api/projects",
            json={
                "name": "Node Flow Path Routing",
                "slug": slug,
                "resource": "posts",
                "fields": [{"name": "title", "type": "string", "required": True}],
            },
        )
        client.post(
            f"/api/projects/{slug}/resources",
            json={"name": "comments", "fields": [{"name": "title", "type": "string", "required": True}]},
        )
        client.post(f"/api/mock/{slug}/posts", json={"title": "Post one"})
        client.post(f"/api/mock/{slug}/comments", json={"title": "Comment one"})
        graph = {
            "nodes": [
                {"id": "posts-get-request", "data": {"kind": "request", "group": "posts-get", "config": {"method": "GET", "path": "/posts"}}},
                {"id": "posts-resource", "data": {"kind": "resource", "config": {"project": slug, "resource": "posts"}}},
                {"id": "posts-output", "data": {"kind": "response", "config": {"path": "/posts"}}},
                {"id": "comments-get-request", "data": {"kind": "request", "group": "comments-get", "config": {"method": "GET", "path": "/comments"}}},
                {"id": "comments-resource", "data": {"kind": "resource", "config": {"project": slug, "resource": "comments"}}},
                {"id": "comments-output", "data": {"kind": "response", "config": {"path": "/comments"}}},
            ],
            "edges": [
                {"id": "posts-e1", "source": "posts-get-request", "sourceHandle": "request", "target": "posts-resource", "targetHandle": "request", "data": {"group": "posts-get"}},
                {"id": "posts-e2", "source": "posts-resource", "sourceHandle": "records", "target": "posts-output", "targetHandle": "records"},
                {"id": "comments-e1", "source": "comments-get-request", "sourceHandle": "request", "target": "comments-resource", "targetHandle": "request", "data": {"group": "comments-get"}},
                {"id": "comments-e2", "source": "comments-resource", "sourceHandle": "records", "target": "comments-output", "targetHandle": "records"},
            ],
        }
        client.put(f"/api/flows/{key}", json=graph)

        posts = client.get(f"/api/node-flows/{key}/posts")
        comments = client.get(f"/api/node-flows/{key}/comments")
        assert [item["title"] for item in posts.json()] == ["Post one"]
        assert [item["title"] for item in comments.json()] == ["Comment one"]
    finally:
        with pool.connection() as connection:
            connection.execute("DELETE FROM flows WHERE key = %s", (key,))
            connection.execute("DELETE FROM projects WHERE slug = %s", (slug,))
