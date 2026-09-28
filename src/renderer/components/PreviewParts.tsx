import React, { useEffect, useLayoutEffect, useReducer, useRef, useState } from "react";
import { requestPartThumbnail, selectViewerPart } from "../lib/viewer";
import { PartThumbnailImage, reducePartThumbnailImages } from "./PreviewPartImage";

interface PartEntry { id: string; label: string; }
interface PartThumbnailState {
  id: string;
  url: string | null;
  acknowledgeRelease?: () => void;
  releasedUrl?: string;
}

export const PreviewParts: React.FC = () => {
  const [parts, setParts] = useState<PartEntry[]>([]);
  const [images, dispatchImage] = useReducer(reducePartThumbnailImages, new Map<string, string>());
  const [selected, setSelected] = useState(-1);
  const stripRef = useRef<HTMLDivElement>(null);
  const pendingReleases = useRef(new Map<string, { url: string; acknowledge: () => void }>());

  useEffect(() => {
    const onParts = (event: Event) => {
      const detail = (event as CustomEvent<PartEntry[]>).detail;
      setParts(detail);
      dispatchImage({ clear: true });
      setSelected(-1);
    };
    const onClear = () => { setParts([]); dispatchImage({ clear: true }); setSelected(-1); };
    const onThumbnail = (event: Event) => {
      const { id, url, acknowledgeRelease, releasedUrl } = (event as CustomEvent<PartThumbnailState>).detail;
      if (url === null && acknowledgeRelease && releasedUrl) {
        pendingReleases.current.set(releasedUrl, { url: releasedUrl, acknowledge: acknowledgeRelease });
      }
      dispatchImage({ id, url });
    };
    const onSelection = (event: Event) => setSelected((event as CustomEvent<number>).detail);
    window.addEventListener("polytray-multipart-parts", onParts);
    window.addEventListener("polytray-multipart-clear", onClear);
    window.addEventListener("polytray-part-thumbnail", onThumbnail);
    window.addEventListener("polytray-part-selection", onSelection);
    return () => {
      window.removeEventListener("polytray-multipart-parts", onParts);
      window.removeEventListener("polytray-multipart-clear", onClear);
      window.removeEventListener("polytray-part-thumbnail", onThumbnail);
      window.removeEventListener("polytray-part-selection", onSelection);
    };
  }, []);

  useLayoutEffect(() => {
    for (const [url, pending] of pendingReleases.current) {
      const stillRendered = parts.some((part) => images.get(part.id) === url);
      if (stillRendered) continue;
      pendingReleases.current.delete(url);
      pending.acknowledge();
    }
  }, [images, parts]);

  useEffect(() => () => {
    for (const pending of pendingReleases.current.values()) pending.acknowledge();
    pendingReleases.current.clear();
  }, []);

  useEffect(() => {
    const strip = stripRef.current;
    if (!strip || !parts.length) return;
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const id = (entry.target as HTMLElement).dataset.partId;
        if (id) requestPartThumbnail(id);
      }
    }, { root: strip, rootMargin: "0px 256px 0px 256px", threshold: 0 });
    for (const card of strip.querySelectorAll<HTMLElement>("[data-part-id]")) observer.observe(card);
    return () => observer.disconnect();
  }, [parts]);

  if (!parts.length) return <div ref={stripRef} className="viewer-multi-model hidden" id="viewer-multi-model" />;
  return (
    <div ref={stripRef} className="viewer-multi-model" id="viewer-multi-model" role="group" aria-label="Model parts">
      <button type="button" className={`multi-model-thumb${selected === -1 ? " active" : ""}`}
        aria-label="Show all model parts" title="Show all" onClick={() => { selectViewerPart(-1); setSelected(-1); }}>
        <span className="archive-thumb-fallback">Show all</span>
      </button>
      {parts.map((part, index) => (
        <button key={part.id} type="button" data-part-id={part.id}
          className={`multi-model-thumb${selected === index ? " active" : ""}`}
          aria-label={`Show ${part.label}`} title={part.label}
          onClick={() => { selectViewerPart(index); setSelected(index); }}>
          <PartThumbnailImage url={images.get(part.id)} index={index} />
        </button>
      ))}
    </div>
  );
};
