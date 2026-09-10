import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { NextRequest, NextResponse } from "next/server";

import { parseSystemBuildInfo, type SystemBuildInfo } from "@/lib/system-version";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

let buildInfoPromise: Promise<SystemBuildInfo> | null = null;

function fallbackBuildInfo(): SystemBuildInfo {
  return {
    schemaVersion: 1,
    version: process.env.NEXT_PUBLIC_APP_VERSION || "0.1.0",
    buildId: process.env.NEXT_PUBLIC_BUILD_ID || process.env.BUILD_VERSION || "build-unknown",
    buildNumber: process.env.NEXT_PUBLIC_BUILD_NUMBER || "unknown",
    commitSha: process.env.NEXT_PUBLIC_BUILD_COMMIT || "",
    builtAt: process.env.NEXT_PUBLIC_BUILD_TIME || "",
  };
}

async function getBuildInfo(): Promise<SystemBuildInfo> {
  if (process.env.NODE_ENV !== 'production') {
    return fallbackBuildInfo();
  }
  if (!buildInfoPromise) {
    buildInfoPromise = readFile(join(process.cwd(), "public", "build-info.json"), "utf8")
      .then((raw) => parseSystemBuildInfo(JSON.parse(raw)) || fallbackBuildInfo())
      .catch(() => fallbackBuildInfo());
  }
  return buildInfoPromise;
}

function buildHeaders(buildId: string): Record<string, string> {
  return {
    "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0",
    "CDN-Cache-Control": "no-store",
    "Surrogate-Control": "no-store",
    ETag: `"${buildId.replace(/["\\]/g, "")}"`,
    Vary: "If-None-Match",
  };
}

export async function GET(request: NextRequest) {
  const buildInfo = await getBuildInfo();
  const headers = buildHeaders(buildInfo.buildId);
  if (request.headers.get("if-none-match") === headers.ETag) {
    return new Response(null, { status: 304, headers });
  }

  return NextResponse.json(buildInfo, { headers });
}
