import React, { useEffect } from "react";
import { AppIcon } from "./AppIcon";

interface Props {
  sort: string;
  order: "ASC" | "DESC";
  search: string;
  searchDraft: string;
  activeFolderLabel: string | null;
  activeCollectionLabel: string | null;
  activeFilter: string | null;
  resultCount: number;
  onSortChange: (sort: string) => void;
  onOrderToggle: () => void;
  onSearch: (query: string) => void;
  onSearchDraftChange: (query: string) => void;
  onRescan: () => void;
  onClearThumbnails: () => void;
  onDismissFolder: () => void;
  onDismissCollection: () => void;
  onDismissFilter: () => void;
  onDismissSearch: () => void;
}

export const Toolbar: React.FC<Props> = ({
  sort,
  order,
  search,
  searchDraft,
  activeFolderLabel,
  activeCollectionLabel,
  activeFilter,
  resultCount,
  onSortChange,
  onOrderToggle,
  onSearch,
  onSearchDraftChange,
  onRescan,
  onClearThumbnails,
  onDismissFolder,
  onDismissCollection,
  onDismissFilter,
  onDismissSearch,
}) => {
  useEffect(() => {
    if (searchDraft === search) return;
    const timeout = setTimeout(() => onSearch(searchDraft.trim()), 200);
    return () => clearTimeout(timeout);
  }, [onSearch, search, searchDraft]);

  const clearSearch = () => {
    onSearchDraftChange("");
    onSearch("");
  };

  const contextChips: {
    key: string;
    label: string;
    tone: string;
    onDismiss?: () => void;
  }[] = [
    {
      key: "scope",
      label: activeFolderLabel ? `Folder: ${activeFolderLabel}` : "All Models",
      tone: "neutral",
      onDismiss: activeFolderLabel ? onDismissFolder : undefined,
    },
    ...(activeCollectionLabel
      ? [
          {
            key: "collection",
            label: `Collection: ${activeCollectionLabel}`,
            tone: "neutral",
            onDismiss: onDismissCollection,
          },
        ]
      : []),
    ...(activeFilter
      ? [
          {
            key: "filter",
            label: activeFilter.toUpperCase(),
            tone:
              activeFilter.toLowerCase() === "3mf"
                ? "threemf"
                : activeFilter.toLowerCase(),
            onDismiss: onDismissFilter,
          },
        ]
      : []),
    ...(search
      ? [
          {
            key: "search",
            label: `Search: "${search}"`,
            tone: "neutral",
            onDismiss: onDismissSearch,
          },
        ]
      : []),
    {
      key: "results",
      label: `${resultCount} results`,
      tone: "muted",
    },
  ];

  return (
    <div id="toolbar">
      <div className="toolbar-main">
        <div className="search-wrapper">
        <svg
          className="search-icon"
          width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
          >
            <circle
              cx="6.5"
              cy="6.5"
              r="5"
              stroke="currentColor"
              strokeWidth="1.5"
            />
            <path
              d="M10.5 10.5L15 15"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
          <input
            type="text"
            id="search-input"
            placeholder="Search files..."
            autoComplete="off"
            value={searchDraft}
            onChange={(e) => onSearchDraftChange(e.target.value)}
          />
          <button
            id="search-clear"
            className={`search-clear${searchDraft ? "" : " hidden"}`}
            onClick={clearSearch}
          >
            ×
          </button>
        </div>

        <div className="toolbar-controls">
          <select
            id="sort-select"
            value={sort}
            onChange={(e) => onSortChange(e.target.value)}
          >
            <option value="name">Name</option>
            <option value="size">Size</option>
            <option value="date">Date</option>
            <option value="vertices">Vertices</option>
            <option value="faces">Faces</option>
          </select>

        <button
          id="sort-order"
            className={`btn-icon${order === "DESC" ? " desc" : ""}`}
            title="Toggle sort order"
            onClick={onOrderToggle}
        >
          <AppIcon name="sortOrder" />
        </button>

          <button
            id="btn-rescan"
            className="btn-icon"
            title="Rescan folders"
            onClick={onRescan}
        >
          <AppIcon name="rescan" />
        </button>

          <button
            id="btn-clear-thumbnails"
            className="btn-icon"
            title="Regenerate Thumbnails"
            onClick={onClearThumbnails}
        >
          <AppIcon name="thumbnailRefresh" />
        </button>
        </div>
      </div>

      <div id="toolbar-context">
        {contextChips.map((chip) => (
          <span
            key={chip.key}
            className={`context-chip ${chip.tone}`}
          >
            {chip.label}
            {chip.onDismiss && (
              <button
                className="context-chip-dismiss"
                onClick={chip.onDismiss}
                title={`Remove ${chip.key} filter`}
              >
                ×
              </button>
            )}
          </span>
        ))}
      </div>
    </div>
  );
};
