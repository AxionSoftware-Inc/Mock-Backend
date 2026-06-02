import { NextResponse, type NextRequest } from "next/server";

const reservedSubdomains = new Set(["www", "app", "api"]);

export function proxy(request: NextRequest) {
  const host = request.headers.get("host")?.split(":")[0] || "";
  const hostnameParts = host.split(".");
  const isLocalSubdomain = host.endsWith(".localhost");
  const hasProductionSubdomain = hostnameParts.length > 2;

  if (!isLocalSubdomain && !hasProductionSubdomain) return NextResponse.next();

  const slug = hostnameParts[0];
  if (!slug || reservedSubdomains.has(slug)) return NextResponse.next();

  const pathname = request.nextUrl.pathname;
  if (
    pathname.startsWith("/api/") ||
    pathname.startsWith("/_next/") ||
    pathname === "/favicon.ico"
  ) {
    return NextResponse.next();
  }

  const url = request.nextUrl.clone();
  url.protocol = "http";
  url.host = process.env.API_HOST || "localhost:8000";
  url.pathname = `/api/mock/${slug}${pathname}`;
  return NextResponse.rewrite(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
