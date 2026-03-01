import fs from "fs";
import JSZip from "jszip";

/**
 * Extracts vertex/face count metadata from a 3D file.
 * @param {string} filePath - Absolute path to the file
 * @param {string} ext - File extension (stl, obj, 3mf)
 * @returns {Promise<{vertexCount: number, faceCount: number}>}
 */
export async function extractMetadata(
  filePath: string,
  ext: string,
): Promise<{ vertexCount: number; faceCount: number }> {
  switch (ext.toLowerCase()) {
    case "stl":
      return extractSTL(filePath);
    case "obj":
      return extractOBJ(filePath);
    case "3mf":
      return extract3MF(filePath);
    default:
      return { vertexCount: 0, faceCount: 0 };
  }
}

/**
 * Parse STL file — supports both binary and ASCII formats.
 */
async function extractSTL(
  filePath: string,
): Promise<{ vertexCount: number; faceCount: number }> {
  const buffer = await fs.promises.readFile(filePath);

  // Check if it's ASCII STL (starts with "solid")
  const header = buffer.slice(0, 80).toString("ascii").trim().toLowerCase();
  if (
    header.startsWith("solid") &&
    buffer.toString("ascii", 0, 1000).includes("facet")
  ) {
    return extractSTLAscii(buffer);
  }

  return extractSTLBinary(buffer);
}

function extractSTLBinary(buffer: Buffer): {
  vertexCount: number;
  faceCount: number;
} {
  // Binary STL: 80 byte header + 4 byte face count + 50 bytes per face
  if (buffer.length < 84) return { vertexCount: 0, faceCount: 0 };

  const faceCount = buffer.readUInt32LE(80);
  return {
    vertexCount: faceCount * 3,
    faceCount,
  };
}

function extractSTLAscii(buffer: Buffer): {
  vertexCount: number;
  faceCount: number;
} {
  const text = buffer.toString("ascii");
  const matches = text.match(/facet\s+normal/gi);
  const faceCount = matches ? matches.length : 0;
  return {
    vertexCount: faceCount * 3,
    faceCount,
  };
}

/**
 * Parse OBJ file — count lines starting with 'v ' and 'f '.
 */
async function extractOBJ(
  filePath: string,
): Promise<{ vertexCount: number; faceCount: number }> {
  const text = await fs.promises.readFile(filePath, "utf-8");
  let vertexCount = 0;
  let faceCount = 0;

  const lines = text.split("\n");
  for (const line of lines) {
    const trimmed = line.trimStart();
    if (trimmed.startsWith("v ")) vertexCount++;
    else if (trimmed.startsWith("f ")) faceCount++;
  }

  return { vertexCount, faceCount };
}

/**
 * Parse 3MF file — it's a ZIP containing XML model files.
 */
async function extract3MF(
  filePath: string,
): Promise<{ vertexCount: number; faceCount: number }> {
  const data = await fs.promises.readFile(filePath);
  const zip = await JSZip.loadAsync(data);

  let vertexCount = 0;
  let faceCount = 0;

  // Look for 3D model files in the archive
  for (const [name, file] of Object.entries(zip.files)) {
    if (
      name.endsWith(".model") ||
      name.includes("3dmodel.model") ||
      name.includes("3D/3dmodel.model")
    ) {
      const xml = await file.async("text");

      // Count <vertex> or <v ... /> elements
      const vertexMatches = xml.match(/<vertex\s/gi) || xml.match(/<v\s/gi);
      if (vertexMatches) vertexCount += vertexMatches.length;

      // Count <triangle> or <t ... /> elements
      const triMatches = xml.match(/<triangle\s/gi) || xml.match(/<t\s/gi);
      if (triMatches) faceCount += triMatches.length;
    }
  }

  return { vertexCount, faceCount };
}
