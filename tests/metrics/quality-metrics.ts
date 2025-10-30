/**
 * Quality Metrics for Search Evaluation
 *
 * Implements standard Information Retrieval (IR) metrics for evaluating
 * search quality and embedding effectiveness.
 */

export interface SearchResult {
  path: string;
  score: number;
  rank?: number;
}

export interface RelevanceLabel {
  docId: string;  // Document identifier (e.g., filename)
  relevance: number;  // 0 = not relevant, 1 = relevant, 2+ = highly relevant
}

export interface QueryEvaluation {
  query: string;
  results: SearchResult[];
  relevantDocs: Set<string>;  // Set of relevant document IDs
  relevanceScores?: Map<string, number>;  // Optional graded relevance
}

export interface MetricsReport {
  // Overall metrics
  precisionAt1: number;
  precisionAt3: number;
  precisionAt5: number;
  precisionAt10: number;
  recallAt10: number;
  mrr: number;  // Mean Reciprocal Rank

  // Score statistics
  avgScore: number;
  minScore: number;
  maxScore: number;
  scoreDistribution: { range: string; count: number }[];

  // Per-query details
  queryResults: Array<{
    query: string;
    precisionAt1: number;
    precisionAt3: number;
    precisionAt5: number;
    reciprocalRank: number;
    avgScore: number;
    foundRelevant: number;
    totalRelevant: number;
  }>;
}

export class QualityMetrics {
  /**
   * Calculate Precision@K: What percentage of the top K results are relevant?
   */
  static precisionAtK(
    results: SearchResult[],
    relevantDocs: Set<string>,
    k: number
  ): number {
    if (k === 0 || results.length === 0) return 0;

    const topK = results.slice(0, Math.min(k, results.length));
    const relevantInTopK = topK.filter(r =>
      relevantDocs.has(this.extractDocId(r.path))
    ).length;

    return relevantInTopK / Math.min(k, results.length);
  }

  /**
   * Calculate Recall@K: What percentage of relevant docs are in the top K?
   */
  static recallAtK(
    results: SearchResult[],
    relevantDocs: Set<string>,
    k: number
  ): number {
    if (relevantDocs.size === 0) return 0;

    const topK = results.slice(0, Math.min(k, results.length));
    const relevantInTopK = topK.filter(r =>
      relevantDocs.has(this.extractDocId(r.path))
    ).length;

    return relevantInTopK / relevantDocs.size;
  }

  /**
   * Calculate Reciprocal Rank: 1 / rank of first relevant result
   * Returns 0 if no relevant results found
   */
  static reciprocalRank(
    results: SearchResult[],
    relevantDocs: Set<string>
  ): number {
    for (let i = 0; i < results.length; i++) {
      if (relevantDocs.has(this.extractDocId(results[i].path))) {
        return 1 / (i + 1);
      }
    }
    return 0;
  }

  /**
   * Calculate Mean Reciprocal Rank across multiple queries
   */
  static meanReciprocalRank(evaluations: QueryEvaluation[]): number {
    if (evaluations.length === 0) return 0;

    const sum = evaluations.reduce((acc, eval_) => {
      return acc + this.reciprocalRank(eval_.results, eval_.relevantDocs);
    }, 0);

    return sum / evaluations.length;
  }

