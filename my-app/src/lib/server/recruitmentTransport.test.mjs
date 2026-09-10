import assert from "node:assert/strict";
import test from "node:test";
import loadTypeScript from "../../../tests/load-typescript.mjs";

const permissions = loadTypeScript(new URL("./recruitmentRoutePermissions.ts", import.meta.url));
const proxyFile = new URL("../../app/api/recruitment/[...path]/route.ts", import.meta.url);
const streamFile = new URL("../../app/api/recruitment/task-events/route.ts", import.meta.url);

function loadRoute(file, granted, fetch, globals = {}) {
  const guard = (_request, required) => required.some((key) => granted.includes(key))
    ? { session: { id: "synthetic" } }
    : { response: Response.json({ error: "Forbidden" }, { status: 403 }) };
  return loadTypeScript(file, {
    "next/server": { NextResponse: Response },
    "@/lib/server/backendBaseUrl": { getBackendBaseUrl: () => "http://backend.invalid" },
    "@/lib/server/recruitmentRoutePermissions": permissions,
    "@/lib/server/scriptHubSession": {
      requireScriptHubAnyPermission: guard,
      requireScriptHubPermission: (request, permission) => guard(request, [permission]),
    },
  }, { fetch, ...globals });
}

const matrix = [
  ["POST", "candidates/7/parse", "recruitment-process-execute"],
  ["POST", "candidates/7/screen/start", "recruitment-process-execute"],
  ["POST", "candidates/screen/batch-start", "recruitment-process-execute"],
  ["POST", "candidates/screen/batch/start", "recruitment-process-execute"],
  ["POST", "candidates/screen/batch/query", "recruitment-process-execute"],
  ["POST", "candidates/screen/batch/cancel", "recruitment-process-execute"],
  ["POST", "candidates/screen/visible/cancel", "recruitment-process-execute"],
  ["POST", "candidates/7/score", "recruitment-process-execute"],
  ["POST", "candidates/7/interview-questions/preview-stream", "recruitment-process-execute"],
  ["POST", "ai-task-logs/7/cancel", "recruitment-process-execute"],
  ["GET", "interview-questions/7/download", "recruitment-process-execute"],
  ["PATCH", "positions/7", "recruitment-skill-bind"],
  ["GET", "candidates/pending-match", "recruitment-candidate-manage"],
  ["POST", "candidates/check-duplicates", "recruitment-dashboard-view"],
  ["GET", "interview-availability", "recruitment-candidate-manage"],
  ["GET", "interviews/interviewers", "recruitment-candidate-manage"],
  ["POST", "interview-schedules", "recruitment-candidate-manage"],
  ["POST", "follow-ups", "recruitment-candidate-manage"],
  ["PATCH", "offers/7", "recruitment-candidate-manage"],
  ["DELETE", "resume-files/7", "recruitment-candidate-manage"],
  ["POST", "publish-tasks", "recruitment-position-manage"],
  ["POST", "resource-governance/skills/7/copy", "recruitment-skill-manage"],
];

for (const [method, path, permission] of matrix) {
  test(`${method} ${path}: forwards only the existing operation permission`, async () => {
    let calls = 0;
    const upstream = async () => { calls++; return Response.json({ success: true }); };
    const context = { params: Promise.resolve({ path: path.split("/") }) };
    const request = new Request(`http://local.invalid/api/recruitment/${path}`, { method });
    const allowed = await loadRoute(proxyFile, [permission], upstream)[method](request, context);
    assert.equal(allowed.status, 200);
    const denied = await loadRoute(proxyFile, ["unrelated"], upstream)[method](request, context);
    assert.equal(denied.status, 403);
    assert.equal(calls, 1);
  });
}

test("skill binding and process execution cannot edit/delete arbitrary candidate or position data", async () => {
  for (const [method, path, permission] of [
    ["DELETE", "positions/7", "recruitment-skill-bind"],
    ["PATCH", "candidates/7", "recruitment-process-execute"],
    ["POST", "candidate-comparisons/preview", "recruitment-process-execute"],
  ]) {
    const route = loadRoute(proxyFile, [permission], () => assert.fail("must not forward"));
    const response = await route[method](new Request(`http://local.invalid/${path}`, { method }),
      { params: Promise.resolve({ path: path.split("/") }) });
    assert.equal(response.status, 403);
  }
});

test("SSE preserves authorization and availability status, and passes cancellation upstream", async () => {
  for (const status of [401, 403, 429, 503]) {
    const request = new Request("http://local.invalid/task-events");
    const route = loadRoute(streamFile, ["recruitment-process-execute"], async (_url, init) => {
      assert.equal(init.signal, request.signal);
      return new Response("private provider error", { status });
    });
    const response = await route.GET(request);
    assert.equal(response.status, status);
    assert.doesNotMatch(await response.text(), /private provider error/);
  }
});

test("SSE returns safe transport errors and preserves streaming headers and data", async () => {
  const failure = loadRoute(streamFile, ["recruitment-process-execute"], () => { throw new Error("private endpoint"); });
  assert.equal((await failure.GET(new Request("http://local.invalid"))).status, 503);
  const controller = new AbortController();
  controller.abort();
  assert.equal((await failure.GET(new Request("http://local.invalid", { signal: controller.signal }))).status, 499);
  const success = loadRoute(streamFile, ["recruitment-process-execute"], async () => new Response("data: hello\n\n"));
  const response = await success.GET(new Request("http://local.invalid"));
  assert.equal(response.headers.get("x-accel-buffering"), "no");
  assert.match(response.headers.get("cache-control"), /no-transform/);
  assert.equal(await response.text(), "data: hello\n\n");
});

test("authenticatedFetch cancellation remains connected after response headers", async () => {
  let fetchSignal;
  const auth = loadTypeScript(new URL("../auth.ts", import.meta.url), {}, {
    fetch: async (_input, init) => { fetchSignal = init.signal; return new Response("stream"); },
  });
  const controller = new AbortController();
  await auth.authenticatedFetch("http://local.invalid", { signal: controller.signal });
  controller.abort();
  assert.equal(fetchSignal.aborted, true);
});
