import React from "react";
import { formatSize } from "../lib/formatters";
import type { AppSettings } from "../../shared/settings";
import type { CollectionRecord } from "../../shared/libraryCollections";
import { AppIcon } from "./AppIcon";
import { ARCHIVE_ENTRY_SEPARATOR } from "../../shared/archivePaths";

interface Props {
  folders: string[];
  directories: string[];
  collections: CollectionRecord[];
  activeCollectionId: string | null;
  stats: {
    total: number;
    stl: number;
    obj: number;
    threemf: number;
    totalSize: number;
  };
  activeFilter: string | null;
  activeFolder: string | null;
  onAddFolder: () => void;
  onRemoveFolder: (path: string) => void;
  onFolderSelect: (folder: string | null) => void;
  onRescanFolder: (folder: string) => void;
  onFilterChange: (ext: string | null) => void;
  onOpenSettings: () => void;
  lightMode: boolean;
  onSettingsChange: (settings: Partial<AppSettings>) => void;
  onRefreshFolderThumbnails: (folder: string) => void;
  onCollectionSelect: (collectionId: string | null) => void;
  onRemoveCollection: (collectionId: string) => void;
  preferredWidth: number;
  effectiveWidth: number;
  onPreferredWidthChange: (width: number) => void;
}

interface FolderNode {
  path: string;
  name: string;
  isLibraryRoot: boolean;
  children: FolderNode[];
}

function parseArchiveNodePath(nodePath: string) {
  const separatorIndex = nodePath.indexOf(ARCHIVE_ENTRY_SEPARATOR);
  if (separatorIndex === -1) {
    return null;
  }

  return {
    archivePath: nodePath.slice(0, separatorIndex),
    entryPath: nodePath.slice(separatorIndex + ARCHIVE_ENTRY_SEPARATOR.length),
  };
}

function getFolderNodeLabel(node: FolderNode) {
  const archiveNode = parseArchiveNodePath(node.path);
  if (!archiveNode) {
    return node.name;
  }

  if (!archiveNode.entryPath) {
    return archiveNode.archivePath.split(/[\\/]/).filter(Boolean).pop() || archiveNode.archivePath;
  }

  return node.name;
}

function FolderNodeIcon({ node }: { node: FolderNode }) {
  const archiveNode = parseArchiveNodePath(node.path);

  if (archiveNode && !archiveNode.entryPath) {
    return (
      <svg
        width="14"
        height="14"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ flexShrink: 0, opacity: 0.7, marginRight: "6px" }}
      >
        <path d="M4 2.5h6.5L13.5 5v8A1.5 1.5 0 0 1 12 14.5H4A1.5 1.5 0 0 1 2.5 13v-9A1.5 1.5 0 0 1 4 2.5Z" />
        <path d="M10 2.5V5h3.5" />
        <path d="M5.5 7h5" />
        <path d="M5.5 9h5" />
        <path d="M5.5 11h3.5" />
      </svg>
    );
  }

  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flexShrink: 0, opacity: 0.7, marginRight: "6px" }}
    >
      <path d="M2 3.5A1.5 1.5 0 013.5 2h2.879a1.5 1.5 0 011.06.44l.622.62a1.5 1.5 0 001.06.44H12.5A1.5 1.5 0 0114 5v7.5a1.5 1.5 0 01-1.5 1.5h-9A1.5 1.5 0 012 12.5v-9z" />
    </svg>
  );
}

