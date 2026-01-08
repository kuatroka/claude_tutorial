// src/shared/parquet-utils-base.ts
function parseFilename(filename) {
  const parts = filename.replace(".parquet", "").split("-");
  const cik = parseInt(parts[0]);
  const year = parts[parts.length - 3];
  const month = parseInt(parts[parts.length - 2]);
  const day = parts[parts.length - 1];
  const date = `${year}-${parts[parts.length - 2]}-${day}`;
  const accessionNumber = `${parts[1]}-${parts[2]}-${parts[3]}`;
  let quarter;
  if (month <= 3)
    quarter = `${year}-Q1`;
  else if (month <= 6)
    quarter = `${year}-Q2`;
  else if (month <= 9)
    quarter = `${year}-Q3`;
  else
    quarter = `${year}-Q4`;
  return { cik, date, quarter, accessionNumber };
}
function getNextQuarter(quarter) {
  const match = quarter.match(/^(\d{4})-Q(\d)$/);
  if (!match)
    return null;
  const year = parseInt(match[1]);
  const q = parseInt(match[2]);
  if (q === 4) {
    return `${year + 1}-Q1`;
  }
  return `${year}-Q${q + 1}`;
}
function getPreviousQuarter(quarter) {
  const match = quarter.match(/^(\d{4})-Q(\d)$/);
  if (!match)
    return null;
  const year = parseInt(match[1]);
  const q = parseInt(match[2]);
  if (q === 1) {
    return `${year - 1}-Q4`;
  }
  return `${year}-Q${q - 1}`;
}
function quarterToSortKey(quarter) {
  const match = quarter.match(/^(\d{4})-Q(\d)$/);
  if (match) {
    return parseInt(match[1]) * 10 + parseInt(match[2]);
  }
  return 0;
}

