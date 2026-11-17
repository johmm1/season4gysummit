// Share approved public GYS content through the phone's native share sheet.
// WhatsApp must still be selected by the admin; the website cannot target a Channel composer.
export const GYS_WHATSAPP_CHANNEL = "https://whatsapp.com/channel/0029VbEhzu7CnA7zeOqAmG3g";

export async function shareGysContent({ title, text, urls = [], files = [] }) {
  const shareText = [title, text].filter(Boolean).join("\n\n").trim();
  let mediaFiles = files;

  if (!mediaFiles.length && urls.length) {
    const responses = await Promise.all(urls.map(async (url, index) => {
      const response = await fetch(url, { mode: "cors", credentials: "omit" });
      if (!response.ok) throw new Error("A gallery image could not be downloaded for sharing.");
      const blob = await response.blob();
      const type = blob.type && blob.type.startsWith("image/") ? blob.type : "image/jpeg";
      const extension = type.split("/")[1].replace("jpeg", "jpg").split("+")[0] || "jpg";
      return new File([blob], `gys-summit-photo-${index + 1}.${extension}`, { type });
    }));
    mediaFiles = responses;
  }

  if (!navigator.share) {
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(shareText);
    window.open(GYS_WHATSAPP_CHANNEL, "_blank", "noopener");
    throw new Error("Your browser cannot share files directly. The caption was copied where supported; use WhatsApp's attachment button to add the photos.");
  }

  const payload = { title: title || "GYS Summit", text: shareText };
  if (mediaFiles.length) {
    if (!navigator.canShare || !navigator.canShare({ files: mediaFiles })) {
      throw new Error("This browser cannot share this whole album as files. Try Chrome on Android or share fewer photos.");
    }
    payload.files = mediaFiles;
  }

  await navigator.share(payload);
}
