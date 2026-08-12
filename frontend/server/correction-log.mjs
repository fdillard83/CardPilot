import { randomUUID } from "node:crypto";
import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { CorrectionSubmissionSchema } from "./identification/contracts.mjs";

export function createCorrectionLogger({ filePath, now = () => new Date() }) {
  return {
    async log(submission) {
      const validated = CorrectionSubmissionSchema.parse(submission);
      const record = {
        correctionId: randomUUID(),
        recordedAt: now().toISOString(),
        learningStatus: "unverified_example",
        ...validated,
      };

      await mkdir(path.dirname(filePath), { recursive: true });
      await appendFile(filePath, `${JSON.stringify(record)}\n`, "utf8");
      return record;
    },
  };
}
