import sharp from "sharp";

export async function encodeBackupThumbnail(image) {
  const source = Buffer.isBuffer(image)
    ? image
    : Buffer.from(await image.arrayBuffer());
  const thumbnail = await sharp(source, { animated: false, failOn: "none" })
    .rotate()
    .resize({
      width: 480,
      height: 672,
      fit: "inside",
      withoutEnlargement: true,
    })
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: 72, mozjpeg: true })
    .toBuffer();
  return {
    mimeType: "image/jpeg",
    base64: thumbnail.toString("base64"),
  };
}
