CREATE TABLE IF NOT EXISTS projects (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  created_at timestamptz NOT NULL DEFAULT now()
);

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
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
