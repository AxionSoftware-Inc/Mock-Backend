"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { MockProjectSummary } from "@/lib/types";

export default function NodesIndexPage() {
  const [projects, setProjects] = useState<MockProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/projects")
      .then((response) => response.json())
      .then(setProjects)
      .finally(() => setLoading(false));
  }, []);

  return <main>
    <header className="topbar">
      <Link className="brand" href="/">mockbase</Link>
      <nav><Link href="/projects">Projects</Link><Link href="/create">Yangi API</Link></nav>
    </header>
    <section className="dashboard-hero">
      <div>
        <p className="eyebrow">PROJECT NODES</p>
        <h1>Node editor project ichida ishlaydi.</h1>
        <p>Node view har bir project schema’si bilan bog‘langan. Avval project tanlang, keyin Nodes’da davom eting.</p>
      </div>
      <Link className="hero-action" href="/create">+ Yangi project</Link>
    </section>
    <section className="dashboard-section">
      <div className="section-title">
        <div><p className="eyebrow">OPEN NODES</p><h2>Project tanlang</h2></div>
        <span className="count-badge">{projects.length} project</span>
      </div>
      {loading ? <div className="card empty-state">Projectlar yuklanmoqda...</div> : projects.length === 0 ? <div className="card empty-state"><b>Project yo‘q.</b><p>Node editor loyiha ichida ishlaydi. Avval project yarating.</p><Link className="hero-action" href="/create">Project yaratish</Link></div> : <div className="dashboard-grid">
        {projects.map((project) => <Link className="dashboard-card" href={`/projects/${project.slug}/nodes`} key={project.id}>
          <div className="card-title"><span className="project-mark">{project.name.slice(0, 1).toUpperCase()}</span><span className="api-state ready">NODES</span></div>
          <h3>{project.name}</h3>
          <code>/projects/{project.slug}/nodes</code>
          <div className="project-stats"><span><b>{project.resourceCount}</b> endpoints</span><span><b>{project.recordCount}</b> records</span></div>
          <span className="open-label">Nodes’ni ochish →</span>
        </Link>)}
      </div>}
    </section>
  </main>;
}
