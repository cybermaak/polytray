import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { MetadataWorkerClient, type MetadataWorkerRequest } from "../../../../src/main/metadataWorkerClient";

class FakeUtility extends EventEmitter {
  requests: MetadataWorkerRequest[] = [];
  killed = false;
  postMessage(request: MetadataWorkerRequest) { this.requests.push(request); }
  kill() { this.killed = true; return true; }
}

test("metadata worker client starts lazily and resolves only the matching request", async () => {
  const child = new FakeUtility();
  let starts = 0;
  const client = new MetadataWorkerClient({ spawn: () => { starts++; setImmediate(() => child.emit("spawn")); return child as never; } });
  const request = { requestId: "request-1", fileId: 7, contentRevision: 3, filePath: "/tmp/model.obj", extension: "obj" };
  const extraction = client.extract(request);
  assert.equal(starts, 1);
  await new Promise((resolve) => setImmediate(resolve));
  child.emit("message", { requestId: "other", summary: { vertexCount: 0, faceCount: 0, dimensions: null } });
  child.emit("message", { requestId: request.requestId, summary: { vertexCount: 8, faceCount: 6, dimensions: { x: 1, y: 1, z: 1 } } });
  assert.deepEqual(await extraction, { vertexCount: 8, faceCount: 6, dimensions: { x: 1, y: 1, z: 1 } });
  await client.shutdown();
  assert.equal(child.killed, true);
});

test("metadata worker cancellation settles the request and terminates its owned process", async () => {
  const child = new FakeUtility();
  const client = new MetadataWorkerClient({ spawn: () => { setImmediate(() => child.emit("spawn")); return child as never; } });
  const controller = new AbortController();
  const extraction = client.extract({ requestId: "cancel-1", fileId: 1, contentRevision: 0, filePath: "/tmp/model.stl", extension: "stl" }, { signal: controller.signal });
  await new Promise((resolve) => setImmediate(resolve));
  controller.abort();
  await assert.rejects(extraction, /cancelled/i);
  assert.equal(child.killed, true);
  await client.shutdown();
});

test("cancelling one active scan preserves unrelated queued metadata requests", async () => {
  const workers = [new FakeUtility(), new FakeUtility()];
  let starts = 0;
  const client = new MetadataWorkerClient({ spawn: () => {
    const worker = workers[starts++];
    setImmediate(() => worker.emit("spawn"));
    return worker as never;
  } });
  const controller = new AbortController();
  const first = client.extract({ requestId: "scan-a", fileId: 1, contentRevision: 1, filePath: "/tmp/a.obj", extension: "obj" }, { signal: controller.signal });
  const firstSettled = first.then(() => "resolved", () => "rejected");
  await new Promise((resolve) => setImmediate(resolve));
  const secondRequest = { requestId: "scan-b", fileId: 2, contentRevision: 1, filePath: "/tmp/b.obj", extension: "obj" };
  const second = client.extract(secondRequest);
  controller.abort();
  assert.equal(await firstSettled, "rejected");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(starts, 2);
  assert.deepEqual(workers[1].requests, [secondRequest]);
  workers[1].emit("message", { requestId: secondRequest.requestId, summary: { vertexCount: 8, faceCount: 6, dimensions: null } });
  assert.deepEqual(await second, { vertexCount: 8, faceCount: 6, dimensions: null });
  await client.shutdown();
});

