import assert from "node:assert/strict";
import test from "node:test";
import { PartThumbnailQueue } from "../../../../src/renderer/lib/partThumbnailQueue";

test("cancelled model work does not publish a thumbnail after replacement", async () => {
  let finish!: (value: string) => void;
  const published: string[] = [];
  const queue = new PartThumbnailQueue<string>({
    render: () => new Promise((resolve) => { finish = resolve; }),
    yieldControl: async () => {},
  });
  queue.replace(1);
  queue.request(1, [{ key: "part-a", value: "a" }], () => true, (_key, value) => { if (value) published.push(value); });
  await new Promise((resolve) => setImmediate(resolve));
  queue.replace(2);
  finish("blob:old-model");
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(published, []);
  queue.dispose();
});

test("thumbnail cache stays within 64 entries and releases evicted URLs", async () => {
  const released: string[] = [];
  let finishFirst!: (url: string) => void;
  const queue = new PartThumbnailQueue<number>({
    render: (value) => value === 0
      ? new Promise((resolve) => { finishFirst = resolve; })
      : Promise.resolve(`blob:${value}`),
    yieldControl: async () => {},
    maxCache: 64,
    release: (url) => released.push(url),
  });
  queue.replace(1);
  const published: string[] = [];
  const publish = (_key: string, url: string | null, acknowledge?: () => void) => {
    if (url) published.push(url);
    else acknowledge?.();
  };
  queue.request(1, [{ key: "part-0", value: 0 }], () => true, publish);
  await new Promise((resolve) => setImmediate(resolve));
  queue.request(1, Array.from({ length: 64 }, (_, index) => ({ key: `part-${index + 1}`, value: index + 1 })), () => true,
    publish);
  finishFirst("blob:0");
  await queue.whenIdle();
  assert.equal(queue.cacheSize, 64);
  assert.equal(released.length, 1);
  assert.equal(published.length, 65);
  queue.dispose();
  assert.equal(released.length, 65);
});

test("the pending thumbnail backlog has a fixed upper bound", async () => {
  let finish!: (url: string) => void;
  const queue = new PartThumbnailQueue<number>({
    render: () => new Promise((resolve) => { finish = resolve; }),
    yieldControl: async () => {},
  });
  queue.replace(1);
  queue.request(1, Array.from({ length: 200 }, (_, value) => ({ key: `part-${value}`, value })), () => true, () => {});
  assert.equal(queue.pendingCount, 63);
  finish("blob:first");
  queue.dispose();
  await queue.whenIdle();
});
