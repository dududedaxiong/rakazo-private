#!/usr/bin/env node
// Build the encrypted 小码酱 installer bundle (xiaomajiang.enc).
//
// The bundle carries the full persona (prompt/default-prompt.md + prompt/kernel.md)
// and the 23 skill files from the upstream plugin, encrypted with the server
// passphrase. Nothing in it is ever printed: the script only reports counts,
// byte sizes, and the output path.
//
//   XIAOMAJIANG_PASSPHRASE=<passphrase> node scripts/build-xiaomajiang-bundle.mjs [--out <path>]
//
// The passphrase is read from the environment only. The default output is
// apps/api/src/data/xiaomajiang.enc (shipped inside the image); pass --out to
// write it next to the deployment instead (XIAOMAJIANG_BUNDLE_FILE points at
// it). After writing, the script reads the file back, decrypts it in process,
// and re-checks the shape — a bad bundle never leaves this script silently.
//
//   node scripts/build-xiaomajiang-bundle.mjs --self-test
//
// prints one encrypted fake payload to stdout (used by the adapters tests to
// prove this script and the server decoder agree on the format).
//
// The codec mirrors packages/adapters/src/xiaomajiang-bundle.ts exactly:
// PBKDF2-HMAC-SHA256 (200,000 rounds) derives the key, an HMAC keystream XORs
// the plaintext, and an HMAC tag is verified before decrypting.
// Format: XMJ1.<salt>.<nonce>.<tag>.<ciphertext>, each part urlsafe base64.
import { createHmac, pbkdf2Sync, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_OWNER = "1505843894";
const REPO_NAME = "hermes-purge";
const PINNED_SHA = "e2ff5c82";
const MAGIC = "XMJ1";
const PBKDF2_ITERATIONS = 200_000;
const KEY_LEN = 32;
const SALT_BYTES = 16;
const NONCE_BYTES = 16;
const TAG_BYTES = 32;
const MAX_TEMPLATE_CHARS = 30_000;
const MIN_TEMPLATE_CHARS = 1000;
const MAX_SKILL_CONTENT_CHARS = 100_000;

// The 23 skills, in the order they are packed. The script fails unless the
// upstream tree at the pinned SHA lists exactly these names.
const EXPECTED_SKILLS = [
  "active-scan",
  "asset-correlation",
  "browser-automation",
  "chisel-tunnel",
  "cn-proxy-pool",
  "credential-attack",
  "dir-bruteforce",
  "fofa-recon",
  "frp-tunnel",
  "fscan-intranet",
  "gogo-intranet",
  "kimi-webbridge",
  "lateral-movement",
  "nuclei-scan",
  "passive-recon",
  "recon-pipeline",
  "redteam-setup",
  "shell-handler",
  "suo5-tunnel",
  "unauth-exploit",
  "vps-reverse-shell",
  "web-fingerprint",
  "webshell-toolkit",
];

// Short catalog labels (4-8 chars) for the skill catalog lines. The server
// catalog shows `- 名字：简介`, so a long English description would cost
// tokens on every turn; these keep each line short.
const SHORT_DESCRIPTIONS = {
  "active-scan": "主动扫描",
  "asset-correlation": "资产关联",
  "browser-automation": "浏览器自动化",
  "chisel-tunnel": "内网隧道",
  "cn-proxy-pool": "国内代理池",
  "credential-attack": "口令攻击",
  "dir-bruteforce": "目录爆破",
  "fofa-recon": "FOFA侦察",
  "frp-tunnel": "内网穿透",
  "fscan-intranet": "内网扫描",
  "gogo-intranet": "内网测绘",
  "kimi-webbridge": "Kimi网桥",
  "lateral-movement": "横向移动",
  "nuclei-scan": "漏洞扫描",
  "passive-recon": "被动侦察",
  "recon-pipeline": "侦察流水线",
  "redteam-setup": "红队部署",
  "shell-handler": "Shell接管",
  "suo5-tunnel": "Suo5隧道",
  "unauth-exploit": "未授权利用",
  "vps-reverse-shell": "反弹Shell",
  "web-fingerprint": "指纹识别",
  "webshell-toolkit": "网站后门",
};

function fail(message) {
  console.error(`build-xiaomajiang-bundle: ${message}`);
  process.exit(1);
}

function b64e(raw) {
  return raw.toString("base64url");
}

function b64d(text) {
  return Buffer.from(text, "base64url");
}

function deriveKey(passphrase, salt) {
  return pbkdf2Sync(passphrase, salt, PBKDF2_ITERATIONS, KEY_LEN, "sha256");
}

function keystream(key, nonce, length) {
  const blocks = [];
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

function xor(a, b) {
  const out = Buffer.alloc(a.length);
  for (let i = 0; i < a.length; i += 1) out[i] = a[i] ^ b[i];
  return out;
}

function encrypt(passphrase, payload) {
  const plain = Buffer.from(JSON.stringify(payload), "utf8");
  const salt = randomBytes(SALT_BYTES);
  const nonce = randomBytes(NONCE_BYTES);
  const key = deriveKey(passphrase, salt);
  const ct = xor(plain, keystream(key, nonce, plain.length));
  const tag = createHmac("sha256", key)
    .update(Buffer.concat([Buffer.from("tag", "utf8"), nonce, ct]))
    .digest();
  return [MAGIC, b64e(salt), b64e(nonce), b64e(tag), b64e(ct)].join(".");
}

function decrypt(passphrase, blob) {
  if (!passphrase) fail("口令为空。");
  const parts = blob.trim().split(".");
  if (parts.length !== 5 || parts[0] !== MAGIC) fail("不是小码酱安装包。");
  const salt = b64d(parts[1]);
  const nonce = b64d(parts[2]);
  const tag = b64d(parts[3]);
  const ct = b64d(parts[4]);
  if (salt.length !== SALT_BYTES || nonce.length !== NONCE_BYTES || tag.length !== TAG_BYTES) {
    fail("密文格式错误。");
  }
  const key = deriveKey(passphrase, salt);
  const expected = createHmac("sha256", key)
    .update(Buffer.concat([Buffer.from("tag", "utf8"), nonce, ct]))
    .digest();
  if (!timingSafeEqual(expected, tag)) fail("验签失败：口令错误或密文被篡改。");
  return JSON.parse(xor(ct, keystream(key, nonce, ct.length)).toString("utf8"));
}

function checkPayload(payload) {
  if (!payload || typeof payload !== "object" || payload.version !== 1) {
    fail("安装包内容异常。");
  }
  if (
    typeof payload.templateContent !== "string" ||
    payload.templateContent.length < MIN_TEMPLATE_CHARS ||
    payload.templateContent.length > MAX_TEMPLATE_CHARS
  ) {
    fail("安装包里的人设长度异常。");
  }
  if (!Array.isArray(payload.skills) || payload.skills.length !== EXPECTED_SKILLS.length) {
    fail("安装包里的技能数量不对。");
  }
  payload.skills.forEach((skill, index) => {
    if (
      skill.name !== EXPECTED_SKILLS[index] ||
      skill.description !== SHORT_DESCRIPTIONS[skill.name]
    ) {
      fail(`安装包里第 ${index + 1} 个技能的名字或简介不对。`);
    }
    if (typeof skill.content !== "string" || skill.content.length > MAX_SKILL_CONTENT_CHARS) {
      fail(`安装包里技能 ${skill.name} 的正文异常。`);
    }
    const parsed = parseFrontmatter(skill.content, skill.name);
    if (parsed.name !== skill.name || parsed.description !== skill.description) {
      fail(`安装包里技能 ${skill.name} 的正文与名字或简介不一致。`);
    }
  });
}

/** Read name/description out of a SKILL.md frontmatter block. */
function parseFrontmatter(content, skillName) {
  const lines = content.split("\n");
  if (lines[0]?.trim() !== "---") fail(`技能 ${skillName} 的 SKILL.md 没有 frontmatter。`);
  const end = lines.findIndex((line, i) => i > 0 && line.trim() === "---");
  if (end < 0) fail(`技能 ${skillName} 的 SKILL.md frontmatter 没闭合。`);
  const frontmatter = lines.slice(1, end);
  const read = (key) => {
    const line = frontmatter.find((l) => l.startsWith(`${key}:`));
    if (!line) fail(`技能 ${skillName} 的 SKILL.md 缺少 ${key}。`);
    const value = line.slice(key.length + 1).trim();
    if (!value || value === ">" || value === "|") {
      fail(`技能 ${skillName} 的 SKILL.md 里 ${key} 不是单行。`);
    }
    return value.replace(/^["']|["']$/g, "");
  };
  return { name: read("name"), description: read("description") };
}

/** Replace only the description line inside the frontmatter block. */
function shortenDescription(content, skillName, short) {
  const lines = content.split("\n");
  const end = lines.findIndex((line, i) => i > 0 && line.trim() === "---");
  const index = lines.findIndex((line, i) => i > 0 && i < end && line.startsWith("description:"));
  if (index < 0) fail(`技能 ${skillName} 的 SKILL.md 缺少 description。`);
  lines[index] = `description: ${short}`;
  return lines.join("\n");
}

async function fetchText(url) {
  const response = await fetch(url, { headers: { "User-Agent": "rakazo-xiaomajiang-pack" } });
  if (!response.ok) fail(`取 ${url} 失败：HTTP ${response.status}。`);
  return response.text();
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--self-test")) {
    const passphrase = process.env.XIAOMAJIANG_PASSPHRASE;
    if (!passphrase) fail("口令为空。");
    process.stdout.write(
      `${encrypt(passphrase, {
        version: 1,
        templateContent: `自检人设。${"行为准则。".repeat(200)}`,
        skills: [
          {
            name: "passive-recon",
            description: "被动侦察",
            content: "---\nname: passive-recon\ndescription: 被动侦察\n---\n\n收集公开信息。",
          },
        ],
      })}\n`,
    );
    return;
  }
  const passphrase = process.env.XIAOMAJIANG_PASSPHRASE;
  if (!passphrase) {
    fail("未设 XIAOMAJIANG_PASSPHRASE，口令只放环境变量、不走命令行。");
  }
  const outIndex = args.indexOf("--out");
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const outPath =
    outIndex >= 0 && args[outIndex + 1]
      ? path.resolve(args[outIndex + 1])
      : path.join(repoRoot, "apps", "api", "src", "data", "xiaomajiang.enc");

  const tree = JSON.parse(
    await fetchText(
      `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/git/trees/${PINNED_SHA}?recursive=1`,
    ),
  );
  const paths = new Set((tree.tree ?? []).map((entry) => entry.path));
  const skillNames = [...paths]
    .filter((p) => p.startsWith("skills/") && p.endsWith("/SKILL.md"))
    .map((p) => p.split("/")[1])
    .sort();
  if (
    skillNames.length !== EXPECTED_SKILLS.length ||
    skillNames.some((name, i) => name !== [...EXPECTED_SKILLS].sort()[i])
  ) {
    fail(`上游 ${PINNED_SHA} 的技能清单与预期不符（取到 ${skillNames.length} 个）。`);
  }
  for (const needed of ["prompt/default-prompt.md", "prompt/kernel.md"]) {
    if (!paths.has(needed)) fail(`上游 ${PINNED_SHA} 缺少 ${needed}。`);
  }
  const raw = (p) =>
    fetchText(`https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/${PINNED_SHA}/${p}`);
  const persona = await raw("prompt/default-prompt.md");
  const kernel = await raw("prompt/kernel.md");
  const templateContent = `${persona}\n\n${kernel}`;
  console.log(`人设 ${templateContent.length} 字符，技能 ${EXPECTED_SKILLS.length} 个。`);
  const skills = [];
  for (const name of EXPECTED_SKILLS) {
    const content = shortenDescription(
      await raw(`skills/${name}/SKILL.md`),
      name,
      SHORT_DESCRIPTIONS[name],
    );
    skills.push({ name, description: SHORT_DESCRIPTIONS[name], content });
  }
  const payload = { version: 1, templateContent, skills };
  checkPayload(payload);
  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${encrypt(passphrase, payload)}\n`, "utf8");
  // Read it back and prove it decrypts to the same shape before reporting success.
  checkPayload(decrypt(passphrase, readFileSync(outPath, "utf8")));
  console.log(`已写 ${outPath}（当场自验通过）。`);
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)));
