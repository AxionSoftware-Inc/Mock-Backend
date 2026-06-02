"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import type { FieldType, MockField } from "@/lib/types";

const starterFields: MockField[] = [
  { name: "title", type: "string", required: true },
  { name: "body", type: "string", required: false },
];

export default function CreateProjectPage() {
  const router = useRouter();
  const [name, setName] = useState("Blog API");
  const [resource, setResource] = useState("posts");
  const [fields, setFields] = useState(starterFields);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

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
        <nav><Link href="/">Projects</Link><Link className="nav-active" href="/create">Yangi API</Link><Link href="/nodes">Node lab</Link></nav>
      </header>
      <section className="create-hero compact-hero">
        <p className="eyebrow">NEW PROJECT</p>
        <h1>Backend asosini yarating.</h1>
        <p>Project nomi va birinchi resource’ni kiriting. Keyingi resource va recordlarni workspace ichida boshqarasiz.</p>
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
