"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { addEdge, Background, BackgroundVariant, Controls, Handle, MiniMap, PanOnScrollMode, Position, ReactFlow, useEdgesState, useNodesState, useReactFlow, type Connection, type Edge, type EdgeChange, type Node, type NodeChange, type NodeProps, type ReactFlowInstance } from "@xyflow/react";
import { nodeCatalog, nodeSpec, type NodeKind, type NodeSpec } from "@/lib/node-catalog";
import { flowNode, isGeoFlow, projectFlowKey, projectResourceGetFlow, projectToCrudFlow, sampleBody, type FlowData, type FlowSnapshot } from "@/lib/backend-projection";
import type { ApiRecord, MockProject, MockResource } from "@/lib/types";
import "@xyflow/react/dist/style.css";

type RunState = { ok: boolean; status: number; method: string; message: string } | null;
type SaveStatus = "saved" | "unsaved" | "saving" | "error";

const configValue = (nodes: Node<FlowData>[], kind: NodeKind, key: string, fallback: string) => {
  return nodes.find((item) => item.data.kind === kind)?.data.config[key] || fallback;
};
const apiPreview = (nodes: Node<FlowData>[]) => {
  const method = configValue(nodes, "request", "method", "GET");
  const path = configValue(nodes, "request", "path", "/posts");
  const resource = configValue(nodes, "resource", "resource", "posts");
  const status = configValue(nodes, "response", "status", "200");
  const filter = nodes.find((item) => item.data.kind === "filter")?.data.config;
  const sort = nodes.find((item) => item.data.kind === "sort")?.data.config;
  const pageSize = configValue(nodes, "paginate", "size", "20");
  return { method, path, resource, status, filter, sort, pageSize };
};
const requestBody = (nodes: Node<FlowData>[]) => {
  const config = nodes.find((item) => item.data.kind === "request")?.data.config || {};
  try {
    const body = JSON.parse(config.body || "{}");
    return body;
  } catch {
    return {};
  }
};
const requestBodyError = (nodes: Node<FlowData>[]) => {
  const config = nodes.find((item) => item.data.kind === "request")?.data.config || {};
  const method = config.method || "GET";
  if (method === "GET" || method === "DELETE" || !config.body?.trim()) return null;
  try {
    JSON.parse(config.body);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : "JSON noto‘g‘ri yozilgan.";
  }
};
const responseStatusLabel = (status: RunState) => {
  if (!status) return "Runtime";
  return `${status.status} ${status.ok ? "OK" : "ERR"}`;
};
const nodeCode = (item: Node<FlowData>) => {
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
const socketKind = (nodes: Node<FlowData>[], nodeId: string | null | undefined, handleId: string | null | undefined, side: "inputs" | "outputs") => {
  return nodes.find((item) => item.id === nodeId)?.data[side].find((socket) => socket.id === handleId)?.type;
};
const edgeIsValid = (nodes: Node<FlowData>[], edge: Edge) => {
  const sourceType = socketKind(nodes, edge.source, edge.sourceHandle, "outputs");
  const targetType = socketKind(nodes, edge.target, edge.targetHandle, "inputs");
  return Boolean(sourceType && targetType && sourceType === targetType);
};
const flowIssues = (nodes: Node<FlowData>[], edges: Edge[]) => {
  const issues: string[] = [];
  const request = nodes.find((item) => item.data.kind === "request");
  const resource = nodes.find((item) => item.data.kind === "resource");
  const response = nodes.find((item) => item.data.kind === "response");
  if (!request) issues.push("HTTP Request node kerak.");
  if (!resource) issues.push("Read Resource node kerak.");
  if (!response) issues.push("JSON Response node kerak.");
  if (request && !request.data.config.path?.startsWith("/")) issues.push("Endpoint path '/' bilan boshlanishi kerak.");
  if (resource && !resource.data.config.resource?.trim()) issues.push("Resource nomi bo‘sh bo‘lmasin.");
  if (resource && resource.data.config.project === "demo") issues.push("Resource node'da project slug'ni haqiqiy project slugga almashtiring.");
  if (edges.some((edge) => !edgeIsValid(nodes, edge))) issues.push("Mos kelmaydigan socket ulanishi bor.");
  const connected = new Set(edges.flatMap((edge) => [edge.source, edge.target]));
  if (request && !connected.has(request.id)) issues.push("Request node hali oqimga ulanmagan.");
  if (response && !connected.has(response.id)) issues.push("Response node hali oqimga ulanmagan.");
  if (response && !edges.some((edge) => edge.target === response.id && edge.targetHandle === "records")) issues.push("Flow oxiri JSON Response node'ga ulanishi kerak.");
  return issues;
};
const flowStatus = (nodes: Node<FlowData>[], edges: Edge[], runState: RunState) => {
  const issues = flowIssues(nodes, edges);
  if (issues.length) return { tone: "error", label: "Needs attention", issues };
  if (runState?.ok) return { tone: "live", label: "Flow responded", issues: [`${runState.method} ${runState.status}: real backend ishladi.`] };
  if (runState && !runState.ok) return { tone: "error", label: "Request failed", issues: [`${runState.method} ${runState.status}: ${runState.message}`] };
  return { tone: "idle", label: "Ready to test", issues: ["Flow to‘liq. Send yoki Open in tab bilan sinab ko‘ring."] };
};

const node = (id: string, kind: NodeKind, x: number, y: number): Node<FlowData> => flowNode(id, kind, x, y);
const configuredNode = (id: string, kind: NodeKind, x: number, y: number, config: Record<string, string>) => {
  return flowNode(id, kind, x, y, config);
};
const getPostsNodes = [node("request-template", "request", 70, 190), configuredNode("resource-template", "resource", 360, 190, { project: "node-demo" }), node("response-template", "response", 650, 190)];
const getPostsEdges: Edge[] = [{ id: "template-e1", source: "request-template", sourceHandle: "request", target: "resource-template", targetHandle: "request" }, { id: "template-e2", source: "resource-template", sourceHandle: "records", target: "response-template", targetHandle: "records" }];
const filteredPostsNodes = [node("request-filtered", "request", 40, 180), configuredNode("resource-filtered", "resource", 290, 180, { project: "node-demo" }), node("filter-filtered", "filter", 540, 180), node("response-filtered", "response", 790, 180)];
const filteredPostsEdges: Edge[] = [{ id: "filtered-e1", source: "request-filtered", sourceHandle: "request", target: "resource-filtered", targetHandle: "request" }, { id: "filtered-e2", source: "resource-filtered", sourceHandle: "records", target: "filter-filtered", targetHandle: "records" }, { id: "filtered-e3", source: "filter-filtered", sourceHandle: "records", target: "response-filtered", targetHandle: "records" }];
const createPostNodes = [configuredNode("request-create", "request", 70, 190, { method: "POST", path: "/posts" }), configuredNode("resource-create", "resource", 360, 190, { project: "node-demo" }), configuredNode("response-create", "response", 650, 190, { status: "201" })];
const createPostEdges: Edge[] = [{ id: "create-e1", source: "request-create", sourceHandle: "request", target: "resource-create", targetHandle: "request" }, { id: "create-e2", source: "resource-create", sourceHandle: "records", target: "response-create", targetHandle: "records" }];
const updateRecordNodes = [configuredNode("request-update", "request", 70, 190, { method: "PATCH", path: "/posts" }), configuredNode("resource-update", "resource", 360, 190, { project: "node-demo" }), node("response-update", "response", 650, 190)];
const updateRecordEdges: Edge[] = [{ id: "update-e1", source: "request-update", sourceHandle: "request", target: "resource-update", targetHandle: "request" }, { id: "update-e2", source: "resource-update", sourceHandle: "records", target: "response-update", targetHandle: "records" }];
const deleteRecordNodes = [configuredNode("request-delete", "request", 70, 190, { method: "DELETE", path: "/posts" }), configuredNode("resource-delete", "resource", 360, 190, { project: "node-demo" }), node("response-delete", "response", 650, 190)];
const deleteRecordEdges: Edge[] = [{ id: "delete-e1", source: "request-delete", sourceHandle: "request", target: "resource-delete", targetHandle: "request" }, { id: "delete-e2", source: "resource-delete", sourceHandle: "records", target: "response-delete", targetHandle: "records" }];

function GeoNode({ id, data, selected }: NodeProps<Node<FlowData>>) {
  const { updateNodeData } = useReactFlow();
  function updateConfig(key: string, value: string) {
    const previous = data.config[key] || "";
    updateNodeData(id, { config: { ...data.config, [key]: value } });
    window.dispatchEvent(new CustomEvent("mockbase-flow-dirty", { detail: { id, kind: data.kind, key, value, previous } }));
  }
  const configFields = Object.entries(data.config);
  const spec = nodeSpec(data.kind);
  return <div className={`geo-node ${data.kind} ${selected ? "selected" : ""}`}>
    <div className="geo-node-header"><span>{data.kind}</span><strong>{data.title}</strong>{data.kind === "response" && <em>Runtime</em>}</div>
    <div className="geo-node-body"><small>{data.subtitle}</small>
      <div className="socket-list">
        <div>{data.inputs.map((item) => <div className="socket-row input" key={item.id}><Handle className={item.type} id={item.id} type="target" position={Position.Left} /><span>{item.label}</span></div>)}</div>
        <div>{data.outputs.map((item) => <div className="socket-row output" key={item.id}><span>{item.label}</span><Handle className={item.type} id={item.id} type="source" position={Position.Right} /></div>)}</div>
      </div>
      <div className="node-config">{configFields.map(([key, value]) => { const field = spec.config.find((item) => item.key === key); return <label className="nodrag" key={key}><span>{field?.label || key}</span>{field?.options ? <select value={value} onChange={(event) => updateConfig(key, event.target.value)}>{field.options.map((option) => <option key={option}>{option}</option>)}</select> : <input value={value} onChange={(event) => updateConfig(key, event.target.value)} />}</label>; })}</div>
    </div>
  </div>;
}

export default function NodesPage() {
  const { slug } = useParams<{ slug: string }>();
  const flowKey = projectFlowKey(slug);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<FlowData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [notice, setNotice] = useState("Starter flow yuklandi.");
  const [showJson, setShowJson] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("saved");
  const [previewResult, setPreviewResult] = useState<string | null>(null);
  const [sendingPreview, setSendingPreview] = useState(false);
  const [runState, setRunState] = useState<RunState>(null);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [draggingKind, setDraggingKind] = useState<NodeKind | null>(null);
  const [nodeSearch, setNodeSearch] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [flowInstance, setFlowInstance] = useState<ReactFlowInstance<Node<FlowData>, Edge> | null>(null);
  const [past, setPast] = useState<FlowSnapshot[]>([]);
  const [future, setFuture] = useState<FlowSnapshot[]>([]);
  const [projectName, setProjectName] = useState("Project");
  const [projectResource, setProjectResource] = useState("posts");
  const [project, setProject] = useState<MockProject | null>(null);
  const [projectResources, setProjectResources] = useState<MockResource[]>([]);
  const [loadingFlow, setLoadingFlow] = useState(true);
  const nextId = useRef(2);
  const nodeTypes = useMemo(() => ({ geoNode: GeoNode }), []);
  const selected = nodes.find((item) => item.id === selectedId);
  const activeResource = projectResources.find((resource) => resource.name === projectResource);
  const preview = apiPreview(nodes);
  const endpoint = `/api/node-flows/${flowKey}`;
  const isBodyMethod = preview.method !== "GET" && preview.method !== "DELETE";
  const bodyError = requestBodyError(nodes);
  const requestBlocker = bodyError ? "Request body JSON formatida emas." : null;
  const status = flowStatus(nodes, edges, runState);
  const canSendPreview = status.tone !== "error" && !requestBlocker;
  const saveLabel = saveStatus === "saving" ? "Saqlanmoqda" : saveStatus === "error" ? "Saqlanmadi" : saveStatus === "unsaved" ? "Auto-save kutmoqda" : "Auto-saved";
  const displayEdges = useMemo(() => edges.map((edge) => {
    const invalid = !edgeIsValid(nodes, edge);
    return { ...edge, label: undefined, animated: status.tone === "live" && !invalid, className: invalid ? "edge-invalid" : status.tone === "live" ? "edge-live" : status.tone === "error" ? "edge-warning" : "edge-idle" };
  }), [edges, nodes, status.tone]);

  const refreshProjectProjection = useCallback(async (message: string) => {
    const response = await fetch(`/api/projects/${slug}`);
    if (!response.ok) return setNotice("Project yangilanmadi.");
    const nextProject = await response.json() as MockProject;
    setProject(nextProject);
    setProjectName(nextProject.name);
    setProjectResources(nextProject.resources);
    setProjectResource(nextProject.resources[0]?.name || "");
    const nextFlow = projectToCrudFlow(nextProject);
    setNodes(nextFlow.nodes);
    setEdges(nextFlow.edges);
    await fetch(`/api/flows/${flowKey}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(nextFlow) });
    setDirty(false);
    setSaveStatus("saved");
    setNotice(message);
  }, [flowKey, setEdges, setNodes, slug]);

  const renameResourceFromNode = useCallback(async (previous: string, next: string) => {
    const from = previous.replace(/^\/+/, "").trim();
    const to = next.replace(/^\/+/, "").trim();
    if (!from || !to || from === to) return;
    const resource = projectResources.find((item) => item.name === from);
    if (!resource) return setNotice(`/${from} resource topilmadi.`);
    const response = await fetch(`/api/projects/${slug}/resources/${from}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: to, fields: resource.fields }),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => null);
      return setNotice(data?.detail || "Resource rename bo‘lmadi.");
    }
    await refreshProjectProjection(`/${from} -> /${to} backendda ham yangilandi.`);
  }, [projectResources, refreshProjectProjection, slug]);

  useEffect(() => {
    const markDirty = (event: Event) => {
      setDirty(true);
      setSaveStatus("unsaved");
      setRunState(null);
      const detail = (event as CustomEvent).detail as { kind?: NodeKind; key?: string; value?: string; previous?: string } | undefined;
      if (detail?.kind === "resource" && detail.key === "resource") {
        void renameResourceFromNode(detail.previous || "", detail.value || "");
      }
      if (detail?.kind === "request" && detail.key === "path") {
        const nextResource = (detail.value || "").replace(/^\/+/, "");
        const previousResource = (detail.previous || "").replace(/^\/+/, "");
        if (nextResource && previousResource && nextResource !== previousResource) void renameResourceFromNode(previousResource, nextResource);
      }
    };
    window.addEventListener("mockbase-flow-dirty", markDirty);
    return () => window.removeEventListener("mockbase-flow-dirty", markDirty);
  }, [renameResourceFromNode]);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/projects/${slug}`).then((response) => response.ok ? response.json() : null).then(async (project: MockProject | null) => {
      if (cancelled) return;
      const firstResource = project?.resources?.[0]?.name || "posts";
      if (project?.name) setProjectName(project.name);
      setProject(project);
      setProjectResources(project?.resources || []);
      setProjectResource(firstResource);
      const starter = project ? projectToCrudFlow(project) : { nodes: [], edges: [] };
      setNodes(starter.nodes);
      setEdges(starter.edges);
      if (project) {
        await fetch(`/api/flows/${flowKey}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(starter) });
      }
      setNotice("Backend CRUD projection node ko‘rinishda tayyorlandi.");
      setSaveStatus("saved");
      setDirty(false);
    }).catch(() => setNotice("Project node flow yuklanmadi.")).finally(() => {
      if (!cancelled) setLoadingFlow(false);
    });
    return () => {
      cancelled = true;
    };
  }, [flowKey, setEdges, setNodes, slug]);

  useEffect(() => {
    if (!dirty) return;
    const timer = window.setTimeout(async () => {
      setSaveStatus("saving");
      const response = await fetch(`/api/flows/${flowKey}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nodes, edges }) });
      setDirty(!response.ok);
      setSaveStatus(response.ok ? "saved" : "error");
    }, 650);
    return () => window.clearTimeout(timer);
  }, [dirty, nodes, edges, flowKey]);

  function remember() {
    setPast((current) => [...current.slice(-24), { nodes, edges }]);
    setFuture([]);
  }
  function replaceFlow(nextNodes: Node<FlowData>[], nextEdges: Edge[], selectedNode: string | null, message: string) {
    remember();
    setNodes(nextNodes);
    setEdges(nextEdges);
    setSelectedId(selectedNode);
    setPreviewResult(null);
    setRunState(null);
    setDirty(true);
    setSaveStatus("unsaved");
    setNotice(message);
  }
  function undo() {
    const previous = past.at(-1);
    if (!previous) return;
    setFuture((current) => [{ nodes, edges }, ...current.slice(0, 24)]);
    setPast((current) => current.slice(0, -1));
    setNodes(previous.nodes);
    setEdges(previous.edges);
    setSelectedId(null);
    setPreviewResult(null);
    setRunState(null);
    setDirty(true);
    setSaveStatus("unsaved");
    setNotice("Undo qilindi.");
  }
  function redo() {
    const next = future[0];
    if (!next) return;
    setPast((current) => [...current.slice(-24), { nodes, edges }]);
    setFuture((current) => current.slice(1));
    setNodes(next.nodes);
    setEdges(next.edges);
    setSelectedId(null);
    setPreviewResult(null);
    setDirty(true);
    setSaveStatus("unsaved");
    setNotice("Redo qilindi.");
  }

  const socketType = useCallback((nodeId: string | null, handleId: string | null, side: "inputs" | "outputs") => {
    return nodes.find((item) => item.id === nodeId)?.data[side].find((item) => item.id === handleId)?.type;
  }, [nodes]);
  const isValidConnection = useCallback((connection: Connection | Edge) => {
    const sourceType = socketType(connection.source, connection.sourceHandle ?? null, "outputs");
    const targetType = socketType(connection.target, connection.targetHandle ?? null, "inputs");
    const valid = Boolean(sourceType && targetType && sourceType === targetType);
    if (!valid) setNotice(`Ulanmadi: ${sourceType || "noma’lum"} socket ${targetType || "noma’lum"} socketka mos emas.`);
    return valid;
  }, [socketType]);
  function markFlowUnsaved() {
    setDirty(true);
    setSaveStatus("unsaved");
  }
  function onConnect(connection: Connection) { remember(); setEdges((current) => addEdge({ ...connection, animated: false }, current)); markFlowUnsaved(); setRunState(null); setPreviewResult(null); setNotice("Socketlar ulandi. Auto-save hozir saqlaydi."); }
  function handleNodesChange(changes: NodeChange<Node<FlowData>>[]) { if (changes.some((change) => change.type === "remove")) remember(); onNodesChange(changes); if (changes.some((change) => change.type === "position" || change.type === "remove")) { markFlowUnsaved(); setRunState(null); setPreviewResult(null); } }
  function handleEdgesChange(changes: EdgeChange<Edge>[]) { if (changes.some((change) => change.type === "remove")) remember(); onEdgesChange(changes); if (changes.some((change) => change.type === "remove")) { markFlowUnsaved(); setRunState(null); setPreviewResult(null); } }
  function addNode(item: NodeSpec, position = { x: 190 + nodes.length * 35, y: 230 + nodes.length * 17 }) { remember(); const id = `${item.kind}-${nextId.current++}`; setNodes((current) => [...current, node(id, item.kind, position.x, position.y)]); setSelectedId(id); markFlowUnsaved(); setRunState(null); setPreviewResult(null); setNotice(`${item.title} qo‘shildi. Endi sariq socketni boshqa node’ga ulang.`); }
  function onPaletteDragStart(event: React.DragEvent, kind: NodeKind) { event.dataTransfer.setData("application/mockbase-node", kind); event.dataTransfer.effectAllowed = "move"; setDraggingKind(kind); }
  function onCanvasDragOver(event: React.DragEvent) { event.preventDefault(); event.dataTransfer.dropEffect = "move"; }
  function onCanvasDrop(event: React.DragEvent) { event.preventDefault(); const kind = event.dataTransfer.getData("application/mockbase-node") as NodeKind; setDraggingKind(null); if (!kind || !flowInstance) return; addNode(nodeSpec(kind), flowInstance.screenToFlowPosition({ x: event.clientX, y: event.clientY })); }
  function patchSelected(patch: Partial<FlowData>) { if (!selectedId) return; setNodes((current) => current.map((item) => item.id === selectedId ? { ...item, data: { ...item.data, ...patch } } : item)); setPreviewResult(null); setRunState(null); markFlowUnsaved(); }
  function patchSelectedConfig(key: string, value: string) { if (!selectedId) return; setNodes((current) => current.map((item) => item.id === selectedId ? { ...item, data: { ...item.data, config: { ...item.data.config, [key]: value } } } : item)); setPreviewResult(null); setRunState(null); markFlowUnsaved(); }
  function removeSelected() { if (!selectedId) return; remember(); setNodes((current) => current.filter((item) => item.id !== selectedId)); setEdges((current) => current.filter((edge) => edge.source !== selectedId && edge.target !== selectedId)); setSelectedId(null); setPreviewResult(null); markFlowUnsaved(); setNotice("Node o‘chirildi. Auto-save hozir saqlaydi."); }
  function reset() {
    if (!project) return;
    const starter = projectToCrudFlow(project);
    replaceFlow(starter.nodes, starter.edges, null, "Backend CRUD projection qayta qurildi.");
  }
  async function buildTemplate(nextNodes: Node<FlowData>[], nextEdges: Edge[], selectedNode: string, message: string) {
    try {
      replaceFlow(nextNodes, nextEdges, selectedNode, `${message} Project: ${slug}.`);
      const saved = await fetch(`/api/flows/${flowKey}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nodes: nextNodes, edges: nextEdges }) });
      setDirty(!saved.ok);
      setSaveStatus(saved.ok ? "saved" : "error");
      if (saved.ok && apiPreview(nextNodes).method === "GET") await runSavedFlow(nextNodes);
    } catch {
      setNotice("Demo project tayyorlanmadi. Backend ishlayotganini tekshiring.");
    }
  }
  async function firstRecordId(resourceName: string) {
    const response = await fetch(`/api/mock/${slug}/${resourceName}`);
    if (!response.ok) return "";
    const records = await response.json() as ApiRecord[];
    return records[0]?.id || "";
  }
  function projectizeTemplate(templateNodes: Node<FlowData>[], method?: string, recordId = "") {
    return templateNodes.map((item) => {
      if (item.data.kind === "resource") return { ...item, data: { ...item.data, config: { ...item.data.config, project: slug, resource: projectResource } } };
      if (item.data.kind === "request") return { ...item, data: { ...item.data, config: { ...item.data.config, method: method || item.data.config.method, path: `/${projectResource}`, recordId, body: sampleBody(activeResource) } } };
      return item;
    });
  }
  function switchResource(resourceName: string) {
    setProjectResource(resourceName);
    if (!project) return;
    const starter = projectResourceGetFlow(project, resourceName);
    replaceFlow(starter.nodes, starter.edges, `${resourceName}-get-request`, `/${resourceName} endpoint node editorga ochildi.`);
  }
  function buildGetPostsTemplate() { void buildTemplate(projectizeTemplate(getPostsNodes, "GET"), getPostsEdges, "request-template", `GET /${projectResource} real ishlashga tayyor.`); }
  function buildFilteredTemplate() { void buildTemplate(projectizeTemplate(filteredPostsNodes, "GET"), filteredPostsEdges, "filter-filtered", `Filterli GET /${projectResource} real ishlashga tayyor.`); }
  function buildCreateTemplate() { void buildTemplate(projectizeTemplate(createPostNodes, "POST"), createPostEdges, "request-create", `POST /${projectResource} real ishlashga tayyor.`); }
  async function buildUpdateTemplate() {
    const recordId = await firstRecordId(projectResource);
    void buildTemplate(projectizeTemplate(updateRecordNodes, "PATCH", recordId), updateRecordEdges, "request-update", recordId ? `PATCH /${projectResource} birinchi record bilan tayyor.` : `PATCH /${projectResource} tayyor. Record ID kiriting.`);
  }
  async function buildDeleteTemplate() {
    const recordId = await firstRecordId(projectResource);
    void buildTemplate(projectizeTemplate(deleteRecordNodes, "DELETE", recordId), deleteRecordEdges, "request-delete", recordId ? `DELETE /${projectResource} birinchi record bilan tayyor.` : `DELETE /${projectResource} tayyor. Record ID kiriting.`);
  }
  async function load() { const response = await fetch(`/api/flows/${flowKey}`); const graph = await response.json(); if (!graph.nodes.length || !isGeoFlow(graph)) return setNotice("Saqlangan geo-flow topilmadi. Starter flow bilan davom eting."); setNodes(graph.nodes); setEdges(graph.edges); setSelectedId(null); setDirty(false); setSaveStatus("saved"); setNotice("Saqlangan flow yuklandi."); }
  async function persistCurrentFlow() {
    const response = await fetch(`/api/flows/${flowKey}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nodes, edges }) });
    setDirty(!response.ok);
    setSaveStatus(response.ok ? "saved" : "error");
    return response.ok;
  }
  async function runSavedFlow(nextNodes: Node<FlowData>[]) {
    const method = apiPreview(nextNodes).method;
    const body = requestBody(nextNodes);
    const response = await fetch(endpoint, { method, headers: { "Content-Type": "application/json" }, body: method === "GET" || method === "DELETE" ? undefined : JSON.stringify(body) });
    const payload = await response.json().catch(() => ({ detail: "JSON response emas." }));
    setPreviewResult(JSON.stringify(payload, null, 2));
    setRunState({ ok: response.ok, status: response.status, method, message: response.ok ? "Real backend request ishladi." : payload.detail || "Real backend request xato qaytardi." });
    setNotice(response.ok ? "Real backend flow javob qaytardi." : "Real backend flow xato qaytardi.");
  }
  async function openPreviewTab() {
    if (preview.method !== "GET") {
      setNotice(`${preview.method} request yangi tabda ochilmaydi. Inspector ichidagi Send ${preview.method} tugmasidan foydalaning.`);
      return;
    }
    const ok = await persistCurrentFlow();
    if (!ok) return setNotice("Flow saqlanmadi, endpoint ochilmadi.");
    window.open(endpoint, "_blank", "noopener,noreferrer");
    setNotice("Flow saqlandi va real endpoint yangi tabda ochildi.");
  }
  async function sendPreviewRequest() {
    if (requestBlocker) {
      setNotice(requestBlocker);
      return;
    }
    setSendingPreview(true);
    setPreviewResult(null);
    const ok = await persistCurrentFlow();
    if (!ok) {
      setSendingPreview(false);
      return setNotice("Flow saqlanmadi, request yuborilmadi.");
    }
    await runSavedFlow(nodes);
    setSendingPreview(false);
  }
  async function copyEndpoint() { await navigator.clipboard.writeText(`${window.location.origin}${endpoint}`); setNotice("API preview URL clipboardga ko‘chirildi."); }
  function paletteNodes(category: NodeSpec["category"]) {
    return nodeCatalog.filter((item) => item.category === category && `${item.title} ${item.summary} ${item.kind}`.toLowerCase().includes(nodeSearch.toLowerCase())).map((item) => <button className={`palette-item ${item.kind}`} draggable key={item.kind} onDragEnd={() => setDraggingKind(null)} onDragStart={(event) => onPaletteDragStart(event, item.kind)} onClick={() => addNode(item)}><span>{item.title[0]}</span><div><b>{item.title}</b><small>{item.summary}</small></div><i>⋮⋮</i></button>);
  }
  function coreNodes() {
    return (["request", "resource", "response", "filter"] as NodeKind[])
      .map((kind) => nodeSpec(kind))
      .filter((item) => `${item.title} ${item.summary} ${item.kind}`.toLowerCase().includes(nodeSearch.toLowerCase()))
      .map((item) => <button className={`palette-item ${item.kind}`} draggable key={item.kind} onDragEnd={() => setDraggingKind(null)} onDragStart={(event) => onPaletteDragStart(event, item.kind)} onClick={() => addNode(item)}><span>{item.title[0]}</span><div><b>{item.title}</b><small>{item.summary}</small></div><i>⋮⋮</i></button>);
  }
  return <main className="nodes-page">
    <header className="topbar"><Link className="brand" href="/">mockbase</Link><nav><Link href="/">Projects</Link><Link href={`/projects/${slug}`}>Workspace</Link><Link className="nav-active" href={`/projects/${slug}/nodes`}>Nodes</Link></nav></header>
    <section className="nodes-toolbar"><div><span className="editor-dot" /> <b>{projectName}</b><small>{flowKey}</small><span className={`save-state ${saveStatus}`}><i />{saveLabel}</span></div><div className="header-actions"><Link className="secondary link-button" href={`/projects/${slug}`}>Table view</Link><button className="secondary" onClick={undo} disabled={!past.length}>Undo</button><button className="secondary" onClick={redo} disabled={!future.length}>Redo</button><button className="secondary" onClick={() => setLeftCollapsed(!leftCollapsed)}>{leftCollapsed ? "Show nodes" : "Hide nodes"}</button><button className="secondary" onClick={() => setRightCollapsed(!rightCollapsed)}>{rightCollapsed ? "Show inspector" : "Hide inspector"}</button><button className="secondary" onClick={load}>Load</button><button className="secondary" onClick={reset}>Reset</button><button className="secondary" onClick={() => setShowJson(!showJson)}>{showJson ? "Canvas" : "JSON"}</button></div></section>
    <div className={`geonodes-shell ${leftCollapsed ? "left-collapsed" : ""} ${rightCollapsed ? "right-collapsed" : ""}`}>
      <aside className="node-palette"><button className="collapse-tab left" onClick={() => setLeftCollapsed(!leftCollapsed)}>{leftCollapsed ? "Nodes" : "‹"}</button><div className="sidebar-content"><div className="panel-head"><p className="eyebrow">BUILD</p><h3>Node library</h3><span>Bu projectdagi CRUD endpointlar node ko‘rinishida ochiladi.</span></div><div className="palette-section">Project endpoints</div><div className="resource-node-list">{projectResources.map((resource) => <button className={resource.name === projectResource ? "active" : ""} key={resource.id} onClick={() => switchResource(resource.name)}><b>/{resource.name}</b><span>{resource.recordCount} records · {resource.fields.length} fields</span></button>)}</div><div className="sidebar-card"><b>Search nodes</b><input className="node-search" value={nodeSearch} onChange={(event) => setNodeSearch(event.target.value)} placeholder="Request, resource, response..." /></div><div className="palette-section">Essential flow</div>{coreNodes()}<div className="socket-legend"><b>Socket ranglari</b><span><i className="request" /> Request</span><span><i className="records" /> Records</span><span><i className="value" /> Value</span><small>Har flow oxiri JSON Response node’ga ulanadi.</small></div><button className="advanced-toggle" onClick={() => setShowAdvanced(!showAdvanced)}>{showAdvanced ? "− More nodes" : "+ More nodes"}</button>{showAdvanced && <div className="advanced-palette"><small>Keyinroq kerak bo‘ladigan node’lar</small>{paletteNodes("Transform")}{paletteNodes("Advanced")}</div>}</div></aside>
      <section className={`node-canvas ${draggingKind ? "drop-ready" : ""}`} onDragOver={onCanvasDragOver} onDrop={onCanvasDrop}>{draggingKind && <div className="drop-hint">Bu yerga tashlang: <b>{nodeSpec(draggingKind).title}</b></div>}{!showJson && <div className="quick-strip"><b>CRUD</b><button onClick={buildGetPostsTemplate}>GET /{projectResource}</button><button onClick={buildCreateTemplate}>POST</button><button onClick={buildUpdateTemplate}>PATCH</button><button onClick={buildDeleteTemplate}>DELETE</button><button onClick={buildFilteredTemplate}>Filter</button>{(["request", "resource", "response"] as NodeKind[]).map((kind) => <button key={kind} onClick={() => addNode(nodeSpec(kind))}>{nodeSpec(kind).title}</button>)}</div>}{!showJson && !loadingFlow && <div className={`flow-status ${status.tone}`}><b>{status.label}</b><span>{status.issues[0]}</span></div>}{loadingFlow ? <div className="flow-loading">Project node editor yuklanmoqda...</div> : showJson ? <div className="flow-json"><div className="card-title"><div><p className="eyebrow">FLOW DSL</p><h3>JSON graph</h3></div><span className="count-badge">{nodes.length} nodes</span></div><pre>{JSON.stringify({ nodes, edges }, null, 2)}</pre></div> : <ReactFlow nodes={nodes} edges={displayEdges} nodeTypes={nodeTypes} onInit={setFlowInstance} onNodesChange={handleNodesChange} onEdgesChange={handleEdgesChange} onConnect={onConnect} isValidConnection={isValidConnection} onNodeClick={(_, item) => setSelectedId(item.id)} onPaneClick={() => setSelectedId(null)} defaultEdgeOptions={{ animated: false }} fitView preventScrolling zoomOnScroll={false} panOnScroll panOnScrollMode={PanOnScrollMode.Free} panOnScrollSpeed={0.9} zoomOnPinch zoomOnDoubleClick minZoom={0.25} maxZoom={2.5} nodesDraggable nodeDragThreshold={0} panOnDrag={[1, 2]}><Background variant={BackgroundVariant.Dots} gap={18} size={1} /><Controls /><MiniMap pannable zoomable /></ReactFlow>}</section>
      <aside className="node-inspector"><button className="collapse-tab right" onClick={() => setRightCollapsed(!rightCollapsed)}>{rightCollapsed ? "Inspector" : "›"}</button><div className="sidebar-content"><div className="panel-head"><p className="eyebrow">INSPECT</p><h3>Output & status</h3><span>Flow JSON Response node bilan tugaydi.</span></div><div className={`validation-card ${requestBlocker ? "error" : status.tone}`}><b>{requestBlocker ? "Request tayyor emas" : status.label}</b>{requestBlocker ? <span>{requestBlocker}</span> : status.issues.map((issue) => <span key={issue}>{issue}</span>)}</div>{selected ? <><div className={`inspector-section ${selected.data.kind === "response" ? "output-selected" : ""}`}><h3>{selected.data.title}</h3><small>{selected.id}</small><details className="help-popover"><summary>Bu node nima qiladi?</summary><p>{nodeSpec(selected.data.kind).summary}</p><code>{nodeSpec(selected.data.kind).example}</code></details><details className="code-popover"><summary>Code</summary><pre>{nodeCode(selected)}</pre></details><label>Node nomi<input value={selected.data.title} onChange={(event) => patchSelected({ title: event.target.value })} /></label><div className="property-panel"><b>Node properties</b>{nodeSpec(selected.data.kind).config.map((field) => <label className={field.key === "body" && bodyError ? "field-error" : ""} key={field.key}><span>{field.label}</span>{field.key === "body" ? <><textarea value={selected.data.config[field.key] || ""} onChange={(event) => patchSelectedConfig(field.key, event.target.value)} />{bodyError && <small>{bodyError}</small>}</> : field.options ? <select value={selected.data.config[field.key] || field.defaultValue} onChange={(event) => patchSelectedConfig(field.key, event.target.value)}>{field.options.map((option) => <option key={option}>{option}</option>)}</select> : <input value={selected.data.config[field.key] || ""} onChange={(event) => patchSelectedConfig(field.key, event.target.value)} />}</label>)}</div><button className="danger-button" onClick={removeSelected}>Node’ni o‘chirish</button></div><div className="flow-preview api-console"><div className="console-title"><div><p className="eyebrow">REAL BACKEND</p><h3>Request console</h3></div><span className={`console-status ${runState?.ok ? "live" : runState ? "error" : ""}`}>{responseStatusLabel(runState)}</span></div><div className="request-line"><span className={`method-pill ${preview.method.toLowerCase()}`}>{preview.method}</span><code>{endpoint}</code></div><div className="preview-actions three"><button className="secondary" onClick={openPreviewTab} disabled={preview.method !== "GET"}>Open tab</button><button className="secondary" onClick={copyEndpoint}>Copy URL</button><button onClick={sendPreviewRequest} disabled={sendingPreview || !canSendPreview}>{sendingPreview ? "Sending..." : `Send ${preview.method}`}</button></div><div className={`console-hint ${requestBlocker ? "error" : ""}`}>{requestBlocker || (preview.method === "GET" ? "GET toza JSON array qaytaradi." : "POST yangi record yaratadi. Body JSON bo‘lishi kerak.")}</div>{isBodyMethod && <section className="console-block"><div className="console-block-title"><b>Request body</b><span>{bodyError ? "INVALID" : "JSON"}</span></div><pre>{bodyError ? "JSON tuzatilsa, parsed body shu yerda ko‘rinadi." : JSON.stringify(requestBody(nodes), null, 2)}</pre></section>}{previewResult && <section className="console-block"><div className="console-block-title"><b>Real backend response</b><span>{runState?.ok ? "LIVE" : "ERROR"}</span></div><pre>{previewResult}</pre></section>}</div></> : <div className="inspector-empty"><b>Status tayyor.</b><p>Node tanlanganda properties va request console shu yerda chiqadi.</p><span>O‘zgarishlar avtomatik saqlanadi.</span></div>}<div className="inspector-notice">{notice}</div></div></aside>
    </div>
  </main>;
}
