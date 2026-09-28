import * as THREE from "three";
import JSZip from "jszip";

import { createAvailableMeasurement, createUnavailableMeasurement, type MeasurementUnit } from './measurement';

const MILLIMETERS_PER_UNIT: Record<string, number> = {
  micron: 0.001,
  millimeter: 1,
  centimeter: 10,
  inch: 25.4,
  foot: 304.8,
  meter: 1000,
};

export function get3mfUnitScale(unit: string | null | undefined): number | null {
  return MILLIMETERS_PER_UNIT[unit ?? 'millimeter'] ?? null;
}

function prepare3mfGeometry(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  const prepared = geometry.index ? geometry.toNonIndexed() : geometry;
  prepared.computeVertexNormals();
  return prepared;
}

interface ParsedBuildItem {
  objectId: string;
  transform: THREE.Matrix4 | null;
}

interface ParsedComponent {
  objectId: string;
  transform: THREE.Matrix4 | null;
}

interface ParsedMeshData {
  positions: Float32Array;
  indices: Uint32Array;
}

type ParsedObject =
  | {
      id: string;
      type: "mesh";
      mesh: ParsedMeshData;
    }
  | {
      id: string;
      type: "components";
      components: ParsedComponent[];
    };

const OBJECT_RE = /<(?:[\w-]+:)?object\b([^>]*)>([\s\S]*?)<\/(?:[\w-]+:)?object>/g;
const MESH_RE = /<(?:[\w-]+:)?mesh\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?mesh>/;
const COMPONENTS_RE = /<(?:[\w-]+:)?components\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?components>/;
const VERTEX_RE = /<(?:[\w-]+:)?vertex\b([^>]*)\/>/g;
const TRIANGLE_RE = /<(?:[\w-]+:)?triangle\b([^>]*)\/>/g;
const COMPONENT_RE = /<(?:[\w-]+:)?component\b([^>]*)\/>/g;
const BUILD_RE = /<(?:[\w-]+:)?build\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?build>/;
const ITEM_RE = /<(?:[\w-]+:)?item\b([^>]*)\/>/g;

export interface Fast3mfPreviewSupport {
  supported: boolean;
  reason?: string;
}

export type Fast3mfBuildMeasurement =
  | { status: 'available'; dimensions: { x: number; y: number; z: number }; unit: 'mm' }
  | { status: 'unavailable'; measurement: ReturnType<typeof createUnavailableMeasurement> };

export async function parseFast3mfPreviewGroup(
  arrayBuffer: ArrayBuffer,
): Promise<THREE.Group> {
  const zip = await JSZip.loadAsync(arrayBuffer);
  const support = await inspectFast3mfPreviewSupportFromZip(zip);
  if (!support.supported) {
    throw new Error(support.reason ?? "3MF preview fast path unsupported");
  }

  const modelFile = getPrimaryModelFile(zip);

  if (!modelFile) {
    throw new Error("3MF preview parser could not find a model file");
  }

  const xml = await zip.file(modelFile)!.async("string");
  return buildGroupFromModelXml(xml);
}

/** Measure instantiated build geometry in source axes, before viewer orientation or normalization. */
export async function measureFast3mfBuild(arrayBuffer: ArrayBuffer): Promise<Fast3mfBuildMeasurement> {
  try {
    const zip = await JSZip.loadAsync(arrayBuffer);
    const support = await inspectFast3mfPreviewSupportFromZip(zip);
    if (!support.supported) return { status: 'unavailable', measurement: createUnavailableMeasurement('mm', support.reason ?? 'Unsupported 3MF structure') };
    const modelFile = getPrimaryModelFile(zip);
    if (!modelFile) return { status: 'unavailable', measurement: createUnavailableMeasurement('mm', '3MF primary model part is unavailable') };
    const xml = await zip.file(modelFile)!.async('string');
    const modelMatch = xml.match(/<(?:[\w-]+:)?model\b([^>]*)>/i);
    if (!modelMatch) return { status: 'unavailable', measurement: createUnavailableMeasurement('mm', '3MF model element is missing or malformed') };
    const unitName = getAttr(modelMatch[1] ?? '', 'unit') ?? 'millimeter';
    const scale = get3mfUnitScale(unitName);
    if (scale === null) return { status: 'unavailable', measurement: createUnavailableMeasurement('mm', `Unsupported 3MF unit: ${unitName}`) };
    const group = buildGroupFromModelXml(xml);
    try {
      group.updateMatrixWorld(true);
      const bounds = new THREE.Box3().setFromObject(group);
      if (bounds.isEmpty()) return { status: 'unavailable', measurement: createUnavailableMeasurement('mm', '3MF build contains no measurable geometry') };
      const size = bounds.getSize(new THREE.Vector3());
      const dimensions = {
        x: roundMeasurement(size.x * scale),
        y: roundMeasurement(size.y * scale),
        z: roundMeasurement(size.z * scale),
      };
      const measured = createAvailableMeasurement(dimensions, 'mm');
      return measured
        ? { status: 'available', dimensions: { x: measured.x, y: measured.y, z: measured.z }, unit: 'mm' }
        : { status: 'unavailable', measurement: createUnavailableMeasurement('mm', '3MF build produced nonfinite bounds') };
    } finally {
      group.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
      });
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { status: 'unavailable', measurement: createUnavailableMeasurement('mm', `3MF measurement unavailable: ${reason}`) };
  }
}

