import * as THREE from "three";
import type { SerializedAttribute, SerializedMesh } from "../../shared/types";

export const ASSEMBLY_CHUNK_VERTEX_LIMIT = 32_768;
const ASSEMBLY_CHUNK_INDEX_LIMIT = ASSEMBLY_CHUNK_VERTEX_LIMIT * 3;
const COOPERATIVE_CHECK_TRIANGLES = 256;

export interface MeshAssemblyOptions {
  signal: AbortSignal;
  isCurrent(): boolean;
  yieldToFrame(): Promise<void>;
  createMaterial(): THREE.Material;
  timeBudgetMs?: number;
  vertexBudget?: number;
}

/** Wrap transferred arrays directly for small meshes; copy oversized meshes in bounded, cancellable chunks. */
export async function assembleSerializedMeshes(
  meshes: SerializedMesh[],
  options: MeshAssemblyOptions,
): Promise<THREE.Group | null> {
  const group = new THREE.Group();
  const timeBudgetMs = options.timeBudgetMs ?? 8;
  const vertexBudget = options.vertexBudget ?? 100_000;
  let pendingVertices = 0;
  let sliceStartedAt = performance.now();

  const cancelled = () => options.signal.aborted || !options.isCurrent();
  const cleanup = () => disposeAssemblyGroup(group);
  const yieldIfNeeded = async (force = false) => {
    if (!force && pendingVertices < vertexBudget && performance.now() - sliceStartedAt < timeBudgetMs) return !cancelled();
    if (cancelled()) return false;
    const yielded = await yieldToFrameOrAbort(options.signal, options.yieldToFrame);
    if (!yielded || cancelled()) return false;
    pendingVertices = 0;
    sliceStartedAt = performance.now();
    return true;
  };

  try {
    for (const serialized of meshes) {
      if (cancelled()) { cleanup(); return null; }
      const attributes = serialized.geometry.attributes;
      const position = attributes.position;
      const normal = attributes.normal;
      if (!position || !normal) throw new Error("Prepared preview geometry requires position and normal attributes");
      const vertexCount = attributeVertexCount(position);
      if (position.itemSize !== 3 || normal.itemSize !== 3 || attributeVertexCount(normal) !== vertexCount) {
        throw new Error("Prepared preview position and normal attributes have incompatible shapes");
      }
      for (const attribute of Object.values(attributes)) {
        if (!Number.isSafeInteger(attribute.itemSize) || attribute.itemSize <= 0 || attribute.array.length !== vertexCount * attribute.itemSize) {
          throw new Error("Prepared preview attribute is malformed");
        }
      }

      if (vertexCount <= ASSEMBLY_CHUNK_VERTEX_LIMIT) {
        const geometry = wrapGeometry(attributes, serialized.geometry.index);
        const mesh = createMesh(geometry, serialized.name, options.createMaterial);
        group.add(mesh);
        pendingVertices += vertexCount;
        if (!(await yieldIfNeeded())) { cleanup(); return null; }
        continue;
      }

      const modelGroup = new THREE.Group();
      modelGroup.name = serialized.name;
      group.add(modelGroup);
      const indexData = serialized.geometry.index;
      const indexArray = indexData?.array;
      if (indexData && (indexData.itemSize !== 1 || indexArray!.length % 3 !== 0)) throw new Error("Prepared preview index is malformed");
      const triangleCount = indexArray ? indexArray.length / 3 : vertexCount / 3;
      if (!indexArray && vertexCount % 3 !== 0) throw new Error("Prepared preview triangle positions are incomplete");
      const indexScratch = new Uint16Array(ASSEMBLY_CHUNK_INDEX_LIMIT);
      const attributeScratch = new Map<string, Float32Array>();
      for (const [name, attribute] of Object.entries(attributes)) {
        attributeScratch.set(name, new Float32Array(ASSEMBLY_CHUNK_VERTEX_LIMIT * attribute.itemSize));
      }
      let sourceToLocal = new Map<number, number>();
      let chunkVertices = 0;
      let chunkIndices = 0;
      let chunkNumber = 0;

      const flushChunk = () => {
        if (chunkIndices === 0) return;
        const geometry = new THREE.BufferGeometry();
        for (const [name, attribute] of Object.entries(attributes)) {
          const output = attributeScratch.get(name)!;
          const length = chunkVertices * attribute.itemSize;
          geometry.setAttribute(name, new THREE.BufferAttribute(output.subarray(0, length), attribute.itemSize, attribute.normalized));
        }
        geometry.setIndex(new THREE.BufferAttribute(indexScratch.slice(0, chunkIndices), 1));
        modelGroup.add(createMesh(geometry, chunkNumber === 0 ? serialized.name : `${serialized.name}#${chunkNumber + 1}`, options.createMaterial));
        chunkNumber += 1;
        sourceToLocal = new Map<number, number>();
        chunkVertices = 0;
        chunkIndices = 0;
      };

      for (let triangle = 0; triangle < triangleCount; triangle += 1) {
        if (triangle % COOPERATIVE_CHECK_TRIANGLES === 0 && cancelled()) { cleanup(); return null; }
        const indexOffset = triangle * 3;
        const source0 = indexArray ? indexArray[indexOffset] : indexOffset;
        const source1 = indexArray ? indexArray[indexOffset + 1] : indexOffset + 1;
        const source2 = indexArray ? indexArray[indexOffset + 2] : indexOffset + 2;
        if (!Number.isSafeInteger(source0) || source0 < 0 || source0 >= vertexCount
          || !Number.isSafeInteger(source1) || source1 < 0 || source1 >= vertexCount
          || !Number.isSafeInteger(source2) || source2 < 0 || source2 >= vertexCount) {
          throw new Error("Prepared preview index is malformed");
        }
        let newVertices = Number(!sourceToLocal.has(source0));
        if (source1 !== source0 && !sourceToLocal.has(source1)) newVertices += 1;
        if (source2 !== source0 && source2 !== source1 && !sourceToLocal.has(source2)) newVertices += 1;
        if (chunkVertices + newVertices > ASSEMBLY_CHUNK_VERTEX_LIMIT || chunkIndices + 3 > ASSEMBLY_CHUNK_INDEX_LIMIT) {
          flushChunk();
        }

        for (let corner = 0; corner < 3; corner += 1) {
          const sourceIndex = corner === 0 ? source0 : corner === 1 ? source1 : source2;
          let localIndex = sourceToLocal.get(sourceIndex);
          if (localIndex === undefined) {
            localIndex = chunkVertices++;
            sourceToLocal.set(sourceIndex, localIndex);
            for (const [name, attribute] of Object.entries(attributes)) {
              const output = attributeScratch.get(name)!;
              const sourceOffset = sourceIndex * attribute.itemSize;
              const targetOffset = localIndex * attribute.itemSize;
              for (let component = 0; component < attribute.itemSize; component += 1) {
                output[targetOffset + component] = attribute.array[sourceOffset + component];
              }
            }
          }
          indexScratch[chunkIndices++] = localIndex;
        }
        pendingVertices += 3;
        if ((triangle + 1) % COOPERATIVE_CHECK_TRIANGLES === 0 && !(await yieldIfNeeded())) { cleanup(); return null; }
      }
      flushChunk();
      if (!(await yieldIfNeeded())) { cleanup(); return null; }
    }
    if (cancelled()) { cleanup(); return null; }
    return group;
  } catch (error) {
    cleanup();
    throw error;
  }
}

