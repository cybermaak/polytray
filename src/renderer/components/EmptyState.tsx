import React from "react";

export const EmptyState: React.FC<{ hidden: boolean }> = ({ hidden }) => (
  <div id="empty-state" className={`empty-state${hidden ? " hidden" : ""}`}>
    <div className="empty-icon">
      <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
        <path
          d="M8 16a8 8 0 018-8h11.51a8 8 0 015.657 2.343l2.49 2.49A8 8 0 0041.314 15H48a8 8 0 018 8v25a8 8 0 01-8 8H16a8 8 0 01-8-8V16z"
          stroke="currentColor"
          strokeWidth="2"
          opacity="0.3"
        />
        <path
          d="M24 36h16M32 28v16"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          opacity="0.3"
        />
      </svg>
    </div>
    <h2>No models in view</h2>
    <p>
      Add a library folder or adjust your search and filters to browse `.stl`, `.obj`, and `.3mf` files.
    </p>
  </div>
);
