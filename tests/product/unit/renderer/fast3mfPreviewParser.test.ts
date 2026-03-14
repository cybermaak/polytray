import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import * as THREE from 'three';

import { parseFast3mfPreviewGroup } from '../../../../src/renderer/lib/fast3mfPreviewParser';

async function make3mf(modelXml: string): Promise<ArrayBuffer> {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types></Types>');
  zip.file('3D/3dmodel.model', modelXml);
  const uint8 = await zip.generateAsync({ type: 'uint8array' });
  return uint8.buffer.slice(uint8.byteOffset, uint8.byteOffset + uint8.byteLength);
}

function getWorldBoundingBox(object: THREE.Object3D) {
  object.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(object);
}

test('parseFast3mfPreviewGroup builds a mesh from a simple 3MF model and ignores material properties', async () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
  <model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
    <resources>
      <basematerials id="9"><base name="Blue" displaycolor="#0000FF"/></basematerials>
      <object id="1" type="model">
        <mesh>
          <vertices>
            <vertex x="0" y="0" z="0"/>
            <vertex x="1" y="0" z="0"/>
            <vertex x="0" y="1" z="0"/>
          </vertices>
          <triangles>
            <triangle v1="0" v2="1" v3="2" pid="9" p1="0"/>
          </triangles>
        </mesh>
      </object>
    </resources>
    <build>
      <item objectid="1" transform="1 0 0 0 1 0 0 0 1 10 20 30"/>
    </build>
  </model>`;

  const group = await parseFast3mfPreviewGroup(await make3mf(xml));
  const box = getWorldBoundingBox(group);

  assert.equal(group.children.length, 1);
  assert.equal(group.children[0] instanceof THREE.Mesh, true);
  assert.deepEqual(box.min.toArray(), [10, 20, 30]);
  assert.deepEqual(box.max.toArray(), [11, 21, 30]);
});

test('parseFast3mfPreviewGroup resolves component objects recursively with transforms', async () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
  <model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
    <resources>
      <object id="1" type="model">
        <mesh>
          <vertices>
            <vertex x="0" y="0" z="0"/>
            <vertex x="1" y="0" z="0"/>
            <vertex x="0" y="1" z="0"/>
          </vertices>
          <triangles>
            <triangle v1="0" v2="1" v3="2"/>
          </triangles>
        </mesh>
      </object>
      <object id="2" type="model">
        <components>
          <component objectid="1" transform="1 0 0 0 1 0 0 0 1 5 0 0"/>
          <component objectid="1" transform="1 0 0 0 1 0 0 0 1 0 7 0"/>
        </components>
      </object>
    </resources>
    <build>
      <item objectid="2"/>
    </build>
  </model>`;

  const group = await parseFast3mfPreviewGroup(await make3mf(xml));
  const box = getWorldBoundingBox(group);

  assert.equal(group.children.length, 1);
  assert.equal(group.children[0] instanceof THREE.Group, true);
  assert.deepEqual(box.min.toArray(), [0, 0, 0]);
  assert.deepEqual(box.max.toArray(), [6, 8, 0]);
});
