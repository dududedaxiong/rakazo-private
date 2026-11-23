import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import type { XiaomajiangBundlePayload } from "./xiaomajiang-bundle.js";
import {
  decryptXiaomajiangBundle,
  encryptXiaomajiangBundle,
  findXiaomajiangBundleFile,
  loadXiaomajiangBundle,
  validateXiaomajiangPayload,
  XIAOMAJIANG_BUNDLE_FILE_ENV,
} from "./xiaomajiang-bundle.js";

const PASSPHRASE = "test-passphrase-not-a-secret";

function fakePayload(): XiaomajiangBundlePayload {
  return {
    version: 1,
    templateContent: `你是小码酱。${"行为准则。".repeat(200)}`,
    skills: [
      {
        name: "passive-recon",
        description: "被动侦察",
        content: "---\nname: passive-recon\ndescription: 被动侦察\n---\n\n收集公开信息。",
      },
    ],
  };
}

describe("xiaomajiang bundle codec", () => {
  it("round-trips a payload and validates it", () => {
    const payload = fakePayload();
    const blob = encryptXiaomajiangBundle(PASSPHRASE, payload);
    expect(blob.split(".")[0]).toBe("XMJ1");
    expect(validateXiaomajiangPayload(decryptXiaomajiangBundle(PASSPHRASE, blob))).toEqual(payload);
  });

  it("refuses an empty passphrase", () => {
    expect(() => encryptXiaomajiangBundle("", fakePayload())).toThrow("口令为空");
    expect(() =>
      decryptXiaomajiangBundle("", encryptXiaomajiangBundle(PASSPHRASE, fakePayload())),
    ).toThrow("口令为空");
  });

  it("refuses a wrong passphrase", () => {
    const blob = encryptXiaomajiangBundle(PASSPHRASE, fakePayload());
    expect(() => decryptXiaomajiangBundle("wrong-passphrase", blob)).toThrow("验签失败");
  });

  it("refuses a tampered blob", () => {
    const blob = encryptXiaomajiangBundle(PASSPHRASE, fakePayload());
    const parts = blob.split(".");
    const first = parts[4]![0] === "A" ? "B" : "A";
    const tampered = [...parts.slice(0, 4), `${first}${parts[4]!.slice(1)}`].join(".");
    expect(() => decryptXiaomajiangBundle(PASSPHRASE, tampered)).toThrow("验签失败");
  });

  it("refuses malformed blobs", () => {
    expect(() => decryptXiaomajiangBundle(PASSPHRASE, "not-a-bundle")).toThrow("不是小码酱安装包");
    expect(() => decryptXiaomajiangBundle(PASSPHRASE, "XMJ1.a.b")).toThrow("不是小码酱安装包");
    expect(() => decryptXiaomajiangBundle(PASSPHRASE, "TGDL1.a.b.c.d")).toThrow("不是小码酱安装包");
  });

  it("rejects payloads with a bad shape", () => {
    expect(() => validateXiaomajiangPayload(null)).toThrow("不是合法对象");
    expect(() => validateXiaomajiangPayload({ version: 2 })).toThrow("版本不受支持");
    expect(() =>
      validateXiaomajiangPayload({ version: 1, templateContent: "x", skills: [] }),
    ).toThrow("人设内容异常");
    expect(() =>
      validateXiaomajiangPayload({
        version: 1,
        templateContent: "x".repeat(30_001),
        skills: fakePayload().skills,
      }),
    ).toThrow("超过长度上限");
    expect(() =>
      validateXiaomajiangPayload({
        version: 1,
        templateContent: fakePayload().templateContent,
        skills: [],
      }),
    ).toThrow("没有技能");
  });

  it("rejects skills whose declared fields do not match their SKILL.md", () => {
    const payload = fakePayload();
    payload.skills[0]!.description = "另一个简介";
    expect(() => validateXiaomajiangPayload(payload)).toThrow("名字或简介与正文不一致");
    const bad = fakePayload();
    bad.skills[0]!.content = "no frontmatter here";
    expect(() => validateXiaomajiangPayload(bad)).toThrow("SKILL.md 不合法");
  });

  it("decrypts blobs the pack script produces (same format, both sides)", () => {
    const script = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "..",
      "..",
      "..",
      "scripts",
      "build-xiaomajiang-bundle.mjs",
    );
    const blob = execFileSync(process.execPath, [script, "--self-test"], {
      encoding: "utf8",
      env: { ...process.env, XIAOMAJIANG_PASSPHRASE: PASSPHRASE },
    }).trim();
    const payload = validateXiaomajiangPayload(decryptXiaomajiangBundle(PASSPHRASE, blob));
    expect(payload.skills).toHaveLength(1);
    expect(payload.skills[0]?.name).toBe("passive-recon");
  });

  it("loads a bundle from the environment override path", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "xmj-"));
    const file = path.join(dir, "xiaomajiang.enc");
    writeFileSync(file, encryptXiaomajiangBundle(PASSPHRASE, fakePayload()));
    vi.stubEnv(XIAOMAJIANG_BUNDLE_FILE_ENV, file);
    try {
      expect(findXiaomajiangBundleFile()).toBe(file);
      expect(loadXiaomajiangBundle(PASSPHRASE).skills).toHaveLength(1);
      expect(() => loadXiaomajiangBundle("wrong-passphrase")).toThrow("验签失败");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("reports a missing bundle instead of installing anything", () => {
    vi.stubEnv(XIAOMAJIANG_BUNDLE_FILE_ENV, "/definitely/not/here.enc");
    try {
      expect(findXiaomajiangBundleFile()).toBeNull();
      expect(() => loadXiaomajiangBundle(PASSPHRASE)).toThrow("未找到小码酱安装包");
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
