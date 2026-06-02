# mockbase

A multi-tenant mock backend builder. Next.js serves the project dashboard while
one shared FastAPI service handles every user-created API through PostgreSQL.

## First setup

PostgreSQL must expose a local `mockbase` database. With Postgres.app:

```bash
/Applications/Postgres.app/Contents/Versions/latest/bin/createdb mockbase
python3 -m venv backend/.venv
backend/.venv/bin/pip install -r backend/requirements-dev.txt
npm run db:init
```

## Start locally

Run the API and dashboard in separate terminals:

```bash
npm run dev:api
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). FastAPI documentation is
available at [http://localhost:8000/docs](http://localhost:8000/docs).

A generated backend works through both URL styles:

```text
http://localhost:3000/api/mock/blog-api/posts
http://blog-api.localhost:3000/posts
```

The MVP supports multiple resources inside a project, schema editing with
existing-record validation, project and resource deletion, and full record
CRUD from the web workspace.

See [docs/architecture.md](docs/architecture.md) for the storage model and
production wildcard subdomain setup.
