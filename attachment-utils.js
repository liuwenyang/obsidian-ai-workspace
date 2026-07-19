const path = require("path");

const MAX_IMAGE_ATTACHMENTS = 8;
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const MIME_BY_EXTENSION = Object.freeze({
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
});
const EXTENSION_BY_MIME = Object.freeze({
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
});

function createAttachmentId() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `attachment-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeVaultPath(value) {
  if (typeof value !== "string") return "";
  const normalized = value.trim().replace(/\\/g, "/").replace(/^\.\//, "");
  if (!normalized || normalized.startsWith("/") || /^[a-zA-Z]:\//.test(normalized)) return "";
  const segments = normalized.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) return "";
  return segments.join("/");
}

function safeResolveVaultPath(vaultRoot, relativePath) {
  const normalized = normalizeVaultPath(relativePath);
  if (!normalized || typeof vaultRoot !== "string" || !vaultRoot.trim()) return "";
  const root = path.resolve(vaultRoot);
  const absolute = path.resolve(root, ...normalized.split("/"));
  const relative = path.relative(root, absolute);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return "";
  return absolute;
}

function detectImageMime(bytes) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || 0);
  if (data.length >= 8 && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) {
    return "image/png";
  }
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    data.length >= 12 &&
    data[0] === 0x52 &&
    data[1] === 0x49 &&
    data[2] === 0x46 &&
    data[3] === 0x46 &&
    data[8] === 0x57 &&
    data[9] === 0x45 &&
    data[10] === 0x42 &&
    data[11] === 0x50
  ) {
    return "image/webp";
  }
  if (
    data.length >= 6 &&
    data[0] === 0x47 &&
    data[1] === 0x49 &&
    data[2] === 0x46 &&
    data[3] === 0x38 &&
    (data[4] === 0x37 || data[4] === 0x39) &&
    data[5] === 0x61
  ) {
    return "image/gif";
  }
  return "";
}

function sanitizeImageFileName(name, mimeType, timestamp = Date.now()) {
  const requiredExtension = EXTENSION_BY_MIME[mimeType] || ".png";
  const rawName = String(name || "").split(/[\\/]/).pop().trim();
  const extension = path.extname(rawName).toLowerCase();
  let base = rawName ? rawName.slice(0, rawName.length - extension.length) : "";
  base = base
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .trim();
  if (!base) {
    const date = new Date(timestamp);
    const stamp = Number.isNaN(date.getTime())
      ? String(Date.now())
      : date.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
    base = `AI-Workspace-${stamp}`;
  }
  return `${base.slice(0, 120)}${requiredExtension}`;
}

function validateImageInput(file, bytes) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || 0);
  const declaredSize = Number(file && file.size);
  const size = Number.isFinite(declaredSize) && declaredSize > 0 ? declaredSize : data.byteLength;
  if (!size || !data.byteLength) return { ok: false, error: "图片内容为空" };
  if (size > MAX_IMAGE_BYTES || data.byteLength > MAX_IMAGE_BYTES) {
    return { ok: false, error: `单张图片不能超过 ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)} MB` };
  }

  const detectedMime = detectImageMime(data);
  if (!detectedMime) return { ok: false, error: "只支持 PNG、JPEG、WebP 和 GIF 图片" };

  const rawName = String((file && file.name) || "");
  const extension = path.extname(rawName).toLowerCase();
  const extensionMime = extension ? MIME_BY_EXTENSION[extension] : "";
  const declaredMime = String((file && file.type) || "").toLowerCase();
  if (extension && !extensionMime) return { ok: false, error: "图片扩展名不受支持" };
  if (extensionMime && extensionMime !== detectedMime) return { ok: false, error: "图片扩展名与实际内容不一致" };
  if (declaredMime && declaredMime !== detectedMime) return { ok: false, error: "图片类型与实际内容不一致" };

  return {
    ok: true,
    mimeType: detectedMime,
    name: sanitizeImageFileName(rawName, detectedMime),
    size: data.byteLength,
  };
}

function cleanAttachment(value) {
  if (!value || typeof value !== "object" || value.kind !== "image") return null;
  const attachmentPath = normalizeVaultPath(value.path);
  if (!attachmentPath) return null;
  const extensionMime = MIME_BY_EXTENSION[path.extname(attachmentPath).toLowerCase()];
  const mimeType = String(value.mimeType || extensionMime || "").toLowerCase();
  const size = Number(value.size);
  if (!extensionMime || mimeType !== extensionMime || !Number.isFinite(size) || size <= 0 || size > MAX_IMAGE_BYTES) {
    return null;
  }
  return {
    id: typeof value.id === "string" && value.id ? value.id.slice(0, 160) : createAttachmentId(),
    kind: "image",
    name: sanitizeImageFileName(value.name || path.posix.basename(attachmentPath), mimeType),
    path: attachmentPath,
    mimeType,
    size,
  };
}

function cleanAttachments(value) {
  if (!Array.isArray(value)) return [];
  const output = [];
  const seen = new Set();
  for (const item of value) {
    const attachment = cleanAttachment(item);
    if (!attachment || seen.has(attachment.path)) continue;
    seen.add(attachment.path);
    output.push(attachment);
    if (output.length >= MAX_IMAGE_ATTACHMENTS) break;
  }
  return output;
}

function buildCodexImageArgs(imagePaths) {
  const args = [];
  for (const imagePath of Array.isArray(imagePaths) ? imagePaths : []) {
    if (typeof imagePath !== "string" || !path.isAbsolute(imagePath)) continue;
    args.push("--image", imagePath);
  }
  return args;
}

function escapeXmlAttribute(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function buildImageAttachmentPrompt(attachments) {
  const cleaned = cleanAttachments(attachments);
  if (!cleaned.length) return "";
  const lines = [
    "The following image attachments are stored inside the current Obsidian vault.",
    "Inspect every image. If image bytes were not attached natively, use the Read tool with each path.",
    "<image_attachments>",
  ];
  for (const attachment of cleaned) {
    lines.push(
      `  <image name="${escapeXmlAttribute(attachment.name)}" path="${escapeXmlAttribute(attachment.path)}" mime_type="${attachment.mimeType}" />`,
    );
  }
  lines.push("</image_attachments>");
  return lines.join("\n");
}

module.exports = {
  MAX_IMAGE_ATTACHMENTS,
  MAX_IMAGE_BYTES,
  MIME_BY_EXTENSION,
  buildCodexImageArgs,
  buildImageAttachmentPrompt,
  cleanAttachment,
  cleanAttachments,
  createAttachmentId,
  detectImageMime,
  normalizeVaultPath,
  safeResolveVaultPath,
  sanitizeImageFileName,
  validateImageInput,
};
