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
  resourceCount: number;
  recordCount: number;
  createdAt: string;
};

export type MockProject = {
  id: string;
  name: string;
  slug: string;
  resources: MockResource[];
  createdAt: string;
};

export type ApiRecord = Record<string, unknown> & { id: string };
