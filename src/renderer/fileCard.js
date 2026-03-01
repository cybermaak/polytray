import { formatSize } from "./app.js";

/**
 * Creates a file card DOM element.
 * @param {Object} file - File record from the database
 * @param {number} index - Index for staggered animation
 * @returns {HTMLElement}
 */
export function createFileCard(file, index) {
  const card = document.createElement("div");
  card.className = "file-card";
  card.style.animationDelay = `${Math.min(index * 20, 300)}ms`;
  card.dataset.fileId = file.id;

  // Thumbnail
  const thumbDiv = document.createElement("div");
  thumbDiv.className = "card-thumbnail";

  if (file.thumbnail) {
    // Load thumbnail as base64 data URL via IPC
    const img = document.createElement("img");
    img.alt = file.name;
    img.loading = "lazy";
    thumbDiv.appendChild(img);
    // Placeholder icon until loaded
    const placeholder = createPlaceholderIcon();
    thumbDiv.appendChild(placeholder);

    // Async load the thumbnail through main process
    window.polytray
      .readThumbnail(file.thumbnail)
      .then((dataUrl) => {
        if (dataUrl) {
          img.src = dataUrl;
          img.onload = () => placeholder.remove();
          img.onerror = () => {
            img.remove();
          };
        } else {
          img.remove();
        }
      })
      .catch(() => {
        img.remove();
      });
  } else {
    // No thumbnail yet — show a loading pulse animation
    const pulse = document.createElement("div");
    pulse.className = "thumbnail-pulse";
    thumbDiv.appendChild(pulse);
    thumbDiv.appendChild(createPlaceholderIcon());
  }

  // Extension badge
  const badge = document.createElement("span");
  const extClass = file.extension === "3mf" ? "threemf" : file.extension;
  badge.className = `card-ext-badge ${extClass}`;
  badge.textContent = file.extension.toUpperCase();
  thumbDiv.appendChild(badge);

  card.appendChild(thumbDiv);

  // Info
  const info = document.createElement("div");
  info.className = "card-info";

  const name = document.createElement("div");
  name.className = "card-name";
  name.textContent = file.name;
  name.title = file.name;
  info.appendChild(name);

  const meta = document.createElement("div");
  meta.className = "card-meta";
  meta.innerHTML = `<span>${formatSize(file.size_bytes)}</span><span>${formatVertices(file.vertex_count)}</span>`;
  info.appendChild(meta);

  // Timestamp row
  const timestamp = document.createElement("div");
  timestamp.className = "card-timestamp";
  timestamp.textContent = formatTimestamp(file.modified_at);
  info.appendChild(timestamp);

  card.appendChild(info);

  return card;
}

function createPlaceholderIcon() {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", "48");
  svg.setAttribute("height", "48");
  svg.setAttribute("viewBox", "0 0 48 48");
  svg.setAttribute("fill", "none");
  svg.classList.add("placeholder-icon");

  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", "M24 4L42 14v20L24 44 6 34V14L24 4z");
  path.setAttribute("stroke", "currentColor");
  path.setAttribute("stroke-width", "2");
  path.setAttribute("fill", "none");

  const path2 = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path2.setAttribute("d", "M24 4v20m0 20V24m18-10L24 24M6 14l18 10");
  path2.setAttribute("stroke", "currentColor");
  path2.setAttribute("stroke-width", "1.5");
  path2.setAttribute("opacity", "0.5");

  svg.appendChild(path);
  svg.appendChild(path2);
  return svg;
}

function formatVertices(count) {
  if (!count) return "—";
  if (count >= 1000000) return (count / 1000000).toFixed(1) + "M verts";
  if (count >= 1000) return (count / 1000).toFixed(1) + "K verts";
  return count.toString() + " verts";
}

function formatTimestamp(epochMs) {
  if (!epochMs) return "";
  const d = new Date(epochMs);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday = d.toDateString() === yesterday.toDateString();

  const time = d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });

  if (isToday) return `Today ${time}`;
  if (isYesterday) return `Yesterday ${time}`;

  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
