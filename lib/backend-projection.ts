import { defaultConfig, nodeSpec, type NodeKind, type NodeSocket } from "@/lib/node-catalog";
import type { MockProject, MockResource } from "@/lib/types";
import type { Edge, Node } from "@xyflow/react";

export type FlowData = {
  kind: NodeKind;
  title: string;
  subtitle: string;
  inputs: NodeSocket[];
  outputs: NodeSocket[];
  config: Record<string, string>;
  group?: string;
  [key: string]: unknown;
};

export type FlowSnapshot = { nodes: Node<FlowData>[]; edges: Edge[] };
export type CrudMethod = "GET" | "POST" | "PATCH" | "DELETE";

const crudMethods: CrudMethod[] = ["GET", "POST", "PATCH", "DELETE"];
const defaultContracts = {
  GET: { status: 200, shape: "array" },
  POST: { status: 201, shape: "object" },
  PATCH: { status: 200, shape: "object" },
  DELETE: { status: 200, shape: "object" },
};

export function projectFlowKey(slug: string) {
  return `project-${slug}-flow`;
}

export function exampleValue(type: string, name: string) {
  if (type === "boolean") return true;
  if (type === "number") return 1;
  return `${name} value`;
}

export function sampleBody(resource?: MockResource) {
  if (!resource) return "{\n  \"title\": \"New post\",\n  \"published\": true\n}";
  return JSON.stringify(
    Object.fromEntries(resource.fields.map((field) => [field.name, exampleValue(field.type, field.name)])),
    null,
    2,
  );
}

export function flowNode(id: string, kind: NodeKind, x: number, y: number, config: Record<string, string> = {}, group?: string): Node<FlowData> {
  const spec = nodeSpec(kind);
  return {
    id,
    type: "geoNode",
    position: { x, y },
    data: {
      kind: spec.kind,
      title: spec.title,
      subtitle: spec.example,
      inputs: spec.inputs,
      outputs: spec.outputs,
      config: { ...defaultConfig(kind), ...config },
      group,
    },
  };
}

export function crudGroup(slug: string, resource: MockResource, method: CrudMethod, x: number, y: number): FlowSnapshot {
  const group = `${resource.name}-${method.toLowerCase()}`;
  const requestId = `${group}-request`;
  const resourceId = `${group}-resource`;
  const responseId = `${group}-response`;
  return {
    nodes: [
      flowNode(requestId, "request", x, y, { method, path: `/${resource.name}`, body: sampleBody(resource) }, group),
      flowNode(resourceId, "resource", x + 290, y, { project: slug, resource: resource.name }, group),
      flowNode(responseId, "response", x + 580, y, {}, group),
    ],
    edges: [
      { id: `${group}-e1`, source: requestId, sourceHandle: "request", target: resourceId, targetHandle: "request" },
      { id: `${group}-e2`, source: resourceId, sourceHandle: "records", target: responseId, targetHandle: "records" },
    ],
  };
}

export function resourceCrudHub(slug: string, resource: MockResource, x: number, y: number): FlowSnapshot {
  const nodes: Node<FlowData>[] = [
    flowNode(
      `${resource.name}-resource`,
      "resource",
      x + 330,
      y + 260,
      { project: slug, resource: resource.name, fields: JSON.stringify(resource.fields, null, 2) },
      `${resource.name}-resource`,
    ),
    flowNode(`${resource.name}-output`, "response", x + 700, y + 260, { path: `/${resource.name}`, contracts: JSON.stringify(defaultContracts, null, 2) }),
  ];
  const edges: Edge[] = [
    { id: `${resource.name}-output-e1`, source: `${resource.name}-resource`, sourceHandle: "records", target: `${resource.name}-output`, targetHandle: "records" },
  ];
  crudMethods.forEach((method, index) => {
    const group = `${resource.name}-${method.toLowerCase()}`;
    const rowY = y + index * 170;
    const requestId = `${group}-request`;
    nodes.push(
      flowNode(requestId, "request", x, rowY, { method, path: `/${resource.name}`, body: sampleBody(resource) }, group),
    );
    edges.push(
      { id: `${group}-e1`, source: requestId, sourceHandle: "request", target: `${resource.name}-resource`, targetHandle: "request", data: { group } },
    );
  });
  return { nodes, edges };
}

export function projectToCrudFlow(project: MockProject): FlowSnapshot {
  const nodes: Node<FlowData>[] = [];
  const edges: Edge[] = [];
  project.resources.forEach((resource, resourceIndex) => {
    const group = resourceCrudHub(project.slug, resource, 80 + resourceIndex * 1050, 120);
    nodes.push(...group.nodes);
    edges.push(...group.edges);
  });
  return { nodes, edges };
}

export function projectResourceGetFlow(project: MockProject, resourceName: string): FlowSnapshot {
  const resource = project.resources.find((item) => item.name === resourceName) || project.resources[0];
  return resource ? resourceCrudHub(project.slug, resource, 80, 120) : { nodes: [], edges: [] };
}

export function isGeoFlow(graph: FlowSnapshot) {
  return graph.nodes.every((item) => item.type === "geoNode" && item.data?.kind && item.data?.config && Array.isArray(item.data.inputs) && Array.isArray(item.data.outputs));
}