// src/shared/detection-logic.ts
var DETECTION_CONFIG = {
  RATIO_LOW: 0.1,
  RATIO_HIGH: 10,
  PPS_RATIO_LOW: 500,
  PPS_RATIO_HIGH: 2000,
  MIN_VERIFIED_VALUE: 1e7,
  MIN_VERIFIED_PPS: 1
};
function calculateReferenceData(rawFilings) {
  const verifiedByAccession = new Map;
  for (const v of rawFilings) {
    verifiedByAccession.set(v.accessionNumber, v);
  }
  const quarterMap = new Map;
  for (const f of rawFilings) {
    const existing = quarterMap.get(f.quarter);
    if (existing) {
      existing.value += f.value;
      existing.rowCount += f.rowCount;
    } else {
      quarterMap.set(f.quarter, { ...f });
    }
  }
  const aggregatedByQuarter = Array.from(quarterMap.values());
  const trustworthy = aggregatedByQuarter.filter((v) => v.value > DETECTION_CONFIG.MIN_VERIFIED_VALUE && v.medianPricePerShare !== null && v.medianPricePerShare > DETECTION_CONFIG.MIN_VERIFIED_PPS);
  const reference = trustworthy.length > 0 ? trustworthy : aggregatedByQuarter.filter((v) => v.value > DETECTION_CONFIG.MIN_VERIFIED_VALUE);
  let medianValue = null;
  if (reference.length > 0) {
    const values = reference.map((v) => v.value).sort((a, b) => a - b);
    medianValue = values[Math.floor(values.length / 2)];
  }
  let medianPPS = null;
  const ppsValues = reference.map((v) => v.medianPricePerShare).filter((p) => p !== null && p > 0).sort((a, b) => a - b);
  if (ppsValues.length > 0) {
    medianPPS = ppsValues[Math.floor(ppsValues.length / 2)];
  }
  const verifiedByQuarter = new Map;
  for (const v of aggregatedByQuarter) {
    verifiedByQuarter.set(v.quarter, v);
  }
  return {
    medianValue,
    medianPricePerShare: medianPPS,
    verifiedByQuarter,
    verifiedByAccession
  };
}
function evaluateFile(file, reference) {
  const projectedValue = file.value * 1000;
  const signals = [];
  const sameAccessionVerified = reference.verifiedByAccession.get(file.accessionNumber);
  if (sameAccessionVerified) {
    const ratio = file.value / sameAccessionVerified.value;
    if (ratio > DETECTION_CONFIG.RATIO_LOW && ratio < DETECTION_CONFIG.RATIO_HIGH) {
      return createResult(file, "correct", 0.99, `Matches same accession verified $${sameAccessionVerified.value.toLocaleString()} (ratio ${ratio.toFixed(2)})`, "ACC: Same accession match");
    }
    if (ratio > 500 && ratio < 2000) {
      return createResult(file, "correct", 0.99, `Already x1000 of same accession verified $${sameAccessionVerified.value.toLocaleString()} (ratio ${ratio.toFixed(0)}x)`, "ACC: Already x1000");
    }
    const projectedRatio = projectedValue / sameAccessionVerified.value;
    if (projectedRatio > DETECTION_CONFIG.RATIO_LOW && projectedRatio < DETECTION_CONFIG.RATIO_HIGH) {
      return createResult(file, "needs-x1000", 0.99, `x1000 matches same accession verified $${sameAccessionVerified.value.toLocaleString()}`, "ACC: x1000 matches accession", projectedValue);
    }
  }
  if (file.marketComparison && file.marketComparison.matchedCusips >= 1) {
    const mc = file.marketComparison;
    if (mc.confidence >= 0.6 && mc.verdict !== "unclear") {
      signals.push({
        strategy: "M: Market consensus",
        verdict: mc.verdict,
        confidence: mc.confidence,
        weight: 0.95,
        reason: `${mc.matchedCusips} CUSIPs, median ratio ${mc.medianRatio?.toFixed(4) || "N/A"}`
      });
    }
  }
  const nextQ = getNextQuarter(file.quarter);
  const prevQ = getPreviousQuarter(file.quarter);
  const nextVerified = nextQ ? reference.verifiedByQuarter.get(nextQ) : null;
  const prevVerified = prevQ ? reference.verifiedByQuarter.get(prevQ) : null;
  const sameQuarterVerified = reference.verifiedByQuarter.get(file.quarter);
  if (sameQuarterVerified && sameQuarterVerified.accessionNumber !== file.accessionNumber) {
    const currentRatio = file.value / sameQuarterVerified.value;
    const projectedRatio = projectedValue / sameQuarterVerified.value;
    if (currentRatio > DETECTION_CONFIG.RATIO_LOW && currentRatio < DETECTION_CONFIG.RATIO_HIGH) {
      signals.push({
        strategy: "A0: Same quarter",
        verdict: "correct",
        confidence: 0.85,
        weight: 0.85,
        reason: `${(currentRatio * 100).toFixed(0)}% of $${sameQuarterVerified.value.toLocaleString()}`
      });
    } else if (projectedRatio > DETECTION_CONFIG.RATIO_LOW && projectedRatio < DETECTION_CONFIG.RATIO_HIGH) {
      signals.push({
        strategy: "A0: Same quarter",
        verdict: "needs-x1000",
        confidence: 0.85,
        weight: 0.85,
        reason: `x1000 → ${(projectedRatio * 100).toFixed(0)}% of $${sameQuarterVerified.value.toLocaleString()}`
      });
    } else if (currentRatio > 500 && currentRatio < 2000) {
      signals.push({
        strategy: "A0: Already x1000",
        verdict: "correct",
        confidence: 0.9,
        weight: 0.9,
        reason: `${currentRatio.toFixed(0)}x same-quarter verified`
      });
    }
  }
  if (nextVerified && nextVerified.value > DETECTION_CONFIG.MIN_VERIFIED_VALUE) {
    const currentRatio = file.value / nextVerified.value;
    const projectedRatio = projectedValue / nextVerified.value;
    if (currentRatio > DETECTION_CONFIG.RATIO_LOW && currentRatio < DETECTION_CONFIG.RATIO_HIGH) {
      signals.push({
        strategy: "D: Next quarter",
        verdict: "correct",
        confidence: 0.75,
        weight: 0.75,
        reason: `Similar to ${nextQ} $${nextVerified.value.toLocaleString()}`
      });
    } else if (projectedRatio > DETECTION_CONFIG.RATIO_LOW && projectedRatio < DETECTION_CONFIG.RATIO_HIGH) {
      signals.push({
        strategy: "D: Next quarter",
        verdict: "needs-x1000",
        confidence: 0.75,
        weight: 0.75,
        reason: `x1000 aligns with ${nextQ}`
      });
    }
  }
  if (prevVerified && prevVerified.value > DETECTION_CONFIG.MIN_VERIFIED_VALUE) {
    const currentRatio = file.value / prevVerified.value;
    const projectedRatio = projectedValue / prevVerified.value;
    if (currentRatio > DETECTION_CONFIG.RATIO_LOW && currentRatio < DETECTION_CONFIG.RATIO_HIGH) {
      signals.push({
        strategy: "E: Prev quarter",
        verdict: "correct",
        confidence: 0.75,
        weight: 0.75,
        reason: `Similar to ${prevQ} $${prevVerified.value.toLocaleString()}`
      });
    } else if (projectedRatio > DETECTION_CONFIG.RATIO_LOW && projectedRatio < DETECTION_CONFIG.RATIO_HIGH) {
      signals.push({
        strategy: "E: Prev quarter",
        verdict: "needs-x1000",
        confidence: 0.75,
        weight: 0.75,
        reason: `x1000 aligns with ${prevQ}`
      });
    }
  }
  if (reference.medianValue) {
    const currentRatio = file.value / reference.medianValue;
    const projectedRatio = projectedValue / reference.medianValue;
    if (currentRatio > DETECTION_CONFIG.RATIO_LOW && currentRatio < DETECTION_CONFIG.RATIO_HIGH) {
      signals.push({
        strategy: "A: Verified median",
        verdict: "correct",
        confidence: 0.7,
        weight: 0.65,
        reason: `${(currentRatio * 100).toFixed(0)}% of median $${reference.medianValue.toLocaleString()}`
      });
    } else if (projectedRatio > DETECTION_CONFIG.RATIO_LOW && projectedRatio < DETECTION_CONFIG.RATIO_HIGH) {
      signals.push({
        strategy: "B: x1000 → median",
        verdict: "needs-x1000",
        confidence: 0.7,
        weight: 0.65,
        reason: `x1000 → ${(projectedRatio * 100).toFixed(0)}% of median`
      });
    }
  }
  if (reference.medianPricePerShare && file.medianPricePerShare) {
    const ppsRatio = reference.medianPricePerShare / file.medianPricePerShare;
    if (ppsRatio > DETECTION_CONFIG.PPS_RATIO_LOW && ppsRatio < DETECTION_CONFIG.PPS_RATIO_HIGH) {
      signals.push({
        strategy: "C: Price/share",
        verdict: "needs-x1000",
        confidence: 0.8,
        weight: 0.6,
        reason: `PPS ${ppsRatio.toFixed(0)}x lower than verified`
      });
    } else if (ppsRatio > 0.5 && ppsRatio < 2) {
      signals.push({
        strategy: "C: Price/share",
        verdict: "correct",
        confidence: 0.8,
        weight: 0.6,
        reason: "PPS similar to verified"
      });
    }
  }
  const projectedPerHolding = file.rowCount > 0 ? projectedValue / file.rowCount : projectedValue;
  if (projectedPerHolding > 1e8) {
    signals.push({
      strategy: "Sanity: Per-holding",
      verdict: "correct",
      confidence: 0.85,
      weight: 0.8,
      reason: `x1000 would mean $${(projectedPerHolding / 1e6).toFixed(0)}M per holding`
    });
  }
  if (projectedValue > 50000000000 && file.rowCount < 10) {
    signals.push({
      strategy: "Sanity: Total value",
      verdict: "correct",
      confidence: 0.9,
      weight: 0.85,
      reason: `x1000 would mean $${(projectedValue / 1e9).toFixed(0)}B with only ${file.rowCount} holdings`
    });
  }
  let correctScore = 0;
  let needsX1000Score = 0;
  for (const signal of signals) {
    const score = signal.confidence * signal.weight;
    if (signal.verdict === "correct") {
      correctScore += score;
    } else if (signal.verdict === "needs-x1000") {
      needsX1000Score += score;
    }
  }
  if (signals.length === 0) {
    if (file.value > DETECTION_CONFIG.MIN_VERIFIED_VALUE) {
      return createResult(file, "correct", 0.5, "No clear signals, but value >$10M", "Default: High value");
    }
    return createResult(file, "unclear", 0.3, "Unable to determine - insufficient data", "None: Unclear");
  }
  const margin = Math.abs(correctScore - needsX1000Score);
  const totalScore = correctScore + needsX1000Score;
  const confidence = totalScore > 0 ? Math.min(0.95, 0.5 + margin / totalScore * 0.45) : 0.5;
  if (needsX1000Score > correctScore && margin > 0.3) {
    const topSignal = signals.find((s) => s.verdict === "needs-x1000");
    return createResult(file, "needs-x1000", confidence, `Weighted vote: ${needsX1000Score.toFixed(2)} vs ${correctScore.toFixed(2)} (${topSignal?.reason || ""})`, topSignal?.strategy || "Weighted voting", projectedValue);
  } else if (correctScore >= needsX1000Score) {
    const topSignal = signals.find((s) => s.verdict === "correct");
    return createResult(file, "correct", confidence, `Weighted vote: ${correctScore.toFixed(2)} vs ${needsX1000Score.toFixed(2)} (${topSignal?.reason || ""})`, topSignal?.strategy || "Weighted voting");
  }
  return createResult(file, "unclear", 0.5, "Weighted vote inconclusive", "None: Unclear");
}
function createResult(file, status, confidence, message, strategyUsed, projectedValue) {
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
    ...projectedValue !== undefined && { projectedValue }
  };
}

