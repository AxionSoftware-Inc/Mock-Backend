# Mockbase Architecture

## Core rule

A user-created backend is configuration and data, not a new FastAPI, Next.js,
container, or worker process. One shared FastAPI runtime serves every project.

## Services

```text
Next.js dashboard :3000
  -> /api/* gateway rewrite
FastAPI runtime :8000
  -> PostgreSQL :5432
```

FastAPI owns project configuration, record validation and CRUD. Next.js owns
the dashboard and gateway routing only. Redis can be added later for rate
limits and hot configuration caching without changing this boundary.

The current MVP intentionally leaves authentication, access modes and rate
limits for a later phase. Project and resource management are already separate
from runtime record CRUD, so those policies can be added around the same core.

## Request flow

```text
posts-demo.localhost:3000/posts
  -> proxy.ts extracts "posts-demo"
  -> http://localhost:8000/api/mock/posts-demo/posts
  -> shared FastAPI CRUD route
  -> PostgreSQL
```

The path-based `/api/mock/:slug/:resource` URL remains available through the
Next.js gateway for debugging and environments without wildcard subdomains.

## PostgreSQL model

```text
projects 1 -> many resources
resources 1 -> many fields
resources 1 -> many records
records.data = jsonb
```

`projects`, `resources`, and `fields` describe a virtual backend. `records`
stores user-created API data. The JSONB GIN index leaves room for filtering
without creating a database table for every virtual resource.

## Production subdomains

Configure wildcard DNS such as `*.example.com`, point it to the Next.js
gateway, and configure wildcard TLS. Set `API_HOST` for Next.js proxy routing
and `API_URL` for path-based gateway rewrites when FastAPI is not available at
`localhost:8000`.

Subdomains `www`, `app`, and `api` are reserved for the product itself.