function roundMeasurement(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export async function inspectFast3mfPreviewSupport(
  arrayBuffer: ArrayBuffer,
): Promise<Fast3mfPreviewSupport> {
  const zip = await JSZip.loadAsync(arrayBuffer);
  return inspectFast3mfPreviewSupportFromZip(zip);
}

export function buildGroupFromModelXml(xml: string): THREE.Group {
  const objects = parseObjects(xml);
  const buildItems = parseBuildItems(xml);

  if (buildItems.length === 0) {
    throw new Error("3MF preview parser found no build items");
  }

  const root = new THREE.Group();
  const seen = new Set<string>();

  for (const item of buildItems) {
    const child = instantiateObject(item.objectId, objects, seen);
    if (item.transform) {
      child.applyMatrix4(item.transform);
    }
    root.add(child);
  }

  if (root.children.length === 0) {
    throw new Error("3MF preview parser built an empty scene");
  }

  return root;
}

function parseObjects(xml: string): Map<string, ParsedObject> {
  const objects = new Map<string, ParsedObject>();

  for (const match of xml.matchAll(OBJECT_RE)) {
    const attrs = match[1] ?? "";
    const body = match[2] ?? "";
    const id = getAttr(attrs, "id");
    if (!id) continue;

    const meshMatch = body.match(MESH_RE);
    if (meshMatch) {
      objects.set(id, {
        id,
        type: "mesh",
        mesh: parseMesh(meshMatch[1] ?? ""),
      });
      continue;
    }

    const componentsMatch = body.match(COMPONENTS_RE);
    if (componentsMatch) {
      objects.set(id, {
        id,
        type: "components",
        components: parseComponents(componentsMatch[1] ?? ""),
      });
    }
  }

  return objects;
}

function parseBuildItems(xml: string): ParsedBuildItem[] {
  const buildMatch = xml.match(BUILD_RE);
  if (!buildMatch) {
    return [];
  }

  const items: ParsedBuildItem[] = [];
  for (const match of buildMatch[1].matchAll(ITEM_RE)) {
    const attrs = match[1] ?? "";
    const objectId = getAttr(attrs, "objectid");
    if (!objectId) throw new Error('3MF build item is missing objectid');

    items.push({
      objectId,
      transform: parseTransform(getAttr(attrs, "transform")),
    });
  }

  return items;
}

function parseComponents(xml: string): ParsedComponent[] {
  const components: ParsedComponent[] = [];

  for (const match of xml.matchAll(COMPONENT_RE)) {
    const attrs = match[1] ?? "";
    const objectId = getAttr(attrs, "objectid");
    if (!objectId) throw new Error('3MF component is missing objectid');

    const path = getAttr(attrs, "path");
    if (path) {
      throw new Error("3MF preview parser does not support external component paths");
    }

    components.push({
      objectId,
      transform: parseTransform(getAttr(attrs, "transform")),
    });
  }

  return components;
}

function parseMesh(xml: string): ParsedMeshData {
  const positions: number[] = [];
  const indices: number[] = [];

  for (const match of xml.matchAll(VERTEX_RE)) {
    const attrs = match[1] ?? "";
    const values = ['x', 'y', 'z'].map((name) => Number(getAttr(attrs, name)));
    if (values.some((value) => !Number.isFinite(value))) throw new Error('3MF mesh contains a missing or nonfinite vertex coordinate');
    positions.push(...values);
  }

  for (const match of xml.matchAll(TRIANGLE_RE)) {
    const attrs = match[1] ?? "";
    const triangle = ['v1', 'v2', 'v3'].map((name) => Number(getAttr(attrs, name)));
    if (triangle.some((index) => !Number.isInteger(index) || index < 0 || index >= positions.length / 3)) {
      throw new Error('3MF triangle contains a missing or out-of-range vertex index');
    }
    indices.push(...triangle);
  }

  if (positions.length === 0 || indices.length === 0) {
    throw new Error("3MF preview parser found an empty mesh");
  }

  return {
    positions: new Float32Array(positions),
    indices: new Uint32Array(indices),
  };
}

function instantiateObject(
  objectId: string,
  objects: Map<string, ParsedObject>,
  seen: Set<string>,
): THREE.Object3D {
  if (seen.has(objectId)) {
    throw new Error(`3MF preview parser detected a component cycle at object ${objectId}`);
  }

  const parsed = objects.get(objectId);
  if (!parsed) {
    throw new Error(`3MF build references missing object ${objectId}`);
  }

  seen.add(objectId);
  try {
    if (parsed.type === "mesh") {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute(
        "position",
        new THREE.BufferAttribute(parsed.mesh.positions.slice(), 3),
      );
      geometry.setIndex(new THREE.Uint32BufferAttribute(parsed.mesh.indices.slice(), 1));
      const prepared = prepare3mfGeometry(geometry);
      return new THREE.Mesh(prepared);
    }

    const group = new THREE.Group();
    for (const component of parsed.components) {
      const child = instantiateObject(component.objectId, objects, seen);
      if (component.transform) {
        child.applyMatrix4(component.transform);
      }
      group.add(child);
    }
    return group;
  } finally {
    seen.delete(objectId);
  }
}

function parseTransform(raw: string | null): THREE.Matrix4 | null {
  if (!raw) {
    return null;
  }

  const values = raw.trim().split(/\s+/).map(Number);
  if (values.length !== 12 || values.some((value) => !Number.isFinite(value))) {
    throw new Error('3MF transform is malformed or nonfinite');
  }

  const [a, b, c, d, e, f, g, h, i, j, k, l] = values;
  return new THREE.Matrix4().set(
    a, d, g, j,
    b, e, h, k,
    c, f, i, l,
    0, 0, 0, 1,
  );
}

function getAttr(attrs: string, name: string): string | null {
  const match = attrs.match(
    new RegExp(`(?:^|\\s)${name}="([^"]*)"`, "i"),
  );
  return match?.[1] ?? null;
}

async function inspectFast3mfPreviewSupportFromZip(
  zip: JSZip,
): Promise<Fast3mfPreviewSupport> {
  const modelFiles = Object.keys(zip.files).filter((filename) =>
    filename.toLowerCase().endsWith(".model"),
  );

  if (modelFiles.length !== 1) {
    return {
      supported: false,
      reason: "3MF preview fast path only supports single-model archives",
    };
  }

  const primaryModelFile = getPrimaryModelFile(zip);
  if (!primaryModelFile) {
    return {
      supported: false,
      reason: "3MF preview fast path could not identify the primary model file",
    };
  }

  const raw = zip.file(primaryModelFile);
  if (!raw) {
    return {
      supported: false,
      reason: "3MF preview fast path could not open the primary model file",
    };
  }

  const xmlString = await raw.async("string");

  if (/\b(?:path|p:path|slic3rpe:path)=/i.test(xmlString)) {
    return {
      supported: false,
      reason: "3MF preview fast path does not support external component paths",
    };
  }

  if (
    /<(?:[\w-]+:)?(?:colorgroup|texture2d|texture2dgroup|pbmetallicdisplayproperties)\b/i.test(
      xmlString,
    )
  ) {
    return {
      supported: false,
      reason: "3MF preview fast path does not support color or material resource groups",
    };
  }

  return { supported: true };
}

function getPrimaryModelFile(zip: JSZip): string | null {
  return (
    Object.keys(zip.files).find((filename) =>
      filename.toLowerCase() === "3d/3dmodel.model" ||
      filename.toLowerCase() === "/3d/3dmodel.model",
    ) ??
    Object.keys(zip.files).find((filename) =>
      filename.toLowerCase().endsWith(".model"),
    ) ??
    null
  );
}
