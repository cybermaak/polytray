import React, { useState, useRef } from "react";

interface Props {
  sort: string;
  order: "ASC" | "DESC";
  search: string;
  onSortChange: (sort: string) => void;
  onOrderToggle: () => void;
  onSearch: (query: string) => void;
  onRescan: () => void;
  onClearThumbnails: () => void;
  lightMode: boolean;
  onSettingsChange: (settings: any) => void;
}

export const Toolbar: React.FC<Props> = ({
  sort,
  order,
  search,
  onSortChange,
  onOrderToggle,
  onSearch,
  onRescan,
  onClearThumbnails,
  lightMode,
  onSettingsChange,
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

  const handleThemeToggle = () => {
    onSettingsChange({ lightMode: !lightMode });
  };

  return (
    <div id="toolbar">
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
        <button
          id="btn-theme-toggle"
          className="btn-icon"
          title="Toggle Light/Dark Mode"
          onClick={handleThemeToggle}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path
              d="M8 12a4 4 0 100-8 4 4 0 000 8zM8 2V1M8 15v-1M2 8H1M15 8h-1M3.75 3.75L3 3M13 13l-.75-.75M3.75 12.25L3 13M13 3l-.75.75"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>

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
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path
              d="M4 6l4-4 4 4M4 10l4 4 4-4"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>

        <button
          id="btn-rescan"
          className="btn-icon"
          title="Rescan folders"
          onClick={onRescan}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path
              d="M13.5 8a5.5 5.5 0 01-9.23 4.05M2.5 8a5.5 5.5 0 019.23-4.05"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
            <path
              d="M13.5 3v5h-5M2.5 13V8h5"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>

        <button
          id="btn-clear-thumbnails"
          className="btn-icon"
          title="Regenerate Thumbnails"
          onClick={onClearThumbnails}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <rect
              x="2"
              y="3"
              width="12"
              height="10"
              rx="1.5"
              stroke="currentColor"
              strokeWidth="1.5"
              fill="none"
            />
            <circle cx="5.5" cy="6.5" r="1" fill="currentColor" />
            <path
              d="M2 11l3.5-3 2.5 2 2.5-3L14 11"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>
    </div>
  );
};
