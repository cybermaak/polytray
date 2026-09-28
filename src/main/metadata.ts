import fs from "fs";
import readline from "readline";
import { Readable } from "stream";
import * as unzipper from "unzipper";
import type { ModelDimensions } from "../shared/types";
import { parseArchiveEntryPath } from "../shared/archivePaths";
import {
  createAvailableMeasurement,
  createUnavailableMeasurement,
  type MeasurementUnit,
  type StoredMeasurement,
} from '../shared/model/measurement';
import { measureFast3mfBuild } from '../shared/model/fast3mfGeometry';

export interface MetadataSummary {
  vertexCount: number;
  faceCount: number;
  dimensions: StoredMeasurement | null;
}

interface RawMetadataSummary {
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
  options: { signal?: AbortSignal } = {},
): Promise<MetadataSummary> {
  if (options.signal?.aborted) throw new Error("Metadata extraction cancelled");
  const archiveEntry = parseArchiveEntryPath(filePath);
  if (archiveEntry) {
    try {
      if (ext.toLowerCase() === "3mf") {
        const buffer = await readArchiveEntryBuffer(archiveEntry.archivePath, archiveEntry.entryPath);
        return buffer ? extractMetadataFromBuffer(buffer, ext) : unavailableSummary('3mf', '3MF archive entry is missing');
      }
      const entryStream = await openArchiveEntryStream(archiveEntry.archivePath, archiveEntry.entryPath);
      if (!entryStream) {
        return unavailableSummary(ext, 'Archive model entry is missing');
      }
      try { return convertRawSummary(await extractMetadataFromStream(entryStream.stream, ext, options.signal, entryStream.size), ext); }
      finally { await entryStream.close(); }
    } catch (error) {
      if (options.signal?.aborted) throw error;
      const reason = error instanceof Error ? error.message : String(error);
      return unavailableSummary(ext, `Archive metadata extraction failed: ${reason}`);
    }
  }

  try {
    switch (ext.toLowerCase()) {
      case "stl":
        return convertRawSummary(await extractSTL(filePath, options.signal), ext);
      case "obj":
        return convertRawSummary(await extractOBJ(filePath, options.signal), ext);
      case "3mf":
        return extract3MF(filePath);
      default:
        return unavailableSummary(ext, `Unsupported model format: ${ext}`);
    }
  } catch (error) {
    if (options.signal?.aborted) throw error;
    const reason = error instanceof Error ? error.message : String(error);
    return unavailableSummary(ext, `Metadata extraction failed: ${reason}`);
  }
}

export async function extractMetadataFromBuffer(
  buffer: Buffer,
  ext: string,
): Promise<MetadataSummary> {
  try {
    switch (ext.toLowerCase()) {
      case "stl":
        return convertRawSummary(extractSTLFromBuffer(buffer), ext);
      case "obj":
        return convertRawSummary(extractOBJFromText(buffer.toString("utf8")), ext);
      case "3mf":
        return extract3MFFromBuffer(buffer);
      default:
        return unavailableSummary(ext, `Unsupported model format: ${ext}`);
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return unavailableSummary(ext, `Metadata extraction failed: ${reason}`);
  }
}

async function openArchiveEntryStream(
  archivePath: string,
  entryPath: string,
): Promise<{ stream: NodeJS.ReadableStream; size: number; close: () => Promise<void> } | null> {
  const streams = new Set<fs.ReadStream>();
  const source = {
    size: async () => (await fs.promises.stat(archivePath)).size,
    stream: (start: number, length?: number) => {
      const stream = fs.createReadStream(archivePath, { start, end: length ? start + length - 1 : undefined });
      streams.add(stream);
      return stream;
    },
  };
  const close = async () => Promise.all([...streams].map((stream) => new Promise<void>((resolve) => {
    if (stream.closed) return resolve();
    stream.once("close", resolve);
    stream.destroy();
    if (stream.closed) resolve();
  }))).then(() => undefined);
  try {
    const directory = await unzipper.Open.custom(source);
    const entry = directory.files.find((file) => file.path === entryPath && file.type === "File");
    if (!entry) {
      await close();
      return null;
    }
    return { stream: entry.stream(), size: entry.uncompressedSize, close };
  } catch (e: unknown) {
    await close();
    const reason = e instanceof Error ? e.message : String(e);
    throw new Error(`Failed to read archive entry ${archivePath} :: ${entryPath}: ${reason}`, { cause: e });
  }
}

async function readArchiveEntryBuffer(archivePath: string, entryPath: string): Promise<Buffer | null> {
  const opened = await openArchiveEntryStream(archivePath, entryPath);
  if (!opened) return null;
  const chunks: Buffer[] = [];
  try {
    for await (const chunk of opened.stream as AsyncIterable<Buffer>) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks);
  } finally { await opened.close(); }
}

