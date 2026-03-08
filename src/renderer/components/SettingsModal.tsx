import React from "react";

interface Settings {
  lightMode: boolean;
  gridSize: string;
  autoScan: boolean;
  watch: boolean;
  showGrid: boolean;
  thumbQuality: string;
  accentColor: string;
  thumbnail_timeout: number;
  scanning_batch_size: number;
  watcher_stability: number;
  page_size: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
  settings: Settings;
  onSettingsChange: (newSettings: Partial<Settings>) => void;
}

export const SettingsModal: React.FC<Props> = ({
  open,
  onClose,
  settings,
  onSettingsChange,
}) => {
  const [advancedExpanded, setAdvancedExpanded] = React.useState(false);
  return (
    <div
      id="settings-overlay"
      className={`settings-overlay${open ? "" : " hidden"}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="settings-modal">
        <div className="settings-header">
          <h2>Settings</h2>
          <button
            id="settings-close"
            className="settings-close"
            onClick={onClose}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path
                d="M4 4l8 8M12 4L4 12"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
        <div className="settings-body">
          {/* Appearance */}
          <div className="settings-group">
            <div className="settings-group-title">Appearance</div>
            <div className="settings-row">
              <div>
                <div className="settings-row-label">Light Mode</div>
                <div className="settings-row-desc">Use light color scheme</div>
              </div>
              <label className="toggle-switch">
                <input
                  type="checkbox"
                  id="setting-light-mode"
                  checked={settings.lightMode}
                  onChange={(e) =>
                    onSettingsChange({ lightMode: e.target.checked })
                  }
                />
                <span className="toggle-slider" />
              </label>
            </div>
            <div className="settings-row">
              <div>
                <div className="settings-row-label">Accent Color</div>
                <div className="settings-row-desc">UI highlight and default 3D material color</div>
              </div>
              <input
                type="color"
                className="color-picker"
                id="setting-accent-color"
                value={settings.accentColor || "#6d9fff"}
                onChange={(e) => onSettingsChange({ accentColor: e.target.value })}
              />
            </div>
            <div className="settings-row">
              <div>
                <div className="settings-row-label">Grid Size</div>
                <div className="settings-row-desc">
                  Card size in the file grid
                </div>
              </div>
              <select
                id="setting-grid-size"
                value={settings.gridSize}
                onChange={(e) => onSettingsChange({ gridSize: e.target.value })}
              >
                <option value="small">Small</option>
                <option value="medium">Medium</option>
                <option value="large">Large</option>
              </select>
            </div>
          </div>

          {/* Scanning */}
          <div className="settings-group">
            <div className="settings-group-title">Scanning</div>
            <div className="settings-row">
              <div>
                <div className="settings-row-label">Auto-scan on startup</div>
                <div className="settings-row-desc">
                  Rescan library folders when app opens
                </div>
              </div>
              <label className="toggle-switch">
                <input
                  type="checkbox"
                  id="setting-auto-scan"
                  checked={settings.autoScan}
                  onChange={(e) =>
                    onSettingsChange({ autoScan: e.target.checked })
                  }
                />
                <span className="toggle-slider" />
              </label>
            </div>
            <div className="settings-row">
              <div>
                <div className="settings-row-label">Watch for file changes</div>
                <div className="settings-row-desc">
                  Auto-detect new/modified files
                </div>
              </div>
              <label className="toggle-switch">
                <input
                  type="checkbox"
                  id="setting-watch"
                  checked={settings.watch}
                  onChange={(e) =>
                    onSettingsChange({ watch: e.target.checked })
                  }
                />
                <span className="toggle-slider" />
              </label>
            </div>
          </div>

          {/* 3D Viewer */}
          <div className="settings-group">
            <div className="settings-group-title">3D Viewer</div>
            <div className="settings-row">
              <div>
                <div className="settings-row-label">Show grid</div>
                <div className="settings-row-desc">
                  Display floor grid in the viewer
                </div>
              </div>
              <label className="toggle-switch">
                <input
                  type="checkbox"
                  id="setting-show-grid"
                  checked={settings.showGrid}
                  onChange={(e) =>
                    onSettingsChange({ showGrid: e.target.checked })
                  }
                />
                <span className="toggle-slider" />
              </label>
            </div>
            <div className="settings-row">
              <div>
                <div className="settings-row-label">Thumbnail quality</div>
                <div className="settings-row-desc">
                  Resolution for generated thumbnails
                </div>
              </div>
              <select
                id="setting-thumb-quality"
                value={settings.thumbQuality}
                onChange={(e) =>
                  onSettingsChange({ thumbQuality: e.target.value })
                }
              >
                <option value="128">Low (128px)</option>
                <option value="256">Medium (256px)</option>
                <option value="512">High (512px)</option>
              </select>
            </div>
          </div>

          {/* Advanced */}
          <div className="settings-group">
            <div 
              className="settings-group-title advanced-toggle" 
              onClick={() => setAdvancedExpanded(!advancedExpanded)}
              style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}
            >
              Advanced
              <span style={{ 
                fontSize: '10px', 
                transition: 'transform 0.2s',
                transform: advancedExpanded ? 'rotate(90deg)' : 'rotate(0deg)' 
              }}>▶</span>
            </div>
            
            {advancedExpanded && (
              <>
                <div className="settings-row">
                  <div>
                    <div className="settings-row-label">Thumbnail Timeout (ms)</div>
                    <div className="settings-row-desc">
                      Max time to wait for a 3D render. Increase for very large models.
                    </div>
                  </div>
                  <input
                    type="number"
                    id="setting-thumbnail-timeout"
                    value={settings.thumbnail_timeout || 20000}
                    style={{ width: '80px' }}
                    onChange={(e) => onSettingsChange({ thumbnail_timeout: parseInt(e.target.value) || 20000 })}
                  />
                </div>

                <div className="settings-row">
                  <div>
                    <div className="settings-row-label">Scanning Batch Size</div>
                    <div className="settings-row-desc">
                      Files to index before yielding. High values may freeze the UI.
                    </div>
                  </div>
                  <input
                    type="number"
                    id="setting-batch-size"
                    value={settings.scanning_batch_size || 50}
                    style={{ width: '80px' }}
                    onChange={(e) => onSettingsChange({ scanning_batch_size: parseInt(e.target.value) || 50 })}
                  />
                </div>

                <div className="settings-row">
                  <div>
                    <div className="settings-row-label">Watcher Stability (ms)</div>
                    <div className="settings-row-desc">
                      Delay before responding to file changes (prevents partial reads).
                    </div>
                  </div>
                  <input
                    type="number"
                    id="setting-watcher-stability"
                    value={settings.watcher_stability || 1000}
                    style={{ width: '80px' }}
                    onChange={(e) => onSettingsChange({ watcher_stability: parseInt(e.target.value) || 1000 })}
                  />
                </div>

                <div className="settings-row">
                  <div>
                    <div className="settings-row-label">Grid Page Size</div>
                    <div className="settings-row-desc">
                      Number of files to load at once. Lower values improve scroll performance.
                    </div>
                  </div>
                  <input
                    type="number"
                    id="setting-page-size"
                    value={settings.page_size || 500}
                    style={{ width: '80px' }}
                    onChange={(e) => onSettingsChange({ page_size: parseInt(e.target.value) || 500 })}
                  />
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
