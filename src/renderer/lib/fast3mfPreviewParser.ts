import * as THREE from "three";
import JSZip from "jszip";

import { prepare3mfGeometry } from "./meshPrep";

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

export async function parseFast3mfPreviewGroup(
  arrayBuffer: ArrayBuffer,
): Promise<THREE.Group> {
  const zip = await JSZip.loadAsync(arrayBuffer);
  const modelFile = Object.keys(zip.files).find((filename) =>
    filename.toLowerCase() === "3d/3dmodel.model" ||
    filename.toLowerCase() === "/3d/3dmodel.model" ||
    filename.toLowerCase().endsWith(".model"),
  );

  if (!modelFile) {
    throw new Error("3MF preview parser could not find a model file");
  }

  const xml = await zip.file(modelFile)!.async("string");
  return buildGroupFromModelXml(xml);
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
    if (!child) continue;
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
    if (!objectId) continue;

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
    if (!objectId) continue;

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
    positions.push(
      parseFloat(getAttr(attrs, "x") ?? "0"),
      parseFloat(getAttr(attrs, "y") ?? "0"),
      parseFloat(getAttr(attrs, "z") ?? "0"),
    );
  }

  for (const match of xml.matchAll(TRIANGLE_RE)) {
    const attrs = match[1] ?? "";
    indices.push(
      parseInt(getAttr(attrs, "v1") ?? "0", 10),
      parseInt(getAttr(attrs, "v2") ?? "0", 10),
      parseInt(getAttr(attrs, "v3") ?? "0", 10),
    );
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
): THREE.Object3D | null {
  if (seen.has(objectId)) {
    throw new Error(`3MF preview parser detected a component cycle at object ${objectId}`);
  }

  const parsed = objects.get(objectId);
  if (!parsed) {
    return null;
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
      if (!child) continue;
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
    return null;
  }

  const [a, b, c, d, e, f, g, h, i, j, k, l] = values;
  return new THREE.Matrix4().set(
    a, b, c, j,
    d, e, f, k,
    g, h, i, l,
    0, 0, 0, 1,
  );
}

function getAttr(attrs: string, name: string): string | null {
  const match = attrs.match(
    new RegExp(`(?:^|\\s)${name}="([^"]*)"`, "i"),
  );
  return match?.[1] ?? null;
}
