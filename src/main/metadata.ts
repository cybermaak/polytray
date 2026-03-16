import fs from "fs";
import readline from "readline";
import * as unzipper from "unzipper";
import type { ModelDimensions } from "../shared/types";

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
 * @param {string} filePath - Absolute path to the file
 * @param {string} ext - File extension (stl, obj, 3mf)
 * @returns {Promise<{vertexCount: number, faceCount: number, dimensions: ModelDimensions | null}>}
 */
export async function extractMetadata(
  filePath: string,
  ext: string,
): Promise<MetadataSummary> {
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

/**
 * Parse STL file — supports both binary and ASCII formats.
 */
async function extractSTL(
  filePath: string,
): Promise<MetadataSummary> {
  // Read just the first 84 bytes to check header and binary face count
  const fd = await fs.promises.open(filePath, "r");
  const buffer = Buffer.alloc(84);
  const { bytesRead } = await fd.read(buffer, 0, 84, 0);
  await fd.close();

  if (bytesRead < 80) return { vertexCount: 0, faceCount: 0, dimensions: null };

  // Check if it's ASCII STL (starts with "solid")
  const header = buffer.slice(0, 80).toString("ascii").trim().toLowerCase();
  
  if (header.startsWith("solid")) {
    // We can't be 100% sure it's ASCII just from "solid" (some binary STLs violate the spec),
    // but we can check if the file size matches the binary formula: 84 + (faceCount * 50)
    const stat = await fs.promises.stat(filePath);
    if (bytesRead >= 84) {
       const expectedBinaryFaceCount = buffer.readUInt32LE(80);
       const expectedBinarySize = 84 + (expectedBinaryFaceCount * 50);
       if (stat.size === expectedBinarySize) {
           return extractSTLBinary(filePath, expectedBinaryFaceCount);
       }
    }
    return extractSTLAscii(filePath);
  }

  // Binary STL: 80 byte header + 4 byte face count
  if (bytesRead < 84) return { vertexCount: 0, faceCount: 0, dimensions: null };
  const faceCount = buffer.readUInt32LE(80);
  return extractSTLBinary(filePath, faceCount);
}

/**
 * Fast streaming ASCII STL parser
 */
async function extractSTLAscii(
  filePath: string,
): Promise<MetadataSummary> {
  let faceCount = 0;
  const bounds = createBounds();
  
  const fileStream = fs.createReadStream(filePath, { encoding: "utf8" });
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    const trimmed = line.trimStart().toLowerCase();
    if (trimmed.startsWith("facet normal")) {
      faceCount++;
    } else if (trimmed.startsWith("vertex ")) {
      const parts = trimmed.split(/\s+/);
      if (parts.length >= 4) {
        updateBounds(
          bounds,
          Number(parts[1]),
          Number(parts[2]),
          Number(parts[3]),
        );
      }
    }
  }

  return {
    vertexCount: faceCount * 3,
    faceCount,
    dimensions: boundsToDimensions(bounds),
  };
}

async function extractSTLBinary(
  filePath: string,
  faceCount: number,
): Promise<MetadataSummary> {
  const buffer = await fs.promises.readFile(filePath);
  const bounds = createBounds();

  let offset = 84;
  for (let i = 0; i < faceCount; i++) {
    offset += 12; // skip normal
    for (let vertex = 0; vertex < 3; vertex++) {
      const x = buffer.readFloatLE(offset);
      const y = buffer.readFloatLE(offset + 4);
      const z = buffer.readFloatLE(offset + 8);
      updateBounds(bounds, x, y, z);
      offset += 12;
    }
    offset += 2; // attribute byte count
  }

  return {
    vertexCount: faceCount * 3,
    faceCount,
    dimensions: boundsToDimensions(bounds),
  };
}

/**
 * Fast streaming OBJ file parser.
 */
async function extractOBJ(
  filePath: string,
): Promise<MetadataSummary> {
  let vertexCount = 0;
  let faceCount = 0;
  const bounds = createBounds();

  const fileStream = fs.createReadStream(filePath, { encoding: "utf8" });
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    const trimmed = line.trimStart();
    if (trimmed.startsWith("v ")) {
      vertexCount++;
      const parts = trimmed.split(/\s+/);
      if (parts.length >= 4) {
        updateBounds(
          bounds,
          Number(parts[1]),
          Number(parts[2]),
          Number(parts[3]),
        );
      }
    } else if (trimmed.startsWith("f ")) faceCount++;
  }

  return { vertexCount, faceCount, dimensions: boundsToDimensions(bounds) };
}

/**
 * Parse 3MF file — it's a ZIP containing XML model files.
 */
async function extract3MF(
  filePath: string,
): Promise<MetadataSummary> {
  let vertexCount = 0;
  let faceCount = 0;
  const bounds = createBounds();

  try {
    const directory = await unzipper.Open.file(filePath);
    
    // Look for 3D model files in the archive
    const modelFiles = directory.files.filter(
      (file: unzipper.File) =>
        file.path.endsWith(".model") ||
        file.path.includes("3dmodel.model") ||
        file.path.includes("3D/3dmodel.model")
    );

    for (const file of modelFiles) {
      const stream = file.stream();
      
      const rl = readline.createInterface({
        input: stream,
        crlfDelay: Infinity,
      });

      for await (const line of rl) {
        // Count <vertex> or <v ... /> elements
        const vertexMatches = line.match(/<vertex\s/gi) || line.match(/<v\s/gi);
        if (vertexMatches) vertexCount += vertexMatches.length;
        for (const match of line.matchAll(
          /<vertex[^>]*x="([^"]+)"[^>]*y="([^"]+)"[^>]*z="([^"]+)"/gi,
        )) {
          updateBounds(
            bounds,
            Number(match[1]),
            Number(match[2]),
            Number(match[3]),
          );
        }

        // Count <triangle> or <t ... /> elements
        const triMatches = line.match(/<triangle\s/gi) || line.match(/<t\s/gi);
        if (triMatches) faceCount += triMatches.length;
      }
    }
  } catch (e: unknown) {
    console.warn(`[Streaming] extract3MF failed for ${filePath}: ${(e as Error).message}`);
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
