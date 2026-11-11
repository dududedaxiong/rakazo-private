import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { appendSherpaProguardRules } from "./with-sherpa-proguard.js";

const require = createRequire(import.meta.url);
const expoTemplateTgz = join(dirname(require.resolve("expo/package.json")), "template.tgz");
// Append to the pinned package's prebuild template so a template change that
// already keeps the sherpa JNI package fails here instead of at Android prebuild.
const TEMPLATE = execFileSync(
  "tar",
  ["-xOf", expoTemplateTgz, "package/android/app/proguard-rules.pro"],
  {
    encoding: "utf8",
  },
);

describe("appendSherpaProguardRules", () => {
  it("keeps the sherpa-onnx JNI package with an explanation", () => {
    const result = appendSherpaProguardRules(TEMPLATE);

    expect(result).toContain("-keep class com.k2fsa.sherpa.onnx.** { *; }");
    expect(result).toContain("JNI DETECTED ERROR IN APPLICATION: fid == null");
    expect(result.startsWith(TEMPLATE)).toBe(true);
  });

  it("is idempotent", () => {
    const once = appendSherpaProguardRules(TEMPLATE);
    expect(appendSherpaProguardRules(once)).toBe(once);
  });

  it("does not duplicate an existing keep rule", () => {
    const withRule = `${TEMPLATE}\n-keep class com.k2fsa.sherpa.onnx.** { *; }\n`;
    expect(appendSherpaProguardRules(withRule)).toBe(withRule);
  });

  it("keeps the file newline-terminated when the input is not", () => {
    const result = appendSherpaProguardRules("# rules");
    expect(result).toBe(
      '# rules\n\n# sherpa-onnx JNI: the native library looks up OfflineTtsConfig fields by name,\n# so R8 must not rename or remove them. Renaming aborts OfflineTts.newFromFile\n# with "JNI DETECTED ERROR IN APPLICATION: fid == null" (2026-11-11 device log).\n-keep class com.k2fsa.sherpa.onnx.** { *; }\n',
    );
  });
});
