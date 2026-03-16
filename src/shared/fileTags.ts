export function normalizeFileTags(input: string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const tag of input) {
    const trimmed = tag.trim();
    if (!trimmed) continue;

    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(trimmed);
  }

  return normalized;
}

export function serializeFileTags(input: string[]): string | null {
  const normalized = normalizeFileTags(input);
  return normalized.length > 0 ? JSON.stringify(normalized) : null;
}

export function parseStoredFileTags(input: string | null | undefined): string[] {
  if (!input) return [];

  try {
    const parsed = JSON.parse(input) as unknown;
    return Array.isArray(parsed)
      ? normalizeFileTags(parsed.filter((entry): entry is string => typeof entry === "string"))
      : [];
  } catch {
    return [];
  }
}
