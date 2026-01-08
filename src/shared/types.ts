/**
 * Shared types for the DuckDB benchmark system.
 */

// === Status and Operation Types ===

export type FileStatus = 'pending' | 'needs_x1000' | 'correct' | 'unclear' | 'processed' | 'skipped';
export type OperationType = 'x1000' | 'divide_1000' | 'revert';
export type DecisionSource = 'cli_auto' | 'cli_manual' | 'dashboard_auto' | 'dashboard_manual';

// === Core Data Interfaces ===

export interface FileEvaluation {
  filename: string;
  cik: number;
  quarter: string;
  accessionNumber: string;
  currentValue: number;
  rowCount: number;
  medianPricePerShare: number | null;
  status: 'needs-x1000' | 'correct' | 'unclear';
  message: string;
  confidence: number;
  strategyUsed: string;
  projectedValue?: number;
}

export interface CikData {
  cik: number;
  verified: VerifiedFiling[];
  antigravity: AntigravityFile[];
}

export interface VerifiedFiling {
  quarter: string;
  value: number;
  rowCount: number;
  accessionNumber: string;
  medianPricePerShare: number | null;
}

export interface MarketPriceComparison {
  matchedCusips: number;
  totalCusips: number;
  totalFilerWeight: number;
  medianRatio: number | null;
  avgRatio: number | null;
  minRatio: number | null;
  maxRatio: number | null;
  needsX1000Weight: number;
  correctWeight: number;
  verdict: 'needs-x1000' | 'correct' | 'unclear';
  confidence: number;
}

export interface AntigravityFile {
  filename: string;
  quarter: string;
  date: string;
  accessionNumber: string;
  value: number;
  rowCount: number;
  medianPricePerShare: number | null;
  marketComparison?: MarketPriceComparison;
}

export interface ReferenceData {
  medianValue: number | null;
  medianPricePerShare: number | null;
  verifiedByQuarter: Map<string, VerifiedFiling>;
  verifiedByAccession: Map<string, VerifiedFiling>;
}

// === Detection Interfaces ===

export interface DetectionSignal {
  strategy: string;
  verdict: 'needs-x1000' | 'correct' | 'unclear';
  confidence: number;
  weight: number;
  reason: string;
}

// === Operation Interfaces ===

export interface OperationResult {
  success: boolean;
  filename: string;
  operation: OperationType;
  originalValue?: number;
  newValue?: number;
  error?: string;
}

export interface OperationLog {
  id?: number;
  filename: string;
  operation: OperationType;
  originalValue: number;
  newValue: number;
  source: DecisionSource;
  timestamp: string;
  reverted: boolean;
  revertedAt?: string;
}

// === Status Record Interfaces ===

export interface FileStatusRecord {
  filename: string;
  cik: number;
  quarter: string;
  status: FileStatus;
  decisionSource: DecisionSource;
  originalValue: number;
  currentValue: number;
  confidence: number;
  message: string;
  createdAt: string;
  updatedAt: string;
}

export interface CikStatusRecord {
  cik: number;
  totalFiles: number;
  processedFiles: number;
  status: 'pending' | 'in_progress' | 'completed' | 'needs_review';
  lastUpdated: string;
}

// === Batch Processing Interfaces ===

export interface BatchProcessOptions {
  dryRun?: boolean;
  skipProcessed?: boolean;
  cik?: number;
  sample?: number;
  inPlace?: boolean;
}

export interface BatchProcessResult {
  totalFiles: number;
  processed: number;
  skipped: number;
  errors: string[];
  results: FileEvaluation[];
}

// === Benchmark Interfaces ===

export interface TimingRecord {
  operation: string;
  startTime: number;
  endTime: number;
  durationMs: number;
  metadata?: Record<string, unknown>;
}

export interface BenchmarkMetrics {
  totalDurationMs: number;
  timings: TimingRecord[];
  fileCount: number;
  rowCount: number;
  throughputFilesPerSec: number;
  throughputRowsPerSec: number;
  memoryUsageMB?: number;
  peakMemoryMB?: number;
}
