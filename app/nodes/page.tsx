"use client";

import Link from "next/link";
import { useCallback, useMemo, useRef, useState } from "react";
import { addEdge, Background, BackgroundVariant, Controls, Handle, MiniMap, Position, ReactFlow, useEdgesState, useNodesState, useReactFlow, type Connection, type Edge, type EdgeChange, type Node, type NodeChange, type NodeProps, type ReactFlowInstance } from "@xyflow/react";
import "@xyflow/react/dist/style.css";

type Kind = "request" | "resource" | "filter" | "sort" | "paginate" | "response" | "select" | "limit" | "delay" | "randomError";
type SocketType = "request" | "records" | "value" | "response";
type Socket = { id: string; label: string; type: SocketType };
type FlowData = { kind: Kind; title: string; subtitle: string; inputs: Socket[]; outputs: Socket[]; config: Record<string, string>; [key: string]: unknown };
type PaletteItem = { kind: Kind; title: string; subtitle: string; group: "input" | "transform" | "output" | "advanced"; inputs: Socket[]; outputs: Socket[] };

const socket = (id: string, label: string, type: SocketType): Socket => ({ id, label, type });
const palette: PaletteItem[] = [
  { kind: "request", title: "HTTP Request", subtitle: "GET /posts", group: "input", inputs: [], outputs: [socket("request", "Request", "request")] },
  { kind: "resource", title: "Read Resource", subtitle: "posts", group: "input", inputs: [socket("request", "Request", "request")], outputs: [socket("records", "Records", "records")] },
  { kind: "filter", title: "Filter Records", subtitle: "published = true", group: "transform", inputs: [socket("records", "Records", "records")], outputs: [socket("records", "Filtered", "records")] },
  { kind: "sort", title: "Sort Records", subtitle: "created_at desc", group: "transform", inputs: [socket("records", "Records", "records")], outputs: [socket("records", "Sorted", "records")] },
  { kind: "paginate", title: "Pagination", subtitle: "page size: 20", group: "transform", inputs: [socket("records", "Records", "records")], outputs: [socket("records", "Page", "records")] },
  { kind: "response", title: "JSON Response", subtitle: "200 OK", group: "output", inputs: [socket("records", "Body", "records")], outputs: [] },
  { kind: "select", title: "Select Fields", subtitle: "id, title", group: "advanced", inputs: [socket("records", "Records", "records")], outputs: [socket("records", "Selected", "records")] },
  { kind: "limit", title: "Limit Records", subtitle: "first 10", group: "advanced", inputs: [socket("records", "Records", "records")], outputs: [socket("records", "Limited", "records")] },
  { kind: "delay", title: "Response Delay", subtitle: "300 ms", group: "advanced", inputs: [socket("records", "Records", "records")], outputs: [socket("records", "Delayed", "records")] },
  { kind: "randomError", title: "Random Error", subtitle: "10% → 500", group: "advanced", inputs: [socket("records", "Records", "records")], outputs: [socket("records", "Passed", "records")] },
];
const byKind = (kind: Kind) => palette.find((item) => item.kind === kind)!;
function configFor(kind: Kind): Record<string, string> {
  if (kind === "request") return { method: "GET", path: "/posts" };
  if (kind === "resource") return { resource: "posts" };
  if (kind === "filter") return { field: "published", operator: "=", value: "true" };
  if (kind === "sort") return { field: "created_at", direction: "desc" };
  if (kind === "paginate") return { size: "20" };
  if (kind === "select") return { fields: "id,title" };
  if (kind === "limit") return { count: "10" };
  if (kind === "delay") return { milliseconds: "300" };
  if (kind === "randomError") return { chance: "10", status: "500" };
  return { status: "200" };
}
const node = (id: string, kind: Kind, x: number, y: number): Node<FlowData> => {
  const item = byKind(kind);
  const config = configFor(item.kind);
  return { id, type: "geoNode", position: { x, y }, data: { kind: item.kind, title: item.title, subtitle: item.subtitle, inputs: item.inputs, outputs: item.outputs, config } };
};
const starterNodes = [node("request-1", "request", 50, 150), node("resource-1", "resource", 300, 150), node("filter-1", "filter", 560, 150), node("response-1", "response", 820, 150)];
const starterEdges: Edge[] = [{ id: "e1", source: "request-1", sourceHandle: "request", target: "resource-1", targetHandle: "request" }, { id: "e2", source: "resource-1", sourceHandle: "records", target: "filter-1", targetHandle: "records" }];

