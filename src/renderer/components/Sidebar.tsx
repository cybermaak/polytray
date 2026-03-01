import React from "react";
import { formatSize } from "../lib/formatters";

interface Props {
  folders: string[];
  stats: {
    total: number;
    stl: number;
    obj: number;
    threemf: number;
    totalSize: number;
  };
  activeFilter: string | null;
  onAddFolder: () => void;
  onRemoveFolder: (path: string) => void;
  onFilterChange: (ext: string | null) => void;
  onOpenSettings: () => void;
}

export const Sidebar: React.FC<Props> = ({
  folders,
  stats,
  activeFilter,
  onAddFolder,
  onRemoveFolder,
  onFilterChange,
  onOpenSettings,
}) => {
  const filters = [
    { label: "All", ext: null, dataExt: "" },
    { label: "STL", ext: "stl", dataExt: "stl" },
    { label: "OBJ", ext: "obj", dataExt: "obj" },
    { label: "3MF", ext: "3mf", dataExt: "3mf" },
  ];

  return (
    <aside id="sidebar" style={{ display: "flex", flexDirection: "column" }}>
      <div style={{ flex: 1, overflowY: "auto" }}>
        <div className="sidebar-section">
          <button
            id="btn-select-folder"
            className="btn-primary"
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
          <ul id="library-folders" className="library-folders">
            {folders.map((folder) => {
              const parts = folder.split("/");
              const displayName = parts[parts.length - 1] || folder;
              return (
                <li key={folder} className="library-folder-item">
                  <span style={{ fontSize: "12px" }}>📁</span>
                  <span className="library-folder-name" title={folder}>
                    {displayName}
                  </span>
                  <button
                    className="library-folder-remove"
                    title="Remove from library"
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemoveFolder(folder);
                    }}
                  >
                    ×
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="sidebar-section sidebar-stats">
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

        <div className="sidebar-section">
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

      {/* Settings at the bottom of the sidebar */}
      <div
        className="sidebar-section"
        style={{
          borderTop: "1px solid var(--border-subtle)",
          paddingTop: "16px",
          marginTop: "auto",
          marginBottom: 0,
        }}
      >
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
