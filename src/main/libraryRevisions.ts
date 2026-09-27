import type { Database } from 'better-sqlite3';

export interface LibraryRevisions {
  contentSequence: number;
  browseRevision: number;
  statsRevision: number;
  topologyRevision: number;
}

const contentAllocators = new WeakMap<Database, { get(): { content_sequence: number } | undefined }>();

export function getLibraryRevisions(db: Database): LibraryRevisions {
  const row = db.prepare(`SELECT content_sequence, browse_revision, stats_revision, topology_revision
    FROM library_revisions WHERE singleton = 1`).get() as {
      content_sequence: number;
      browse_revision: number;
      stats_revision: number;
      topology_revision: number;
    };
  return {
    contentSequence: row.content_sequence,
    browseRevision: row.browse_revision,
    statsRevision: row.stats_revision,
    topologyRevision: row.topology_revision,
  };
}

/** Allocates identities globally so deleting and recreating a path cannot reuse a revision. */
export function allocateContentRevision(db: Database): number {
  let statement = contentAllocators.get(db);
  if (!statement) {
    statement = db.prepare('UPDATE library_revisions SET content_sequence = content_sequence + 1 WHERE singleton = 1 RETURNING content_sequence');
    contentAllocators.set(db, statement);
  }
  const row = statement.get();
  if (!row) throw new Error('Library revision row is missing');
  return row.content_sequence;
}

export function advanceLibraryRevisions(
  db: Database,
  flags: { browse?: boolean; stats?: boolean; topology?: boolean },
): LibraryRevisions {
  db.prepare(`UPDATE library_revisions SET
    browse_revision = browse_revision + ?,
    stats_revision = stats_revision + ?,
    topology_revision = topology_revision + ?
    WHERE singleton = 1`).run(flags.browse ? 1 : 0, flags.stats ? 1 : 0, flags.topology ? 1 : 0);
  return getLibraryRevisions(db);
}

export function getBrowseRevision(db: Database): number {
  return getLibraryRevisions(db).browseRevision;
}
