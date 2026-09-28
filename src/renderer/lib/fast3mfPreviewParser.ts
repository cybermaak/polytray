// Compatibility export. New geometry consumers should import the DOM-free shared core.
export {
  buildGroupFromModelXml,
  get3mfUnitScale,
  inspectFast3mfPreviewSupport,
  measureFast3mfBuild,
  parseFast3mfPreviewGroup,
} from '../../shared/model/fast3mfGeometry';
export type { Fast3mfPreviewSupport, Fast3mfBuildMeasurement } from '../../shared/model/fast3mfGeometry';
