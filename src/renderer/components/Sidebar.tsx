import React from "react";
import { formatSize } from "../lib/formatters";
import type { AppSettings } from "../../shared/settings";
import type { CollectionRecord } from "../../shared/libraryCollections";
import { AppIcon } from "./AppIcon";

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
}

interface FolderNode {
  path: string;
  name: string;
  isLibraryRoot: boolean;
  children: FolderNode[];
}

function buildFolderTree(roots: string[], directories: string[]): FolderNode[] {
  const pathSet = new Set([...roots, ...directories]);
  
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
  
  for (const p of nodeMap.keys()) {
    const isWin = p.includes('\\');
    const sep = isWin ? '\\' : '/';
    const node = nodeMap.get(p)!;
    
    let parentNode: FolderNode | null = null;
    let current = p;
    while(current.length > 0) {
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
}> = ({ node, level, activeFolder, onSelect, onRemove, onRescan, onRefreshThumbnails }) => {
  const [expanded, setExpanded] = React.useState(false);
  const hasChildren = node.children.length > 0;
  const isActive = activeFolder === node.path;

  return (
    <div className="folder-tree-node">
      <div 
        className={`library-folder-item ${isActive ? 'active' : ''}`}
        style={{ paddingLeft: `${level * 12 + 8}px`, cursor: 'pointer' }}
        onClick={(e) => {
          if ((e.target as HTMLElement).classList.contains('folder-toggle')) return;
          onSelect(isActive ? null : node.path);
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          window.polytray.showFolderContextMenu(node.path);
        }}
      >
        {hasChildren ? (
          <span 
            className="folder-toggle" 
            onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
            style={{ width: 14, display: 'inline-block', textAlign: 'center', marginRight: 4, fontSize: '10px', opacity: 0.6 }}
          >
            {expanded ? '▼' : '▶'}
          </span>
        ) : (
          <span style={{ width: 14, display: 'inline-block', marginRight: 4 }} />
        )}
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
        <span className="library-folder-name" title={node.path} style={{ flex: 1, whiteSpace: 'nowrap' }}>
          {node.name}
        </span>
        
        {node.isLibraryRoot && (
           <div className="folder-actions hide-on-idle">
             <button
               className="library-folder-remove"
               title="Remove from library"
               onClick={(e) => { e.stopPropagation(); onRemove(node.path); }}
             >
               ×
             </button>
           </div>
        )}
      </div>
      
      {expanded && hasChildren && (
        <div className="folder-children">
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
            />
          ))}
        </div>
      )}
    </div>
  );
};

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
}) => {
  const tree = React.useMemo(() => buildFolderTree(folders, directories), [folders, directories]);
  const filters = [
    { label: "All", ext: null, dataExt: "" },
    { label: "STL", ext: "stl", dataExt: "stl" },
    { label: "OBJ", ext: "obj", dataExt: "obj" },
    { label: "3MF", ext: "3mf", dataExt: "3mf" },
  ];

  return (
    <aside id="sidebar" style={{ display: "flex", flexDirection: "column", overflow: "hidden", resize: "horizontal", minWidth: 220, maxWidth: "50vw" }}>
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
          <div id="library-folders" className="library-folders sidebar-scrollable" style={{ marginTop: 8, flex: 1, overflowY: "auto", overflowX: "auto", paddingBottom: 16 }}>
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
                  onClick={() =>
                    onCollectionSelect(
                      activeCollectionId === collection.id ? null : collection.id,
                    )
                  }
                >
                  <span className="collection-name">{collection.name}</span>
                  <button
                    className="library-folder-remove"
                    title="Remove collection"
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemoveCollection(collection.id);
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
          <div className="filter-buttons">
            {filters.map((f) => (
              <button
                key={f.label}
                className={`filter-btn${activeFilter === f.ext ? " active" : ""}`}
                data-ext={f.dataExt}
                onClick={() => onFilterChange(f.ext)}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        <div className="sidebar-section sidebar-stats" style={{ flexShrink: 0 }}>
          <h3>Library</h3>
          <div className="stat-grid">
            <div className="stat-item">
              <span className="stat-value" id="stat-total">
                {stats.total}
              </span>
              <span className="stat-label">Total</span>
            </div>
            <div className="stat-item stat-stl">
              <span className="stat-value" id="stat-stl">
                {stats.stl}
              </span>
              <span className="stat-label">STL</span>
            </div>
            <div className="stat-item stat-obj">
              <span className="stat-value" id="stat-obj">
                {stats.obj}
              </span>
              <span className="stat-label">OBJ</span>
            </div>
            <div className="stat-item stat-3mf">
              <span className="stat-value" id="stat-3mf">
                {stats.threemf}
              </span>
              <span className="stat-label">3MF</span>
            </div>
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
