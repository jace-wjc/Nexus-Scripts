import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import loadTypeScript from "../../../tests/load-typescript.mjs";

const tick = () => new Promise((resolve) => setImmediate(resolve));

function hookHarness(fetch) {
  const cleanups = [];
  const timers = new Map();
  let session = { token: "user-a" };
  let sequence = 0;
  const { useTaskSSE } = loadTypeScript(new URL("./hooks/useTaskSSE.ts", import.meta.url), {
    react: { useRef: (value) => ({ current: value }), useEffect: (callback) => cleanups.push(callback()) },
    "@/lib/auth": { authenticatedFetch: fetch, getStoredScriptHubSession: () => session },
  }, {
    window: { setTimeout: (callback) => { timers.set(++sequence, callback); return sequence; },
      clearTimeout: (id) => timers.delete(id) },
  });
  return { useTaskSSE, timers, cleanups, setSession: (next) => { session = next; } };
}

test("401/403 and JSON errors never announce an SSE connection", async () => {
  for (const status of [401, 403, 502]) {
    const harness = hookHarness(async () => Response.json({ error: "unavailable" }, { status }));
    let connected = 0;
    harness.useTaskSSE(true, { onConnected: () => connected++ });
    await tick();
    assert.equal(connected, 0);
    assert.equal(harness.timers.size, status === 502 ? 1 : 0);
  }
});

test("same-session listeners share one stream and closing the last listener releases it", async () => {
  let calls = 0;
  let signal;
  let streamController;
  let stream;
  let cancelled = 0;
  const harness = hookHarness(async (_url, init) => {
    calls++;
    signal = init.signal;
    stream = new ReadableStream({
      start(controller) { streamController = controller; },
      cancel() { cancelled++; },
    });
    return new Response(stream, { headers: { "content-type": "text/event-stream" } });
  });
  const received = [];
  harness.useTaskSSE(true, { onCandidateUpdated: () => received.push("one") });
  harness.useTaskSSE(true, { onCandidateUpdated: () => received.push("two") });
  await tick();
  streamController.enqueue(new TextEncoder().encode('data: {"type":"candidate_updated"}\n\n'));
  await tick();
  assert.equal(calls, 1);
  assert.deepEqual(received, ["one", "two"]);
  harness.cleanups[0]();
  assert.equal(harness.timers.size, 0);
  harness.cleanups[1]();
  for (const callback of harness.timers.values()) callback();
  assert.equal(signal.aborted, true);
  streamController.close();
  await tick();
  assert.ok(cancelled <= 1);
  assert.equal(stream.locked, false);
});

test("a late event from another login is discarded instead of being sent to current handlers", async () => {
  const streams = [];
  const harness = hookHarness(async () => new Response(new ReadableStream({
    start(controller) { streams.push(controller); },
  }), { headers: { "content-type": "text/event-stream" } }));
  const received = [];
  harness.useTaskSSE(true, { onCandidateUpdated: () => received.push("old-login") });
  await tick();
  harness.setSession({ token: "user-b" });
  harness.useTaskSSE(true, { onCandidateUpdated: () => received.push("new-login") });
  await tick();
  const event = new TextEncoder().encode('data: {"type":"candidate_updated"}\n\n');
  streams[0].enqueue(event);
  streams[1].enqueue(event);
  streams[1].close();
  await tick();
  assert.deepEqual(received, ["new-login"]);
});

test("duplicate checks use a request body and ignore late success/error after candidate changes", async () => {
  const file = new URL("./RecruitmentAutomationContainer.tsx", import.meta.url);
  const source = readFileSync(file, "utf8");
  const ast = ts.createSourceFile(String(file), source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let functionSource;
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === "checkDuplicatesForCandidate") functionSource = node.getText(ast);
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(functionSource);
  const selection = { current: 7 };
  const pending = [];
  let displayed = [];
  const { checkDuplicatesForCandidate } = loadTypeScript(file, {}, {
    mountedRef: { current: true }, duplicateCheckGenerationRef: { current: 0 },
    selectedCandidateIdRef: selection, setDuplicateCandidates: (rows) => { displayed = rows; },
    recruitmentApi: (url, init) => {
      assert.equal(url, "/candidates/check-duplicates");
      assert.equal(init.method, "POST");
      assert.ok(JSON.parse(init.body).phone);
      return new Promise((resolve, reject) => pending.push({ resolve, reject }));
    },
  }, `export ${functionSource}`);
  const first = checkDuplicatesForCandidate({ candidate: { id: 7, phone: "synthetic-one" } });
  selection.current = 8;
  const second = checkDuplicatesForCandidate({ candidate: { id: 8, phone: "synthetic-two" } });
  pending[1].resolve([{ id: 80 }]);
  await second;
  pending[0].resolve([{ id: 70 }]);
  await first;
  assert.deepEqual(displayed, [{ id: 80 }]);
  const oldFailure = checkDuplicatesForCandidate({ candidate: { id: 8, phone: "synthetic-two" } });
  selection.current = 9;
  pending[2].reject(new Error("old request"));
  await oldFailure;
  assert.deepEqual(displayed, [{ id: 80 }]);
});
