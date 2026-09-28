import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PartThumbnailImage, reducePartThumbnailImages } from "../../../../src/renderer/components/PreviewPartImage";
import { PartThumbnailQueue } from "../../../../src/renderer/lib/partThumbnailQueue";

test("LRU eviction removes a React image reference before its object URL is released", async () => {
  let images = new Map<string, string>();
  const released: string[] = [];
  const queue = new PartThumbnailQueue<number>({
    maxCache: 2,
    render: async (value) => `blob:part-${value}`,
    yieldControl: async () => {},
    release: (url) => {
      assert.equal([...images.values()].includes(url), false, "React state must drop the URL before release");
      released.push(url);
    },
  });
  queue.replace(1);
  queue.request(1, [0, 1, 2].map((value) => ({ key: `part-${value}`, value })), () => true,
    (id, url, acknowledge, releasedUrl) => {
      images = reducePartThumbnailImages(images, { id, url });
      if (url === null) {
        assert.ok(releasedUrl);
        acknowledge?.();
      }
    });
  await queue.whenIdle();

  assert.equal(queue.cacheSize, 2);
  assert.equal(images.size, 2);
  assert.equal(images.has("part-0"), false);
  assert.deepEqual(released, ["blob:part-0"]);
  const markup = renderToStaticMarkup(React.createElement(PartThumbnailImage, { url: images.get("part-0"), index: 0 }));
  assert.match(markup, /data-part-thumbnail="placeholder"/);
  assert.doesNotMatch(markup, /blob:part-0/);
  queue.dispose();
});
