const supportedDataUrl =
  /^data:image\/(jpeg|png|webp|gif);base64,[a-z0-9+/=\r\n]+$/i;

export class ImageIntakeError extends Error {
  constructor(message) {
    super(message);
    this.name = "ImageIntakeError";
    this.status = 400;
  }
}

export function parseImageIntake(payload) {
  const {
    frontImage,
    backImage = null,
    frontDetailImages = [],
  } = payload ?? {};

  if (typeof frontImage !== "string" || !supportedDataUrl.test(frontImage)) {
    throw new ImageIntakeError(
      "A valid JPG, PNG, WebP, or GIF front image is required.",
    );
  }

  if (
    backImage !== null &&
    (typeof backImage !== "string" || !supportedDataUrl.test(backImage))
  ) {
    throw new ImageIntakeError(
      "The back image must be a JPG, PNG, WebP, or GIF.",
    );
  }

  if (!Array.isArray(frontDetailImages) || frontDetailImages.length > 4) {
    throw new ImageIntakeError("Up to four front-image detail crops are supported.");
  }

  const validatedDetailImages = frontDetailImages.map((detailImage) => {
    if (
      !detailImage ||
      typeof detailImage.label !== "string" ||
      typeof detailImage.image !== "string" ||
      !supportedDataUrl.test(detailImage.image)
    ) {
      throw new ImageIntakeError(
        "Each front detail crop must be a labeled JPG, PNG, WebP, or GIF image.",
      );
    }

    return { label: detailImage.label.slice(0, 40), image: detailImage.image };
  });

  return {
    frontImage,
    backImage,
    frontDetailImages: validatedDetailImages,
    backPhotoProvided: Boolean(backImage),
  };
}