test("metadata worker retries an in-flight request once after its owned process exits", async () => {
  const workers = [new FakeUtility(), new FakeUtility()];
  let starts = 0;
  const client = new MetadataWorkerClient({ spawn: () => {
    const worker = workers[starts++];
    setImmediate(() => worker.emit("spawn"));
    return worker as never;
  } });
  const request = { requestId: "retry-1", fileId: 4, contentRevision: 9, filePath: "/tmp/model.stl", extension: "stl" };
  const extraction = client.extract(request);
  await new Promise((resolve) => setImmediate(resolve));
  const staleExit = workers[0].listeners("exit").find((listener) => listener !== undefined)! as (code: number) => void;
  staleExit(1);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(starts, 2);
  assert.deepEqual(workers[1].requests, [request]);
  staleExit(1);
  const nextRequest = { ...request, requestId: "retry-followup" };
  const nextExtraction = client.extract(nextRequest);
  assert.equal(starts, 2);
  workers[1].emit("message", { requestId: request.requestId, summary: { vertexCount: 3, faceCount: 1, dimensions: null } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(workers[1].requests, [request, nextRequest]);
  workers[1].emit("message", { requestId: nextRequest.requestId, summary: { vertexCount: 3, faceCount: 1, dimensions: null } });
  assert.deepEqual(await extraction, { vertexCount: 3, faceCount: 1, dimensions: null });
  assert.deepEqual(await nextExtraction, { vertexCount: 3, faceCount: 1, dimensions: null });
  await client.shutdown();
});

test("metadata worker rejects malformed summaries and leaves the caller settled without committing bad values", async () => {
  const invalidSummaries = [
    { vertexCount: -1, faceCount: 1, dimensions: null },
    { vertexCount: 1.5, faceCount: 1, dimensions: null },
    { vertexCount: 1, faceCount: Number.NaN, dimensions: null },
    { vertexCount: 1, faceCount: 1, dimensions: { x: 1, y: Number.POSITIVE_INFINITY, z: 0 } },
    { vertexCount: 1, faceCount: 1, dimensions: { x: 1, y: 2 } },
  ];
  const child = new FakeUtility();
  const client = new MetadataWorkerClient({ spawn: () => { setImmediate(() => child.emit("spawn")); return child as never; } });
  try {
    for (let index = 0; index < invalidSummaries.length; index++) {
      const requestId = `malformed-${index}`;
      const extraction = client.extract({ requestId, fileId: 1, contentRevision: 1, filePath: "/tmp/model.obj", extension: "obj" });
      await new Promise((resolve) => setImmediate(resolve));
      child.emit("message", { requestId, summary: invalidSummaries[index] });
      await assert.rejects(extraction, /invalid|malformed/i);
    }
  } finally { await client.shutdown(); }
});

test("metadata worker client applies queue backpressure and promptly cancels a waiting caller", async () => {
  const child = new FakeUtility();
  const client = new MetadataWorkerClient({ maxQueuedRequests: 1, spawn: () => { setImmediate(() => child.emit("spawn")); return child as never; } });
  const first = client.extract({ requestId: "queue-1", fileId: 1, contentRevision: 1, filePath: "/tmp/1.obj", extension: "obj" });
  await new Promise((resolve) => setImmediate(resolve));
  const second = client.extract({ requestId: "queue-2", fileId: 2, contentRevision: 1, filePath: "/tmp/2.obj", extension: "obj" });
  const controller = new AbortController();
  const third = client.extract({ requestId: "queue-3", fileId: 3, contentRevision: 1, filePath: "/tmp/3.obj", extension: "obj" }, { signal: controller.signal });
  controller.abort();
  await assert.rejects(third, /cancelled/i);
  assert.deepEqual(child.requests.map(({ requestId }) => requestId), ["queue-1"]);
  child.emit("message", { requestId: "queue-1", summary: { vertexCount: 1, faceCount: 0, dimensions: null } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(child.requests.map(({ requestId }) => requestId), ["queue-1", "queue-2"]);
  child.emit("message", { requestId: "queue-2", summary: { vertexCount: 1, faceCount: 0, dimensions: null } });
  await Promise.all([first, second]);
  await client.shutdown();
});

test("metadata worker reports parser failures as failures instead of empty metadata", async () => {
  const child = new FakeUtility();
  const client = new MetadataWorkerClient({ spawn: () => { setImmediate(() => child.emit("spawn")); return child as never; } });
  const extraction = client.extract({ requestId: "invalid-1", fileId: 1, contentRevision: 1, filePath: "/tmp/truncated.stl", extension: "stl" });
  await new Promise((resolve) => setImmediate(resolve));
  child.emit("message", { requestId: "invalid-1", error: "Malformed or truncated binary STL data" });
  await assert.rejects(extraction, /malformed|truncated/i);
  await client.shutdown();
});

test("metadata worker request timeout rejects the caller and kills its owned process", async () => {
  const child = new FakeUtility();
  const client = new MetadataWorkerClient({ timeoutMs: 5, spawn: () => { setImmediate(() => child.emit("spawn")); return child as never; } });
  const extraction = client.extract({ requestId: "timeout-1", fileId: 1, contentRevision: 1, filePath: "/tmp/hung.obj", extension: "obj" });
  await assert.rejects(extraction, /timed out/i);
  assert.equal(child.killed, true);
  await client.shutdown();
});
