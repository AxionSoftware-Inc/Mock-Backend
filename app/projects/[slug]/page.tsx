"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { projectFlowKey, projectToCrudFlow } from "@/lib/backend-projection";
import type { ApiRecord, FieldType, MockField, MockProject, MockResource } from "@/lib/types";

const emptyFields: MockField[] = [{ name: "title", type: "string", required: true }];
type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE";
const methods: HttpMethod[] = ["GET", "POST", "PATCH", "DELETE"];

function samplePayload(fields: MockField[]) {
  return JSON.stringify(Object.fromEntries(fields.map((field) => [field.name, field.type === "boolean" ? false : field.type === "number" ? 1 : `${field.name} namunasi`])), null, 2);
}

function sampleValues(fields: MockField[]) {
  return Object.fromEntries(fields.map((field) => [field.name, field.type === "boolean" ? false : field.type === "number" ? 0 : ""]));
}

function fieldExample(field: MockField) {
  if (field.type === "boolean") return true;
  if (field.type === "number") return 1;
  return `${field.name} value`;
}

function displayValue(value: unknown) {
  if (typeof value === "boolean") return value ? "true" : "false";
  if (value === null || value === undefined || value === "") return "—";
  return String(value);
}

function FieldEditor({ fields, onChange }: { fields: MockField[]; onChange: (fields: MockField[]) => void }) {
  return <>
    <div className="field-labels"><span>Nomi</span><span>Turi</span><span>Majburiy</span></div>
    {fields.map((field, index) => (
      <div className="field-row" key={index}>
        <input aria-label="Field name" value={field.name} placeholder="field_name" onChange={(event) => onChange(fields.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item))} />
        <select aria-label="Field type" value={field.type} onChange={(event) => onChange(fields.map((item, itemIndex) => itemIndex === index ? { ...item, type: event.target.value as FieldType } : item))}>
          <option>string</option><option>number</option><option>boolean</option>
        </select>
        <label className="required"><input type="checkbox" checked={field.required} onChange={(event) => onChange(fields.map((item, itemIndex) => itemIndex === index ? { ...item, required: event.target.checked } : item))} />required</label>
        <button className="icon-button danger" type="button" disabled={fields.length === 1} onClick={() => onChange(fields.filter((_, itemIndex) => itemIndex !== index))}>×</button>
      </div>
    ))}
    <button className="secondary add-field" type="button" onClick={() => onChange([...fields, { name: "", type: "string", required: false }])}>+ Field qo‘shish</button>
  </>;
}

