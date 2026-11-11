// sherpa-onnx JNI classes must survive R8. The native library looks up
// OfflineTtsConfig fields by name, so renaming or removing them aborts
// OfflineTts.newFromFile with "JNI DETECTED ERROR IN APPLICATION: fid == null"
// (every TTS listen tap crashed this way, 2026-11-11 device log). The library's
// own consumer rules only keep SherpaOnnxArchiveHelper and ai.onnxruntime.**,
// so the app has to keep com.k2fsa.sherpa.onnx.** itself.
const fs = require("node:fs");
const path = require("node:path");
const { withDangerousMod } = require("expo/config-plugins");

const SHERPA_JNI_PACKAGE = "com.k2fsa.sherpa.onnx";
const SHERPA_KEEP_RULE = `-keep class ${SHERPA_JNI_PACKAGE}.** { *; }`;
const SHERPA_KEEP_COMMENT = [
  "# sherpa-onnx JNI: the native library looks up OfflineTtsConfig fields by name,",
  "# so R8 must not rename or remove them. Renaming aborts OfflineTts.newFromFile",
  '# with "JNI DETECTED ERROR IN APPLICATION: fid == null" (2026-11-11 device log).',
].join("\n");

function appendSherpaProguardRules(contents) {
  if (contents.includes(SHERPA_JNI_PACKAGE)) return contents;
  const block = `${SHERPA_KEEP_COMMENT}\n${SHERPA_KEEP_RULE}\n`;
  const prefix = contents.length > 0 && !contents.endsWith("\n") ? "\n" : "";
  return `${contents}${prefix}\n${block}`;
}

function withSherpaProguard(config) {
  return withDangerousMod(config, [
    "android",
    async (config) => {
      const proguardPath = path.join(
        config.modRequest.platformProjectRoot,
        "app",
        "proguard-rules.pro",
      );
      const contents = fs.readFileSync(proguardPath, "utf8");
      fs.writeFileSync(proguardPath, appendSherpaProguardRules(contents));
      return config;
    },
  ]);
}

module.exports = withSherpaProguard;
module.exports.appendSherpaProguardRules = appendSherpaProguardRules;
