import React, { useEffect, useState } from 'react';
import {
  thumbnailImageCache,
  watchThumbnailImage,
  type ThumbnailImageIdentity,
} from '../lib/thumbnailImageCache';

const TRANSPARENT_PLACEHOLDER = 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';

export interface ThumbnailImageProps {
  thumbnailPath: string | null | undefined;
  identity?: ThumbnailImageIdentity;
  /** Empty by default when nearby card text already names the model. */
  alt?: string;
  className?: string;
  style?: React.CSSProperties;
}

export interface ResolvedThumbnailImage {
  path: string | null | undefined;
  identity: ThumbnailImageIdentity | undefined;
  dataUrl: string | null;
}

export function markThumbnailImageDecodeFailed(
  current: ResolvedThumbnailImage | null,
  path: string | null | undefined,
  identity: ThumbnailImageIdentity | undefined,
  failedDataUrl: string,
): ResolvedThumbnailImage | null {
  if (!current || current.path !== path || !Object.is(current.identity, identity) || current.dataUrl !== failedDataUrl) {
    return current;
  }
  return { ...current, dataUrl: null };
}

export function ThumbnailImage({
  thumbnailPath,
  identity,
  alt = '',
  className,
  style,
}: ThumbnailImageProps) {
  const [resolved, setResolved] = useState<ResolvedThumbnailImage | null>(null);

  useEffect(() => watchThumbnailImage(
    thumbnailImageCache,
    thumbnailPath,
    identity,
    (dataUrl) => setResolved({ path: thumbnailPath, identity, dataUrl }),
  ), [thumbnailPath, identity]);

  const matchesCurrentRequest = resolved !== null && resolved.path === thumbnailPath && Object.is(resolved.identity, identity);
  const dataUrl = matchesCurrentRequest ? resolved.dataUrl : null;
  const handleImageError = dataUrl
    ? () => setResolved((current) => markThumbnailImageDecodeFailed(current, thumbnailPath, identity, dataUrl))
    : undefined;

  return (
    <img
      src={dataUrl ?? TRANSPARENT_PLACEHOLDER}
      alt={alt}
      className={className}
      style={{ width: '100%', height: '100%', display: 'block', ...style }}
      draggable={false}
      onError={handleImageError}
      data-thumbnail-state={dataUrl ? 'ready' : 'placeholder'}
    />
  );
}
