export type FieldType = "string" | "number" | "boolean";

export type MockField = {
  name: string;
  type: FieldType;
  required: boolean;
};

export type MockResource = {
  id: string;
  name: string;
  fields: MockField[];
  recordCount: number;
  createdAt: string;
};

export type MockProjectSummary = {
  id: string;
  name: string;
  slug: string;
  access: "public" | "private";
  resourceCount: number;
  recordCount: number;
  createdAt: string;
};

export type MockProject = {
  id: string;
  name: string;
  slug: string;
  ownerId: string;
  access: "public" | "private";
  apiKey: string;
  resources: MockResource[];
  createdAt: string;
};

export type ApiRecord = Record<string, unknown> & { id: string };

export type ApiMethod = {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  enabled: boolean;
};

export type ApiEndpoint = {
  path: string;
  resource: string;
  fields: MockField[];
  methods: ApiMethod[];
  recordCount: number;
};

export type ApiModel = {
  project: string;
  name: string;
  access: "public" | "private";
  endpoints: ApiEndpoint[];
};
