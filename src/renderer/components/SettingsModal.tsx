import React from "react";

interface Settings {
  lightMode: boolean;
  gridSize: string;
  autoScan: boolean;
  watch: boolean;
  showGrid: boolean;
  thumbQuality: string;
  accentColor: string;
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
        </div>
      </div>
    </div>
  );
};