  /**
   * Generate a comprehensive metrics report
   */
  static generateReport(evaluations: QueryEvaluation[]): MetricsReport {
    if (evaluations.length === 0) {
      throw new Error('No evaluations provided');
    }

    // Calculate per-query metrics
    const queryResults = evaluations.map(eval_ => {
      const p1 = this.precisionAtK(eval_.results, eval_.relevantDocs, 1);
      const p3 = this.precisionAtK(eval_.results, eval_.relevantDocs, 3);
      const p5 = this.precisionAtK(eval_.results, eval_.relevantDocs, 5);
      const rr = this.reciprocalRank(eval_.results, eval_.relevantDocs);

      const scores = eval_.results.map(r => r.score);
      const avgScore = scores.length > 0
        ? scores.reduce((a, b) => a + b, 0) / scores.length
        : 0;

      const foundRelevant = eval_.results.filter(r =>
        eval_.relevantDocs.has(this.extractDocId(r.path))
      ).length;

      return {
        query: eval_.query,
        precisionAt1: p1,
        precisionAt3: p3,
        precisionAt5: p5,
        reciprocalRank: rr,
        avgScore,
        foundRelevant,
        totalRelevant: eval_.relevantDocs.size
      };
    });

    // Calculate overall metrics (averages across queries)
    const avgPrecisionAt1 = queryResults.reduce((a, b) => a + b.precisionAt1, 0) / queryResults.length;
    const avgPrecisionAt3 = queryResults.reduce((a, b) => a + b.precisionAt3, 0) / queryResults.length;
    const avgPrecisionAt5 = queryResults.reduce((a, b) => a + b.precisionAt5, 0) / queryResults.length;
    const avgPrecisionAt10 = evaluations.reduce((sum, eval_) =>
      sum + this.precisionAtK(eval_.results, eval_.relevantDocs, 10), 0
    ) / evaluations.length;

    const avgRecallAt10 = evaluations.reduce((sum, eval_) =>
      sum + this.recallAtK(eval_.results, eval_.relevantDocs, 10), 0
    ) / evaluations.length;

    const mrr = this.meanReciprocalRank(evaluations);

    // Calculate score statistics
    const allScores = evaluations.flatMap(e => e.results.map(r => r.score));
    const avgScore = allScores.length > 0
      ? allScores.reduce((a, b) => a + b, 0) / allScores.length
      : 0;
    const minScore = allScores.length > 0 ? Math.min(...allScores) : 0;
    const maxScore = allScores.length > 0 ? Math.max(...allScores) : 0;

    // Score distribution (buckets)
    const scoreDistribution = this.calculateScoreDistribution(allScores);

    return {
      precisionAt1: avgPrecisionAt1,
      precisionAt3: avgPrecisionAt3,
      precisionAt5: avgPrecisionAt5,
      precisionAt10: avgPrecisionAt10,
      recallAt10: avgRecallAt10,
      mrr,
      avgScore,
      minScore,
      maxScore,
      scoreDistribution,
      queryResults
    };
  }

  /**
   * Calculate score distribution in buckets
   */
  private static calculateScoreDistribution(
    scores: number[]
  ): { range: string; count: number }[] {
    const buckets = [
      { range: '0.0-0.2', min: 0.0, max: 0.2, count: 0 },
      { range: '0.2-0.4', min: 0.2, max: 0.4, count: 0 },
      { range: '0.4-0.6', min: 0.4, max: 0.6, count: 0 },
      { range: '0.6-0.8', min: 0.6, max: 0.8, count: 0 },
      { range: '0.8-1.0', min: 0.8, max: 1.0, count: 0 },
    ];

    scores.forEach(score => {
      for (const bucket of buckets) {
        if (score >= bucket.min && score < bucket.max) {
          bucket.count++;
          break;
        }
        // Handle score === 1.0 case
        if (score === 1.0 && bucket.max === 1.0) {
          bucket.count++;
          break;
        }
      }
    });

    return buckets.map(b => ({ range: b.range, count: b.count }));
  }

  /**
   * Extract document ID from path (basename)
   */
  private static extractDocId(path: string): string {
    return path.split('/').pop() || path;
  }

