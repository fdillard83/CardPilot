import { randomUUID } from "node:crypto";
import { CardIdentificationResultSchema } from "./contracts.mjs";
import { createProvisionalCandidate } from "./candidate-generator.mjs";
import { calculateOverallConfidence } from "./confidence-engine.mjs";
import { parseImageIntake } from "./image-intake.mjs";
import { normalizeCardSemantics } from "./semantic-normalizer.mjs";
import {
  defaultTrustConfig,
  evaluateTrust,
  getBackPhotoGuidance,
} from "./trust-engine.mjs";
import { verifyCandidates } from "./verification-engine.mjs";
import { applyEvidenceConsensus } from "./evidence-consensus.mjs";

async function runStage(stages, name, operation) {
  const startedAt = performance.now();
  try {
    const value = await operation();
    stages.push({
      name,
      status: "completed",
      durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
    });
    return value;
  } catch (error) {
    error.pipelineStage = name;
    throw error;
  }
}

function unsupportedStatus(status) {
  return status === "not_sports_card" || status === "not_trading_card";
}

export class IdentificationEngine {
  constructor({
    evidenceEngine,
    candidateGenerator,
    model,
    trustConfig = defaultTrustConfig,
    webEvidence = null,
    idFactory = randomUUID,
    now = () => new Date(),
  }) {
    this.evidenceEngine = evidenceEngine;
    this.candidateGenerator = candidateGenerator;
    this.model = model;
    this.trustConfig = trustConfig;
    this.webEvidence = webEvidence;
    this.idFactory = idFactory;
    this.now = now;
  }

  async identify(payload) {
    const pipelineStartedAt = performance.now();
    const stages = [];
    const intake = await runStage(stages, "image_intake", () =>
      parseImageIntake(payload),
    );
    const webEvidencePending = this.webEvidence?.configured
      ? this.webEvidence.analyze(intake)
      : null;
    const pipelineModel =
      this.evidenceEngine.modelFor?.(intake) ?? this.model;
    const rawExtraction = await runStage(
      stages,
      "evidence_extraction",
      () => this.evidenceEngine.extract(intake),
    );
    let extraction = await runStage(
      stages,
      "semantic_normalization",
      () => normalizeCardSemantics(rawExtraction),
    );
    if (webEvidencePending) {
      const providerResults = await webEvidencePending;
      const webDurationMs = providerResults.reduce(
        (duration, provider) => Math.max(duration, provider.durationMs),
        0,
      );
      stages.push({
        name: "web_evidence",
        status: providerResults.some((provider) => provider.status === "degraded")
          ? "degraded"
          : "completed",
        durationMs: webDurationMs,
      });
      extraction = applyEvidenceConsensus(extraction, providerResults);
    }

    let candidates = [];
    const candidateStartedAt = performance.now();
    if (!unsupportedStatus(extraction.status)) {
      try {
        candidates = await this.candidateGenerator.generate(extraction);
        if (candidates.length === 0) {
          candidates = [createProvisionalCandidate(extraction)];
        }
        stages.push({
          name: "candidate_generation",
          status: "completed",
          durationMs: Math.max(
            0,
            Math.round(performance.now() - candidateStartedAt),
          ),
        });
      } catch (error) {
        console.warn(
          "Candidate generation degraded; using visible evidence only.",
          error?.message ?? error,
        );
        candidates = [createProvisionalCandidate(extraction)];
        extraction.missingEvidence.push({
          field: "product",
          description:
            "An independent candidate or checklist match was not available.",
          suggestedSource: "catalog",
          expectedConfidenceGain: 0.1,
        });
        stages.push({
          name: "candidate_generation",
          status: "degraded",
          durationMs: Math.max(
            0,
            Math.round(performance.now() - candidateStartedAt),
          ),
        });
      }
    } else {
      stages.push({
        name: "candidate_generation",
        status: "completed",
        durationMs: 0,
      });
    }

    const verification = await runStage(stages, "verification", () =>
      verifyCandidates(extraction, candidates),
    );
    const overallConfidence = await runStage(
      stages,
      "confidence_scoring",
      () =>
        calculateOverallConfidence({
          status: extraction.status,
          fields: verification.fields,
          missingEvidence: extraction.missingEvidence,
          candidateMatches: verification.candidateMatches,
        }),
    );
    const decisionResult = await runStage(
      stages,
      "overall_decision",
      () => {
        const decision = evaluateTrust(
          {
            status: extraction.status,
            fields: verification.fields,
            missingEvidence: extraction.missingEvidence,
            overallConfidence,
          },
          this.trustConfig,
        );
        const backPhoto = getBackPhotoGuidance(
          {
            provided: intake.backPhotoProvided,
            decision,
            missingEvidence: extraction.missingEvidence,
            overallConfidence,
          },
          this.trustConfig,
        );
        return { decision, backPhoto };
      },
    );

    return CardIdentificationResultSchema.parse({
      schemaVersion: "1.0",
      identificationId: this.idFactory(),
      status: extraction.status,
      fields: verification.fields,
      evidence: extraction.evidence,
      missingEvidence: extraction.missingEvidence,
      candidateMatches: verification.candidateMatches,
      overallConfidence,
      decision: decisionResult.decision,
      backPhoto: decisionResult.backPhoto,
      summary: extraction.summary,
      pipeline: {
        model: pipelineModel,
        totalDurationMs: Math.max(
          0,
          Math.round(performance.now() - pipelineStartedAt),
        ),
        stages,
      },
      createdAt: this.now().toISOString(),
    });
  }
}
