/**
 * Pure detection logic for deciding whether a parquet file likely needs x1000 correction.
 *
 * IMPORTANT: This module must remain pure:
 * - No DuckDB calls
 * - No filesystem/network I/O
 * - No global mutable state
 */

import { getNextQuarter, getPreviousQuarter, parseFilename } from './parquet-utils-base';
import type {
  AntigravityFile,
  DetectionSignal,
  FileEvaluation,
  ReferenceData,
  VerifiedFiling,
} from './types';

export const DETECTION_CONFIG = {
  // Detection thresholds
  RATIO_LOW: 0.1, // Value is correct if within 0.1x to 10x of reference
  RATIO_HIGH: 10,
  PPS_RATIO_LOW: 500, // Price-per-share indicates x1000 if ratio is 500-2000
  PPS_RATIO_HIGH: 2000,
  MIN_VERIFIED_VALUE: 10_000_000, // $10M minimum for "trustworthy" verified data
  MIN_VERIFIED_PPS: 1, // $1 minimum for trustworthy price-per-share
} as const;

/**
 * Calculate reference data from verified filings.
 * This is the "ground truth" we compare antigravity files against.
 *
 * Input: RAW filings with individual accession numbers (not aggregated)
 * Output: Reference data with both accession-level and quarter-level lookups
 */
export function calculateReferenceData(rawFilings: VerifiedFiling[]): ReferenceData {
  const verifiedByAccession = new Map<string, VerifiedFiling>();
  for (const v of rawFilings) {
    verifiedByAccession.set(v.accessionNumber, v);
  }

  // Aggregate by quarter (for quarter-level comparison)
  const quarterMap = new Map<string, VerifiedFiling>();
  for (const f of rawFilings) {
    const existing = quarterMap.get(f.quarter);
    if (existing) {
      existing.value += f.value;
      existing.rowCount += f.rowCount;
      // Keep the median PPS from the first filing (reasonable approximation)
    } else {
      quarterMap.set(f.quarter, { ...f });
    }
  }
  const aggregatedByQuarter = Array.from(quarterMap.values());

  // Find "trustworthy" verified data: high values and reasonable price/share
  const trustworthy = aggregatedByQuarter.filter(
    (v) =>
      v.value > DETECTION_CONFIG.MIN_VERIFIED_VALUE &&
      v.medianPricePerShare !== null &&
      v.medianPricePerShare > DETECTION_CONFIG.MIN_VERIFIED_PPS
  );

  // If no trustworthy data, use all verified with value > $10M
  const reference =
    trustworthy.length > 0
      ? trustworthy
      : aggregatedByQuarter.filter((v) => v.value > DETECTION_CONFIG.MIN_VERIFIED_VALUE);

  // Calculate median value from aggregated data
  let medianValue: number | null = null;
  if (reference.length > 0) {
    const values = reference
      .map((v) => v.value)
      .sort((a, b) => a - b);
    medianValue = values[Math.floor(values.length / 2)];
  }

  // Calculate median price-per-share
  let medianPPS: number | null = null;
  const ppsValues = reference
    .map((v) => v.medianPricePerShare)
    .filter((p): p is number => p !== null && p > 0)
    .sort((a, b) => a - b);
  if (ppsValues.length > 0) {
    medianPPS = ppsValues[Math.floor(ppsValues.length / 2)];
  }

  // Create quarter lookup map from aggregated data
  const verifiedByQuarter = new Map<string, VerifiedFiling>();
  for (const v of aggregatedByQuarter) {
    verifiedByQuarter.set(v.quarter, v);
  }

  return {
    medianValue,
    medianPricePerShare: medianPPS,
    verifiedByQuarter,
    verifiedByAccession,
  };
}

/**
 * Evaluate a single file using weighted voting across multiple strategies.
 */
