import test from "node:test";
import assert from "node:assert/strict";

import type { FileRecord } from "../../../../src/shared/types";
import type { LibraryArchiveItem } from "../../../../src/shared/libraryQuery";
import {
  collapseArchiveEntriesForDisplay,
  formatArchiveFolderLabel,
  isArchiveSummaryRecord,
  isLibraryArchiveDisplayRecord,
  libraryItemToDisplayRecord,
} from "../../../../src/renderer/lib/archiveDisplay";

function createFile(overrides: Partial<FileRecord>): FileRecord {
  return {
    id: overrides.id ?? 1,
    path: overrides.path ?? "/library/a.stl",
    name: overrides.name ?? "a",
    extension: overrides.extension ?? "stl",
    directory: overrides.directory ?? "/library",
    size_bytes: overrides.size_bytes ?? 100,
    modified_at: overrides.modified_at ?? 1,
    vertex_count: overrides.vertex_count ?? 10,
    face_count: overrides.face_count ?? 20,
    thumbnail: overrides.thumbnail ?? null,
    thumbnail_failed: overrides.thumbnail_failed ?? 0,
    indexed_at: overrides.indexed_at ?? 1,
    tags: overrides.tags ?? null,
    notes: overrides.notes ?? null,
    dimensions: overrides.dimensions ?? null,
    content_revision: overrides.content_revision ?? 1,
    archive_path: overrides.archive_path ?? null,
  };
}

test("collapseArchiveEntriesForDisplay replaces archive children with one summary card in normal browsing", () => {
  const files = [
    createFile({ id: 1, path: "/library/part.stl", name: "part" }),
    createFile({
      id: 2,
      path: "/library/bundle.zip::entry::a.stl",
      name: "a",
      directory: "/library/bundle.zip::entry::",
    }),
    createFile({
      id: 3,
      path: "/library/bundle.zip::entry::b.obj",
      name: "b",
      extension: "obj",
      directory: "/library/bundle.zip::entry::",
    }),
  ];

  const display = collapseArchiveEntriesForDisplay(files, {
    activeFolder: "/library",
    search: "",
    hasActiveCollection: false,
  });

  assert.equal(display.length, 2);
  assert.equal(isArchiveSummaryRecord(display[1]), true);
  if (isArchiveSummaryRecord(display[1])) {
    assert.equal(display[1].entries.length, 2);
    assert.equal(display[1].name, "bundle.zip");
  }
});

test("collapseArchiveEntriesForDisplay keeps archive children visible inside archive view or search results", () => {
  const files = [
    createFile({
      id: 2,
      path: "/library/bundle.zip::entry::a.stl",
      name: "a",
      directory: "/library/bundle.zip::entry::",
    }),
  ];

  assert.equal(
    collapseArchiveEntriesForDisplay(files, {
      activeFolder: "/library/bundle.zip::entry::",
      search: "",
      hasActiveCollection: false,
    }).length,
    1,
  );

  assert.equal(
    collapseArchiveEntriesForDisplay(files, {
      activeFolder: "/library",
      search: "a",
      hasActiveCollection: false,
    }).length,
    1,
  );
});

test("formatArchiveFolderLabel removes archive implementation suffixes", () => {
  assert.equal(
    formatArchiveFolderLabel("/library/bundle.zip::entry::"),
    "bundle.zip",
  );
  assert.equal(
    formatArchiveFolderLabel("/library/bundle.zip::entry::nested"),
    "nested",
  );
});

test("archive display record preserves the server key, complete count, and bounded samples", () => {
  const archive: LibraryArchiveItem = {
    kind: "archive",
    key: "archive:/library/bundle.zip",
    archivePath: "/library/bundle.zip",
    name: "bundle.zip",
    modelCount: 120,
    vertexCount: 400,
    faceCount: 240,
    sizeBytes: 1800,
    thumbnailSamples: [1, 2, 3, 4].map((id) => createFile({
      id,
      path: `/library/bundle.zip::entry::${id}.stl`,
      archive_path: "/library/bundle.zip",
    })),
  };

  const display = libraryItemToDisplayRecord(archive);
  assert.equal(isLibraryArchiveDisplayRecord(display), true);
  if (isLibraryArchiveDisplayRecord(display)) {
    assert.equal(display.key, archive.key);
    assert.equal(display.archivePath, archive.archivePath);
    assert.equal(display.modelCount, 120);
    assert.equal(display.thumbnailSamples.length, 4);
    assert.equal("id" in display, false);
  }
});

test("file display records retain the real file record and stable key", () => {
  const fileRecord = createFile({ id: 12 });
  const display = libraryItemToDisplayRecord({ kind: "file", key: "file:12", file: fileRecord });
  assert.equal(display, fileRecord);
  assert.equal(isArchiveSummaryRecord(display), false);
});
