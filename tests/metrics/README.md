# Search Quality Metrics

This directory contains tools for evaluating the quality of Semantica's embedding-based search using standard Information Retrieval (IR) metrics.

## Overview

The quality evaluation system tests how well semantic search performs by:
- Running systematic test queries against known documents
- Measuring relevance using Precision@K, Recall@K, and Mean Reciprocal Rank (MRR)
- Providing automated quality grading and reporting
- Using the **REAL production model** (paraphrase-multilingual-mpnet-base-v2, 768-dim via Python sidecar)

## Files

### `quality-metrics.ts`
Core metrics module implementing standard IR evaluation metrics.

**Exports:**
- `QualityMetrics` class with static methods for:
  - `precisionAtK()` - What % of top-K results are relevant?
  - `recallAtK()` - What % of relevant docs are in top-K?
  - `reciprocalRank()` - 1/rank of first relevant result
  - `meanReciprocalRank()` - Average RR across queries
  - `generateReport()` - Comprehensive metrics report
  - `formatReport()` - Human-readable formatted output

**Example:**
```typescript
import { QualityMetrics, QueryEvaluation } from './quality-metrics';

const evaluations: QueryEvaluation[] = [
  {
    query: "machine learning",
    results: [
      { path: "ml-intro.pdf", score: 0.89, rank: 1 },
      { path: "ai-basics.pdf", score: 0.75, rank: 2 }
    ],
    relevantDocs: new Set(["ml-intro.pdf"])
  }
];

const report = QualityMetrics.generateReport(evaluations);
console.log(QualityMetrics.formatReport(report));
```

### `quality-metrics.test.ts`
Unit tests for the metrics module (8 tests, all passing).

**Run tests:**
```bash
npx tsx tests/metrics/quality-metrics.test.ts
```

**Tests cover:**
- Precision@K calculation
- Recall@K calculation
- Reciprocal Rank calculation
- Mean Reciprocal Rank across queries
- Full report generation
- Report formatting
- Edge cases (no relevant results)
- Quality assessment grading

### `search-quality-eval.ts`
Main quality evaluation script with 25 comprehensive test cases.

**Features:**
- 25 test cases across 6 categories (exact match, semantic, paraphrase, cross-lingual, multi-word, edge cases)
- Full worker + Python sidecar initialization
- Real embedding generation and vector search
- Category-specific analysis
- Score distribution visualization
- Automated quality thresholds (fails if P@1 < 70% or P@3 < 85%)
- Multiple output modes (standard, detailed, JSON export)

**Quick Start:**

**Option 1: Verify metrics module (fast, no dependencies)**
```bash
# Run unit tests for metrics calculations
npx tsx tests/metrics/quality-metrics.test.ts
# Expected: 8/8 tests pass ✅
```

**Option 2: Full quality evaluation (requires Python sidecar)**
```bash
# 1. Ensure the app has been run at least once to download models
npm run dev  # Run app, let models download, then quit

# 2. Build the worker
npm run build

# 3. Run quality evaluation
npx tsx tests/metrics/search-quality-eval.ts
# Expected: Full quality report with metrics
```

**Note:** The Python sidecar initialization can take 30-60 seconds on first run as it loads the model into memory (1.5GB). If you encounter timeouts, try running the main Semantica app first to ensure all models are downloaded and cached.

**Usage modes:**

```bash
# Standard evaluation (brief report)
npx tsx tests/metrics/search-quality-eval.ts

# Detailed per-query results
npx tsx tests/metrics/search-quality-eval.ts --detailed

# Export results to JSON
npx tsx tests/metrics/search-quality-eval.ts --export

# Test a specific document (ad-hoc)
npx tsx tests/metrics/search-quality-eval.ts \
  "/path/to/document.pdf" \
  "search query" \
  0.80  # optional expected score

# Legacy mode (old pass/fail format)
npx tsx tests/metrics/search-quality-eval.ts --legacy
```

## Test Categories

The evaluation includes 25 synthetic test cases:

| Category | Tests | Description | Expected Score |
|----------|-------|-------------|----------------|
| **Exact Match** | 5 | Query text appears verbatim in document | 75-85% |
| **Semantic Similarity** | 5 | Synonyms and related concepts (car/automobile) | 55-65% |
| **Paraphrases** | 5 | Same meaning, different words (buy/purchase) | 60-70% |
| **Cross-lingual** | 3 | French ↔ English queries and documents | 55-60% |
| **Multi-word Concepts** | 4 | Complex phrases (machine learning, renewable energy) | 70-75% |
| **Edge Cases** | 3 | Short queries, acronyms, numerical values | 65-70% |

