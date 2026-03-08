import React from "react";
import { formatSize } from "../lib/formatters";

interface Props {
  folders: string[];
  directories: string[];
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
  onSettingsChange: (settings: Record<string, boolean | string>) => void;
  onRefreshFolderThumbnails: (folder: string) => void;
}

interface FolderNode {
  path: string;
  name: string;
  isLibraryRoot: boolean;
  children: FolderNode[];
}

function buildFolderTree(roots: string[], directories: string[]): FolderNode[] {
  const allPaths = Array.from(new Set([...roots, ...directories])).sort();
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
  const [expanded, setExpanded] = React.useState(true);
  const hasChildren = node.children.length > 0;
  const isActive = activeFolder === node.path;

  return (
    <div className="folder-tree-node">
      <div 
        className={`library-folder-item ${isActive ? 'active' : ''}`}
        style={{ paddingLeft: `${level * 12 + 8}px`, cursor: 'pointer' }}
        onClick={(e) => {
          // If clicking exactly on the toggle, don't select
          if ((e.target as HTMLElement).classList.contains('folder-toggle')) return;
          onSelect(isActive ? null : node.path);
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
        <span className="library-folder-name" title={node.path} style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {node.name}
        </span>
        
        <div className="folder-actions hide-on-idle">
          <button
            className="library-folder-remove"
            title="Refresh thumbnails"
            onClick={(e) => { e.stopPropagation(); onRefreshThumbnails(node.path); }}
          >
            🖼️
          </button>
          <button
            className="library-folder-remove"
            title="Rescan folder"
            onClick={(e) => { e.stopPropagation(); onRescan(node.path); }}
          >
            ↻
          </button>
          
          {node.isLibraryRoot && (
            <button
              className="library-folder-remove"
              title="Remove from library"
              onClick={(e) => { e.stopPropagation(); onRemove(node.path); }}
            >
              ×
            </button>
          )}
        </div>
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
}) => {
  const tree = React.useMemo(() => buildFolderTree(folders, directories), [folders, directories]);
  const filters = [
    { label: "All", ext: null, dataExt: "" },
    { label: "STL", ext: "stl", dataExt: "stl" },
    { label: "OBJ", ext: "obj", dataExt: "obj" },
    { label: "3MF", ext: "3mf", dataExt: "3mf" },
  ];

  return (
    <aside id="sidebar" style={{ display: "flex", flexDirection: "column", overflow: "hidden" }}>
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
          <div id="library-folders" className="library-folders sidebar-scrollable" style={{ marginTop: 8, flex: 1, overflowY: "auto", paddingBottom: 16 }}>
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
        <button
          id="btn-theme-toggle"
          className="btn-primary"
          style={{
            background: "transparent",
            border: "1px solid var(--border-default)",
            color: "var(--text-primary)",
            marginBottom: "8px",
          }}
          title="Toggle Light/Dark Mode"
          onClick={() => onSettingsChange({ lightMode: !lightMode })}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            style={{ marginRight: "8px" }}
          >
            <path
              d="M8 12a4 4 0 100-8 4 4 0 000 8zM8 2V1M8 15v-1M2 8H1M15 8h-1M3.75 3.75L3 3M13 13l-.75-.75M3.75 12.25L3 13M13 3l-.75.75"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
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
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            style={{ marginRight: "8px" }}
          >
            <path
              d="M6.86 2h2.28l.32 1.6a5.5 5.5 0 011.32.77l1.55-.52.94 1.62-1.24 1.08a5.5 5.5 0 010 1.54l1.24 1.08-.94 1.62-1.55-.52a5.5 5.5 0 01-1.32.77L9.14 14H6.86l-.32-1.6a5.5 5.5 0 01-1.32-.77l-1.55.52-.94-1.62 1.24-1.08a5.5 5.5 0 010-1.54L2.73 6.83l.94-1.62 1.55.52a5.5 5.5 0 011.32-.77L6.86 2z"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinejoin="round"
            />
            <circle
              cx="8"
              cy="8"
              r="2"
              stroke="currentColor"
              strokeWidth="1.3"
            />
          </svg>
          Settings
        </button>
      </div>
    </aside>
  );
};
