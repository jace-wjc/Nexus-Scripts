import type { ResumeUploadFileResult, ResumeUploadResponse } from "@/lib/recruitment-api";

type UploadOptions = {
  files: readonly File[];
  signal: AbortSignal;
  sendBatch: (files: File[], index: number) => Promise<ResumeUploadResponse>;
  onSettled: (completedFiles: number) => void;
  batchSize?: number;
  concurrency?: number;
};

// Wait for every started batch: one transport failure must not discard another
// batch's committed results or reset the dialog while requests are still active.
export async function runResumeUploadBatches({ files, signal, sendBatch, onSettled, batchSize = 50, concurrency = 4 }: UploadOptions) {
  const responses: ResumeUploadResponse[] = [];
  const results: ResumeUploadFileResult[] = [];
  const batches = Array.from({ length: Math.ceil(files.length / batchSize) }, (_, index) =>
    files.slice(index * batchSize, (index + 1) * batchSize));
  let nextBatch = 0;
  let completed = 0;

  async function worker() {
    while (nextBatch < batches.length && !signal.aborted) {
      const index = nextBatch++;
      const batch = batches[index];
      try {
        const response = await sendBatch(batch, index);
        responses.push(response);
        for (let offset = 0; offset < batch.length; offset++) {
          const matches = Array.isArray(response.file_results)
            ? response.file_results.filter((entry) => entry && entry.file_index === offset) : undefined;
          const entry = matches?.length === 1 ? matches[0] : undefined;
          const legacyComplete = !response.file_results && Array.isArray(response.items) && response.items.length === batch.length;
          const status = entry && ["uploaded", "skipped_duplicate", "failed", "unknown"].includes(entry.status)
            ? entry.status : legacyComplete ? "uploaded" : "unknown";
          results.push({ ...entry, file_index: index * batchSize + offset, file_name: batch[offset].name,
            status, retryable: status === "failed" && entry?.retryable !== false });
        }
      } catch {
        // The server may have committed before the connection failed. These
        // files must be reconciled, never automatically added to the retry set.
        batch.forEach((file, offset) => results.push({ file_index: index * batchSize + offset,
          file_name: file.name, status: "unknown", error_code: "upload_transport_unknown", retryable: false }));
      } finally {
        completed += batch.length;
        onSettled(completed);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, batches.length) }, worker));
  for (let index = nextBatch; index < batches.length; index++) {
    batches[index].forEach((file, offset) => results.push({ file_index: index * batchSize + offset,
      file_name: file.name, status: "failed", error_code: "upload_not_started", retryable: true }));
  }
  results.sort((left, right) => left.file_index - right.file_index);
  return { responses, results };
}
