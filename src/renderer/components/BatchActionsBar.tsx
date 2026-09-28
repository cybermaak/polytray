import React from "react";
import type { CollectionRecord } from "../../shared/libraryCollections";

interface Props {
  selectedCount: number;
  batchTagsInput: string;
  batchCollectionId: string;
  collections: CollectionRecord[];
  canCompare: boolean;
  onBatchTagsInputChange: (value: string) => void;
  onBatchCollectionChange: (value: string) => void;
  onApplyBatchTags: () => void;
  onAddToCollection: () => void;
  onCompare: () => void;
  onClear: () => void;
  selectionAnnouncement: string;
}

export const BatchActionsBar: React.FC<Props> = ({
  selectedCount,
  batchTagsInput,
  batchCollectionId,
  collections,
  canCompare,
  onBatchTagsInputChange,
  onBatchCollectionChange,
  onApplyBatchTags,
  onAddToCollection,
  onCompare,
  onClear,
  selectionAnnouncement,
}) => {
  const [liveMessage, setLiveMessage] = React.useState("");
  React.useEffect(() => {
    if (!selectionAnnouncement && selectedCount === 0) {
      setLiveMessage("");
      return;
    }
    const timeout = window.setTimeout(() => {
      setLiveMessage(selectionAnnouncement || (selectedCount ? `${selectedCount} files selected` : "Selection cleared"));
    }, 180);
    return () => window.clearTimeout(timeout);
  }, [selectedCount, selectionAnnouncement]);

  return (
    <>
      {selectedCount > 0 && (
        <div id="batch-actions" className="batch-actions" role="group" aria-label="Batch actions">
          <span id="batch-selection-count" className="context-chip neutral">
            {selectedCount} selected
          </span>
          <input
            id="batch-tags-input"
            type="text"
            aria-label="Tags to add to selected files"
            value={batchTagsInput}
            placeholder="Add tags to selection"
            onChange={(e) => onBatchTagsInputChange(e.target.value)}
          />
          <button
            type="button"
            id="apply-batch-tags"
            className="btn-secondary batch-action-button"
            onClick={onApplyBatchTags}
          >
            Apply Tags
          </button>
          <select
            id="batch-collection-select"
            aria-label="Collection to add selected files to"
            value={batchCollectionId}
            onChange={(e) => onBatchCollectionChange(e.target.value)}
          >
            <option value="">Add to collection…</option>
            {collections.map((collection) => (
              <option key={collection.id} value={collection.id}>
                {collection.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            id="batch-add-to-collection"
            className="btn-secondary batch-action-button"
            onClick={onAddToCollection}
          >
            Add to Collection
          </button>
          {canCompare && (
            <button
              type="button"
              id="compare-selected"
              className="btn-secondary batch-action-button"
              onClick={onCompare}
            >
              Compare
            </button>
          )}
          <button
            type="button"
            id="clear-batch-selection"
            className="btn-secondary batch-action-button"
            onClick={onClear}
          >
            Clear
          </button>
        </div>
      )}
      <div
        role="status"
        aria-live="polite"
        style={{ position: "absolute", width: 1, height: 1, padding: 0, margin: -1, overflow: "hidden", clip: "rect(0, 0, 0, 0)", whiteSpace: "nowrap", border: 0 }}
      >
        {liveMessage}
      </div>
    </>
  );
};