function buildFolderTree(roots: string[], directories: string[]): FolderNode[] {
  const pathSet = new Set([...roots, ...directories]);

  for (const entry of [...roots, ...directories]) {
    const archiveNode = parseArchiveNodePath(entry);
    if (!archiveNode || !archiveNode.entryPath) {
      continue;
    }

    pathSet.add(`${archiveNode.archivePath}${ARCHIVE_ENTRY_SEPARATOR}`);
  }
  
  // Synthesize missing intermediate directories
  for (const dir of directories) {
    const isWin = dir.includes('\\');
    const sep = isWin ? '\\' : '/';
    let current = dir;
    
    while(current.length > 0) {
      const lastSep = current.lastIndexOf(sep);
      if (lastSep === -1) break;
      current = current.substring(0, lastSep);
      if (current === '' && dir.startsWith(sep)) current = sep;
      
      const hasRoot = roots.some(r => current.startsWith(r + sep) || current === r);
      if (hasRoot) {
        pathSet.add(current);
      } else {
        break;
      }
      
      if (current === sep) break;
    }
  }

  const allPaths = Array.from(pathSet).sort();
  const nodeMap = new Map<string, FolderNode>();
  
  for (const p of allPaths) {
    const isWin = p.includes('\\');
    const sep = isWin ? '\\' : '/';
    const parts = p.split(sep);
    const name = parts[parts.length - 1] || p;
    nodeMap.set(p, {
      path: p,
      name,
      isLibraryRoot: roots.includes(p),
      children: []
    });
  }

  const tree: FolderNode[] = [];

  const findArchiveAncestor = (virtualPath: string) => {
    const separatorIndex = virtualPath.indexOf(ARCHIVE_ENTRY_SEPARATOR);
    if (separatorIndex === -1) {
      return null;
    }

    const archivePath = virtualPath.slice(0, separatorIndex);
    const entryPath = virtualPath
      .slice(separatorIndex + ARCHIVE_ENTRY_SEPARATOR.length)
      .replace(/\\/g, "/")
      .replace(/^\/+/, "");

    if (!entryPath) {
      return (
        roots.find((root) => archivePath === root || archivePath.startsWith(`${root}/`) || archivePath.startsWith(`${root}\\`)) ||
        null
      );
    }

    const segments = entryPath.split("/").filter(Boolean);
    segments.pop();

    if (segments.length === 0) {
      return `${archivePath}${ARCHIVE_ENTRY_SEPARATOR}`;
    }

    return `${archivePath}${ARCHIVE_ENTRY_SEPARATOR}${segments.join("/")}`;
  };
  
  for (const p of nodeMap.keys()) {
    const isWin = p.includes('\\');
    const sep = isWin ? '\\' : '/';
    const node = nodeMap.get(p)!;
    
    let parentNode: FolderNode | null = null;
    const archiveAncestor = findArchiveAncestor(p);
    if (archiveAncestor && nodeMap.has(archiveAncestor)) {
      parentNode = nodeMap.get(archiveAncestor)!;
    }

    let current = p;
    while(!parentNode && current.length > 0) {
      const lastSep = current.lastIndexOf(sep);
      if (lastSep === -1) break;
      current = current.substring(0, lastSep);
      if (current === '' && p.startsWith(sep)) current = sep;

      if (nodeMap.has(current)) {
        parentNode = nodeMap.get(current)!;
        break;
      }
      if (current === sep) break; // Prevent infinite loop on root
    }
    
    if (parentNode) {
       node.name = p.substring(parentNode.path.length + 1);
       parentNode.children.push(node);
    } else {
       tree.push(node);
    }
  }
  
  return tree;
}

