import type { ScanProgressData } from '../../shared/types';

export interface ScanProgressPresentation {
  percent: number;
  text: string;
  count: string;
}

/** Convert progressive scan counts without inventing a total before discovery ends. */
export function getScanProgressPresentation(data: ScanProgressData): ScanProgressPresentation {
  const totalKnown = typeof data.total === 'number' && data.total > 0;
  const percent = totalKnown ? Math.round((data.current / data.total!) * 100) : 0;
  const count = data.discovered !== undefined && data.indexed !== undefined
    ? `${data.discovered} discovered / ${data.indexed} indexed`
    : data.total === null ? `${data.current} indexed` : `${data.current} / ${data.total}`;
  return {
    percent,
    text: (data.filename || 'Scanning files...') + (data.skipped ? ' (cached)' : ''),
    count,
  };
}
