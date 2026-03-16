import React from "react";
import {
  applySettingsPreset,
  DEFAULT_APP_SETTINGS,
  type AppSettings,
  type SettingsPreset,
} from "../../shared/settings";

interface Props {
  open: boolean;
  onClose: () => void;
  settings: AppSettings;
  onSettingsChange: (newSettings: Partial<AppSettings>) => void;
}

export const SettingsModal: React.FC<Props> = ({
  open,
  onClose,
  settings,
  onSettingsChange,
}) => {
  const [advancedExpanded, setAdvancedExpanded] = React.useState(false);
  const renderColorSetting = (
    id: string,
    label: string,
    description: string,
    value: string,
    settingKey: keyof Pick<
      AppSettings,
      "accentColor" | "previewColor" | "thumbnailColor"
    >,
    resetId: string,
  ) => (
    <div className="settings-row">
      <div>
        <div className="settings-row-label">{label}</div>
        <div className="settings-row-desc">{description}</div>
      </div>
      <div className="settings-color-actions">
        <input
          type="color"
          className="color-picker"
          id={id}
          value={value}
          onChange={(e) => onSettingsChange({ [settingKey]: e.target.value })}
        />
        <button
          type="button"
          id={resetId}
          className="settings-reset-btn"
          onClick={() =>
            onSettingsChange({
              [settingKey]: DEFAULT_APP_SETTINGS[settingKey],
            })
          }
        >
          Reset
        </button>
      </div>
    </div>
  );

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
            {renderColorSetting(
              "setting-accent-color",
              "Accent Color",
              "UI highlight color for selected and interactive states",
              settings.accentColor || DEFAULT_APP_SETTINGS.accentColor,
              "accentColor",
              "reset-accent-color",
            )}
            {renderColorSetting(
              "setting-preview-color",
              "Preview Color",
              "Default 3D material color for the interactive viewer",
              settings.previewColor || DEFAULT_APP_SETTINGS.previewColor,
              "previewColor",
              "reset-preview-color",
            )}
            {renderColorSetting(
              "setting-thumbnail-color",
              "Thumbnail Color",
              "Default 3D material color used for generated thumbnails",
              settings.thumbnailColor || DEFAULT_APP_SETTINGS.thumbnailColor,
              "thumbnailColor",
              "reset-thumbnail-color",
            )}
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
                onChange={(e) =>
                  onSettingsChange({
                    gridSize: e.target.value as AppSettings["gridSize"],
                  })
                }
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
                  onSettingsChange({
                    thumbQuality: e.target.value as AppSettings["thumbQuality"],
                  })
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
                    <div className="settings-row-label">Advanced Preset</div>
                    <div className="settings-row-desc">
                      Apply a tuned bundle for balanced, speed-focused, or fidelity-focused behavior.
                    </div>
                  </div>
                  <select
                    id="apply-settings-preset"
                    defaultValue=""
                    onChange={(e) => {
                      const preset = e.target.value as SettingsPreset | "";
                      if (!preset) return;
                      onSettingsChange(applySettingsPreset(settings, preset));
                    }}
                  >
                    <option value="">Choose preset…</option>
                    <option value="balanced">Balanced</option>
                    <option value="performance">Performance</option>
                    <option value="fidelity">Fidelity</option>
                  </select>
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

                <div className="settings-row">
                  <div>
                    <div className="settings-row-label">Reset Advanced</div>
                    <div className="settings-row-desc">
                      Restore advanced tuning values without changing appearance or scan/watch toggles.
                    </div>
                  </div>
                  <button
                    type="button"
                    id="reset-advanced-settings"
                    className="settings-reset-btn"
                    onClick={() =>
                      onSettingsChange({
                        thumbnail_timeout: DEFAULT_APP_SETTINGS.thumbnail_timeout,
                        scanning_batch_size: DEFAULT_APP_SETTINGS.scanning_batch_size,
                        watcher_stability: DEFAULT_APP_SETTINGS.watcher_stability,
                        page_size: DEFAULT_APP_SETTINGS.page_size,
                        thumbQuality: DEFAULT_APP_SETTINGS.thumbQuality,
                      })
                    }
                  >
                    Reset Advanced
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