const FolderTreeNode: React.FC<{
  node: FolderNode;
  level: number;
  activeFolder: string | null;
  onSelect: (path: string | null) => void;
  onRemove: (path: string) => void;
  onRescan: (path: string) => void;
  onRefreshThumbnails: (path: string) => void;
  focusedPath: string | null;
  onFocusPath: (path: string) => void;
}> = ({ node, level, activeFolder, onSelect, onRemove, onRescan, onRefreshThumbnails, focusedPath, onFocusPath }) => {
  const [expanded, setExpanded] = React.useState(false);
  const treeItemRef = React.useRef<HTMLDivElement>(null);
  const refocusAfterExpandRef = React.useRef(false);
  const hasChildren = node.children.length > 0;
  const isActive = activeFolder === node.path;
  React.useLayoutEffect(() => {
    if (!expanded || !refocusAfterExpandRef.current) return;
    refocusAfterExpandRef.current = false;
    requestAnimationFrame(() => {
      const treeItem = treeItemRef.current;
      const tree = treeItem?.closest<HTMLElement>("[role='tree']");
      if (treeItem && tree && !tree.contains(document.activeElement)) {
        treeItem.focus({ preventScroll: true });
      }
    });
  }, [expanded]);
  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    const tree = event.currentTarget.closest<HTMLElement>("[role='tree']");
    if (!tree) return;
    const visibleItems = Array.from(tree.querySelectorAll<HTMLElement>("[role='treeitem']"))
      .filter((item) => item.getClientRects().length > 0);
    const focusItem = (item: HTMLElement | null | undefined) => {
      if (!item) return;
      const path = item.dataset.folderPath;
      if (path) onFocusPath(path);
      item.focus();
    };
    const currentIndex = visibleItems.indexOf(event.currentTarget);
    if (event.key === "ArrowDown") {
      event.preventDefault();
      focusItem(visibleItems[currentIndex + 1]);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      focusItem(visibleItems[currentIndex - 1]);
    } else if (event.key === "Home") {
      event.preventDefault();
      focusItem(visibleItems[0]);
    } else if (event.key === "End") {
      event.preventDefault();
      focusItem(visibleItems[visibleItems.length - 1]);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      if (expanded) setExpanded(false);
      else focusItem(event.currentTarget.parentElement?.closest<HTMLElement>("[role='treeitem']"));
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      if (hasChildren && !expanded) {
        refocusAfterExpandRef.current = true;
        setExpanded(true);
      }
      else focusItem(event.currentTarget.querySelector<HTMLElement>(".folder-children [role='treeitem']") ?? undefined);
    } else if (event.key === "Delete" && node.isLibraryRoot) {
      event.preventDefault();
      onRemove(node.path);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelect(isActive ? null : node.path);
    }
  };

  return (
    <div
      ref={treeItemRef}
      className="folder-tree-node"
      data-folder-path={node.path}
      role="treeitem"
      aria-label={getFolderNodeLabel(node)}
      aria-selected={isActive}
      aria-expanded={hasChildren ? expanded : undefined}
      aria-keyshortcuts={node.isLibraryRoot ? "Delete" : undefined}
      aria-describedby={node.isLibraryRoot ? "library-folder-delete-hint" : undefined}
      tabIndex={focusedPath === node.path ? 0 : -1}
      onFocus={(event) => {
        if (event.target === event.currentTarget) onFocusPath(node.path);
      }}
      onKeyDown={handleKeyDown}
    >
      <div
        className={`library-folder-item ${isActive ? 'active' : ''}`}
        data-folder-path={node.path}
        style={{ paddingLeft: `${level * 12 + 8}px`, cursor: 'pointer' }}
        onClick={(e) => {
          if ((e.target as HTMLElement).classList.contains('folder-toggle')) return;
          (e.currentTarget.parentElement as HTMLElement).focus();
          onSelect(isActive ? null : node.path);
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          window.polytray.showFolderContextMenu(node.path);
        }}
      >
        {hasChildren ? (
          <button
            type="button"
            className="folder-toggle"
            tabIndex={-1}
            aria-label={`${expanded ? "Collapse" : "Expand"} ${getFolderNodeLabel(node)}`}
            aria-expanded={expanded}
            onClick={(e) => {
              e.stopPropagation();
              (e.currentTarget.parentElement?.parentElement as HTMLElement | null)?.focus();
              setExpanded(!expanded);
            }}
            style={{ width: 14, display: 'inline-block', textAlign: 'center', marginRight: 4, fontSize: '10px', opacity: 0.6 }}
          >
            {expanded ? '▼' : '▶'}
          </button>
        ) : (
          <span style={{ width: 14, display: 'inline-block', marginRight: 4 }} />
        )}
        <FolderNodeIcon node={node} />
        <span
          className="library-folder-name"
          title={node.path}
          style={{ flex: 1, whiteSpace: 'nowrap' }}
          onClick={(e) => {
            e.stopPropagation();
            (e.currentTarget.parentElement?.parentElement as HTMLElement | null)?.focus();
            onSelect(isActive ? null : node.path);
          }}
        >
          {getFolderNodeLabel(node)}
        </span>
        
        {node.isLibraryRoot && (
           <div className="folder-actions hide-on-idle">
             <button
               type="button"
               tabIndex={-1}
               className="library-folder-remove"
               title="Remove from library"
               aria-label={`Remove ${getFolderNodeLabel(node)} from library`}
               onClick={(e) => { e.stopPropagation(); onRemove(node.path); }}
             >
               ×
             </button>
           </div>
        )}
      </div>
      {expanded && hasChildren && (
        <div className="folder-children" role="group">
          {node.children.map(child => (
            <FolderTreeNode
              key={child.path}
              node={child}
              level={level + 1}
              activeFolder={activeFolder}
              onSelect={onSelect}
              onRemove={onRemove}
              onRescan={onRescan}
             onRefreshThumbnails={onRefreshThumbnails}
              focusedPath={focusedPath}
              onFocusPath={onFocusPath}
            />
          ))}
        </div>
      )}
    </div>
  );
};

