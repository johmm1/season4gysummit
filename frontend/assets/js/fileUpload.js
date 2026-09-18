// GY Summit 2026 — direct-to-Supabase-Storage browser upload helper
// Gets a short-lived signed upload URL from our API, then uploads the file
// straight to Supabase Storage so large images never pass through our own
// server. (Previously this was cloudinaryUpload.js / uploadToCloudinary —
// renamed since the underlying provider changed.)
import { apiFetch } from "./utils.js";

/**
 * @param {File} file
 * @param {"avatar"|"gallery"|"document"} purpose
 * @param {(percent: number) => void} [onProgress]
 * @returns {Promise<{url: string, bytes: number, format: string}>}
 */
export async function uploadFile(file, purpose = "avatar", onProgress) {
  const { upload } = await apiFetch(
    `/uploads/signature?purpose=${purpose}&filename=${encodeURIComponent(file.name)}`
  );

  await new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", upload.uploadUrl);
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    xhr.upload.onprogress = (e) => {
      if (onProgress && e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error("Upload failed — the file may be too large or an unsupported type."));
    };
    xhr.onerror = () => reject(new Error("Upload failed — check your connection."));
    xhr.send(file);
  });

  return {
    url: upload.publicUrl,
    bytes: file.size,
    format: (file.name.split(".").pop() || "").toLowerCase(),
    // Cloudinary used to classify this server-side (resource_type); Supabase
    // Storage doesn't, so it's derived here from the browser-reported MIME
    // type instead — good enough for the photo/video/document split the
    // gallery uses.
    mediaType: file.type.startsWith("video/") ? "video" : file.type.startsWith("image/") ? "photo" : "document",
  };
}
