const MAX_GROUP_DIMENSION = 1500;
export const MAX_GROUP_CARDS = 9;

type Rectangle = { x: number; y: number; width: number; height: number };

function loadImage(file: File) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("CardPilot could not read the group photo."));
    };
    image.src = url;
  });
}

function median(values: number[]) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function expand(mask: Uint8Array, width: number, height: number, radius: number) {
  const result = new Uint8Array(mask.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!mask[y * width + x]) continue;
      for (let dy = -radius; dy <= radius; dy += 1) {
        for (let dx = -radius; dx <= radius; dx += 1) {
          const nextX = x + dx;
          const nextY = y + dy;
          if (nextX >= 0 && nextX < width && nextY >= 0 && nextY < height) {
            result[nextY * width + nextX] = 1;
          }
        }
      }
    }
  }
  return result;
}

export function componentRectangles(
  mask: Uint8Array,
  width: number,
  height: number,
): Rectangle[] {
  const visited = new Uint8Array(mask.length);
  const queue = new Int32Array(mask.length);
  const rectangles: Rectangle[] = [];
  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || visited[start]) continue;
    let head = 0;
    let tail = 1;
    queue[0] = start;
    visited[start] = 1;
    let minimumX = width;
    let minimumY = height;
    let maximumX = 0;
    let maximumY = 0;
    let count = 0;
    while (head < tail) {
      const index = queue[head++];
      const x = index % width;
      const y = Math.floor(index / width);
      minimumX = Math.min(minimumX, x);
      minimumY = Math.min(minimumY, y);
      maximumX = Math.max(maximumX, x);
      maximumY = Math.max(maximumY, y);
      count += 1;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nextX = x + dx;
        const nextY = y + dy;
        if (nextX < 0 || nextX >= width || nextY < 0 || nextY >= height) continue;
        const next = nextY * width + nextX;
        if (mask[next] && !visited[next]) {
          visited[next] = 1;
          queue[tail++] = next;
        }
      }
    }
    const rectangle = {
      x: minimumX,
      y: minimumY,
      width: maximumX - minimumX + 1,
      height: maximumY - minimumY + 1,
    };
    const areaRatio = (rectangle.width * rectangle.height) / (width * height);
    const aspect = rectangle.width / rectangle.height;
    if (count >= 12 && areaRatio >= 0.018 && areaRatio <= 0.45 && aspect >= 0.45 && aspect <= 2.2) {
      rectangles.push(rectangle);
    }
  }
  return rectangles.sort((left, right) =>
    Math.abs(left.y - right.y) > height * 0.08 ? left.y - right.y : left.x - right.x,
  );
}

function canvasToFile(canvas: HTMLCanvasElement, index: number) {
  return new Promise<File>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("CardPilot could not create an individual card photo."));
        return;
      }
      resolve(new File([blob], `group-card-${index + 1}.jpg`, { type: "image/jpeg" }));
    }, "image/jpeg", 0.9);
  });
}

export async function splitGroupCardPhoto(file: File): Promise<File[]> {
  const image = await loadImage(file);
  const scale = Math.min(1, MAX_GROUP_DIMENSION / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("This browser cannot split a group photo.");
  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  const gridWidth = 120;
  const gridHeight = Math.max(60, Math.round(gridWidth * canvas.height / canvas.width));
  const sampleCanvas = document.createElement("canvas");
  sampleCanvas.width = gridWidth;
  sampleCanvas.height = gridHeight;
  const sampleContext = sampleCanvas.getContext("2d", { willReadFrequently: true });
  if (!sampleContext) throw new Error("This browser cannot analyze a group photo.");
  sampleContext.drawImage(canvas, 0, 0, gridWidth, gridHeight);
  const pixels = sampleContext.getImageData(0, 0, gridWidth, gridHeight).data;
  const borderRed: number[] = [];
  const borderGreen: number[] = [];
  const borderBlue: number[] = [];
  for (let y = 0; y < gridHeight; y += 1) {
    for (let x = 0; x < gridWidth; x += 1) {
      if (x > 2 && x < gridWidth - 3 && y > 2 && y < gridHeight - 3) continue;
      const index = (y * gridWidth + x) * 4;
      borderRed.push(pixels[index]);
      borderGreen.push(pixels[index + 1]);
      borderBlue.push(pixels[index + 2]);
    }
  }
  const background = [median(borderRed), median(borderGreen), median(borderBlue)];
  const mask = new Uint8Array(gridWidth * gridHeight);
  for (let index = 0; index < mask.length; index += 1) {
    const pixel = index * 4;
    const distance = Math.hypot(
      pixels[pixel] - background[0],
      pixels[pixel + 1] - background[1],
      pixels[pixel + 2] - background[2],
    );
    if (distance >= 42) mask[index] = 1;
  }
  const rectangles = componentRectangles(expand(mask, gridWidth, gridHeight, 2), gridWidth, gridHeight)
    .slice(0, MAX_GROUP_CARDS);
  if (rectangles.length < 2) {
    throw new Error("CardPilot could not find multiple separated cards. Place 2–9 cards on a plain, contrasting surface with space between every card.");
  }

  return Promise.all(rectangles.map(async (rectangle, index) => {
    const marginX = Math.max(1, Math.round(rectangle.width * 0.03));
    const marginY = Math.max(1, Math.round(rectangle.height * 0.03));
    const x = Math.max(0, rectangle.x - marginX);
    const y = Math.max(0, rectangle.y - marginY);
    const width = Math.min(gridWidth - x, rectangle.width + marginX * 2);
    const height = Math.min(gridHeight - y, rectangle.height + marginY * 2);
    const crop = document.createElement("canvas");
    crop.width = Math.max(1, Math.round(width * canvas.width / gridWidth));
    crop.height = Math.max(1, Math.round(height * canvas.height / gridHeight));
    crop.getContext("2d")?.drawImage(
      canvas,
      x * canvas.width / gridWidth,
      y * canvas.height / gridHeight,
      width * canvas.width / gridWidth,
      height * canvas.height / gridHeight,
      0,
      0,
      crop.width,
      crop.height,
    );
    return canvasToFile(crop, index);
  }));
}
