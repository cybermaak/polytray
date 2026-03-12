import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { _electron as electron } from "playwright";
import * as THREE from "three";
import { STLExporter } from "three/examples/jsm/exporters/STLExporter.js";
import { OBJExporter } from "three/examples/jsm/exporters/OBJExporter.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const mainEntry = path.join(repoRoot, "out/main/index.js");
const screenshotPath = path.join(repoRoot, "docs/assets/screenshot.png");
const demoPath = path.join(repoRoot, "docs/assets/polytray_demo.webp");
const defaultRuntimeSettings = {
  thumbnail_timeout: 20000,
  scanning_batch_size: 50,
  watcher_stability: 1000,
  page_size: 500,
  thumbnailColor: "#8888aa",
};

class HelixCurve extends THREE.Curve {
  constructor(radius, height, turns) {
    super();
    this.radius = radius;
    this.height = height;
    this.turns = turns;
  }

  getPoint(t, target = new THREE.Vector3()) {
    const angle = t * Math.PI * 2 * this.turns;
    const y = (t - 0.5) * this.height;
    return target.set(
      Math.cos(angle) * this.radius,
      y,
      Math.sin(angle) * this.radius,
    );
  }
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function cloneForExport(object3d) {
  const clone = object3d.clone(true);
  clone.updateMatrixWorld(true);
  return clone;
}

function writeBinaryFile(filePath, data) {
  if (data instanceof DataView) {
    fs.writeFileSync(
      filePath,
      Buffer.from(data.buffer, data.byteOffset, data.byteLength),
    );
    return;
  }

  if (ArrayBuffer.isView(data)) {
    fs.writeFileSync(
      filePath,
      Buffer.from(data.buffer, data.byteOffset, data.byteLength),
    );
    return;
  }

  if (data instanceof ArrayBuffer) {
    fs.writeFileSync(filePath, Buffer.from(data));
    return;
  }

  throw new Error(`Unsupported binary payload for ${filePath}`);
}

function writeStl(filePath, object3d) {
  const exporter = new STLExporter();
  const payload = exporter.parse(cloneForExport(object3d), { binary: true });
  writeBinaryFile(filePath, payload);
}

function writeObj(filePath, object3d) {
  const exporter = new OBJExporter();
  fs.writeFileSync(filePath, exporter.parse(cloneForExport(object3d)), "utf8");
}

function makeMesh(geometry) {
  return new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({ color: 0x9999bb }),
  );
}

function makeRoundedCup() {
  const points = [
    [0, 0],
    [12, 0],
    [13, 2],
    [14, 8],
    [15, 18],
    [15, 24],
    [14, 30],
    [12, 34],
    [0, 34],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  const geometry = new THREE.LatheGeometry(points, 72);
  return makeMesh(geometry);
}

function makeSpring() {
  const curve = new HelixCurve(13, 42, 3.6);
  const geometry = new THREE.TubeGeometry(curve, 220, 2.8, 24, false);
  return makeMesh(geometry);
}

function makeStudioRing() {
  return makeMesh(new THREE.TorusGeometry(16, 5.2, 28, 72));
}

function makeTwistKnot() {
  return makeMesh(new THREE.TorusKnotGeometry(13, 3.5, 180, 24, 2, 5));
}

function makePlate() {
  const group = new THREE.Group();
  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(18, 18, 2.4, 72),
    new THREE.MeshStandardMaterial({ color: 0x9999bb }),
  );
  const lip = new THREE.Mesh(
    new THREE.TorusGeometry(15, 1.4, 16, 72),
    new THREE.MeshStandardMaterial({ color: 0x9999bb }),
  );
  lip.rotation.x = Math.PI / 2;
  lip.position.y = 1.1;
  group.add(base, lip);
  return group;
}