/**
 * Parse STL file — supports both binary and ASCII formats.
 */
async function extractSTL(filePath: string, signal?: AbortSignal): Promise<RawMetadataSummary> {
  const handle = await fs.promises.open(filePath, "r");
  try {
    const stat = await handle.stat();
    const probe = Buffer.alloc(Math.min(84, stat.size));
    await handle.read(probe, 0, probe.length, 0);
    if (stat.size < 84) throw new Error("Malformed or truncated STL header");
    const expectedFaces = probe.readUInt32LE(80);
    const expectedSize = 84 + expectedFaces * 50;
    const header = probe.subarray(0, 80).toString("ascii").trim().toLowerCase();
    if (stat.size === expectedSize) {
      return streamBinarySTL(filePath, expectedFaces, signal);
    }
    if (!header.startsWith("solid")) {
      throw new Error("Malformed STL: binary face count does not match file size");
    }
    const stream = fs.createReadStream(filePath, { encoding: "utf8" });
    return streamSTLAscii(stream, signal);
  } finally {
    await handle.close();
  }
}

function extractSTLFromBuffer(buffer: Buffer): RawMetadataSummary {
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
  if (buffer.length !== 84 + faceCount * 50) throw new Error("Malformed or truncated binary STL data");
  return extractSTLBinaryFromBuffer(buffer, faceCount);
}

async function streamBinarySTL(filePath: string, faceCount: number, signal?: AbortSignal): Promise<RawMetadataSummary> {
  return streamBinarySTLRecords(fs.createReadStream(filePath, { start: 84 }), faceCount, signal);
}

async function streamBinarySTLRecords(input: NodeJS.ReadableStream, faceCount: number, signal?: AbortSignal): Promise<RawMetadataSummary> {
  if (signal?.aborted) { destroyReadable(input); throw new Error("Metadata extraction cancelled"); }
  const bounds = createBounds();
  let carry: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  let faces = 0;
  try {
    for await (const chunkValue of input) {
      if (signal?.aborted) throw new Error("Metadata extraction cancelled");
      const chunk = Buffer.isBuffer(chunkValue) ? chunkValue : Buffer.from(String(chunkValue));
      const data = carry.length ? Buffer.concat([carry, chunk]) : chunk;
      const complete = data.length - (data.length % 50);
      for (let offset = 0; offset < complete; offset += 50) {
        if (faces >= faceCount) throw new Error("Malformed binary STL: excess triangle data");
        for (let vertex = 0; vertex < 3; vertex++) {
          const position = offset + 12 + vertex * 12;
          updateBounds(bounds, data.readFloatLE(position), data.readFloatLE(position + 4), data.readFloatLE(position + 8));
        }
        faces++;
      }
      carry = data.subarray(complete);
    }
    if (carry.length || faces !== faceCount) throw new Error("Malformed or truncated binary STL data");
    return { vertexCount: faceCount * 3, faceCount, dimensions: boundsToDimensions(bounds) };
  } catch (error) {
    (input as NodeJS.ReadableStream & { destroy?: () => void }).destroy?.();
    throw error;
  }
}

