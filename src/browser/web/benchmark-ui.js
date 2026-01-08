/**
 * Browser Benchmark UI
 *
 * Provides UI for running benchmarks in the browser with:
 * - Progress bar
 * - "Run Benchmark" button
 * - Export metrics to window.benchmarkResults for Claude extraction
 * - Graceful error handling
 */

// Import detection engine (assumes it's already loaded)
// BrowserDetectionEngine should be available from detection-engine-browser.js

class BenchmarkUI {
  constructor(containerId = 'benchmark-container') {
    this.container = document.getElementById(containerId);
    if (!this.container) {
      console.error(`Container #${containerId} not found`);
      return;
    }

    this.results = null;
    this.isRunning = false;
    this.render();
  }

  render() {
    this.container.innerHTML = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 800px; margin: 2rem auto; padding: 2rem; background: #f9fafb; border-radius: 8px;">
        <h1 style="margin: 0 0 1.5rem 0; color: #1f2937;">Browser Benchmark</h1>

        <div id="benchmark-status" style="margin-bottom: 1.5rem; padding: 1rem; background: white; border-radius: 4px; border: 1px solid #e5e7eb;">
          <div style="color: #6b7280; font-size: 0.875rem;">Ready to run benchmark</div>
        </div>

        <div style="margin-bottom: 1.5rem;">
          <div id="progress-container" style="display: none;">
            <div style="display: flex; justify-content: space-between; margin-bottom: 0.5rem; font-size: 0.875rem; color: #6b7280;">
              <span id="progress-text">Processing...</span>
              <span id="progress-percent">0%</span>
            </div>
            <div style="width: 100%; background: #e5e7eb; border-radius: 9999px; height: 1.5rem; overflow: hidden;">
              <div id="progress-bar" style="height: 100%; background: linear-gradient(90deg, #3b82f6, #2563eb); width: 0%; transition: width 0.3s ease; display: flex; align-items: center; justify-content: center; color: white; font-size: 0.75rem; font-weight: 600;"></div>
            </div>
          </div>
        </div>

        <button
          id="run-benchmark-btn"
          style="width: 100%; padding: 0.875rem 1.5rem; background: #2563eb; color: white; border: none; border-radius: 6px; font-size: 1rem; font-weight: 600; cursor: pointer; transition: background 0.2s;"
          onmouseover="this.style.background='#1d4ed8'"
          onmouseout="this.style.background='#2563eb'"
        >
          Run Benchmark
        </button>

        <div id="results-section" style="display: none; margin-top: 2rem;">
          <h2 style="margin: 0 0 1rem 0; color: #1f2937; font-size: 1.25rem;">Results</h2>
          <div id="results-content" style="background: white; border-radius: 4px; border: 1px solid #e5e7eb; padding: 1.5rem;"></div>
        </div>

        <div id="error-section" style="display: none; margin-top: 1.5rem;">
          <div style="padding: 1rem; background: #fef2f2; border: 1px solid #fecaca; border-radius: 4px; color: #991b1b;">
            <strong style="display: block; margin-bottom: 0.5rem;">Error:</strong>
            <div id="error-message"></div>
          </div>
        </div>
      </div>
    `;

    this.attachEventListeners();
  }

  attachEventListeners() {
    const btn = document.getElementById('run-benchmark-btn');
    if (btn) {
      btn.addEventListener('click', () => this.runBenchmark());
    }
  }

  updateProgress(current, total, text = 'Processing...') {
    const progressContainer = document.getElementById('progress-container');
    const progressBar = document.getElementById('progress-bar');
    const progressText = document.getElementById('progress-text');
    const progressPercent = document.getElementById('progress-percent');

    if (progressContainer) progressContainer.style.display = 'block';

    const percent = Math.round((current / total) * 100);
    if (progressBar) {
      progressBar.style.width = `${percent}%`;
      progressBar.textContent = `${percent}%`;
    }
    if (progressText) progressText.textContent = text;
    if (progressPercent) progressPercent.textContent = `${percent}%`;
  }

  hideProgress() {
    const progressContainer = document.getElementById('progress-container');
    if (progressContainer) progressContainer.style.display = 'none';
  }

  updateStatus(message, type = 'info') {
    const statusEl = document.getElementById('benchmark-status');
    if (!statusEl) return;

    const colors = {
      info: '#6b7280',
      success: '#059669',
      error: '#dc2626',
      warning: '#d97706'
    };

    statusEl.innerHTML = `<div style="color: ${colors[type]}; font-size: 0.875rem;">${message}</div>`;
  }

  showError(message, error = null) {
    const errorSection = document.getElementById('error-section');
    const errorMessage = document.getElementById('error-message');

    if (errorSection) errorSection.style.display = 'block';
    if (errorMessage) {
      errorMessage.textContent = error ? `${message}: ${error.message}` : message;
    }

    this.updateStatus('Benchmark failed', 'error');
    console.error('Benchmark error:', message, error);
  }

  hideError() {
    const errorSection = document.getElementById('error-section');
    if (errorSection) errorSection.style.display = 'none';
  }

  showResults(results) {
    const resultsSection = document.getElementById('results-section');
    const resultsContent = document.getElementById('results-content');

    if (!resultsSection || !resultsContent) return;

    resultsSection.style.display = 'block';

    const metrics = results.metrics.metrics;
    const duration = (metrics.totalDurationMs / 1000).toFixed(2);
    const throughput = metrics.throughputFilesPerSec.toFixed(2);

    resultsContent.innerHTML = `
      <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 1rem; margin-bottom: 1.5rem;">
        <div style="padding: 1rem; background: #f9fafb; border-radius: 4px;">
          <div style="color: #6b7280; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.25rem;">Duration</div>
          <div style="font-size: 1.5rem; font-weight: 700; color: #1f2937;">${duration}s</div>
        </div>
        <div style="padding: 1rem; background: #f9fafb; border-radius: 4px;">
          <div style="color: #6b7280; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.25rem;">Files Processed</div>
          <div style="font-size: 1.5rem; font-weight: 700; color: #1f2937;">${results.totalFiles}</div>
        </div>
        <div style="padding: 1rem; background: #f9fafb; border-radius: 4px;">
          <div style="color: #6b7280; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.25rem;">Throughput</div>
          <div style="font-size: 1.5rem; font-weight: 700; color: #1f2937;">${throughput} files/s</div>
        </div>
        <div style="padding: 1rem; background: #f9fafb; border-radius: 4px;">
          <div style="color: #6b7280; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.25rem;">Total CIKs</div>
          <div style="font-size: 1.5rem; font-weight: 700; color: #1f2937;">${results.measurementCiks}</div>
        </div>
      </div>

      <div style="padding: 1rem; background: #ecfdf5; border: 1px solid #a7f3d0; border-radius: 4px; color: #065f46; font-size: 0.875rem;">
        <strong>Success!</strong> Results have been exported to <code style="background: white; padding: 0.125rem 0.25rem; border-radius: 2px;">window.benchmarkResults</code>
      </div>
    `;
  }

  async runBenchmark() {
    if (this.isRunning) {
      console.warn('Benchmark already running');
      return;
    }

    // Check if BrowserDetectionEngine is available
    if (typeof BrowserDetectionEngine === 'undefined') {
      this.showError('BrowserDetectionEngine not found. Make sure detection-engine-browser.js is loaded.');
      return;
    }

    this.isRunning = true;
    this.hideError();
    this.updateStatus('Initializing benchmark...', 'info');

    const btn = document.getElementById('run-benchmark-btn');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Running...';
      btn.style.background = '#9ca3af';
      btn.style.cursor = 'not-allowed';
    }

    try {
      // Initialize detection engine (assumes config and fileDiscovery are set up)
      // This will need to be customized based on the actual browser setup
      const config = window.benchmarkConfig || {
        antigravityBaseUrl: '/data/ANTIGRAVITY_FINAL_CLEAN_SCHEMA',
        verifiedBaseUrl: '/data/FILINGS_PARQ_MISSING_BATCH_1',
        parquetOps: window.parquetOps
      };

      const fileDiscovery = window.fileDiscovery;

      if (!fileDiscovery) {
        throw new Error('File discovery not configured. Set window.fileDiscovery');
      }

      const engine = new BrowserDetectionEngine(config, fileDiscovery);

      // Get all CIKs
      this.updateStatus('Discovering CIKs...', 'info');
      const allCiksMap = await engine.getAllCiks();
      const allCiks = Array.from(allCiksMap.keys()).sort((a, b) => a - b);

      const warmupCiks = 5;
      const warmupCikList = allCiks.slice(0, warmupCiks);
      const measurementCikList = allCiks.slice(warmupCiks);

      // Warmup phase
      this.updateStatus(`Warmup phase: ${warmupCiks} CIKs...`, 'info');
      this.updateProgress(0, warmupCiks, 'Warmup...');

      for (let i = 0; i < warmupCikList.length; i++) {
        await engine.evaluateCik(warmupCikList[i]);
        this.updateProgress(i + 1, warmupCiks, 'Warmup...');
      }

      // Measurement phase
      this.updateStatus('Measurement phase...', 'info');
      const startTime = performance.now();
      const allEvaluations = [];
      let filesProcessed = 0;

      for (let i = 0; i < measurementCikList.length; i++) {
        const cik = measurementCikList[i];

        try {
          const evaluations = await engine.evaluateCik(cik);
          allEvaluations.push(...evaluations);
          filesProcessed += evaluations.length;

          this.updateProgress(
            i + 1,
            measurementCikList.length,
            `Processing CIK ${cik} (${i + 1}/${measurementCikList.length})`
          );
        } catch (error) {
          console.error(`Error processing CIK ${cik}:`, error);
          // Continue with next CIK on error
        }
      }

      const endTime = performance.now();
      const totalDurationMs = endTime - startTime;

      // Prepare results
      const results = {
        timestamp: new Date().toISOString(),
        platform: 'browser',
        warmupCiks,
        measurementCiks: measurementCikList.length,
        totalFiles: filesProcessed,
        metrics: {
          metrics: {
            totalDurationMs,
            fileCount: filesProcessed,
            throughputFilesPerSec: (filesProcessed / totalDurationMs) * 1000,
            timings: [] // Browser doesn't track detailed timings
          }
        },
        evaluations: allEvaluations
      };

      // Export to window for Claude extraction
      window.benchmarkResults = results;

      this.results = results;
      this.hideProgress();
      this.updateStatus('Benchmark complete!', 'success');
      this.showResults(results);

    } catch (error) {
      this.hideProgress();
      this.showError('Benchmark failed', error);
    } finally {
      this.isRunning = false;
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Run Benchmark';
        btn.style.background = '#2563eb';
        btn.style.cursor = 'pointer';
      }
    }
  }
}

// Auto-initialize if container exists
if (typeof window !== 'undefined') {
  window.BenchmarkUI = BenchmarkUI;

  // Auto-initialize on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      if (document.getElementById('benchmark-container')) {
        new BenchmarkUI();
      }
    });
  } else {
    if (document.getElementById('benchmark-container')) {
      new BenchmarkUI();
    }
  }
}
