"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import type { FieldType, MockField } from "@/lib/types";

const starterFields: MockField[] = [
  { name: "title", type: "string", required: true },
  { name: "body", type: "string", required: false },
];

const templates: { label: string; name: string; resource: string; fields: MockField[] }[] = [
  {
    label: "Blog",
    name: "Blog API",
    resource: "posts",
    fields: starterFields,
  },
  {
    label: "Cars",
    name: "Cars API",
    resource: "cars",
    fields: [
      { name: "brand", type: "string", required: true },
      { name: "model", type: "string", required: true },
      { name: "year", type: "number", required: false },
      { name: "available", type: "boolean", required: false },
    ],
  },
  {
    label: "Products",
    name: "Products API",
    resource: "products",
    fields: [
      { name: "name", type: "string", required: true },
      { name: "price", type: "number", required: true },
      { name: "inStock", type: "boolean", required: false },
    ],
  },
  {
    label: "Students",
    name: "Students API",
    resource: "students",
    fields: [
      { name: "name", type: "string", required: true },
      { name: "course", type: "string", required: false },
      { name: "score", type: "number", required: false },
      { name: "active", type: "boolean", required: false },
    ],
  },
];

export default function CreateProjectPage() {
  const router = useRouter();
  const [name, setName] = useState("Blog API");
  const [resource, setResource] = useState("posts");
  const [fields, setFields] = useState(starterFields);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  function applyTemplate(template: (typeof templates)[number]) {
    setName(template.name);
    setResource(template.resource);
    setFields(template.fields);
    setMessage(`${template.label} template tanlandi.`);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setMessage("");
    try {
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, resource, fields }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Project yaratilmadi.");
      router.push(`/projects/${data.slug}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Xatolik yuz berdi.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main>
      <header className="topbar">
        <Link className="brand" href="/">mockbase</Link>
        <nav><Link href="/projects">Projects</Link><Link className="nav-active" href="/create">Yangi API</Link></nav>
      </header>
      <section className="create-hero compact-hero">
        <div>
          <p className="eyebrow">NEW PROJECT</p>
          <h1>Backend asosini yarating.</h1>
          <p>Project nomi va birinchi resource’ni kiriting. Keyingi resource va recordlarni workspace ichida boshqarasiz.</p>
        </div>
        <div className="create-preview-card">
          <span>CRUD</span>
          <b>GET · POST · PATCH · DELETE</b>
          <code>/{resource}</code>
        </div>
      </section>
      <section className="template-strip">
        <div><p className="eyebrow">TEMPLATES</p><h3>Tez boshlash</h3></div>
        <div className="template-pills">{templates.map((template) => <button className="secondary" type="button" key={template.label} onClick={() => applyTemplate(template)}>{template.label}</button>)}</div>
      </section>
      <form className="card create-form elevated" onSubmit={submit}>
        <div className="card-title">
          <div><p className="eyebrow">01 / PROJECT SETUP</p><h2>Project va birinchi resource</h2></div>
          <span className="status-dot">PostgreSQL</span>
        </div>
        <div className="form-grid">
          <label>Project nomi<input value={name} onChange={(event) => setName(event.target.value)} /></label>
          <label>Birinchi resource<input value={resource} onChange={(event) => setResource(event.target.value)} /></label>
        </div>
        <div className="field-heading">
          <span>Resource fieldlari <small>{fields.length} ta</small></span>
          <button className="secondary" type="button" onClick={() => setFields([...fields, { name: "", type: "string", required: false }])}>+ Field</button>
        </div>
        <div className="field-labels"><span>Nomi</span><span>Turi</span><span>Majburiy</span></div>
        {fields.map((field, index) => (
          <div className="field-row" key={index}>
            <input aria-label="Field name" value={field.name} placeholder="field_name" onChange={(event) => setFields(fields.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item))} />
            <select aria-label="Field type" value={field.type} onChange={(event) => setFields(fields.map((item, itemIndex) => itemIndex === index ? { ...item, type: event.target.value as FieldType } : item))}>
              <option>string</option><option>number</option><option>boolean</option>
            </select>
            <label className="required"><input type="checkbox" checked={field.required} onChange={(event) => setFields(fields.map((item, itemIndex) => itemIndex === index ? { ...item, required: event.target.checked } : item))} />required</label>
            <button className="icon-button danger" type="button" disabled={fields.length === 1} onClick={() => setFields(fields.filter((_, itemIndex) => itemIndex !== index))}>×</button>
          </div>
        ))}
        <div className="form-footer">
          <span className="message">{message}</span>
          <button type="submit" disabled={loading}>{loading ? "Yaratilmoqda..." : "Project yaratish →"}</button>
        </div>
      </form>
    </main>
  );
}
