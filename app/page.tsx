import Link from "next/link";

export default function LandingPage() {
  return (
    <main>
      <header className="topbar">
        <Link className="brand" href="/">mockbase</Link>
        <nav>
          <Link href="/projects">Projects</Link>
          <Link href="/create">Yangi API</Link>
        </nav>
      </header>

      <section className="landing-hero">
        <div className="landing-copy">
          <p className="eyebrow">VISUAL MOCK BACKEND</p>
          <h1>Frontend uchun backendni daqiqalarda yig‘ing.</h1>
          <p>
            CRUD API, records, schema va node flow bitta real backend modelga ulanadi.
            Hozir auth yo‘q, shuning uchun ishni boshlash projectlar workspace’iga olib kiradi.
          </p>
          <div className="landing-actions">
            <Link className="hero-action" href="/projects">Ishni boshlash</Link>
            <Link className="link-button secondary" href="/create">Yangi API yaratish</Link>
          </div>
        </div>
        <div className="landing-preview">
          <span>LIVE ENDPOINT</span>
          <code>GET /api/mock/project/posts</code>
          <pre>{`[
  { "id": "...", "title": "Hello API" }
]`}</pre>
        </div>
      </section>

      <section className="landing-section">
        <article className="card">
          <b>Graphic CRUD</b>
          <p>Resource, field va recordlarni oddiy workspace orqali boshqaring.</p>
        </article>
        <article className="card">
          <b>Node Editor</b>
          <p>Xuddi shu backendni node flow ko‘rinishida ochib, request oqimini qurish mumkin.</p>
        </article>
        <article className="card">
          <b>Single Backend Model</b>
          <p>Ikkala UI mustaqil, lekin bitta canonical backend modelga ulanadi.</p>
        </article>
      </section>
    </main>
  );
}
