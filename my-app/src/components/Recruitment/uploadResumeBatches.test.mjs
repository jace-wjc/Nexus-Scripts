import assert from "node:assert/strict";
import test from "node:test";
import loadTypeScript from "../../../tests/load-typescript.mjs";

const { runResumeUploadBatches: runBatches } = loadTypeScript(new URL("./uploadResumeBatches.ts", import.meta.url));
// Normalize VM realm prototypes while retaining strict value/order assertions.
const runResumeUploadBatches = async (options) => structuredClone(await runBatches(options));
const files = (count) => Array.from({ length: count }, (_, i) => new File(["synthetic"], `file-${i}.pdf`));
const response = (statuses) => ({ items: statuses.filter((status) => status === "uploaded").map(() => ({ id: 1 })),
  file_results: statuses.map((status, index) => ({ file_index: index, file_name: "server-name", status, retryable: status === "failed" })) });
const tick = () => new Promise((resolve) => setImmediate(resolve));

test("a failed concurrent batch does not finish before other batches return committed results", async () => {
  const pending = [];
  let finished = false;
  const progress = [];
  const run = runResumeUploadBatches({ files: files(3), signal: new AbortController().signal, batchSize: 1, concurrency: 2,
    sendBatch: (batch, index) => new Promise((resolve, reject) => pending.push({ index, resolve, reject })),
    onSettled: (count) => progress.push(count),
  }).then((value) => { finished = true; return value; });
  await tick();
  pending[0].reject(new Error("synthetic network failure after possible commit"));
  await tick();
  assert.equal(finished, false);
  pending[2].resolve(response(["uploaded"]));
  await tick();
  assert.equal(finished, false);
  pending[1].resolve(response(["uploaded"]));
  const result = await run;
  assert.deepEqual(result.results.map((item) => item.status), ["unknown", "uploaded", "uploaded"]);
  assert.equal(result.responses.length, 2);
  assert.deepEqual(progress, [1, 2, 3]);
  assert.equal(result.results[0].retryable, false);
});

test("retry set contains only definite failures and preserves input indexes across batches", async () => {
  const result = await runResumeUploadBatches({ files: files(4), signal: new AbortController().signal, batchSize: 2,
    sendBatch: async (_batch, index) => response(index === 0 ? ["uploaded", "failed"] : ["unknown", "skipped_duplicate"]),
    onSettled: () => {},
  });
  assert.deepEqual(result.results.map((item) => item.file_name), files(4).map((item) => item.name));
  assert.deepEqual(result.results.filter((item) => item.retryable).map((item) => item.file_index), [1]);
});

test("cancellation marks only unstarted batches as safe to retry", async () => {
  const controller = new AbortController();
  let calls = 0;
  const result = await runResumeUploadBatches({ files: files(3), signal: controller.signal, batchSize: 1, concurrency: 1,
    sendBatch: async () => { calls++; controller.abort(); throw new DOMException("aborted", "AbortError"); }, onSettled: () => {},
  });
  assert.equal(calls, 1);
  assert.deepEqual(result.results.map((item) => item.status), ["unknown", "failed", "failed"]);
  assert.deepEqual(result.results.filter((item) => item.retryable).map((item) => item.file_index), [1, 2]);
});

test("missing or duplicate file results are unconfirmed rather than automatically retried", async () => {
  const ambiguous = response(["failed", "failed"]);
  ambiguous.file_results[1].file_index = 0;
  const result = await runResumeUploadBatches({ files: files(2), signal: new AbortController().signal,
    sendBatch: async () => ambiguous, onSettled: () => {},
  });
  assert.deepEqual(result.results.map((item) => item.status), ["unknown", "unknown"]);
  assert.ok(result.results.every((item) => !item.retryable));
});
