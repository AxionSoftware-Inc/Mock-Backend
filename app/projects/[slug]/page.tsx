"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { FormEvent, useCallback, useEffect, useState } from "react";
import type { ApiRecord, FieldType, MockField, MockProject, MockResource } from "@/lib/types";

const emptyFields: MockField[] = [{ name: "title", type: "string", required: true }];

function samplePayload(fields: MockField[]) {
  return JSON.stringify(Object.fromEntries(fields.map((field) => [field.name, field.type === "boolean" ? false : field.type === "number" ? 1 : `${field.name} namunasi`])), null, 2);
}

function sampleValues(fields: MockField[]) {
  return Object.fromEntries(fields.map((field) => [field.name, field.type === "boolean" ? false : field.type === "number" ? 0 : ""]));
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

  const active = project?.resources.find((resource) => resource.name === selected);
  const baseUrl = active ? `/api/mock/${slug}/${active.name}` : "";

  const loadProject = useCallback(async () => {
    const response = await fetch(`/api/projects/${slug}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || "Project topilmadi.");
    setProject(data);
    setSelected((current) => current && data.resources.some((item: MockResource) => item.name === current) ? current : data.resources[0]?.name || "");
    return data as MockProject;
  }, [slug]);

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
    setShowResourceForm(false);
    setNotice("Yangi resource qo‘shildi.");
  }

  async function saveSchema() {
    if (!active) return;
    const response = await fetch(`/api/projects/${slug}/resources/${active.name}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fields: schemaFields }) });
    const data = await response.json();
    if (!response.ok) return setNotice(data.detail || "Schema saqlanmadi.");
    await loadProject();
    setEditingSchema(false);
    setNotice("Schema yangilandi.");
  }

  async function removeResource() {
    if (!active || !confirm(`${active.name} resource va uning barcha recordlari o‘chirilsinmi?`)) return;
    await fetch(`/api/projects/${slug}/resources/${active.name}`, { method: "DELETE" });
    const refreshed = await loadProject();
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

  if (loading) return <main><div className="page-loading">Workspace yuklanmoqda...</div></main>;
  if (!project) return <main><div className="page-loading">{notice}</div></main>;

  return <main>
    <header className="topbar"><Link className="brand" href="/">mockbase</Link><nav><Link href="/">Projects</Link><Link href="/create">Yangi API</Link><Link href="/nodes">Node lab</Link></nav></header>
    <section className="workspace-header">
      <div><Link className="back-link" href="/">← Projects</Link><p className="eyebrow">PROJECT WORKSPACE</p><h1>{project.name}</h1><code>{project.slug}.localhost:3000</code></div>
      <button className="danger-button" onClick={removeProject}>Projectni o‘chirish</button>
    </section>
    <div className="app-shell">
      <aside className="resource-sidebar">
        <div className="sidebar-heading"><b>Resources</b><button aria-label="Add resource" onClick={() => setShowResourceForm(!showResourceForm)}>+</button></div>
        {project.resources.map((resource) => <button className={resource.name === selected ? "resource-item selected" : "resource-item"} key={resource.id} onClick={() => activateResource(resource)}><span>/{resource.name}</span><small>{resource.recordCount}</small></button>)}
      </aside>
      <section className="workspace-content">
        {notice && <div className="notice">{notice}</div>}
        {showResourceForm && <form className="card schema-panel resource-create-panel" onSubmit={createResource}><div className="card-title"><div><p className="eyebrow">NEW RESOURCE</p><h3>Resource qo‘shish</h3></div><button className="secondary" type="button" onClick={() => setShowResourceForm(false)}>Yopish</button></div><p className="card-description">Masalan: comments, products yoki students. Resource alohida CRUD endpoint oladi.</p><label className="resource-name-field">Resource nomi<input value={resourceName} onChange={(event) => setResourceName(event.target.value)} /></label><FieldEditor fields={resourceFields} onChange={setResourceFields} /><div className="panel-footer"><button type="submit">Resource yaratish</button></div></form>}
        {!active ? <div className="card empty-state"><b>Resource qo‘shing.</b><p>Chap tomondagi + tugmasidan birinchi resource yarating.</p></div> : <>
          <div className="resource-header"><div><p className="eyebrow">RESOURCE</p><h2>/{active.name}</h2><code>http://{slug}.localhost:3000/{active.name}</code></div><div className="header-actions"><button className="secondary" onClick={() => setEditingSchema(!editingSchema)}>Schema</button><button className="danger-button" onClick={removeResource}>O‘chirish</button></div></div>
          {editingSchema && <section className="card schema-panel"><div className="card-title"><div><p className="eyebrow">SCHEMA EDITOR</p><h3>Fieldlarni tahrirlash</h3></div><button onClick={saveSchema}>Saqlash</button></div><p className="card-description">Mavjud recordlarga mos kelmaydigan schema saqlanmaydi.</p><FieldEditor fields={schemaFields} onChange={setSchemaFields} /></section>}
          <div className="manager-grid">
            <form className="card elevated record-editor" onSubmit={saveRecord}>
              <div className="card-title"><div><p className="eyebrow">{editing ? "EDIT RECORD" : "NEW RECORD"}</p><h3>{editing ? "Recordni tahrirlash" : "Record qo‘shish"}</h3></div><button className="secondary" type="button" onClick={() => setJsonMode(!jsonMode)}>{jsonMode ? "Form mode" : "JSON mode"}</button></div>
              <p className="card-description">{jsonMode ? "Advanced rejim: JSON payloadni to‘g‘ridan-to‘g‘ri yuboring." : "Fieldlarni to‘ldiring. Backend schema asosida tekshiradi."}</p>
              {jsonMode ? <textarea aria-label="JSON payload" value={payload} onChange={(event) => setPayload(event.target.value)} /> : <div className="record-form">{active.fields.map((field) => <label key={field.name}>{field.name} {field.required && <em>required</em>}{field.type === "boolean" ? <span className="boolean-input"><input type="checkbox" checked={Boolean(formValues[field.name])} onChange={(event) => setFormValues({ ...formValues, [field.name]: event.target.checked })} /> {Boolean(formValues[field.name]) ? "true" : "false"}</span> : <input type={field.type === "number" ? "number" : "text"} value={String(formValues[field.name] ?? "")} onChange={(event) => setFormValues({ ...formValues, [field.name]: field.type === "number" ? Number(event.target.value) : event.target.value })} />}</label>)}</div>}
              <div className="editor-actions">{editing && <button className="secondary" type="button" onClick={() => { setEditing(null); setFormValues(sampleValues(active.fields)); setPayload(samplePayload(active.fields)); }}>Bekor qilish</button>}<button type="submit">{editing ? "O‘zgarishni saqlash" : "Record yaratish"}</button></div>
            </form>
            <section className="card elevated records-panel"><div className="card-title"><div><p className="eyebrow">RECORDS</p><h3>Saqlangan ma’lumotlar <span>{records.length}</span></h3></div><button className="secondary" onClick={() => loadRecords(selected)}>Yangilash</button></div>{records.length === 0 ? <div className="empty-state small"><b>Record yo‘q.</b><p>Chap tomondagi formdan birinchi recordni yarating.</p></div> : <div className="record-table">{records.map((record) => <article className={editing?.id === record.id ? "record-card editing" : "record-card"} key={record.id}><div><small>ID: {record.id}</small><pre>{JSON.stringify(record, null, 2)}</pre></div><div className="record-actions"><button className="secondary" onClick={() => { const { id: _, ...data } = record; void _; setEditing(record); setFormValues(data); setPayload(JSON.stringify(data, null, 2)); }}>Tahrirlash</button><button className="danger-button" onClick={() => removeRecord(record.id)}>O‘chirish</button></div></article>)}</div>}</section>
          </div>
        </>}
      </section>
    </div>
  </main>;
}