async function streamSTLAscii(input: NodeJS.ReadableStream, signal?: AbortSignal): Promise<RawMetadataSummary> {
  if (signal?.aborted) { destroyReadable(input); throw new Error("Metadata extraction cancelled"); }
  let faceCount = 0;
  const bounds = createBounds();
  const rl = readline.createInterface({ input, crlfDelay: Infinity });
  const cancel = () => { (input as NodeJS.ReadableStream & { destroy?: () => void }).destroy?.(); rl.close(); };
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    for await (const line of rl) {
      if (signal?.aborted) throw new Error("Metadata extraction cancelled");
      const trimmed = line.trimStart().toLowerCase();
      if (trimmed.startsWith("facet normal")) faceCount++;
      else if (trimmed.startsWith("vertex ")) {
        const parts = trimmed.split(/\s+/, 4);
        if (parts.length >= 4) updateBounds(bounds, Number(parts[1]), Number(parts[2]), Number(parts[3]));
      }
    }
    return { vertexCount: faceCount * 3, faceCount, dimensions: boundsToDimensions(bounds) };
  } catch (error) {
    cancel();
    throw error;
  } finally {
    signal?.removeEventListener("abort", cancel);
  }
}

function extractSTLAsciiFromText(text: string): RawMetadataSummary {
  return extractSTLAsciiFromLines(text.split(/\r?\n/));
}

function extractSTLAsciiFromLines(lines: Iterable<string>): RawMetadataSummary {
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

function extractSTLBinaryFromBuffer(buffer: Buffer, faceCount: number): RawMetadataSummary {
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

async function extractOBJ(filePath: string, signal?: AbortSignal): Promise<RawMetadataSummary> {
  const fileStream = fs.createReadStream(filePath, { encoding: "utf8" });
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  return extractOBJFromLineSource(rl, fileStream, signal);
}

async function extractMetadataFromStream(input: NodeJS.ReadableStream, ext: string, signal?: AbortSignal, expectedSize?: number): Promise<RawMetadataSummary> {
  if (signal?.aborted) { destroyReadable(input); throw new Error("Metadata extraction cancelled"); }
  if (ext.toLowerCase() === "obj") return extractOBJFromLineSource(readline.createInterface({ input, crlfDelay: Infinity }), input, signal);
  if (ext.toLowerCase() === "stl") {
    const iterator = (input as NodeJS.ReadableStream & AsyncIterable<Buffer>)[Symbol.asyncIterator]();
    let prefix = Buffer.alloc(0);
    while (prefix.length < 84) {
      const next = await iterator.next();
      if (next.done) break;
      prefix = Buffer.concat([prefix, Buffer.isBuffer(next.value) ? next.value : Buffer.from(String(next.value))]);
    }
    if (prefix.length < 84) {
      (input as NodeJS.ReadableStream & { destroy?: () => void }).destroy?.();
      throw new Error("Malformed or truncated STL header in archive entry");
    }
    const header = prefix.subarray(0, 80).toString("ascii").trim().toLowerCase();
    const faceCount = prefix.readUInt32LE(80);
    const isBinary = expectedSize === 84 + faceCount * 50;
    const replay = Readable.from((async function* () {
      yield prefix;
      for await (const chunk of { [Symbol.asyncIterator]: () => iterator }) yield chunk;
    })());
    if (isBinary) return streamBinarySTLRecords(Readable.from((async function* () {
      if (prefix.length > 84) yield prefix.subarray(84);
      for await (const chunk of { [Symbol.asyncIterator]: () => iterator }) yield chunk;
    })()), faceCount, signal);
    if (header.startsWith("solid")) return streamSTLAscii(replay, signal);
    (input as NodeJS.ReadableStream & { destroy?: () => void }).destroy?.();
    throw new Error("Malformed STL archive entry: binary face count does not match entry size");
  }
  (input as NodeJS.ReadableStream & { destroy?: () => void }).destroy?.();
  return { vertexCount: 0, faceCount: 0, dimensions: null };
}

async function extractOBJFromLineSource(rl: AsyncIterable<string>, stream: NodeJS.ReadableStream, signal?: AbortSignal): Promise<RawMetadataSummary> {
  if (signal?.aborted) { destroyReadable(stream); throw new Error("Metadata extraction cancelled"); }
  let vertexCount = 0;
  let faceCount = 0;
  const bounds = createBounds();
  const cancel = () => { (stream as NodeJS.ReadableStream & { destroy?: () => void }).destroy?.(); };
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    for await (const line of rl) {
      if (signal?.aborted) throw new Error("Metadata extraction cancelled");
      const trimmed = line.trimStart();
      if (trimmed.startsWith("v ")) {
        vertexCount++;
        const parts = trimmed.split(/\s+/, 4);
        if (parts.length >= 4) updateBounds(bounds, Number(parts[1]), Number(parts[2]), Number(parts[3]));
      } else if (trimmed.startsWith("f ")) faceCount++;
    }
    return { vertexCount, faceCount, dimensions: boundsToDimensions(bounds) };
  } catch (error) {
    cancel();
    throw error;
  } finally {
    signal?.removeEventListener("abort", cancel);
  }
}

function extractOBJFromText(text: string): RawMetadataSummary {
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
    const raw = await extract3MFFromDirectory(directory);
    const bytes = await fs.promises.readFile(filePath);
    return combine3mfMeasurement(raw, bytes);
  } catch (e: unknown) {
    const reason = e instanceof Error ? e.message : String(e);
    return unavailableSummary('3mf', `3MF archive could not be read: ${reason}`);
  }
}

