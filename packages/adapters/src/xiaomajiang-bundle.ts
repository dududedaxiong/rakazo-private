import { createHmac, pbkdf2Sync, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { BOT_INSTRUCTIONS_MAX_LENGTH } from "@rakazo_mickvvw/contracts";
import { parseSkillMd } from "@rakazo_mickvvw/core";

/**
 * The 小码酱 installer bundle: one encrypted line carrying the persona template
 * and its skills. The format mirrors the obfuscated-secrets scheme already
 * proven on another service: PBKDF2-HMAC-SHA256 derives the key, an HMAC
 * keystream XORs the plaintext, and an HMAC tag is verified before anything
 * is decrypted. No plaintext ever travels with the bundle; the passphrase
 * only ever lives in the server environment.
 *
 * Format: `XMJ1.<salt>.<nonce>.<tag>.<ciphertext>`, each part urlsafe base64.
 */

export const XIAOMAJIANG_BUNDLE_MAGIC = "XMJ1";
export const XIAOMAJIANG_PASSPHRASE_ENV = "XIAOMAJIANG_PASSPHRASE";
export const XIAOMAJIANG_BUNDLE_FILE_ENV = "XIAOMAJIANG_BUNDLE_FILE";

const PBKDF2_ITERATIONS = 200_000;
const KEY_LEN = 32;
const SALT_BYTES = 16;
const NONCE_BYTES = 16;
const TAG_BYTES = 32;
const MIN_TEMPLATE_CONTENT_CHARS = 1000;
const MAX_SKILL_CONTENT_CHARS = 100_000;

export type XiaomajiangBundleSkill = {
  name: string;
  description: string;
  content: string;
};

export type XiaomajiangBundlePayload = {
  version: 1;
  templateContent: string;
  skills: XiaomajiangBundleSkill[];
};

function b64e(raw: Buffer): string {
  return raw.toString("base64url");
}

function b64d(text: string): Buffer {
  return Buffer.from(text, "base64url");
}

function deriveKey(passphrase: string, salt: Buffer): Buffer {
  return pbkdf2Sync(passphrase, salt, PBKDF2_ITERATIONS, KEY_LEN, "sha256");
}

function keystream(key: Buffer, nonce: Buffer, length: number): Buffer {
  const blocks: Buffer[] = [];
  let counter = 0;
  let produced = 0;
  while (produced < length) {
    const counterBytes = Buffer.alloc(4);
    counterBytes.writeUInt32BE(counter, 0);
    blocks.push(
      createHmac("sha256", key)
        .update(Buffer.concat([nonce, counterBytes]))
        .digest(),
    );
    produced += 32;
    counter += 1;
  }
  return Buffer.concat(blocks).subarray(0, length);
}

function xor(a: Buffer, b: Buffer): Buffer {
  const out = Buffer.alloc(a.length);
  for (let i = 0; i < a.length; i += 1) out[i] = a[i]! ^ b[i]!;
  return out;
}

/** Pack a payload into one ciphertext line. The pack script uses this. */
export function encryptXiaomajiangBundle(passphrase: string, payload: unknown): string {
  if (!passphrase) throw new Error("口令为空。");
  const plain = Buffer.from(JSON.stringify(payload), "utf8");
  const salt = randomBytes(SALT_BYTES);
  const nonce = randomBytes(NONCE_BYTES);
  const key = deriveKey(passphrase, salt);
  const ct = xor(plain, keystream(key, nonce, plain.length));
  const tag = createHmac("sha256", key)
    .update(Buffer.concat([Buffer.from("tag", "utf8"), nonce, ct]))
    .digest();
  return [XIAOMAJIANG_BUNDLE_MAGIC, b64e(salt), b64e(nonce), b64e(tag), b64e(ct)].join(".");
}

/**
 * Verify the tag first, then decrypt. A wrong passphrase, a tampered blob, or
 * a malformed line all throw; nothing decrypted is ever returned on failure.
 */
export function decryptXiaomajiangBundle(passphrase: string, blob: string): unknown {
  if (!passphrase) throw new Error("口令为空。");
  const parts = blob.trim().split(".");
  if (parts.length !== 5 || parts[0] !== XIAOMAJIANG_BUNDLE_MAGIC) {
    throw new Error("不是小码酱安装包。");
  }
  let salt: Buffer;
  let nonce: Buffer;
  let tag: Buffer;
  let ct: Buffer;
  try {
    salt = b64d(parts[1]!);
    nonce = b64d(parts[2]!);
    tag = b64d(parts[3]!);
    ct = b64d(parts[4]!);
  } catch {
    throw new Error("密文格式错误。");
  }
  if (salt.length !== SALT_BYTES || nonce.length !== NONCE_BYTES || tag.length !== TAG_BYTES) {
    throw new Error("密文格式错误。");
  }
  const key = deriveKey(passphrase, salt);
  const expected = createHmac("sha256", key)
    .update(Buffer.concat([Buffer.from("tag", "utf8"), nonce, ct]))
    .digest();
  if (!timingSafeEqual(expected, tag)) {
    throw new Error("验签失败：口令错误或密文被篡改。");
  }
  const plain = xor(ct, keystream(key, nonce, ct.length));
  try {
    return JSON.parse(plain.toString("utf8"));
  } catch {
    throw new Error("解密后内容不是合法 JSON。");
  }
}

/** Shape-check a decrypted payload before the installer trusts it. */
export function validateXiaomajiangPayload(value: unknown): XiaomajiangBundlePayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("安装包内容不是合法对象。");
  }
  const { version, templateContent, skills } = value as Record<string, unknown>;
  if (version !== 1) throw new Error("安装包版本不受支持。");
  if (typeof templateContent !== "string" || templateContent.trim().length === 0) {
    throw new Error("安装包里的人设内容为空。");
  }
  if (templateContent.length < MIN_TEMPLATE_CONTENT_CHARS) {
    throw new Error("安装包里的人设内容异常。");
  }
  if (templateContent.length > BOT_INSTRUCTIONS_MAX_LENGTH) {
    throw new Error("安装包里的人设超过长度上限。");
  }
  if (!Array.isArray(skills) || skills.length === 0) {
    throw new Error("安装包里没有技能。");
  }
  const checked = skills.map((skill, index) => {
    if (!skill || typeof skill !== "object" || Array.isArray(skill)) {
      throw new Error(`安装包里第 ${index + 1} 个技能异常。`);
    }
    const { name, description, content } = skill as Record<string, unknown>;
    if (typeof content !== "string") {
      throw new Error(`安装包里技能 ${String(name ?? index + 1)} 没有正文。`);
    }
    if (content.length > MAX_SKILL_CONTENT_CHARS) {
      throw new Error(`安装包里技能 ${String(name ?? index + 1)} 的正文超过长度上限。`);
    }
    const parsed = parseSkillMd(content);
    if ("error" in parsed) {
      throw new Error(`安装包里技能 ${String(name ?? index + 1)} 的 SKILL.md 不合法。`);
    }
    if (parsed.name !== name || parsed.description !== description) {
      throw new Error(`安装包里技能 ${String(name)} 的名字或简介与正文不一致。`);
    }
    return { name: parsed.name, description: parsed.description, content };
  });
  return { version: 1, templateContent, skills: checked };
}

/**
 * Where the bundle lives. The environment override wins; then a file mounted
 * next to the deployment, then the copy shipped inside the image.
 */
export function findXiaomajiangBundleFile(): string | null {
  const candidates: string[] = [];
  const envPath = process.env[XIAOMAJIANG_BUNDLE_FILE_ENV]?.trim();
  if (envPath) candidates.push(envPath);
  candidates.push("/app/xiaomajiang.enc");
  candidates.push(path.resolve("src/data/xiaomajiang.enc"));
  candidates.push(path.resolve("apps/api/src/data/xiaomajiang.enc"));
  candidates.push("/app/apps/api/src/data/xiaomajiang.enc");
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/** Read, decrypt, and validate the bundle. Anything wrong throws, fail-closed. */
export function loadXiaomajiangBundle(passphrase: string): XiaomajiangBundlePayload {
  const file = findXiaomajiangBundleFile();
  if (!file) throw new Error("未找到小码酱安装包。");
  let blob: string;
  try {
    blob = readFileSync(file, "utf8");
  } catch {
    throw new Error("小码酱安装包读不出来。");
  }
  return validateXiaomajiangPayload(decryptXiaomajiangBundle(passphrase, blob));
}
