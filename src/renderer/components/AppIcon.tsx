import React from "react";
import { ICON_PATHS, type IconShape } from "./iconPaths";

interface Props {
  name: keyof typeof ICON_PATHS;
  size?: number;
  className?: string;
}

function renderShape(shape: IconShape, index: number) {
  switch (shape.kind) {
    case "path": {
      const { kind: _kind, ...props } = shape;
      return <path key={index} {...props} />;
    }
    case "line": {
      const { kind: _kind, ...props } = shape;
      return <line key={index} {...props} />;
    }
    case "circle": {
      const { kind: _kind, ...props } = shape;
      return <circle key={index} {...props} />;
    }
    case "rect": {
      const { kind: _kind, ...props } = shape;
      return <rect key={index} {...props} />;
    }
    case "polyline": {
      const { kind: _kind, ...props } = shape;
      return <polyline key={index} {...props} />;
    }
  }
}

export const AppIcon: React.FC<Props> = ({ name, size = 16, className }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 16 16"
    fill="none"
    className={className}
    aria-hidden="true"
    style={{ flexShrink: 0 }}
  >
    {ICON_PATHS[name].map((shape, index) => renderShape(shape, index))}
  </svg>
);