function useSidebarResize(
  effectiveWidth: number,
  onPreferredWidthChange: (width: number) => void,
  minWidth = 200,
  maxWidth = 600,
) {
  const sidebarRef = React.useRef<HTMLElement>(null);
  const [isDragging, setIsDragging] = React.useState(false);

  const handleMouseDown = React.useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = sidebarRef.current?.getBoundingClientRect().width ?? effectiveWidth;
    setIsDragging(true);

    const onMouseMove = (ev: MouseEvent) => {
      const delta = ev.clientX - startX;
      if (delta === 0) return;
      const next = Math.max(minWidth, Math.min(maxWidth, startWidth + delta));
      onPreferredWidthChange(next);
    };

    const onMouseUp = () => {
      setIsDragging(false);
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }, [effectiveWidth, onPreferredWidthChange, minWidth, maxWidth]);

  return { sidebarRef, isDragging, handleMouseDown };
}

export const Sidebar: React.FC<Props> = ({
  folders,
  directories,
  collections,
  activeCollectionId,
  stats,
  activeFilter,
  activeFolder,
  onAddFolder,
  onRemoveFolder,
  onFolderSelect,
  onRescanFolder,
  onFilterChange,
  onOpenSettings,
  lightMode,
  onSettingsChange,
  onRefreshFolderThumbnails,
  onCollectionSelect,
  onRemoveCollection,
  effectiveWidth,
  onPreferredWidthChange,
}) => {
  const { sidebarRef, isDragging: sidebarDragging, handleMouseDown: handleSidebarMouseDown } = useSidebarResize(effectiveWidth, onPreferredWidthChange);
  const tree = React.useMemo(() => buildFolderTree(folders, directories), [folders, directories]);
  const folderPaths = React.useMemo(() => {
    const paths: string[] = [];
    const visit = (node: FolderNode) => {
      paths.push(node.path);
      node.children.forEach(visit);
    };
    tree.forEach(visit);
    return paths;
  }, [tree]);
  const [focusedFolderPath, setFocusedFolderPath] = React.useState<string | null>(
    () => activeFolder ?? tree[0]?.path ?? null,
  );
  const previousActiveFolderRef = React.useRef(activeFolder);
  React.useEffect(() => {
    const previousActiveFolder = previousActiveFolderRef.current;
    previousActiveFolderRef.current = activeFolder;
    if (activeFolder !== previousActiveFolder && activeFolder && folderPaths.includes(activeFolder)) {
      setFocusedFolderPath(activeFolder);
      return;
    }
    if (!focusedFolderPath || !folderPaths.includes(focusedFolderPath)) {
      setFocusedFolderPath(activeFolder && folderPaths.includes(activeFolder) ? activeFolder : tree[0]?.path ?? null);
    }
  }, [activeFolder, focusedFolderPath, folderPaths, tree]);
  const filters = [
    { label: "All", ext: null, dataExt: "", count: stats.total, statId: "stat-total" },
    { label: "STL", ext: "stl", dataExt: "stl", count: stats.stl, statId: "stat-stl" },
    { label: "OBJ", ext: "obj", dataExt: "obj", count: stats.obj, statId: "stat-obj" },
    { label: "3MF", ext: "3mf", dataExt: "3mf", count: stats.threemf, statId: "stat-3mf" },
  ];

  return (
    <aside
      id="sidebar"
      ref={sidebarRef}
      style={{ display: "flex", flexDirection: "column", overflow: "hidden", minWidth: effectiveWidth, width: effectiveWidth, flex: `0 0 ${effectiveWidth}px` }}
    >
      <div
        className={`sidebar-resize-handle${sidebarDragging ? " dragging" : ""}`}
        onMouseDown={handleSidebarMouseDown}
      />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
        <div className="sidebar-section" style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, paddingBottom: 0 }}>
          <button
            id="btn-select-folder"
            className="btn-primary"
            style={{ flexShrink: 0 }}
            onClick={onAddFolder}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path
                d="M2 3.5A1.5 1.5 0 013.5 2h2.879a1.5 1.5 0 011.06.44l.622.62a1.5 1.5 0 001.06.44H12.5A1.5 1.5 0 0114 5v7.5a1.5 1.5 0 01-1.5 1.5h-9A1.5 1.5 0 012 12.5v-9z"
                stroke="currentColor"
                strokeWidth="1.5"
                fill="none"
              />
            </svg>
            Add Folder
          </button>
          <div
            id="library-folder-delete-hint"
            className="sr-only"
          >
            With a library root focused, press Delete to remove it from the library. Model files remain on disk.
          </div>
          <div id="library-folders" className="library-folders sidebar-scrollable" role="tree" aria-label="Library folders" style={{ marginTop: 8, flex: 1, overflowY: "auto", overflowX: "auto", paddingBottom: 16 }}>
            {tree.map((node) => (
               <FolderTreeNode
                 key={node.path}
                 node={node}
                 level={0}
                 activeFolder={activeFolder}
                 onSelect={onFolderSelect}
                 onRemove={onRemoveFolder}
                 onRescan={onRescanFolder}
                 onRefreshThumbnails={onRefreshFolderThumbnails}
                 focusedPath={focusedFolderPath}
                 onFocusPath={setFocusedFolderPath}
               />
            ))}
          </div>
        </div>

        <div className="sidebar-section" style={{ flexShrink: 0 }}>
          <h3>Collections</h3>
          <div
            id="collection-list"
            className="sidebar-collections sidebar-scrollable"
          >
            {collections.length > 0 ? (
              collections.map((collection) => (
                <div
                  key={collection.id}
                  className={`collection-item${activeCollectionId === collection.id ? " active" : ""}`}
                >
                  <button
                    type="button"
                    className="collection-item-select"
                    aria-pressed={activeCollectionId === collection.id}
                    onClick={() => onCollectionSelect(activeCollectionId === collection.id ? null : collection.id)}
                  >
                    <span className="collection-name">{collection.name}</span>
                  </button>
                  <button
                    type="button"
                    className="library-folder-remove"
                    aria-label={activeCollectionId === collection.id
                      ? "Clear collection filter"
                      : `Delete collection ${collection.name}`}
                    title={
                      activeCollectionId === collection.id
                        ? "Clear collection filter"
                        : "Delete collection"
                    }
                    onClick={(e) => {
                      e.stopPropagation();
                      if (activeCollectionId === collection.id) {
                        onCollectionSelect(null);
                        return;
                      }
                      if (confirm(`Delete collection "${collection.name}"?`)) {
                        onRemoveCollection(collection.id);
                      }
                    }}
                  >
                    ×
                  </button>
                </div>
              ))
            ) : (
              <div className="sidebar-empty-hint">No collections yet</div>
            )}
          </div>
        </div>

        <div className="sidebar-section" style={{ flexShrink: 0 }}>
          <h3>Format Filter</h3>
          <div className="filter-buttons filter-buttons-stats">
            {filters.map((f) => (
              <button
                type="button"
                key={f.label}
                className={`filter-btn${activeFilter === f.ext ? " active" : ""}`}
                data-ext={f.dataExt}
                aria-pressed={activeFilter === f.ext}
                onClick={() => onFilterChange(f.ext)}
              >
                <span className="filter-label">{f.label}</span>
                <span id={f.statId} className="filter-count">
                  {f.count}
                </span>
              </button>
            ))}
          </div>
          <div className="stat-size">
            <span id="stat-size">{formatSize(stats.totalSize)}</span> total
          </div>
        </div>
      </div>

      <div
        className="sidebar-section"
        style={{
          marginTop: "auto",
          borderTop: "1px solid var(--border-subtle)",
          paddingTop: "12px",
          borderBottom: "none",
        }}
      >
        <div className="sidebar-actions-row">
          <button
            type="button"
            id="btn-theme-toggle"
            className="btn-primary"
            style={{
              background: "transparent",
              border: "1px solid var(--border-default)",
              color: "var(--text-primary)",
            }}
            title="Toggle Light/Dark Mode"
            onClick={() => onSettingsChange({ lightMode: !lightMode })}
          >
            <AppIcon name="theme" />
            {lightMode ? "Dark Mode" : "Light Mode"}
          </button>

          <button
            type="button"
            id="btn-settings"
            className="btn-primary"
            style={{
              background: "transparent",
              border: "1px solid var(--border-default)",
              color: "var(--text-primary)",
            }}
            title="Settings"
            onClick={onOpenSettings}
          >
            <AppIcon name="settings" />
            Settings
          </button>
        </div>
      </div>
    </aside>
  );
};
