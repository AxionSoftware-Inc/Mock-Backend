"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { MockProjectSummary } from "@/lib/types";

export default function Home() {
  const [projects, setProjects] = useState<MockProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/projects")
      .then((response) => response.json())
      .then(setProjects)
      .finally(() => setLoading(false));
  }, []);

  return (
    <main>
      <header className="topbar">
        <Link className="brand" href="/">mockbase</Link>
        <nav>
          <Link className="nav-active" href="/">Projects</Link>
          <Link href="/create">Yangi API</Link>
          <Link href="/nodes">Node lab</Link>
        </nav>
      </header>
      <section className="dashboard-hero">
        <div>
          <p className="eyebrow">MOCK BACKEND WORKSPACE</p>
          <h1>API projectlaringiz.</h1>
          <p>Frontend uchun kerakli CRUD backendlarni yarating va bitta joydan boshqaring.</p>
        </div>
        <Link className="hero-action" href="/create">+ Yangi project</Link>
      </section>
      <section className="dashboard-section">
        <div className="section-title">
          <div>
            <p className="eyebrow">PROJECTS</p>
            <h2>Barcha API’lar</h2>
          </div>
          <span className="count-badge">{projects.length} project</span>
        </div>
        {loading ? (
          <div className="card empty-state">Projectlar yuklanmoqda...</div>
        ) : projects.length === 0 ? (
          <div className="card empty-state">
            <b>Hali project yo‘q.</b>
            <p>Birinchi mock backend projectini yarating.</p>
            <Link className="hero-action" href="/create">Project yaratish</Link>
          </div>
        ) : (
          <div className="dashboard-grid">
            {projects.map((project) => (
              <Link className="dashboard-card" href={`/projects/${project.slug}`} key={project.id}>
                <div className="card-title">
                  <span className="project-mark">{project.name.slice(0, 1).toUpperCase()}</span>
                  <span className="api-state ready">ACTIVE</span>
                </div>
                <h3>{project.name}</h3>
                <code>{project.slug}.localhost:3000</code>
                <div className="project-stats">
                  <span><b>{project.resourceCount}</b> resources</span>
                  <span><b>{project.recordCount}</b> records</span>
                </div>
                <span className="open-label">Workspace’ni ochish →</span>
              </Link>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
