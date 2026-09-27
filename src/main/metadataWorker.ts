import { extractMetadata } from "./metadata";
import type { MetadataWorkerRequest } from "./metadataWorkerClient";

process.parentPort.on("message", async (event) => {
  const request = event.data as MetadataWorkerRequest;
  if (!request || typeof request.requestId !== "string" || typeof request.filePath !== "string"
    || typeof request.extension !== "string" || !Number.isInteger(request.fileId)
    || !Number.isInteger(request.contentRevision)) return;
  try {
    const summary = await extractMetadata(request.filePath, request.extension);
    process.parentPort.postMessage({ requestId: request.requestId, summary });
  } catch (error) {
    process.parentPort.postMessage({ requestId: request.requestId, error: error instanceof Error ? error.message : String(error) });
  }
});
