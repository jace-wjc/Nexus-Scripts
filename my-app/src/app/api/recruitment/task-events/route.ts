import { NextRequest } from "next/server";

import { getBackendBaseUrl } from "@/lib/server/backendBaseUrl";
import { RECRUITMENT_TASK_EVENT_PERMISSIONS } from "@/lib/server/recruitmentRoutePermissions";
import { requireScriptHubAnyPermission } from "@/lib/server/scriptHubSession";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  // 权限检查
  const auth = requireScriptHubAnyPermission(request, RECRUITMENT_TASK_EVENT_PERMISSIONS);
  if ("response" in auth) {
    return auth.response;
  }

  const backendBaseUrl = getBackendBaseUrl();
  const backendUrl = `${backendBaseUrl}/recruitment/task-events`;

  // 获取原始请求的 headers
  const authorization = request.headers.get("authorization");

  let backendResponse: Response;
  try {
    backendResponse = await fetch(backendUrl, {
      headers: {
        Authorization: authorization || "",
        Accept: "text/event-stream",
        "Cache-Control": "no-cache",
      },
      signal: request.signal,
      cache: "no-store",
    });
  } catch {
    return Response.json(
      { error: request.signal.aborted ? "request_cancelled" : "sse_upstream_unavailable" },
      { status: request.signal.aborted ? 499 : 503 },
    );
  }

  if (!backendResponse.ok) {
    await backendResponse.body?.cancel();
    return Response.json(
      { error: "sse_upstream_unavailable" },
      { status: backendResponse.status },
    );
  }

  if (!backendResponse.body) {
    return new Response("Backend SSE unavailable", { status: 502 });
  }

  return new Response(backendResponse.body, {
    status: backendResponse.status,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