function attributeVertexCount(position: SerializedAttribute) {
  if (!Number.isSafeInteger(position.itemSize) || position.itemSize <= 0 || position.array.length % position.itemSize !== 0) {
    throw new Error("Prepared preview position attribute is malformed");
  }
  return position.array.length / position.itemSize;
}

function wrapGeometry(attributes: Record<string, SerializedAttribute>, index: { array: Uint16Array | Uint32Array } | null) {
  const geometry = new THREE.BufferGeometry();
  for (const [name, attribute] of Object.entries(attributes)) {
    geometry.setAttribute(name, new THREE.BufferAttribute(attribute.array, attribute.itemSize, attribute.normalized));
  }
  if (index) geometry.setIndex(new THREE.BufferAttribute(index.array, 1));
  return geometry;
}

function createMesh(geometry: THREE.BufferGeometry, name: string, createMaterial: () => THREE.Material) {
  const mesh = new THREE.Mesh(geometry, createMaterial());
  mesh.name = name;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

export function disposeAssemblyGroup(group: THREE.Object3D) {
  group.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    child.geometry.dispose();
    if (Array.isArray(child.material)) child.material.forEach((material) => material.dispose());
    else child.material.dispose();
  });
}

export async function yieldToFrameOrAbort(signal: AbortSignal, yieldToFrame: () => Promise<void>) {
  if (signal.aborted) return false;
  let removeAbort = () => {};
  try {
    return await new Promise<boolean>((resolve, reject) => {
      let settled = false;
      const finish = (value: boolean) => {
        if (settled) return;
        settled = true;
        removeAbort();
        resolve(value);
      };
      const onAbort = () => finish(false);
      removeAbort = () => signal.removeEventListener("abort", onAbort);
      signal.addEventListener("abort", onAbort, { once: true });
      if (signal.aborted) { finish(false); return; }
      void yieldToFrame().then(() => finish(!signal.aborted), (error) => {
        if (settled) return;
        settled = true;
        removeAbort();
        reject(error);
      });
    });
  } finally {
    removeAbort();
  }
}
