/**
 * threemf-repair.ts — Repairs malformed 3MF archives from various slicers.
 *
 * Some slicers (PrusaSlicer, Bambu Studio, etc.) produce 3MF files with
 * missing XML namespace declarations or external sub-model references that
 * Three.js's ThreeMFLoader cannot parse. This module repairs such archives
 * by inlining sub-model references and fixing namespace declarations.
 */
import JSZip from "jszip";

/**
 * Attempts to repair common issues in 3MF archives.
 * Returns the original buffer if no repairs were needed.
 */
export async function fix3MF(buffer: ArrayBuffer): Promise<ArrayBuffer> {
  try {
    const zip = await JSZip.loadAsync(buffer);
    let mainModelFile = null;
    for (const filename of Object.keys(zip.files)) {
      if (
        filename.toLowerCase() === "3d/3dmodel.model" ||
        filename.toLowerCase() === "/3d/3dmodel.model"
      ) {
        mainModelFile = filename;
        break;
      }
    }
    if (!mainModelFile) return buffer;

    const repairXmlString = (xmlString: string) => {
      let fixed = xmlString;
      if (fixed.includes("p:") && !fixed.includes("xmlns:p=")) {
        fixed = fixed.replace(
          /<model\s+/,
          '<model xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06" ',
        );
      }
      if (fixed.includes("slic3rpe:") && !fixed.includes("xmlns:slic3rpe=")) {
        fixed = fixed.replace(
          /<model\s+/,
          '<model xmlns:slic3rpe="http://schemas.slic3r.org/3mf/2017/06" ',
        );
      }
      return fixed;
    };

    const mainXml = await zip.file(mainModelFile)!.async("string");
    const repairedMainXml = repairXmlString(mainXml);
    let modified = repairedMainXml !== mainXml;

    const parser = new DOMParser();
    const doc = parser.parseFromString(repairedMainXml, "application/xml");
    const resources = doc.querySelector("resources");
    if (!resources) return buffer;

    const components = doc.querySelectorAll("component");

    for (const comp of components) {
      const pathAttr =
        comp.getAttribute("path") ||
        comp.getAttribute("p:path") ||
        comp.getAttribute("slic3rpe:path");

      if (pathAttr) {
        let subFile = pathAttr;
        if (subFile.startsWith("/")) subFile = subFile.substring(1);

        if (zip.file(subFile)) {
          let subXml = await zip.file(subFile)!.async("string");
          subXml = repairXmlString(subXml);

          const subDoc = parser.parseFromString(subXml, "application/xml");
          const subObjects = subDoc.querySelectorAll("object");

          for (const obj of subObjects) {
            const oldId = obj.getAttribute("id");
            if (!oldId) continue;

            const newId = subFile.replace(/[^a-zA-Z0-9]/g, "_") + "_" + oldId;
            obj.setAttribute("id", newId);

            // If this component specifically requested this objectId, update it
            if (comp.getAttribute("objectid") === oldId) {
              comp.setAttribute("objectid", newId);
            }

            // Remove the reference to the external file so ThreeMFLoader looks locally
            comp.removeAttribute("path");
            comp.removeAttribute("p:path");
            comp.removeAttribute("slic3rpe:path");

            resources.appendChild(doc.importNode(obj, true));
            modified = true;
          }
        }
      }
    }

    if (modified) {
      const serializer = new XMLSerializer();
      const newXml = serializer.serializeToString(doc);
      zip.file(mainModelFile, newXml);
      return await zip.generateAsync({ type: "arraybuffer" });
    }
  } catch (e) {
    console.warn("Failed attempting to auto-repair 3MF zip contents:", e);
  }
  return buffer;
}
