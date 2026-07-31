/**
 * Shared image handling for uploads that get stored as data URLs in IndexedDB.
 *
 * Everything the user attaches is inlined into the Dexie record and, in turn,
 * into every "Save My Data" backup JSON. A raw 4 MB phone photo becomes ~5.3 MB
 * of base64, so photos are downscaled and re-encoded before they are stored.
 */

const MAX_EDGE = 1600;
const JPEG_QUALITY = 0.8;

export const IMAGE_UPLOAD_ACCEPT = "image/*";
export const FILE_UPLOAD_ACCEPT = "image/*,application/pdf";

/** Message shown inline when a file can't be decoded (HEIC, corrupt, too large). */
export const IMAGE_READ_ERROR =
  "Couldn't read that image. Try a JPG or PNG — iPhone HEIC photos may need to be converted first.";

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error(IMAGE_READ_ERROR));
    reader.readAsDataURL(file);
  });
}

async function decode(file: File): Promise<{ source: CanvasImageSource; width: number; height: number; release: () => void }> {
  // createImageBitmap applies EXIF rotation, so photos taken sideways on a
  // phone don't get stored upside down.
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() };
    } catch {
      // Fall through to the <img> path.
    }
  }

  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error(IMAGE_READ_ERROR));
      el.src = url;
    });
    return {
      source: img,
      width: img.naturalWidth,
      height: img.naturalHeight,
      release: () => URL.revokeObjectURL(url),
    };
  } catch (err) {
    URL.revokeObjectURL(url);
    throw err;
  }
}

/**
 * Downscale an image file to at most ~1600px on its long edge and re-encode it
 * as JPEG, returning a data URL. Non-image files (PDFs) pass through untouched.
 *
 * Throws an Error carrying a user-facing message when the file can't be decoded.
 */
export async function fileToStorableDataUrl(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) return readAsDataUrl(file);

  const { source, width, height, release } = await decode(file);
  try {
    if (!width || !height) throw new Error(IMAGE_READ_ERROR);

    const scale = Math.min(1, MAX_EDGE / Math.max(width, height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));

    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error(IMAGE_READ_ERROR);

    // JPEG has no alpha channel; without this, transparent PNGs come out black.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);

    const dataUrl = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
    if (!dataUrl.startsWith("data:image/jpeg")) throw new Error(IMAGE_READ_ERROR);
    return dataUrl;
  } finally {
    release();
  }
}
