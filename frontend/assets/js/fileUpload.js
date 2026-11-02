// Y-Summit Season 4 2026 — direct-to-Cloudinary browser upload helper
//
// 1. Asks our API for a signature (the folder, allowed formats and resize rules
//    are signed server-side, so they can't be loosened from the browser).
// 2. Shrinks big phone photos first, so they upload quickly on a weak
//    connection and stay under Cloudinary's file-size limit.
// 3. POSTs the file straight to Cloudinary — it never passes through our server.
import { apiFetch } from "./utils.js";

const PHOTO_MAX_SIDE = { avatar: 1000, gallery: 2400 };

/**
 * @param {File} file
 * @param {"avatar"|"gallery"|"video"|"document"} purpose
 * @param {(percent: number) => void} [onProgress]
 * @returns {Promise<{url: string, publicId: string, resourceType: string, bytes: number, format: string, mediaType: "photo"|"video"|"document"}>}
 */
export async function uploadFile(file, purpose = "avatar", onProgress) {
  const isVideo = file.type.startsWith("video/");
  const isImage = file.type.startsWith("image/");
  // The gallery pages ask for "gallery" for everything; videos get their own folder.
  if (purpose === "gallery" && isVideo) purpose = "video";

  let toSend = file;
  if (isImage && PHOTO_MAX_SIDE[purpose]) toSend = await shrinkImage(file, PHOTO_MAX_SIDE[purpose]);

  const { upload } = await apiFetch(`/uploads/signature?purpose=${purpose}`);

  if (upload.maxBytes && toSend.size > upload.maxBytes) {
    const maxMb = Math.round(upload.maxBytes / (1024 * 1024));
    const mb = (toSend.size / (1024 * 1024)).toFixed(1);
    throw new Error(`That file is too large (${mb} MB). The limit is ${maxMb} MB${isVideo ? " — trim or compress the video and try again" : ""}.`);
  }

  const form = new FormData();
  Object.entries(upload.fields).forEach(([key, value]) => form.append(key, value));
  form.append("file", toSend);

  const result = await new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", upload.uploadUrl);
    xhr.upload.onprogress = (e) => {
      if (onProgress && e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      let body = {};
      try { body = JSON.parse(xhr.responseText); } catch { /* not JSON */ }
      if (xhr.status >= 200 && xhr.status < 300 && body.secure_url) resolve(body);
      else reject(new Error(friendlyError(body?.error?.message)));
    };
    xhr.onerror = () => reject(new Error("Upload failed — check your connection and try again."));
    xhr.send(form);
  });

  return {
    url: result.secure_url,
    publicId: result.public_id,
    resourceType: result.resource_type,
    bytes: result.bytes || toSend.size,
    format: (result.format || file.name.split(".").pop() || "").toLowerCase(),
    mediaType: isVideo ? "video" : isImage ? "photo" : "document",
  };
}

function friendlyError(message = "") {
  const m = message.toLowerCase();
  if (m.includes("file size too large")) return "That file is too large to upload.";
  if (m.includes("format") && m.includes("not allowed")) return "That file type isn't allowed. Use a JPG, PNG or WebP photo, or an MP4 video.";
  return message || "Upload failed — the file may be too large or an unsupported type.";
}

// Downscale + re-encode as JPEG. Falls back to the original file if the
// browser can't decode it (e.g. HEIC outside Safari) — Cloudinary accepts HEIC.
async function shrinkImage(file, maxSide) {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return file;
  if (file.size < 600 * 1024) return file; // already small
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
  } catch {
    return file;
  }
}
