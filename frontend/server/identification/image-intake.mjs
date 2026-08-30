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
    backDetailImages = [],
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

  const validateDetailImages = (detailImages, side) => {
    if (!Array.isArray(detailImages) || detailImages.length > 4) {
      throw new ImageIntakeError(`Up to four ${side}-image detail crops are supported.`);
    }
    return detailImages.map((detailImage) => {
    if (
      !detailImage ||
      typeof detailImage.label !== "string" ||
      typeof detailImage.image !== "string" ||
      !supportedDataUrl.test(detailImage.image)
    ) {
      throw new ImageIntakeError(
        `Each ${side} detail crop must be a labeled JPG, PNG, WebP, or GIF image.`,
      );
    }

    return { label: detailImage.label.slice(0, 40), image: detailImage.image };
    });
  };

  const validatedFrontDetailImages = validateDetailImages(frontDetailImages, "front");
  const validatedBackDetailImages = validateDetailImages(backDetailImages, "back");
  if (backImage === null && validatedBackDetailImages.length > 0) {
    throw new ImageIntakeError("Back detail crops require a back card image.");
  }

  return {
    frontImage,
    backImage,
    frontDetailImages: validatedFrontDetailImages,
    backDetailImages: validatedBackDetailImages,
    backPhotoProvided: Boolean(backImage),
  };
}