function makeBracket() {
  const material = new THREE.MeshStandardMaterial({ color: 0x9999bb });
  const group = new THREE.Group();
  const base = new THREE.Mesh(new THREE.BoxGeometry(34, 4, 18), material);
  const wall = new THREE.Mesh(new THREE.BoxGeometry(6, 28, 18), material);
  wall.position.set(-14, 12, 0);
  const rib = new THREE.Mesh(new THREE.BoxGeometry(18, 16, 4), material);
  rib.rotation.z = Math.PI / 4;
  rib.position.set(-6, 8, 0);
  group.add(base, wall, rib);
  return group;
}

function makeWingTray() {
  const shape = new THREE.Shape();
  shape.moveTo(-26, -8);
  shape.lineTo(14, -12);
  shape.lineTo(26, 0);
  shape.lineTo(12, 12);
  shape.lineTo(-26, 8);
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: 2.8,
    bevelEnabled: true,
    bevelSegments: 2,
    bevelSize: 0.6,
    bevelThickness: 0.5,
  });
  geometry.center();
  return makeMesh(geometry);
}

function makeVase() {
  const profile = [
    [0, 0],
    [7, 0],
    [8, 4],
    [9, 12],
    [13, 18],
    [14, 30],
    [10, 42],
    [8, 52],
    [0, 52],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  return makeMesh(new THREE.LatheGeometry(profile, 80));
}

function makeBlockStack() {
  const material = new THREE.MeshStandardMaterial({ color: 0x9999bb });
  const group = new THREE.Group();
  const lower = new THREE.Mesh(new THREE.BoxGeometry(18, 10, 18), material);
  const upper = new THREE.Mesh(new THREE.BoxGeometry(12, 8, 12), material);
  const cap = new THREE.Mesh(new THREE.BoxGeometry(8, 6, 8), material);
  upper.position.y = 9;
  cap.position.y = 16;
  group.add(lower, upper, cap);
  return group;
}

function buildDemoLibrary(libraryDir) {
  ensureDir(libraryDir);

  const entries = [
    ["Arc_Spring.stl", makeSpring(), "stl"],
    ["Studio_Ring.stl", makeStudioRing(), "stl"],
    ["Lathe_Cup.stl", makeRoundedCup(), "stl"],
    ["Display_Plate.stl", makePlate(), "stl"],
    ["Bracket_Block.obj", makeBracket(), "obj"],
    ["Wing_Tray.obj", makeWingTray(), "obj"],
    ["Twist_Knot.stl", makeTwistKnot(), "stl"],
    ["Gallery_Vase.stl", makeVase(), "stl"],
    ["Stack_Block.obj", makeBlockStack(), "obj"],
    ["Spring_Compact.stl", makeSpring(), "stl"],
    ["Ring_Low.obj", makeStudioRing(), "obj"],
    ["Plate_Mini.stl", makePlate(), "stl"],
  ];

  for (const [fileName, object3d, type] of entries) {
    const filePath = path.join(libraryDir, fileName);
    if (type === "stl") {
      writeStl(filePath, object3d);
    } else {
      writeObj(filePath, object3d);
    }
  }
}

async function waitForMainWindow(app) {
  for (let attempt = 0; attempt < 20; attempt++) {
    for (const page of app.windows()) {
      try {
        await page.locator("#search-input").waitFor({ timeout: 1000 });
        return page;
      } catch {
        // Keep probing until the main UI is ready.
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Main window did not become ready");
}

async function waitForGrid(page) {
  await page.waitForFunction(async () => {
    const result = await window.polytray.getFiles({ limit: 200, offset: 0 });
    return result.files.length >= 10;
  }, { timeout: 30000 });
  await page.waitForFunction(
    () => document.querySelectorAll(".file-card").length >= 8,
    { timeout: 30000 },
  );
}

async function waitForThumbnails(page, minimumLoaded = 8) {
  await page.waitForFunction(
    (count) => document.querySelectorAll(".file-card img").length >= count,
    minimumLoaded,
    { timeout: 60000 },
  );
}

async function clearUi(page) {
  const settingsClasses = (await page.locator("#settings-overlay").getAttribute("class")) || "";
  if (!settingsClasses.includes("hidden")) {
    await page.locator("#settings-close").click();
    await page.waitForTimeout(250);
  }

  const previewClasses = (await page.locator("#preview-panel").getAttribute("class")) || "";
  if (!previewClasses.includes("hidden")) {
    await page.locator("#btn-close-viewer").click();
    await page.waitForTimeout(400);
  }

  await page.locator("#search-input").fill("");
  await page.waitForTimeout(250);
}

async function captureFrame(page, filePath) {
  await page.screenshot({ path: filePath });
}

function buildAnimatedWebp(framesDir) {
  const durations = [1200, 1000, 1200, 1100, 1200];
  const inputs = ["-loop", "0", "-lossy", "-q", "82"];
  for (let i = 0; i < durations.length; i++) {
    inputs.push("-d", String(durations[i]), path.join(framesDir, `frame-${i}.png`));
  }
  execFileSync("img2webp", [...inputs, "-o", demoPath], {
    cwd: repoRoot,
    stdio: "inherit",
  });
}

async function main() {
  if (!fs.existsSync(mainEntry)) {
    throw new Error("Built app not found. Run `npm run build` first.");
  }

  const demoRoot = path.join("/tmp", "polytray-readme-demo");
  const demoLibrary = path.join(demoRoot, "Polytray Demo Library");
  const userData = path.join(demoRoot, "user-data");
  const framesDir = path.join(demoRoot, "frames");
  fs.rmSync(demoRoot, { recursive: true, force: true });
  ensureDir(userData);
  ensureDir(framesDir);
  buildDemoLibrary(demoLibrary);

  let app;
  try {
    app = await electron.launch({
      args: [mainEntry, `--user-data-dir=${userData}`],
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "",
        ELECTRON_USER_DATA: userData,
      },
    });

    const page = await waitForMainWindow(app);
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(1200);

    await page.evaluate(({ folderPath, settings }) => window.polytray.scanFolder(folderPath, settings), {
      folderPath: demoLibrary,
      settings: defaultRuntimeSettings,
    });

    await waitForGrid(page);
    await waitForThumbnails(page, 8);
    await page.waitForTimeout(1200);

    await clearUi(page);
    await captureFrame(page, path.join(framesDir, "frame-0.png"));

    await page.locator('#search-input').fill("ring");
    await page.waitForTimeout(400);
    await captureFrame(page, path.join(framesDir, "frame-1.png"));

    const ringCard = page.locator('.file-card', { hasText: 'Studio_Ring' }).first();
    await ringCard.click();
    await page.locator("#viewer-loading").waitFor({ state: "visible", timeout: 10000 }).catch(() => {});
    await page.waitForFunction(
      () => document.querySelector("#viewer-loading")?.className.includes("hidden"),
      { timeout: 30000 },
    );
    await page.waitForTimeout(800);
    await captureFrame(page, path.join(framesDir, "frame-2.png"));

    await page.locator("#btn-wireframe").click();
    await page.waitForTimeout(450);
    await captureFrame(page, path.join(framesDir, "frame-3.png"));

    await page.locator("#btn-close-viewer").click();
    await page.waitForTimeout(300);
    await page.locator("#search-input").fill("");
    await page.waitForTimeout(250);
    await page.locator('.file-card', { hasText: 'Studio_Ring' }).first().click();
    await page.waitForFunction(
      () => document.querySelector("#viewer-loading")?.className.includes("hidden"),
      { timeout: 30000 },
    );
    await page.waitForTimeout(700);
    await captureFrame(page, screenshotPath);

    await page.locator("#btn-close-viewer").click();
    await page.waitForTimeout(300);
    await page.locator("#btn-settings").click();
    await page.waitForTimeout(450);
    await captureFrame(page, path.join(framesDir, "frame-4.png"));

    buildAnimatedWebp(framesDir);
  } finally {
    if (app) {
      await app.close();
    }
    fs.rmSync(demoRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