// src/browser/web/detection-engine-browser.ts
class BrowserDetectionEngine {
  config;
  fileDiscovery;
  constructor(config, fileDiscovery) {
    this.config = config;
    this.fileDiscovery = fileDiscovery;
  }
  async getAllCiks() {
    const cikMap = new Map;
    const files = await this.fileDiscovery.listAntigravityFiles();
    for (const f of files) {
      const { cik } = parseFilename(f);
      if (!cikMap.has(cik))
        cikMap.set(cik, []);
      cikMap.get(cik).push(f);
    }
    return cikMap;
  }
  async getVerifiedFilings(cik) {
    const files = await this.fileDiscovery.listVerifiedFiles(cik);
    const filings = [];
    for (const filename of files) {
      const { quarter, accessionNumber } = parseFilename(filename);
      const fileUrl = `${this.config.verifiedBaseUrl}/${filename}`;
      const stats = await this.config.parquetOps.getFileStats(fileUrl);
      filings.push({
        quarter,
        value: stats.value,
        rowCount: stats.rowCount,
        accessionNumber,
        medianPricePerShare: stats.medianPricePerShare
      });
    }
    return filings.sort((a, b) => quarterToSortKey(a.quarter) - quarterToSortKey(b.quarter));
  }
  async getAntigravityFiles(cik) {
    const cikMap = await this.getAllCiks();
    const filenames = cikMap.get(cik) || [];
    const files = [];
    for (const filename of filenames) {
      const { quarter, date, accessionNumber } = parseFilename(filename);
      const fileUrl = `${this.config.antigravityBaseUrl}/${filename}`;
      const [stats, marketComparison] = await Promise.all([
        this.config.parquetOps.getFileStats(fileUrl),
        this.config.parquetOps.getMarketPriceComparison(fileUrl, quarter)
      ]);
      files.push({
        filename,
        quarter,
        date,
        accessionNumber,
        value: stats.value,
        rowCount: stats.rowCount,
        medianPricePerShare: stats.medianPricePerShare,
        marketComparison
      });
    }
    return files.sort((a, b) => quarterToSortKey(a.quarter) - quarterToSortKey(b.quarter));
  }
  async evaluateCik(cik) {
    const verified = await this.getVerifiedFilings(cik);
    const antigravity = await this.getAntigravityFiles(cik);
    const reference = calculateReferenceData(verified);
    return antigravity.map((file) => evaluateFile(file, reference));
  }
  async processAll() {
    const cikMap = await this.getAllCiks();
    const results = new Map;
    let totalFiles = 0;
    for (const [cik, filenames] of cikMap.entries()) {
      totalFiles += filenames.length;
      const evaluations = await this.evaluateCik(cik);
      results.set(cik, evaluations);
    }
    return {
      totalCiks: cikMap.size,
      totalFiles,
      results
    };
  }
}
if (typeof window !== "undefined") {
  window.BrowserDetectionEngine = BrowserDetectionEngine;
}
export {
  BrowserDetectionEngine
};
