import fs from "fs";
import readline from "readline";
import * as unzipper from "unzipper";
import type { ModelDimensions } from "../shared/types";
import { parseArchiveEntryPath } from "../shared/archivePaths";

export interface MetadataSummary {
  vertexCount: number;
  faceCount: number;
  dimensions: ModelDimensions | null;
}

interface Bounds {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

/**
 * Extracts vertex/face count metadata from a 3D file.
 * @param {string} filePath - Absolute path to the file or virtual archive entry path
 * @param {string} ext - File extension (stl, obj, 3mf)
 */
export async function extractMetadata(
  filePath: string,
  ext: string,
): Promise<MetadataSummary> {
  const archiveEntry = parseArchiveEntryPath(filePath);
  if (archiveEntry) {
    const entryBuffer = await readArchiveEntryBuffer(archiveEntry.archivePath, archiveEntry.entryPath);
    if (!entryBuffer) {
      return { vertexCount: 0, faceCount: 0, dimensions: null };
    }
    return extractMetadataFromBuffer(entryBuffer, ext);
  }

  switch (ext.toLowerCase()) {
    case "stl":
      return extractSTL(filePath);
    case "obj":
      return extractOBJ(filePath);
    case "3mf":
      return extract3MF(filePath);
    default:
      return { vertexCount: 0, faceCount: 0, dimensions: null };
  }
}

export async function extractMetadataFromBuffer(
  buffer: Buffer,
  ext: string,
): Promise<MetadataSummary> {
  switch (ext.toLowerCase()) {
    case "stl":
      return extractSTLFromBuffer(buffer);
    case "obj":
      return extractOBJFromText(buffer.toString("utf8"));
    case "3mf":
      return extract3MFFromBuffer(buffer);
    default:
      return { vertexCount: 0, faceCount: 0, dimensions: null };
  }
}

async function readArchiveEntryBuffer(
  archivePath: string,
  entryPath: string,
): Promise<Buffer | null> {
  try {
    // Read the archive into memory first so the file descriptor is released
    // before the caller can attempt cleanup (important on Windows where open
    // handles prevent directory removal).
    const fileBuffer = await fs.promises.readFile(archivePath);
    const directory = await unzipper.Open.buffer(fileBuffer);
    const entry = directory.files.find((file) => file.path === entryPath && file.type === "File");
    if (!entry) {
      return null;
    }
    return entry.buffer();
  } catch (e: unknown) {
    console.warn(`[Metadata] Failed to read archive entry ${archivePath} :: ${entryPath}:`, (e as Error).message);
    return null;
  }
}

/**
 * Parse STL file — supports both binary and ASCII formats.
 */
async function extractSTL(filePath: string): Promise<MetadataSummary> {
  const buffer = await fs.promises.readFile(filePath);
  return extractSTLFromBuffer(buffer);
}

function extractSTLFromBuffer(buffer: Buffer): MetadataSummary {
  if (buffer.length < 80) return { vertexCount: 0, faceCount: 0, dimensions: null };

  const header = buffer.slice(0, 80).toString("ascii").trim().toLowerCase();
  if (header.startsWith("solid") && buffer.length >= 84) {
    const expectedBinaryFaceCount = buffer.readUInt32LE(80);
    const expectedBinarySize = 84 + expectedBinaryFaceCount * 50;
    if (buffer.length !== expectedBinarySize) {
      return extractSTLAsciiFromText(buffer.toString("utf8"));
    }
  }

  if (buffer.length < 84) return { vertexCount: 0, faceCount: 0, dimensions: null };
  const faceCount = buffer.readUInt32LE(80);
  return extractSTLBinaryFromBuffer(buffer, faceCount);
}

async function extractSTLAscii(filePath: string): Promise<MetadataSummary> {
  const fileStream = fs.createReadStream(filePath, { encoding: "utf8" });
  return extractSTLAsciiFromLineSource(fileStream);
}

function extractSTLAsciiFromText(text: string): MetadataSummary {
  return extractSTLAsciiFromLines(text.split(/\r?\n/));
}

async function extractSTLAsciiFromLineSource(input: NodeJS.ReadableStream): Promise<MetadataSummary> {
  const rl = readline.createInterface({
    input,
    crlfDelay: Infinity,
  });

  const lines: string[] = [];
  for await (const line of rl) {
    lines.push(line);
  }
  return extractSTLAsciiFromLines(lines);
}

function extractSTLAsciiFromLines(lines: Iterable<string>): MetadataSummary {
  let faceCount = 0;
  const bounds = createBounds();

  for (const line of lines) {
    const trimmed = line.trimStart().toLowerCase();
    if (trimmed.startsWith("facet normal")) {
      faceCount++;
    } else if (trimmed.startsWith("vertex ")) {
      const parts = trimmed.split(/\s+/);
      if (parts.length >= 4) {
        updateBounds(bounds, Number(parts[1]), Number(parts[2]), Number(parts[3]));
      }
    }
  }

  return {
    vertexCount: faceCount * 3,
    faceCount,
    dimensions: boundsToDimensions(bounds),
  };
}

function extractSTLBinaryFromBuffer(buffer: Buffer, faceCount: number): MetadataSummary {
  const bounds = createBounds();

  let offset = 84;
  for (let i = 0; i < faceCount; i++) {
    offset += 12;
    for (let vertex = 0; vertex < 3; vertex++) {
      const x = buffer.readFloatLE(offset);
      const y = buffer.readFloatLE(offset + 4);
      const z = buffer.readFloatLE(offset + 8);
      updateBounds(bounds, x, y, z);
      offset += 12;
    }
    offset += 2;
  }

  return {
    vertexCount: faceCount * 3,
    faceCount,
    dimensions: boundsToDimensions(bounds),
  };
}

async function extractOBJ(filePath: string): Promise<MetadataSummary> {
  const fileStream = fs.createReadStream(filePath, { encoding: "utf8" });
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  const lines: string[] = [];
  for await (const line of rl) {
    lines.push(line);
  }

  return extractOBJFromText(lines.join("\n"));
}

function extractOBJFromText(text: string): MetadataSummary {
  let vertexCount = 0;
  let faceCount = 0;
  const bounds = createBounds();

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trimStart();
    if (trimmed.startsWith("v ")) {
      vertexCount++;
      const parts = trimmed.split(/\s+/);
      if (parts.length >= 4) {
        updateBounds(bounds, Number(parts[1]), Number(parts[2]), Number(parts[3]));
      }
    } else if (trimmed.startsWith("f ")) {
      faceCount++;
    }
  }

