import React from "react";
import type { AppSettings } from "../../shared/settings";
import type { SlicerConfiguration } from "../../shared/types";

interface Props {
  configuration: AppSettings["slicerConfiguration"];
  onChange: (configuration: SlicerConfiguration) => void;
}

export const SlicerSettings: React.FC<Props> = ({ configuration, onChange }) => (
  <section className="settings-group" aria-labelledby="slicer-settings-title">
    <div className="settings-group-title" id="slicer-settings-title">Slicer</div>
    <p className="settings-row-desc">Choose an application for models you explicitly open in a slicer.</p>
    <div className="settings-row">
      <span>{configuration?.useSystemDefault ? "System default application" : configuration?.applicationPath ? `Using ${configuration.applicationPath.split(/[\\/]/).pop()}` : "No slicer selected"}</span>
      <button type="button" id="pick-slicer-application" onClick={async () => {
        const selected = await window.polytray.pickSlicerApplication();
        if (selected) onChange(selected);
      }}>Choose application…</button>
    </div>
    <label className="settings-row">
      <span>Use the system default for model files</span>
      <input type="checkbox" id="slicer-use-system-default" checked={configuration?.useSystemDefault ?? false}
        onChange={event => onChange(event.currentTarget.checked
          ? { applicationPath: null, useSystemDefault: true }
          : { applicationPath: configuration?.applicationPath ?? null, useSystemDefault: false })} />
    </label>
  </section>
);
