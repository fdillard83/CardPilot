import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const fixturePath = path.resolve(
  process.cwd(),
  process.argv[2] ?? "accuracy/fixtures.sample.json",
);
const baseUrl = (process.env.CARDPILOT_BASE_URL ?? "http://localhost:8787").replace(
  /\/$/,
  "",
);

function imageMimeType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".png") return "image/png";
  if (extension === ".webp") return "image/webp";
  if (extension === ".gif") return "image/gif";
  return "image/jpeg";
}

async function imageDataUrl(filePath) {
  const contents = await readFile(filePath);
  return `data:${imageMimeType(filePath)};base64,${contents.toString("base64")}`;
}

function comparable(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : value;
}

const fixtures = JSON.parse(await readFile(fixturePath, "utf8"));
if (!Array.isArray(fixtures) || fixtures.length === 0) {
  throw new Error("Accuracy fixtures must be a non-empty JSON array.");
}

const fixtureDirectory = path.dirname(fixturePath);
let checks = 0;
let passed = 0;

for (const fixture of fixtures) {
  const frontImage = await imageDataUrl(
    path.resolve(fixtureDirectory, fixture.frontImage),
  );
  const backImage = fixture.backImage
    ? await imageDataUrl(path.resolve(fixtureDirectory, fixture.backImage))
    : null;
  const frontDetailImages = await Promise.all(
    (fixture.frontDetailImages ?? []).map(async (detail) => ({
      label: detail.label,
      image: await imageDataUrl(path.resolve(fixtureDirectory, detail.image)),
    })),
  );

  const response = await fetch(`${baseUrl}/api/identify-card`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ frontImage, backImage, frontDetailImages }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.identification) {
    throw new Error(
      `${fixture.name}: ${payload?.error ?? `identification returned ${response.status}`}`,
    );
  }

  const result = payload.identification;
  process.stdout.write(`\n${fixture.name} (${result.pipeline.totalDurationMs} ms)\n`);
  for (const [field, expected] of Object.entries(fixture.expected)) {
    checks += 1;
    const actual = result.fields[field]?.value;
    const matches = comparable(actual) === comparable(expected);
    if (matches) passed += 1;
    process.stdout.write(
      `  ${matches ? "PASS" : "FAIL"} ${field}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}\n`,
    );
  }
}

const score = checks === 0 ? 0 : Math.round((passed / checks) * 1000) / 10;
process.stdout.write(`\nAccuracy: ${passed}/${checks} checks (${score}%)\n`);
if (passed !== checks) process.exitCode = 1;