export default function ProjectWorkspace() {
  const { slug } = useParams<{ slug: string }>();
  const router = useRouter();
  const [project, setProject] = useState<MockProject | null>(null);
  const [selected, setSelected] = useState("");
  const [records, setRecords] = useState<ApiRecord[]>([]);
  const [payload, setPayload] = useState("{}");
  const [formValues, setFormValues] = useState<Record<string, unknown>>({});
  const [jsonMode, setJsonMode] = useState(false);
  const [editing, setEditing] = useState<ApiRecord | null>(null);
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [showResourceForm, setShowResourceForm] = useState(false);
  const [resourceName, setResourceName] = useState("comments");
  const [resourceFields, setResourceFields] = useState<MockField[]>(emptyFields);
  const [schemaFields, setSchemaFields] = useState<MockField[]>([]);
  const [editingSchema, setEditingSchema] = useState(false);
  const [selectedMethod, setSelectedMethod] = useState<HttpMethod>("GET");

  const active = project?.resources.find((resource) => resource.name === selected);
  const baseUrl = active ? `/api/mock/${slug}/${active.name}` : "";
  const publicUrl = active ? `http://${slug}.localhost:3000/${active.name}` : "";
  const methodUrl = selectedMethod === "GET" || selectedMethod === "POST" ? publicUrl : `${publicUrl}/:id`;
  const selectedRecordUrl = editing && active ? `${publicUrl}/${editing.id}` : "";

  const loadProject = useCallback(async () => {
    const response = await fetch(`/api/projects/${slug}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || "Project topilmadi.");
    setProject(data);
    setSelected((current) => current && data.resources.some((item: MockResource) => item.name === current) ? current : data.resources[0]?.name || "");
    return data as MockProject;
  }, [slug]);

  const syncNodeProjection = useCallback(async (projectData?: MockProject) => {
    const current = projectData || await loadProject();
    await fetch(`/api/flows/${projectFlowKey(slug)}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...projectToCrudFlow(current), metadata: { schemaVersion: 1, source: "workspace-projection" } }) });
  }, [loadProject, slug]);

  const loadRecords = useCallback(async (resourceName: string) => {
    if (!resourceName) return;
    const response = await fetch(`/api/mock/${slug}/${resourceName}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || "Recordlar olinmadi.");
    setRecords(data);
  }, [slug]);

  const activateResource = useCallback((resource: MockResource) => {
    setSelected(resource.name);
    setPayload(samplePayload(resource.fields));
    setFormValues(sampleValues(resource.fields));
    setJsonMode(false);
    setSchemaFields(resource.fields);
    setEditing(null);
    setEditingSchema(false);
    setSelectedMethod("GET");
    void loadRecords(resource.name);
  }, [loadRecords]);

  useEffect(() => {
    fetch(`/api/projects/${slug}`)
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.detail || "Project topilmadi.");
        return data as MockProject;
      })
      .then((data) => {
        setProject(data);
        if (data.resources[0]) activateResource(data.resources[0]);
      })
      .catch((error) => setNotice(error.message))
      .finally(() => setLoading(false));
  }, [activateResource, slug]);

  async function saveRecord(event: FormEvent) {
    event.preventDefault();
    setNotice("");
    try {
      const body = jsonMode ? JSON.parse(payload) : formValues;
      const response = await fetch(editing ? `${baseUrl}/${editing.id}` : baseUrl, { method: editing ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Record saqlanmadi.");
      setNotice(editing ? "Record yangilandi." : "Record yaratildi.");
      setEditing(null);
      if (active) {
        setPayload(samplePayload(active.fields));
        setFormValues(sampleValues(active.fields));
      }
      await loadRecords(selected);
      await loadProject();
    } catch (error) { setNotice(error instanceof Error ? error.message : "JSON formatini tekshiring."); }
  }

  async function removeRecord(id: string) {
    if (!confirm("Record o‘chirilsinmi?")) return;
    await fetch(`${baseUrl}/${id}`, { method: "DELETE" });
    setNotice("Record o‘chirildi.");
    await loadRecords(selected);
    await loadProject();
  }

  async function createResource(event: FormEvent) {
    event.preventDefault();
    const response = await fetch(`/api/projects/${slug}/resources`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: resourceName, fields: resourceFields }) });
    const data = await response.json();
    if (!response.ok) return setNotice(data.detail || "Resource yaratilmadi.");
    await loadProject();
    activateResource(data);
    await syncNodeProjection();
    setShowResourceForm(false);
    setNotice("Yangi resource qo‘shildi.");
  }

  async function saveSchema() {
    if (!active) return;
    const response = await fetch(`/api/projects/${slug}/resources/${active.name}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fields: schemaFields }) });
    const data = await response.json();
    if (!response.ok) return setNotice(data.detail || "Schema saqlanmadi.");
    const refreshed = await loadProject();
    await syncNodeProjection(refreshed);
    setEditingSchema(false);
    setNotice("Schema yangilandi.");
  }

  async function removeResource() {
    if (!active || !confirm(`${active.name} resource va uning barcha recordlari o‘chirilsinmi?`)) return;
    await fetch(`/api/projects/${slug}/resources/${active.name}`, { method: "DELETE" });
    const refreshed = await loadProject();
    await syncNodeProjection(refreshed);
    if (refreshed.resources[0]) activateResource(refreshed.resources[0]);
    else {
      setSelected("");
      setRecords([]);
    }
    setNotice("Resource o‘chirildi.");
  }

  async function removeProject() {
    if (!confirm("Project barcha resource va recordlari bilan o‘chirilsinmi?")) return;
    await fetch(`/api/projects/${slug}`, { method: "DELETE" });
    router.push("/");
  }

  async function copyText(value: string, label: string) {
    await navigator.clipboard.writeText(value);
    setNotice(`${label} copy qilindi.`);
  }

  function openPublicEndpoint() {
    if (!publicUrl) return;
    window.open(publicUrl, "_blank", "noopener,noreferrer");
  }

  async function seedSampleRecords() {
    if (!active) return;
    const first = Object.fromEntries(active.fields.map((field) => [field.name, fieldExample(field)]));
    const second = Object.fromEntries(active.fields.map((field) => [field.name, field.type === "boolean" ? false : field.type === "number" ? 2 : `${field.name} demo`]));
    const response = await fetch(baseUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(first) });
    const responseTwo = await fetch(baseUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(second) });
    if (!response.ok || !responseTwo.ok) {
      const data = await response.json().catch(() => null);
      setNotice(data?.detail || "Sample record yaratilmadi.");
      return;
    }
    setNotice("2 ta sample record qo‘shildi.");
    await loadRecords(selected);
    await loadProject();
  }

  if (loading) return <main><div className="page-loading">Workspace yuklanmoqda...</div></main>;
  if (!project) return <main><div className="page-loading">{notice}</div></main>;

  return <main>
    <header className="topbar"><Link className="brand" href="/">mockbase</Link><nav><Link href="/projects">Projects</Link><Link href="/create">Yangi API</Link><Link href={`/projects/${slug}`}>Workspace</Link><Link href={`/projects/${slug}/nodes`}>Nodes</Link></nav></header>
    <section className="workspace-header">
      <div><Link className="back-link" href="/projects">← Projects</Link><p className="eyebrow">PROJECT WORKSPACE</p><h1>{project.name}</h1><code>{project.slug}.localhost:3000</code></div>
      <div className="header-actions"><Link className="secondary link-button" href={`/projects/${slug}/nodes`}>Open nodes</Link><button className="danger-button" onClick={removeProject}>Projectni o‘chirish</button></div>
    </section>
    <div className="app-shell">
      <aside className="resource-sidebar">
        <div className="sidebar-heading"><b>Endpoints</b><button aria-label="New endpoint" onClick={() => setShowResourceForm(!showResourceForm)}>{showResourceForm ? "×" : "+"}</button></div>
        {project.resources.map((resource) => <button className={resource.name === selected ? "resource-item selected" : "resource-item"} key={resource.id} onClick={() => activateResource(resource)}><span>/{resource.name}</span><small>{resource.recordCount}</small></button>)}
      </aside>
      <section className="workspace-content">
        {notice && <div className="notice">{notice}</div>}
        {showResourceForm && <form className="card schema-panel resource-create-panel" onSubmit={createResource}><div className="card-title"><h3>New endpoint</h3><button className="secondary" type="button" onClick={() => setShowResourceForm(false)}>Close</button></div><label className="resource-name-field">Path<input value={resourceName} placeholder="products" onChange={(event) => setResourceName(event.target.value)} /></label><FieldEditor fields={resourceFields} onChange={setResourceFields} /><div className="panel-footer"><button type="submit">Create endpoint</button></div></form>}
        {!active ? <div className="card empty-state"><b>Endpoint yarating.</b><p>Chapdagi + tugmasi yangi CRUD URL yaratadi.</p></div> : <>
          <div className="resource-header"><div><p className="eyebrow">RESOURCE</p><h2>/{active.name}</h2><code>{publicUrl}</code><div className="schema-chips">{active.fields.map((field) => <span key={field.name}><b>{field.name}</b>{field.type}{field.required ? " · required" : ""}</span>)}</div></div><div className="header-actions"><button className="secondary" onClick={() => setEditingSchema(!editingSchema)}>{editingSchema ? "Schema yopish" : "Schema"}</button><button className="danger-button" onClick={removeResource}>O‘chirish</button></div></div>
          <section className="endpoint-console">
            <div className="method-tabs">{methods.map((method) => <button className={selectedMethod === method ? "active" : ""} key={method} onClick={() => setSelectedMethod(method)}>{method}</button>)}</div>
            <div className="endpoint-line"><span className="live-dot">LIVE</span><code>{methodUrl}</code></div>
            <div className="endpoint-actions"><button className="secondary" disabled={selectedMethod !== "GET"} onClick={openPublicEndpoint}>Open</button><button className="secondary" onClick={() => copyText(methodUrl, "Endpoint URL")}>Copy URL</button>{(selectedMethod === "POST" || selectedMethod === "PATCH") && <button className="secondary" onClick={() => copyText(samplePayload(active.fields), "Sample JSON")}>Copy JSON</button>}</div>
          </section>
          {editingSchema && <section className="card schema-panel"><div className="card-title"><h3>Fields</h3><button onClick={saveSchema}>Save</button></div><FieldEditor fields={schemaFields} onChange={setSchemaFields} /></section>}
          <div className="manager-grid">
            <form className="card elevated record-editor" onSubmit={saveRecord}>
              <div className="card-title"><div><p className="eyebrow">{editing ? "EDIT RECORD" : "NEW RECORD"}</p><h3>{editing ? "Recordni tahrirlash" : "Record qo‘shish"}</h3></div><button className="secondary" type="button" onClick={() => setJsonMode(!jsonMode)}>{jsonMode ? "Form mode" : "JSON mode"}</button></div>
              <p className="card-description">{jsonMode ? "Advanced rejim: JSON payloadni to‘g‘ridan-to‘g‘ri yuboring." : "Fieldlarni to‘ldiring. Backend schema asosida tekshiradi."}</p>
              <div className="request-summary"><span className={`method-pill ${editing ? "patch" : "post"}`}>{editing ? "PATCH" : "POST"}</span><code>{editing ? selectedRecordUrl : publicUrl}</code></div>
              {jsonMode ? <textarea aria-label="JSON payload" value={payload} onChange={(event) => setPayload(event.target.value)} /> : <div className="record-form">{active.fields.map((field) => <label key={field.name}>{field.name} {field.required && <em>required</em>}{field.type === "boolean" ? <span className="boolean-input"><input type="checkbox" checked={Boolean(formValues[field.name])} onChange={(event) => setFormValues({ ...formValues, [field.name]: event.target.checked })} /> {Boolean(formValues[field.name]) ? "true" : "false"}</span> : <input type={field.type === "number" ? "number" : "text"} value={String(formValues[field.name] ?? "")} onChange={(event) => setFormValues({ ...formValues, [field.name]: field.type === "number" ? Number(event.target.value) : event.target.value })} />}</label>)}</div>}
              <div className="editor-actions">{editing && <button className="secondary" type="button" onClick={() => { setEditing(null); setFormValues(sampleValues(active.fields)); setPayload(samplePayload(active.fields)); }}>Bekor qilish</button>}<button type="submit">{editing ? "O‘zgarishni saqlash" : "Record yaratish"}</button></div>
            </form>
            <section className="card elevated records-panel"><div className="card-title"><div><p className="eyebrow">RECORDS</p><h3>Saqlangan ma’lumotlar <span>{records.length}</span></h3></div><div className="header-actions"><button className="secondary" onClick={seedSampleRecords}>Seed</button><button className="secondary" onClick={() => loadRecords(selected)}>Yangilash</button></div></div>{records.length === 0 ? <div className="empty-state small"><b>Record yo‘q.</b><p>Formdan record yarating yoki Seed bilan sample data qo‘shing.</p><button className="secondary" onClick={seedSampleRecords}>Sample recordlar qo‘shish</button></div> : <div className="data-table"><div className="data-table-head" style={{ gridTemplateColumns: `minmax(120px, .8fr) repeat(${active.fields.length}, minmax(110px, 1fr)) 150px` }}><span>ID</span>{active.fields.map((field) => <span key={field.name}>{field.name}</span>)}<span>Actions</span></div>{records.map((record) => <article className={editing?.id === record.id ? "data-row editing" : "data-row"} style={{ gridTemplateColumns: `minmax(120px, .8fr) repeat(${active.fields.length}, minmax(110px, 1fr)) 150px` }} key={record.id}><button className="id-cell" onClick={() => copyText(record.id, "Record ID")}>{record.id.slice(0, 8)}...</button>{active.fields.map((field) => <span className="data-cell" key={field.name}>{displayValue(record[field.name])}</span>)}<div className="row-actions"><button className="secondary" onClick={() => { const { id: _, ...data } = record; void _; setEditing(record); setFormValues(data); setPayload(JSON.stringify(data, null, 2)); }}>Edit</button><button className="danger-button" onClick={() => removeRecord(record.id)}>Delete</button></div></article>)}</div>}</section>
          </div>
        </>}
      </section>
    </div>
  </main>;
}
