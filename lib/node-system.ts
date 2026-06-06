import type { Edge, Node } from "@xyflow/react";
import { nodeSpec, type NodeKind } from "@/lib/node-catalog";
import { flowNode, type FlowData } from "@/lib/backend-projection";

export type RunState = { ok: boolean; status: number; method: string; message: string } | null;

export const flowSavePayload = (nodes: Node<FlowData>[], edges: Edge[], source = "node-editor") => ({
  nodes,
  edges,
  metadata: { schemaVersion: 1, source },
});

export const configValue = (nodes: Node<FlowData>[], kind: NodeKind, key: string, fallback: string) => {
  return nodes.find((item) => item.data.kind === kind)?.data.config[key] || fallback;
};

export const apiPreview = (nodes: Node<FlowData>[]) => {
  const method = configValue(nodes, "request", "method", "GET");
  const path = configValue(nodes, "request", "path", "/posts");
  const resource = configValue(nodes, "resource", "resource", "posts");
  const status = configValue(nodes, "response", "status", "200");
  const filter = nodes.find((item) => item.data.kind === "filter")?.data.config;
  const sort = nodes.find((item) => item.data.kind === "sort")?.data.config;
  const pageSize = configValue(nodes, "paginate", "size", "20");
  return { method, path, resource, status, filter, sort, pageSize };
};

export const requestBody = (nodes: Node<FlowData>[]) => {
  const config = nodes.find((item) => item.data.kind === "request")?.data.config || {};
  try {
    return JSON.parse(config.body || "{}");
  } catch {
    return {};
  }
};

export const requestBodyError = (nodes: Node<FlowData>[]) => {
  const config = nodes.find((item) => item.data.kind === "request")?.data.config || {};
  const method = config.method || "GET";
  if (method === "GET" || method === "DELETE" || !config.body?.trim()) return null;
  try {
    JSON.parse(config.body);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : "JSON noto'g'ri yozilgan.";
  }
};

export const parseFields = (value: string) => {
  const parsed = JSON.parse(value);
  if (!Array.isArray(parsed)) throw new Error("Fields array bo'lishi kerak.");
  return parsed;
};

export const responseStatusLabel = (status: RunState) => {
  if (!status) return "Runtime";
  return `${status.status} ${status.ok ? "OK" : "ERR"}`;
};

export const nodeCode = (item: Node<FlowData>) => {
  const config = item.data.config;
  if (item.data.kind === "request") return [`${config.method} ${config.path}`, config.method !== "GET" ? `body = ${config.body}` : null].filter(Boolean).join("\n");
  if (item.data.kind === "resource") return `records = db.project("${config.project}").resource("${config.resource}").findMany()`;
  if (item.data.kind === "filter") return `records = records.filter(row => row.${config.field} ${config.operator} ${JSON.stringify(config.value)})`;
  if (item.data.kind === "sort") return `records = records.sortBy("${config.field}", "${config.direction}")`;
  if (item.data.kind === "paginate") return `records = paginate(records, { pageSize: ${config.size} })`;
  if (item.data.kind === "response") return "return json(records, { status: runtime.status })";
  if (item.data.kind === "select") return `records = select(records, [${JSON.stringify(config.fields)}])`;
  if (item.data.kind === "limit") return `records = records.slice(0, ${config.count})`;
  if (item.data.kind === "delay") return `await sleep(${config.milliseconds})`;
  if (item.data.kind === "randomError") return `if (random() < ${config.chance}%) return error(${config.status})`;
  return JSON.stringify(config, null, 2);
};

export const socketKind = (nodes: Node<FlowData>[], nodeId: string | null | undefined, handleId: string | null | undefined, side: "inputs" | "outputs") => {
  return nodes.find((item) => item.id === nodeId)?.data[side].find((socket) => socket.id === handleId)?.type;
};

export const edgeIsValid = (nodes: Node<FlowData>[], edge: Edge) => {
  const sourceType = socketKind(nodes, edge.source, edge.sourceHandle, "outputs");
  const targetType = socketKind(nodes, edge.target, edge.targetHandle, "inputs");
  return Boolean(sourceType && targetType && sourceType === targetType);
};

export const flowIssues = (nodes: Node<FlowData>[], edges: Edge[]) => {
  const issues: string[] = [];
  const request = nodes.find((item) => item.data.kind === "request");
  const resource = nodes.find((item) => item.data.kind === "resource");
  const response = nodes.find((item) => item.data.kind === "response");
  if (!request) issues.push("HTTP Request node kerak.");
  if (!resource) issues.push("Read Resource node kerak.");
  if (!response) issues.push("JSON Response node kerak.");
  if (request && !request.data.config.path?.startsWith("/")) issues.push("Endpoint path '/' bilan boshlanishi kerak.");
  if (resource && !resource.data.config.resource?.trim()) issues.push("Resource nomi bo'sh bo'lmasin.");
  if (resource && resource.data.config.project === "demo") issues.push("Resource node'da project slug'ni haqiqiy project slugga almashtiring.");
  edges.forEach((edge) => {
    if (!edgeIsValid(nodes, edge)) issues.push("Socket turlari mos emas: xato ulanish bor.");
  });
  const connected = new Set(edges.flatMap((edge) => [edge.source, edge.target]));
  if (request && !connected.has(request.id)) issues.push("Request node hali oqimga ulanmagan.");
  if (response && !connected.has(response.id)) issues.push("Response node hali oqimga ulanmagan.");
  if (response && !edges.some((edge) => edge.target === response.id && edge.targetHandle === "records")) issues.push("Flow oxiri JSON Response node'ga ulanishi kerak.");
  return [...new Set(issues)];
};

export const flowStatus = (nodes: Node<FlowData>[], edges: Edge[], runState: RunState) => {
  const issues = flowIssues(nodes, edges);
  if (issues.length) return { tone: "error", label: "Needs attention", issues };
  if (runState?.ok) return { tone: "live", label: "Flow responded", issues: [`${runState.method} ${runState.status}: real backend ishladi.`] };
  if (runState && !runState.ok) return { tone: "error", label: "Request failed", issues: [`${runState.method} ${runState.status}: ${runState.message}`] };
  return { tone: "idle", label: "Ready to test", issues: ["Flow to'liq. Send yoki Open in tab bilan sinab ko'ring."] };
};

export const createFlowNode = (id: string, kind: NodeKind, x: number, y: number): Node<FlowData> => flowNode(id, kind, x, y);
export const createConfiguredFlowNode = (id: string, kind: NodeKind, x: number, y: number, config: Record<string, string>): Node<FlowData> => {
  return flowNode(id, kind, x, y, config);
};

export const defaultNodeTitle = (kind: NodeKind) => nodeSpec(kind).title;