## Understanding Metrics

### Precision@K
**What it measures:** Percentage of top-K results that are relevant.

**Interpretation:**
- P@1 = 72% → 72% of queries have a relevant top result
- P@3 = 87% → 87% of queries have at least one relevant result in top 3
- **Higher is better**

**Thresholds:**
- P@1 ≥ 70% (meets documented expectations)
- P@3 ≥ 85% (meets documented expectations)

### Recall@K
**What it measures:** Percentage of relevant documents found in top-K results.

**Interpretation:**
- R@10 = 95% → 95% of relevant docs appear in top 10 results
- **Higher is better**

### Mean Reciprocal Rank (MRR)
**What it measures:** Average position of the first relevant result.

**Calculation:**
- First relevant at rank 1 → RR = 1.0
- First relevant at rank 2 → RR = 0.5
- First relevant at rank 3 → RR = 0.333
- MRR = average across all queries

**Interpretation:**
- MRR > 0.8 → Excellent (relevant results usually #1)
- MRR > 0.7 → Very good (relevant results in top 2)
- MRR > 0.5 → Good (relevant results in top 3)

### Quality Grades

| Grade | P@1 | P@3 | MRR |
|-------|-----|-----|-----|
| ⭐⭐⭐⭐⭐ EXCELLENT | ≥80% | ≥90% | ≥0.85 |
| ⭐⭐⭐⭐ VERY GOOD | ≥70% | ≥85% | ≥0.75 |
| ⭐⭐⭐ GOOD | ≥60% | ≥75% | ≥0.65 |
| ⭐⭐ FAIR | ≥50% | ≥65% | ≥0.50 |
| ⭐ POOR | <50% | <65% | <0.50 |

## Example Output

```
═══════════════════════════════════════════════════════════
                    QUALITY METRICS REPORT
═══════════════════════════════════════════════════════════

📊 OVERALL METRICS
───────────────────────────────────────────────────────────
   Precision@1:  72.0%  (top result is relevant)
   Precision@3:  86.7%  (top 3 results are relevant)
   Precision@5:  84.0%  (top 5 results are relevant)
   Precision@10: 78.5%  (top 10 results are relevant)
   Recall@10:    95.2%  (found relevant docs in top 10)
   MRR:          0.795  (Mean Reciprocal Rank)

🎯 QUALITY ASSESSMENT: ⭐⭐⭐⭐ VERY GOOD
   Search quality meets expectations. Reliable and accurate results.

📈 SCORE STATISTICS
───────────────────────────────────────────────────────────
   Average Score: 68.5%
   Min Score:     12.3%
   Max Score:     94.2%

   Distribution:
   0.0-0.2: █ (2)
   0.2-0.4: ███ (5)
   0.4-0.6: ████████ (12)
   0.6-0.8: ██████████████████ (28)
   0.8-1.0: ████████████ (18)

📂 CATEGORY BREAKDOWN
───────────────────────────────────────────────────────────

EXACT-MATCH (5 tests)
   Success Rate: 5/5 (100%)
   Precision@1:  100.0%
   Precision@3:  100.0%
   MRR:          1.000

SEMANTIC (5 tests)
   Success Rate: 4/5 (80%)
   Precision@1:  80.0%
   Precision@3:  93.3%
   MRR:          0.850

[...more categories...]
```

## Requirements

### For quality-metrics.test.ts
- Node.js and TypeScript (via tsx)
- No external dependencies

### For search-quality-eval.ts
- Built worker: `npm run build`
- Python 3.11+ with dependencies:
  ```bash
  pip install fastapi uvicorn sentence-transformers
  ```
- Models downloaded (auto-copied from `~/Library/Application Support/Semantica/models/` if available)
- Port 8421 available for Python sidecar

## Troubleshooting

### "Worker initialization timeout" or "Startup failed - no embedder created"
**Cause:** Python sidecar failed to start or model loading timed out

**This is the most common issue.** The Python sidecar needs to:
1. Start the FastAPI server (5-10 seconds)
2. Load the embedding model into memory (~1.5GB, 20-40 seconds)
3. Signal readiness to the worker

**Solutions:**
1. **Run the app first:** The easiest fix is to run `npm run dev`, wait for models to download and load, then quit and run the test
2. Verify Python dependencies: `pip list | grep -E "(fastapi|uvicorn|sentence-transformers)"`
3. Check port availability: `lsof -ti:8421` (should be empty)
4. Ensure models exist: `ls ~/Library/Application\ Support/Semantica/models/`
5. Increase timeout: Edit `search-quality-eval.ts` line 415, change `120000` to `180000` (3 minutes)
6. Check Python environment: `python3 --version` (should be 3.11+)

**Debug logging:**
```bash
LOG_CATEGORIES=WORKER,STARTUP,EMBEDDER-FACTORY npx tsx tests/metrics/search-quality-eval.ts
```

### "Worker not found at dist/worker.cjs"
**Cause:** Worker not built

**Solution:** Run `npm run build`

### Tests timeout during indexing
**Cause:** Files taking too long to process

**Solutions:**
1. Check embedding throughput in logs (should be 55-93 texts/sec)
2. Verify Python sidecar is running: `lsof -ti:8421`
3. Enable debug logging: `LOG_CATEGORIES=WORKER,STARTUP npx tsx tests/metrics/search-quality-eval.ts`

### Python sidecar won't start
**Debug steps:**
1. Test Python environment: `python3 --version`
2. Run sidecar manually: `cd embedding_sidecar && python3 embed_server.py`
3. Check app logs: `ls ~/Library/Logs/Semantica/`

## Integration Testing

To verify the metrics module works without Python sidecar:

```bash
# Unit tests only (fast, no dependencies)
npx tsx tests/metrics/quality-metrics.test.ts

# Expected: 8/8 tests pass
```

To run full quality evaluation with real embeddings:

```bash
# Ensure worker is built
npm run build

# Run evaluation (takes ~2-3 minutes)
npx tsx tests/metrics/search-quality-eval.ts

# Expected: Quality report with metrics and category breakdown
```

## Customization

### Add Custom Test Cases

Edit `search-quality-eval.ts` and add to the `TEST_CASES` array:

```typescript
const TEST_CASES: TestCase[] = [
  // ...existing tests
  {
    name: "My custom test",
    category: "custom",
    fileName: "custom-doc.txt",
    fileContent: "Your document content here...",
    searchQuery: "your search query",
    expectedMinScore: 0.70
  }
];
```

### Test Real Documents

Add to `FILE_TEST_CASES` array:

```typescript
const FILE_TEST_CASES: TestCaseWithFile[] = [
  {
    name: "Real PDF test",
    category: "real-file",
    filePath: "/absolute/path/to/your/document.pdf",
    searchQuery: "your search query",
    expectedMinScore: 0.75,
    expectedMaxScore: 0.90
  }
];
```

### Adjust Quality Thresholds

Modify the threshold check in the main function:

```typescript
// Default thresholds
if (report.precisionAt1 < 0.70 || report.precisionAt3 < 0.85) {
  console.log('\n⚠️  WARNING: Search quality is below expected thresholds');
  process.exit(1);
}

// Stricter thresholds
if (report.precisionAt1 < 0.80 || report.precisionAt3 < 0.90) {
  // ...
}
```

## Related Documentation

- [Quality Testing Guide](../../docs/guides/quality-testing.md) - Complete usage guide
- [Search Quality Analysis](../../docs/analysis/search-quality.md) - Expected benchmarks
- [Multilingual Search](../../docs/analysis/multilingual-search.md) - Cross-lingual capabilities
- [Python Sidecar Spec](../../docs/specs/python-sidecar.md) - Embedding service details

## Summary

This metrics directory provides:

✅ **quality-metrics.ts** - Core IR metrics (Precision, Recall, MRR)
✅ **quality-metrics.test.ts** - Unit tests (8/8 passing)
✅ **search-quality-eval.ts** - Full evaluation with 25 test cases
✅ **README.md** - This file

**Quick verification:**
```bash
npx tsx tests/metrics/quality-metrics.test.ts  # Fast, no dependencies
```

**Full evaluation:**
```bash
npm run build
npx tsx tests/metrics/search-quality-eval.ts
```