function GeoNode({ id, data, selected }: NodeProps<Node<FlowData>>) {
  const { updateNodeData } = useReactFlow();
  function updateConfig(key: string, value: string) {
    updateNodeData(id, { config: { ...data.config, [key]: value } });
  }
  const configFields = Object.entries(data.config);
  function optionsFor(key: string) {
    if (key === "method") return ["GET", "POST", "PATCH", "DELETE"];
    if (key === "operator") return ["=", "!=", ">", ">=", "<", "<="];
    if (key === "direction") return ["asc", "desc"];
    if (key === "value" && data.kind === "filter") return ["true", "false"];
    if (key === "status") return ["200", "201", "400", "404", "500"];
    return null;
  }
  return <div className={`geo-node ${data.kind} ${selected ? "selected" : ""}`}>
    <div className="geo-node-header"><span>{data.kind}</span><strong>{data.title}</strong></div>
    <div className="geo-node-body"><small>{data.subtitle}</small>
      <div className="socket-list">
        <div>{data.inputs.map((item) => <div className="socket-row input" key={item.id}><Handle className={item.type} id={item.id} type="target" position={Position.Left} /><span>{item.label}</span></div>)}</div>
        <div>{data.outputs.map((item) => <div className="socket-row output" key={item.id}><span>{item.label}</span><Handle className={item.type} id={item.id} type="source" position={Position.Right} /></div>)}</div>
      </div>
      <div className="node-config">{configFields.map(([key, value]) => { const options = optionsFor(key); return <label className="nodrag" key={key}><span>{key}</span>{options ? <select value={value} onChange={(event) => updateConfig(key, event.target.value)}>{options.map((option) => <option key={option}>{option}</option>)}</select> : <input value={value} onChange={(event) => updateConfig(key, event.target.value)} />}</label>; })}</div>
    </div>
  </div>;
}