async function extract3MFFromBuffer(buffer: Buffer): Promise<MetadataSummary> {
  try {
    const directory = await unzipper.Open.buffer(buffer);
    const raw = await extract3MFFromDirectory(directory);
    return combine3mfMeasurement(raw, buffer);
  } catch (e: unknown) {
    const reason = e instanceof Error ? e.message : String(e);
    return unavailableSummary('3mf', `3MF archive could not be read: ${reason}`);
  }
}

async function combine3mfMeasurement(raw: RawMetadataSummary, bytes: Buffer): Promise<MetadataSummary> {
  const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const result = await measureFast3mfBuild(arrayBuffer);
  return {
    vertexCount: raw.vertexCount,
    faceCount: raw.faceCount,
    dimensions: result.status === 'available'
      ? (createAvailableMeasurement(result.dimensions, 'mm') ?? createUnavailableMeasurement('mm', '3MF build produced invalid dimensions'))
      : result.measurement,
  };
}

async function extract3MFFromDirectory(
  directory: unzipper.CentralDirectory,
): Promise<RawMetadataSummary> {
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

function destroyReadable(stream: NodeJS.ReadableStream) {
  (stream as NodeJS.ReadableStream & { destroy?: () => void }).destroy?.();
}

function updateBounds(bounds: Bounds, x: number, y: number, z: number) {
  if (![x, y, z].every(Number.isFinite)) throw new Error('Model geometry contains a nonfinite vertex coordinate');
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

  const axes = [bounds.maxX - bounds.minX, bounds.maxY - bounds.minY, bounds.maxZ - bounds.minZ];
  if (!axes.every((value) => Number.isFinite(value) && value >= 0)) return null;
  const round = (value: number) => Math.round(value * 1000) / 1000;
  return {
    x: round(axes[0]!),
    y: round(axes[1]!),
    z: round(axes[2]!),
  };
}

function convertRawSummary(raw: RawMetadataSummary, extension: string): MetadataSummary {
  const unit: MeasurementUnit = extension.toLowerCase() === '3mf' ? 'mm' : 'model-unit';
  const dimensions = raw.dimensions
    ? createAvailableMeasurement(raw.dimensions, unit)
    : null;
  return {
    vertexCount: raw.vertexCount,
    faceCount: raw.faceCount,
    dimensions: dimensions ?? createUnavailableMeasurement(unit, 'No finite model bounds could be measured'),
  };
}

function unavailableSummary(extension: string, reason: string): MetadataSummary {
  const unit: MeasurementUnit = extension.toLowerCase() === '3mf' ? 'mm' : 'model-unit';
  return {
    vertexCount: 0,
    faceCount: 0,
    dimensions: createUnavailableMeasurement(unit, reason),
  };
}