export function evaluateFile(file: AntigravityFile, reference: ReferenceData): FileEvaluation {
  const projectedValue = file.value * 1000;
  const signals: DetectionSignal[] = [];

  // ========== STRATEGY ACC: SAME-ACCESSION VERIFIED (DEFINITIVE) ==========
  // If we have the EXACT same accession number in verified data, use that
  const sameAccessionVerified = reference.verifiedByAccession.get(file.accessionNumber);
  if (sameAccessionVerified) {
    const ratio = file.value / sameAccessionVerified.value;

    // If values are similar (0.1x-10x), file is correct
    if (ratio > DETECTION_CONFIG.RATIO_LOW && ratio < DETECTION_CONFIG.RATIO_HIGH) {
      return createResult(
        file,
        'correct',
        0.99,
        `Matches same accession verified $${sameAccessionVerified.value.toLocaleString()} (ratio ${ratio.toFixed(2)})`,
        'ACC: Same accession match'
      );
    }

    // If file is already 1000x the verified value, it's been corrected
    if (ratio > 500 && ratio < 2000) {
      return createResult(
        file,
        'correct',
        0.99,
        `Already x1000 of same accession verified $${sameAccessionVerified.value.toLocaleString()} (ratio ${ratio.toFixed(0)}x)`,
        'ACC: Already x1000'
      );
    }

    // If file x1000 would match verified, needs x1000
    const projectedRatio = projectedValue / sameAccessionVerified.value;
    if (projectedRatio > DETECTION_CONFIG.RATIO_LOW && projectedRatio < DETECTION_CONFIG.RATIO_HIGH) {
      return createResult(
        file,
        'needs-x1000',
        0.99,
        `x1000 matches same accession verified $${sameAccessionVerified.value.toLocaleString()}`,
        'ACC: x1000 matches accession',
        projectedValue
      );
    }
  }

  // ========== STRATEGY M: MARKET PRICE CONSENSUS ==========
  if (file.marketComparison && file.marketComparison.matchedCusips >= 1) {
    const mc = file.marketComparison;
    if (mc.confidence >= 0.6 && mc.verdict !== 'unclear') {
      signals.push({
        strategy: 'M: Market consensus',
        verdict: mc.verdict,
        confidence: mc.confidence,
        weight: 0.95,
        reason: `${mc.matchedCusips} CUSIPs, median ratio ${mc.medianRatio?.toFixed(4) || 'N/A'}`,
      });
    }
  }

  // Find adjacent quarters
  const nextQ = getNextQuarter(file.quarter);
  const prevQ = getPreviousQuarter(file.quarter);
  const nextVerified = nextQ ? reference.verifiedByQuarter.get(nextQ) : null;
  const prevVerified = prevQ ? reference.verifiedByQuarter.get(prevQ) : null;
  const sameQuarterVerified = reference.verifiedByQuarter.get(file.quarter);

  // ========== STRATEGY A0: SAME-QUARTER VERIFIED ==========
  if (sameQuarterVerified && sameQuarterVerified.accessionNumber !== file.accessionNumber) {
    const currentRatio = file.value / sameQuarterVerified.value;
    const projectedRatio = projectedValue / sameQuarterVerified.value;

    if (currentRatio > DETECTION_CONFIG.RATIO_LOW && currentRatio < DETECTION_CONFIG.RATIO_HIGH) {
      signals.push({
        strategy: 'A0: Same quarter',
        verdict: 'correct',
        confidence: 0.85,
        weight: 0.85,
        reason: `${(currentRatio * 100).toFixed(0)}% of $${sameQuarterVerified.value.toLocaleString()}`,
      });
    } else if (
      projectedRatio > DETECTION_CONFIG.RATIO_LOW &&
      projectedRatio < DETECTION_CONFIG.RATIO_HIGH
    ) {
      signals.push({
        strategy: 'A0: Same quarter',
        verdict: 'needs-x1000',
        confidence: 0.85,
        weight: 0.85,
        reason: `x1000 → ${(projectedRatio * 100).toFixed(0)}% of $${sameQuarterVerified.value.toLocaleString()}`,
      });
    } else if (currentRatio > 500 && currentRatio < 2000) {
      signals.push({
        strategy: 'A0: Already x1000',
        verdict: 'correct',
        confidence: 0.9,
        weight: 0.9,
        reason: `${currentRatio.toFixed(0)}x same-quarter verified`,
      });
    }
  }

  // ========== STRATEGY D: NEXT QUARTER ==========
  if (nextVerified && nextVerified.value > DETECTION_CONFIG.MIN_VERIFIED_VALUE) {
    const currentRatio = file.value / nextVerified.value;
    const projectedRatio = projectedValue / nextVerified.value;

    if (currentRatio > DETECTION_CONFIG.RATIO_LOW && currentRatio < DETECTION_CONFIG.RATIO_HIGH) {
      signals.push({
        strategy: 'D: Next quarter',
        verdict: 'correct',
        confidence: 0.75,
        weight: 0.75,
        reason: `Similar to ${nextQ} $${nextVerified.value.toLocaleString()}`,
      });
    } else if (
      projectedRatio > DETECTION_CONFIG.RATIO_LOW &&
      projectedRatio < DETECTION_CONFIG.RATIO_HIGH
    ) {
      signals.push({
        strategy: 'D: Next quarter',
        verdict: 'needs-x1000',
        confidence: 0.75,
        weight: 0.75,
        reason: `x1000 aligns with ${nextQ}`,
      });
    }
  }

  // ========== STRATEGY E: PREVIOUS QUARTER ==========
  if (prevVerified && prevVerified.value > DETECTION_CONFIG.MIN_VERIFIED_VALUE) {
    const currentRatio = file.value / prevVerified.value;
    const projectedRatio = projectedValue / prevVerified.value;

    if (currentRatio > DETECTION_CONFIG.RATIO_LOW && currentRatio < DETECTION_CONFIG.RATIO_HIGH) {
      signals.push({
        strategy: 'E: Prev quarter',
        verdict: 'correct',
        confidence: 0.75,
        weight: 0.75,
        reason: `Similar to ${prevQ} $${prevVerified.value.toLocaleString()}`,
      });
    } else if (
      projectedRatio > DETECTION_CONFIG.RATIO_LOW &&
      projectedRatio < DETECTION_CONFIG.RATIO_HIGH
    ) {
      signals.push({
        strategy: 'E: Prev quarter',
        verdict: 'needs-x1000',
        confidence: 0.75,
        weight: 0.75,
        reason: `x1000 aligns with ${prevQ}`,
      });
    }
  }

  // ========== STRATEGY A/B: VERIFIED MEDIAN ==========
  if (reference.medianValue) {
    const currentRatio = file.value / reference.medianValue;
    const projectedRatio = projectedValue / reference.medianValue;

    if (currentRatio > DETECTION_CONFIG.RATIO_LOW && currentRatio < DETECTION_CONFIG.RATIO_HIGH) {
      signals.push({
        strategy: 'A: Verified median',
        verdict: 'correct',
        confidence: 0.7,
        weight: 0.65,
        reason: `${(currentRatio * 100).toFixed(0)}% of median $${reference.medianValue.toLocaleString()}`,
      });
    } else if (
      projectedRatio > DETECTION_CONFIG.RATIO_LOW &&
      projectedRatio < DETECTION_CONFIG.RATIO_HIGH
    ) {
      signals.push({
        strategy: 'B: x1000 → median',
        verdict: 'needs-x1000',
        confidence: 0.7,
        weight: 0.65,
        reason: `x1000 → ${(projectedRatio * 100).toFixed(0)}% of median`,
      });
    }
  }

  // ========== STRATEGY C: PRICE-PER-SHARE ==========
  if (reference.medianPricePerShare && file.medianPricePerShare) {
    const ppsRatio = reference.medianPricePerShare / file.medianPricePerShare;
    if (ppsRatio > DETECTION_CONFIG.PPS_RATIO_LOW && ppsRatio < DETECTION_CONFIG.PPS_RATIO_HIGH) {
      signals.push({
        strategy: 'C: Price/share',
        verdict: 'needs-x1000',
        confidence: 0.8,
        weight: 0.6,
        reason: `PPS ${ppsRatio.toFixed(0)}x lower than verified`,
      });
    } else if (ppsRatio > 0.5 && ppsRatio < 2) {
      signals.push({
        strategy: 'C: Price/share',
        verdict: 'correct',
        confidence: 0.8,
        weight: 0.6,
        reason: 'PPS similar to verified',
      });
    }
  }

  // ========== SANITY CHECKS (NEGATIVE SIGNALS) ==========
  const projectedPerHolding = file.rowCount > 0 ? projectedValue / file.rowCount : projectedValue;

  // Sanity check: Projected value per holding > $100M is suspicious
  if (projectedPerHolding > 100_000_000) {
    signals.push({
      strategy: 'Sanity: Per-holding',
      verdict: 'correct', // Don't apply x1000 if result would be unrealistic
      confidence: 0.85,
      weight: 0.8,
      reason: `x1000 would mean $${(projectedPerHolding / 1_000_000).toFixed(0)}M per holding`,
    });
  }

  // Sanity check: If projected total > $50B for a small filing, suspicious
  if (projectedValue > 50_000_000_000 && file.rowCount < 10) {
    signals.push({
      strategy: 'Sanity: Total value',
      verdict: 'correct', // Don't apply x1000
      confidence: 0.9,
      weight: 0.85,
      reason: `x1000 would mean $${(projectedValue / 1_000_000_000).toFixed(0)}B with only ${file.rowCount} holdings`,
    });
  }

  // ========== WEIGHTED VOTING ==========
  let correctScore = 0;
  let needsX1000Score = 0;

  for (const signal of signals) {
    const score = signal.confidence * signal.weight;

    if (signal.verdict === 'correct') {
      correctScore += score;
    } else if (signal.verdict === 'needs-x1000') {
      needsX1000Score += score;
    }
  }

  // Make final decision based on weighted votes
  if (signals.length === 0) {
    // No signals - use default logic
    if (file.value > DETECTION_CONFIG.MIN_VERIFIED_VALUE) {
      return createResult(file, 'correct', 0.5, 'No clear signals, but value >$10M', 'Default: High value');
    }
    return createResult(
      file,
      'unclear',
      0.3,
      'Unable to determine - insufficient data',
      'None: Unclear'
    );
  }

  // Determine winner
  const margin = Math.abs(correctScore - needsX1000Score);
  const totalScore = correctScore + needsX1000Score;
  const confidence =
    totalScore > 0 ? Math.min(0.95, 0.5 + (margin / totalScore) * 0.45) : 0.5;

  // Need clear margin to call needs-x1000
  if (needsX1000Score > correctScore && margin > 0.3) {
    const topSignal = signals.find((s) => s.verdict === 'needs-x1000');
    return createResult(
      file,
      'needs-x1000',
      confidence,
      `Weighted vote: ${needsX1000Score.toFixed(2)} vs ${correctScore.toFixed(2)} (${topSignal?.reason || ''})`,
      topSignal?.strategy || 'Weighted voting',
      projectedValue
    );
  } else if (correctScore >= needsX1000Score) {
    const topSignal = signals.find((s) => s.verdict === 'correct');
    return createResult(
      file,
      'correct',
      confidence,
      `Weighted vote: ${correctScore.toFixed(2)} vs ${needsX1000Score.toFixed(2)} (${topSignal?.reason || ''})`,
      topSignal?.strategy || 'Weighted voting'
    );
  }

  return createResult(file, 'unclear', 0.5, 'Weighted vote inconclusive', 'None: Unclear');
}

function createResult(
  file: AntigravityFile,
  status: 'needs-x1000' | 'correct' | 'unclear',
  confidence: number,
  message: string,
  strategyUsed: string,
  projectedValue?: number
): FileEvaluation {
  return {
    filename: file.filename,
    cik: parseFilename(file.filename).cik,
    quarter: file.quarter,
    accessionNumber: file.accessionNumber,
    currentValue: file.value,
    rowCount: file.rowCount,
    medianPricePerShare: file.medianPricePerShare,
    status,
    message,
    confidence,
    strategyUsed,
    ...(projectedValue !== undefined && { projectedValue }),
  };
}

