import type { FileRecord } from "./types";
import type { LibraryArchiveItem, LibraryQuery } from "./libraryQuery";

export type PreviewTarget =
  | { kind: "file"; file: FileRecord }
  | { kind: "archive"; archive: LibraryArchiveItem; query: LibraryQuery };
