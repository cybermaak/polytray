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
}) => {
  if (selectedCount === 0) {
    return null;
  }

  return (
    <div id="batch-actions" className="batch-actions">
      <span id="batch-selection-count" className="context-chip neutral">
        {selectedCount} selected
      </span>
      <input
        id="batch-tags-input"
        type="text"
        value={batchTagsInput}
        placeholder="Add tags to selection"
        onChange={(e) => onBatchTagsInputChange(e.target.value)}
      />
      <button
        id="apply-batch-tags"
        className="btn-icon"
        onClick={onApplyBatchTags}
      >
        Apply Tags
      </button>
      <select
        id="batch-collection-select"
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
        id="batch-add-to-collection"
        className="btn-icon"
        onClick={onAddToCollection}
      >
        Add to Collection
      </button>
      {canCompare && (
        <button id="compare-selected" className="btn-icon" onClick={onCompare}>
          Compare
        </button>
      )}
      <button id="clear-batch-selection" className="btn-icon" onClick={onClear}>
        Clear
      </button>
    </div>
  );
};
