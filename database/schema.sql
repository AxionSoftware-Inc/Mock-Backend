CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS projects (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  owner_id text NOT NULL DEFAULT 'local',
  access text NOT NULL DEFAULT 'public' CHECK (access IN ('public', 'private')),
  api_key text NOT NULL DEFAULT encode(gen_random_bytes(18), 'hex'),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE projects ADD COLUMN IF NOT EXISTS owner_id text NOT NULL DEFAULT 'local';
ALTER TABLE projects ADD COLUMN IF NOT EXISTS access text NOT NULL DEFAULT 'public';
ALTER TABLE projects ADD COLUMN IF NOT EXISTS api_key text NOT NULL DEFAULT encode(gen_random_bytes(18), 'hex');

CREATE TABLE IF NOT EXISTS resources (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (name ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, name)
);

CREATE TABLE IF NOT EXISTS fields (
  id uuid PRIMARY KEY,
  resource_id uuid NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (name ~ '^[a-zA-Z][a-zA-Z0-9_]*$'),
  type text NOT NULL CHECK (type IN ('string', 'number', 'boolean')),
  required boolean NOT NULL DEFAULT false,
  position integer NOT NULL DEFAULT 0,
  UNIQUE (resource_id, name)
);

CREATE TABLE IF NOT EXISTS records (
  id uuid PRIMARY KEY,
  resource_id uuid NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS records_resource_id_idx ON records(resource_id);
CREATE INDEX IF NOT EXISTS records_data_gin_idx ON records USING gin(data);

CREATE TABLE IF NOT EXISTS flows (
  id uuid PRIMARY KEY,
  key text NOT NULL UNIQUE CHECK (key ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  graph jsonb NOT NULL DEFAULT '{"nodes": [], "edges": []}'::jsonb,
  layout jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{"schemaVersion": 1, "source": "manual"}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE flows ADD COLUMN IF NOT EXISTS layout jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE flows ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{"schemaVersion": 1, "source": "manual"}'::jsonb;

CREATE TABLE IF NOT EXISTS project_revisions (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  version integer NOT NULL,
  reason text NOT NULL,
  snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, version)
);

CREATE INDEX IF NOT EXISTS project_revisions_project_id_idx ON project_revisions(project_id);
