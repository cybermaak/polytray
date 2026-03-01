import React, { useEffect } from "react";

interface Props {
  open: boolean;
  onClose: () => void;
}

export const SettingsModal: React.FC<Props> = ({ open, onClose }) => {
  // Load/save settings via localStorage (same as vanilla version)
  useEffect(() => {
    try {
      const raw = localStorage.getItem("polytray-settings");
      if (!raw) return;
      const s = JSON.parse(raw);
      if (s.lightMode) document.body.classList.add("light");
      if (s.gridSize) {
        const el = document.getElementById(
          "setting-grid-size",
        ) as HTMLSelectElement;
        if (el) el.value = s.gridSize;
      }
    } catch {}
  }, []);

  const handleLightModeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    document.body.classList.toggle("light", e.target.checked);
    saveSettings();
  };

  const handleGridSizeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const grid = document.getElementById("file-grid");
    if (grid) {
      switch (e.target.value) {
        case "small":
          grid.style.gridTemplateColumns =
            "repeat(auto-fill, minmax(160px, 1fr))";
          break;
        case "large":
          grid.style.gridTemplateColumns =
            "repeat(auto-fill, minmax(260px, 1fr))";
          break;
        default:
          grid.style.gridTemplateColumns =
            "repeat(auto-fill, minmax(200px, 1fr))";
      }
    }
    saveSettings();
  };

  const saveSettings = () => {
    const lightMode =
      (document.getElementById("setting-light-mode") as HTMLInputElement)
        ?.checked ?? false;
    const gridSize =
      (document.getElementById("setting-grid-size") as HTMLSelectElement)
        ?.value ?? "medium";
    localStorage.setItem(
      "polytray-settings",
      JSON.stringify({ lightMode, gridSize }),
    );
  };

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
                  onChange={handleLightModeChange}
                />
                <span className="toggle-slider" />
              </label>
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
                onChange={handleGridSizeChange}
                defaultValue="medium"
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
                <input type="checkbox" id="setting-auto-scan" defaultChecked />
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
                <input type="checkbox" id="setting-watch" defaultChecked />
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
                <input type="checkbox" id="setting-show-grid" defaultChecked />
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
              <select id="setting-thumb-quality" defaultValue="256">
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
