import React, { useState, useRef } from "react";
import { AppIcon } from "./AppIcon";

interface Props {
  sort: string;
  order: "ASC" | "DESC";
  search: string;
  activeFolderLabel: string | null;
  activeFilter: string | null;
  resultCount: number;
  onSortChange: (sort: string) => void;
  onOrderToggle: () => void;
  onSearch: (query: string) => void;
  onRescan: () => void;
  onClearThumbnails: () => void;
}

export const Toolbar: React.FC<Props> = ({
  sort,
  order,
  search,
  activeFolderLabel,
  activeFilter,
  resultCount,
  onSortChange,
  onOrderToggle,
  onSearch,
  onRescan,
  onClearThumbnails,
}) => {
  const [searchValue, setSearchValue] = useState(search);
  const debounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const handleInput = (val: string) => {
    setSearchValue(val);
    clearTimeout(debounce.current);
    debounce.current = setTimeout(() => onSearch(val.trim()), 200);
  };

  const clearSearch = () => {
    setSearchValue("");
    onSearch("");
  };

  const contextChips = [
    {
      key: "scope",
      label: activeFolderLabel ? `Folder: ${activeFolderLabel}` : "All Models",
      tone: "neutral",
    },
    ...(activeFilter
      ? [
          {
            key: "filter",
            label: activeFilter.toUpperCase(),
            tone:
              activeFilter.toLowerCase() === "3mf"
                ? "threemf"
                : activeFilter.toLowerCase(),
          },
        ]
      : []),
    ...(search
      ? [
          {
            key: "search",
            label: `Search: "${search}"`,
            tone: "neutral",
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
            value={searchValue}
            onChange={(e) => handleInput(e.target.value)}
          />
          <button
            id="search-clear"
            className={`search-clear${searchValue ? "" : " hidden"}`}
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
          </span>
        ))}
      </div>
    </div>
  );
};