  /**
   * Format metrics report as human-readable text
   */
  static formatReport(report: MetricsReport, detailed: boolean = true): string {
    const lines: string[] = [];

    lines.push('');
    lines.push('═══════════════════════════════════════════════════════════');
    lines.push('                    QUALITY METRICS REPORT                  ');
    lines.push('═══════════════════════════════════════════════════════════');
    lines.push('');

    // Overall metrics
    lines.push('📊 OVERALL METRICS');
    lines.push('───────────────────────────────────────────────────────────');
    lines.push(`   Precision@1:  ${(report.precisionAt1 * 100).toFixed(1)}%  (top result is relevant)`);
    lines.push(`   Precision@3:  ${(report.precisionAt3 * 100).toFixed(1)}%  (top 3 results are relevant)`);
    lines.push(`   Precision@5:  ${(report.precisionAt5 * 100).toFixed(1)}%  (top 5 results are relevant)`);
    lines.push(`   Precision@10: ${(report.precisionAt10 * 100).toFixed(1)}%  (top 10 results are relevant)`);
    lines.push(`   Recall@10:    ${(report.recallAt10 * 100).toFixed(1)}%  (found relevant docs in top 10)`);
    lines.push(`   MRR:          ${report.mrr.toFixed(3)}  (Mean Reciprocal Rank)`);
    lines.push('');

    // Quality assessment
    const assessment = this.assessQuality(report);
    lines.push(`🎯 QUALITY ASSESSMENT: ${assessment.grade}`);
    lines.push(`   ${assessment.summary}`);
    lines.push('');

    // Score statistics
    lines.push('📈 SCORE STATISTICS');
    lines.push('───────────────────────────────────────────────────────────');
    lines.push(`   Average Score: ${(report.avgScore * 100).toFixed(1)}%`);
    lines.push(`   Min Score:     ${(report.minScore * 100).toFixed(1)}%`);
    lines.push(`   Max Score:     ${(report.maxScore * 100).toFixed(1)}%`);
    lines.push('');

    // Score distribution
    lines.push('   Distribution:');
    const maxCount = Math.max(...report.scoreDistribution.map(d => d.count), 1);
    report.scoreDistribution.forEach(bucket => {
      const barLength = Math.round((bucket.count / maxCount) * 30);
      const bar = '█'.repeat(barLength);
      lines.push(`   ${bucket.range}: ${bar} (${bucket.count})`);
    });
    lines.push('');

    // Detailed per-query results
    if (detailed) {
      lines.push('🔍 PER-QUERY RESULTS');
      lines.push('───────────────────────────────────────────────────────────');

      report.queryResults.forEach((qr, idx) => {
        const passSymbol = qr.precisionAt1 > 0 ? '✅' : '❌';
        lines.push(`${idx + 1}. ${passSymbol} "${qr.query}"`);
        lines.push(`   P@1: ${(qr.precisionAt1 * 100).toFixed(0)}%  P@3: ${(qr.precisionAt3 * 100).toFixed(0)}%  P@5: ${(qr.precisionAt5 * 100).toFixed(0)}%  RR: ${qr.reciprocalRank.toFixed(3)}`);
        lines.push(`   Found: ${qr.foundRelevant}/${qr.totalRelevant} relevant  Avg score: ${(qr.avgScore * 100).toFixed(1)}%`);
        lines.push('');
      });
    }

    // Summary
    const passed = report.queryResults.filter(qr => qr.precisionAt1 > 0).length;
    const total = report.queryResults.length;
    lines.push('───────────────────────────────────────────────────────────');
    lines.push(`✓ Queries with relevant results: ${passed}/${total} (${((passed/total)*100).toFixed(1)}%)`);
    lines.push('═══════════════════════════════════════════════════════════');

    return lines.join('\n');
  }

  /**
   * Assess overall quality and provide grade
   */
  private static assessQuality(report: MetricsReport): { grade: string; summary: string } {
    const p1 = report.precisionAt1;
    const p3 = report.precisionAt3;
    const mrr = report.mrr;

    // Grading based on documented expectations from search-quality.md
    // Top-1: 70-80%, Top-3: 85-90%
    if (p1 >= 0.80 && p3 >= 0.90 && mrr >= 0.85) {
      return {
        grade: '⭐⭐⭐⭐⭐ EXCELLENT',
        summary: 'Search quality exceeds expectations. Highly accurate and relevant results.'
      };
    } else if (p1 >= 0.70 && p3 >= 0.85 && mrr >= 0.75) {
      return {
        grade: '⭐⭐⭐⭐ VERY GOOD',
        summary: 'Search quality meets expectations. Reliable and accurate results.'
      };
    } else if (p1 >= 0.60 && p3 >= 0.75 && mrr >= 0.65) {
      return {
        grade: '⭐⭐⭐ GOOD',
        summary: 'Search quality is acceptable but has room for improvement.'
      };
    } else if (p1 >= 0.50 && p3 >= 0.65) {
      return {
        grade: '⭐⭐ FAIR',
        summary: 'Search quality is below expectations. Consider tuning or alternative approaches.'
      };
    } else {
      return {
        grade: '⭐ POOR',
        summary: 'Search quality needs significant improvement. Results are often irrelevant.'
      };
    }
  }
}
