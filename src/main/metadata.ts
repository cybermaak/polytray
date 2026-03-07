import fs from "fs";
import readline from "readline";
import * as unzipper from "unzipper";

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
  // Read just the first 84 bytes to check header and binary face count
  const fd = await fs.promises.open(filePath, "r");
  const buffer = Buffer.alloc(84);
  const { bytesRead } = await fd.read(buffer, 0, 84, 0);
  await fd.close();

  if (bytesRead < 80) return { vertexCount: 0, faceCount: 0 };

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
           return {
               vertexCount: expectedBinaryFaceCount * 3,
               faceCount: expectedBinaryFaceCount
           };
       }
    }
    return extractSTLAscii(filePath);
  }

  // Binary STL: 80 byte header + 4 byte face count
  if (bytesRead < 84) return { vertexCount: 0, faceCount: 0 };
  const faceCount = buffer.readUInt32LE(80);
  return {
    vertexCount: faceCount * 3,
    faceCount,
  };
}

/**
 * Fast streaming ASCII STL parser
 */
async function extractSTLAscii(
  filePath: string,
): Promise<{ vertexCount: number; faceCount: number }> {
  let faceCount = 0;
  
  const fileStream = fs.createReadStream(filePath, { encoding: "utf8" });
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (line.trimStart().toLowerCase().startsWith("facet normal")) {
      faceCount++;
    }
  }

  return {
    vertexCount: faceCount * 3,
    faceCount,
  };
}

/**
 * Fast streaming OBJ file parser.
 */
async function extractOBJ(
  filePath: string,
): Promise<{ vertexCount: number; faceCount: number }> {
  let vertexCount = 0;
  let faceCount = 0;

  const fileStream = fs.createReadStream(filePath, { encoding: "utf8" });
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
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
  let vertexCount = 0;
  let faceCount = 0;

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

        // Count <triangle> or <t ... /> elements
        const triMatches = line.match(/<triangle\s/gi) || line.match(/<t\s/gi);
        if (triMatches) faceCount += triMatches.length;
      }
    }
  } catch (e: unknown) {
    console.warn(`[Streaming] extract3MF failed for ${filePath}: ${(e as Error).message}`);
  }

  return { vertexCount, faceCount };
}
