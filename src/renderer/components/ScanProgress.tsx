import React from "react";

interface Props {
  visible: boolean;
  percent: number;
  text: string;
  count: string;
}

export const ScanProgress: React.FC<Props> = ({ visible, percent, text, count }) => (
  <div id="scan-progress" className={`scan-progress${visible ? "" : " hidden"}`}>
    <div className="progress-bar">
      <div className="progress-fill" id="progress-fill" style={{ width: `${percent}%` }} />
    </div>
    <div className="progress-text">
      <span id="progress-text">{text}</span>
      <span id="progress-count">{count}</span>
    </div>
  </div>
);
