const assert = require("assert");
const path = require("path");
const {
  MAX_IMAGE_ATTACHMENTS,
  MAX_IMAGE_BYTES,
  buildCodexImageArgs,
  buildImageAttachmentPrompt,
  cleanAttachments,
  detectImageMime,
  normalizeVaultPath,
  safeResolveVaultPath,
  sanitizeImageFileName,
  validateImageInput,
} = require("../attachment-utils");

function bytes(values) {
  return Uint8Array.from(values);
}

const png = bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const jpeg = bytes([0xff, 0xd8, 0xff, 0xe0]);
const webp = bytes([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
const gif = bytes([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);

assert.strictEqual(detectImageMime(png), "image/png");
assert.strictEqual(detectImageMime(jpeg), "image/jpeg");
assert.strictEqual(detectImageMime(webp), "image/webp");
assert.strictEqual(detectImageMime(gif), "image/gif");
assert.strictEqual(detectImageMime(bytes([1, 2, 3])), "");

assert.deepStrictEqual(validateImageInput({ name: "chart.png", type: "image/png", size: png.length }, png), {
  ok: true,
  mimeType: "image/png",
  name: "chart.png",
  size: png.length,
});
assert.strictEqual(validateImageInput({ name: "chart.jpg", type: "image/jpeg", size: png.length }, png).ok, false);
assert.strictEqual(validateImageInput({ name: "chart.exe", type: "image/png", size: png.length }, png).ok, false);
assert.strictEqual(validateImageInput({ name: "chart.png", type: "image/png", size: MAX_IMAGE_BYTES + 1 }, png).ok, false);
assert.strictEqual(sanitizeImageFileName("bad:name?.jpeg", "image/jpeg", 0), "bad-name-.jpg");
assert.match(sanitizeImageFileName("", "image/png", Date.UTC(2026, 6, 18)), /^AI-Workspace-20260718-000000\.png$/);

assert.strictEqual(normalizeVaultPath("_attachments\\image.png"), "_attachments/image.png");
assert.strictEqual(normalizeVaultPath("../outside.png"), "");
assert.strictEqual(normalizeVaultPath("C:/outside.png"), "");
assert.strictEqual(normalizeVaultPath("/outside.png"), "");
const vaultRoot = process.cwd();
assert.strictEqual(safeResolveVaultPath(vaultRoot, "../outside.png"), "");
assert.strictEqual(safeResolveVaultPath(vaultRoot, "_attachments/image.png"), path.resolve(vaultRoot, "_attachments/image.png"));

const attachment = {
  id: "a1",
  kind: "image",
  name: "diagram.png",
  path: "_attachments/diagram.png",
  mimeType: "image/png",
  size: 128,
};
const many = Array.from({ length: MAX_IMAGE_ATTACHMENTS + 3 }, (_, index) => ({
  ...attachment,
  id: `a${index}`,
  name: `diagram-${index}.png`,
  path: `_attachments/diagram-${index}.png`,
}));
assert.strictEqual(cleanAttachments(many).length, MAX_IMAGE_ATTACHMENTS);
assert.deepStrictEqual(cleanAttachments([attachment, attachment]), [attachment]);
assert.deepStrictEqual(cleanAttachments([{ ...attachment, path: "../escape.png" }]), []);

const imageA = path.resolve(vaultRoot, "_attachments/a.png");
const imageB = path.resolve(vaultRoot, "_attachments/b.jpg");
assert.deepStrictEqual(buildCodexImageArgs([imageA, "relative.png", imageB]), [
  "--image",
  imageA,
  "--image",
  imageB,
]);
const prompt = buildImageAttachmentPrompt([
  { ...attachment, name: 'diagram "one".png', path: "_attachments/diagram&one.png" },
]);
assert.match(prompt, /Read tool/);
assert.match(prompt, /diagram -one-\.png/);
assert.match(prompt, /_attachments\/diagram&amp;one\.png/);

console.log("codex-chat image attachment tests passed");