  return { vertexCount, faceCount, dimensions: boundsToDimensions(bounds) };
}

async function extract3MF(filePath: string): Promise<MetadataSummary> {
  try {
    const directory = await unzipper.Open.file(filePath);
    return extract3MFFromDirectory(directory);
  } catch (e: unknown) {
    console.warn(`[Streaming] extract3MF failed for ${filePath}: ${(e as Error).message}`);
    return { vertexCount: 0, faceCount: 0, dimensions: null };
  }
}

async function extract3MFFromBuffer(buffer: Buffer): Promise<MetadataSummary> {
  try {
    const directory = await unzipper.Open.buffer(buffer);
    return extract3MFFromDirectory(directory);
  } catch (e: unknown) {
    console.warn(`[Streaming] extract3MF failed from buffer: ${(e as Error).message}`);
    return { vertexCount: 0, faceCount: 0, dimensions: null };
  }
}

async function extract3MFFromDirectory(
  directory: unzipper.CentralDirectory,
): Promise<MetadataSummary> {
  let vertexCount = 0;
  let faceCount = 0;
  const bounds = createBounds();

  const modelFiles = directory.files.filter(
    (file: unzipper.File) =>
      file.path.endsWith(".model") ||
      file.path.includes("3dmodel.model") ||
      file.path.includes("3D/3dmodel.model"),
  );

  for (const file of modelFiles) {
    const stream = file.stream();
    const rl = readline.createInterface({
      input: stream,
      crlfDelay: Infinity,
    });

    for await (const line of rl) {
      const vertexMatches = line.match(/<vertex\s/gi) || line.match(/<v\s/gi);
      if (vertexMatches) vertexCount += vertexMatches.length;
      for (const match of line.matchAll(
        /<vertex[^>]*x="([^"]+)"[^>]*y="([^"]+)"[^>]*z="([^"]+)"/gi,
      )) {
        updateBounds(bounds, Number(match[1]), Number(match[2]), Number(match[3]));
      }

      const triMatches = line.match(/<triangle\s/gi) || line.match(/<t\s/gi);
      if (triMatches) faceCount += triMatches.length;
    }
  }

  return { vertexCount, faceCount, dimensions: boundsToDimensions(bounds) };
}

function createBounds(): Bounds {
  return {
    minX: Number.POSITIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    minZ: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY,
    maxZ: Number.NEGATIVE_INFINITY,
  };
}

function updateBounds(bounds: Bounds, x: number, y: number, z: number) {
  if (![x, y, z].every(Number.isFinite)) return;
  bounds.minX = Math.min(bounds.minX, x);
  bounds.minY = Math.min(bounds.minY, y);
  bounds.minZ = Math.min(bounds.minZ, z);
  bounds.maxX = Math.max(bounds.maxX, x);
  bounds.maxY = Math.max(bounds.maxY, y);
  bounds.maxZ = Math.max(bounds.maxZ, z);
}

function boundsToDimensions(bounds: Bounds): ModelDimensions | null {
  if (!Number.isFinite(bounds.minX) || !Number.isFinite(bounds.maxX)) {
    return null;
  }

  const round = (value: number) => Math.round(value * 1000) / 1000;
  return {
    x: round(bounds.maxX - bounds.minX),
    y: round(bounds.maxY - bounds.minY),
    z: round(bounds.maxZ - bounds.minZ),
  };
}