export default function NodesPage() {
  const [nodes, setNodes, onNodesChange] = useNodesState(starterNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(starterEdges);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [notice, setNotice] = useState("Starter flow yuklandi.");
  const [showJson, setShowJson] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [draggingKind, setDraggingKind] = useState<Kind | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [flowInstance, setFlowInstance] = useState<ReactFlowInstance<Node<FlowData>, Edge> | null>(null);
  const nextId = useRef(2);
  const nodeTypes = useMemo(() => ({ geoNode: GeoNode }), []);
  const selected = nodes.find((item) => item.id === selectedId);

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
  const onConnect = useCallback((connection: Connection) => { setEdges((current) => addEdge({ ...connection, animated: true }, current)); setDirty(true); setNotice("Socketlar ulandi. Saqlashni unutmang."); }, [setEdges]);
  function handleNodesChange(changes: NodeChange<Node<FlowData>>[]) { onNodesChange(changes); if (changes.some((change) => change.type === "position" || change.type === "remove")) setDirty(true); }
  function handleEdgesChange(changes: EdgeChange<Edge>[]) { onEdgesChange(changes); if (changes.some((change) => change.type === "remove")) setDirty(true); }
  function addNode(item: PaletteItem, position = { x: 190 + nodes.length * 35, y: 230 + nodes.length * 17 }) { const id = `${item.kind}-${nextId.current++}`; setNodes((current) => [...current, node(id, item.kind, position.x, position.y)]); setSelectedId(id); setDirty(true); setNotice(`${item.title} qo‘shildi. Endi sariq socketni boshqa node’ga ulang.`); }
  function onPaletteDragStart(event: React.DragEvent, kind: Kind) { event.dataTransfer.setData("application/mockbase-node", kind); event.dataTransfer.effectAllowed = "move"; setDraggingKind(kind); }
  function onCanvasDragOver(event: React.DragEvent) { event.preventDefault(); event.dataTransfer.dropEffect = "move"; }
  function onCanvasDrop(event: React.DragEvent) { event.preventDefault(); const kind = event.dataTransfer.getData("application/mockbase-node") as Kind; setDraggingKind(null); if (!kind || !flowInstance) return; addNode(byKind(kind), flowInstance.screenToFlowPosition({ x: event.clientX, y: event.clientY })); }
  function patchSelected(patch: Partial<FlowData>) { if (!selectedId) return; setNodes((current) => current.map((item) => item.id === selectedId ? { ...item, data: { ...item.data, ...patch } } : item)); setDirty(true); }
  function removeSelected() { if (!selectedId) return; setNodes((current) => current.filter((item) => item.id !== selectedId)); setEdges((current) => current.filter((edge) => edge.source !== selectedId && edge.target !== selectedId)); setSelectedId(null); setDirty(true); setNotice("Node o‘chirildi. O‘zgarishni saqlashingiz mumkin."); }
  function reset() { setNodes(starterNodes); setEdges(starterEdges); setSelectedId(null); setDirty(true); setNotice("Starter flow tiklandi. Saqlashni unutmang."); }
  async function save() { const response = await fetch("/api/flows/node-lab", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nodes, edges }) }); setDirty(!response.ok); setNotice(response.ok ? "Flow PostgreSQL bazasiga saqlandi." : "Flow saqlanmadi."); }
  async function load() { const response = await fetch("/api/flows/node-lab"); const graph = await response.json(); if (!graph.nodes.length) return setNotice("Saqlangan flow topilmadi. Starter flow bilan davom eting."); setNodes(graph.nodes); setEdges(graph.edges); setSelectedId(null); setDirty(false); setNotice("Saqlangan flow yuklandi."); }
  function paletteNodes(group: PaletteItem["group"]) {
    return palette.filter((item) => item.group === group).map((item) => <button className={`palette-item ${item.kind}`} draggable key={item.kind} onDragEnd={() => setDraggingKind(null)} onDragStart={(event) => onPaletteDragStart(event, item.kind)} onClick={() => addNode(item)}><span>{item.title[0]}</span><div><b>{item.title}</b><small>{item.subtitle}</small></div><i>⋮⋮</i></button>);
  }
  return <main className="nodes-page">
    <header className="topbar"><Link className="brand" href="/">mockbase</Link><nav><Link href="/">Projects</Link><Link href="/create">Yangi API</Link><Link className="nav-active" href="/nodes">Node editor</Link></nav></header>
    <section className="nodes-toolbar"><div><span className="editor-dot" /> <b>Backend Geometry</b><small>node-lab.flow</small><span className={dirty ? "save-state dirty" : "save-state"}>{dirty ? "Saqlanmagan o‘zgarish" : "Saqlandi"}</span></div><div className="header-actions"><button className="secondary" onClick={load}>Load</button><button className="secondary" onClick={reset}>Reset</button><button className="secondary" onClick={() => setShowJson(!showJson)}>{showJson ? "Canvas" : "JSON"}</button><button onClick={save}>Save flow</button></div></section>
    <div className="geonodes-shell">
      <aside className="node-palette"><p className="eyebrow">ADD NODE</p><h3>Backend nodes</h3><div className="palette-tip"><b>1. Node’ni ushlang</b><span>Canvasga sudrab tashlang</span></div><div className="flow-recipe"><b>Eng oddiy API</b><span>Request → Resource → Response</span><small>Filter, Sort va Pagination ixtiyoriy.</small></div><div className="socket-legend"><b>Socket ranglari</b><span><i className="request" /> Request</span><span><i className="records" /> Records</span><span><i className="value" /> Value</span><small>Faqat bir xil ranglar ulanadi.</small></div><div className="palette-section">Input</div>{paletteNodes("input")}<div className="palette-section">Transform</div>{paletteNodes("transform")}<div className="palette-section">Output</div>{paletteNodes("output")}<button className="advanced-toggle" onClick={() => setShowAdvanced(!showAdvanced)}>{showAdvanced ? "− Advanced nodes" : "+ Advanced nodes"}</button>{showAdvanced && <div className="advanced-palette"><small>Kam ishlatiladigan kuchli node’lar</small>{paletteNodes("advanced")}</div>}</aside>
      <section className={`node-canvas ${draggingKind ? "drop-ready" : ""}`} onDragOver={onCanvasDragOver} onDrop={onCanvasDrop}>{draggingKind && <div className="drop-hint">Bu yerga tashlang: <b>{byKind(draggingKind).title}</b></div>}{!showJson && <div className="canvas-guide"><b>2. Bir xil rangli socketlarni ulang</b><span>Socketdan socketka torting. Mos kelmasa xato chiqadi.</span></div>}{showJson ? <div className="flow-json"><div className="card-title"><div><p className="eyebrow">FLOW DSL</p><h3>JSON graph</h3></div><span className="count-badge">{nodes.length} nodes</span></div><pre>{JSON.stringify({ nodes, edges }, null, 2)}</pre></div> : <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} onInit={setFlowInstance} onNodesChange={handleNodesChange} onEdgesChange={handleEdgesChange} onConnect={onConnect} isValidConnection={isValidConnection} onNodeClick={(_, item) => setSelectedId(item.id)} onPaneClick={() => setSelectedId(null)} defaultEdgeOptions={{ animated: true }} fitView><Background variant={BackgroundVariant.Dots} gap={18} size={1} /><Controls /><MiniMap pannable zoomable /></ReactFlow>}</section>
      <aside className="node-inspector"><p className="eyebrow">INSPECTOR</p>{selected ? <><h3>{selected.data.title}</h3><small>{selected.id}</small><label>Node nomi<input value={selected.data.title} onChange={(event) => patchSelected({ title: event.target.value })} /></label><label>Konfiguratsiya<input value={selected.data.subtitle} onChange={(event) => patchSelected({ subtitle: event.target.value })} /></label><div className="inspector-meta"><span>Inputs <b>{selected.data.inputs.length}</b></span><span>Outputs <b>{selected.data.outputs.length}</b></span></div><button className="danger-button" onClick={removeSelected}>Node’ni o‘chirish</button></> : <div className="inspector-empty">Sozlamalarni ko‘rish uchun node tanlang.</div>}<div className="inspector-notice">{notice}</div></aside>
    </div>
  </main>;
}
