#!/usr/bin/env npx tsx

/**
 * Unit test for Quality Metrics module
 * Tests the metrics calculation without needing the full worker/sidecar setup
 */

import { QualityMetrics, QueryEvaluation } from './quality-metrics';

function runTests() {
  console.log('🧪 Testing Quality Metrics Module\n');

  let passed = 0;
  let failed = 0;

  // Test 1: Precision@K
  console.log('Test 1: Precision@K calculation');
  const results1 = [
    { path: 'doc1.txt', score: 0.9, rank: 1 },
    { path: 'doc2.txt', score: 0.8, rank: 2 },
    { path: 'doc3.txt', score: 0.7, rank: 3 },
    { path: 'doc4.txt', score: 0.6, rank: 4 },
  ];
  const relevant1 = new Set(['doc1.txt', 'doc3.txt']);

  const p1 = QualityMetrics.precisionAtK(results1, relevant1, 1);
  const p3 = QualityMetrics.precisionAtK(results1, relevant1, 3);

  if (p1 === 1.0 && p3 === 2/3) {
    console.log('  ✅ PASSED - P@1=1.0, P@3=0.67\n');
    passed++;
  } else {
    console.log(`  ❌ FAILED - Expected P@1=1.0, P@3=0.67, got P@1=${p1}, P@3=${p3}\n`);
    failed++;
  }

  // Test 2: Recall@K
  console.log('Test 2: Recall@K calculation');
  const recall3 = QualityMetrics.recallAtK(results1, relevant1, 3);
  const recall10 = QualityMetrics.recallAtK(results1, relevant1, 10);

  if (recall3 === 1.0 && recall10 === 1.0) {
    console.log('  ✅ PASSED - R@3=1.0, R@10=1.0\n');
    passed++;
  } else {
    console.log(`  ❌ FAILED - Expected R@3=1.0, R@10=1.0, got R@3=${recall3}, R@10=${recall10}\n`);
    failed++;
  }

  // Test 3: Reciprocal Rank
  console.log('Test 3: Reciprocal Rank calculation');
  const rr1 = QualityMetrics.reciprocalRank(results1, relevant1); // First result is relevant
  const results2 = [
    { path: 'doc4.txt', score: 0.9, rank: 1 },
    { path: 'doc1.txt', score: 0.8, rank: 2 },
  ];
  const rr2 = QualityMetrics.reciprocalRank(results2, relevant1); // Second result is relevant

  if (rr1 === 1.0 && rr2 === 0.5) {
    console.log('  ✅ PASSED - RR=1.0 (rank 1), RR=0.5 (rank 2)\n');
    passed++;
  } else {
    console.log(`  ❌ FAILED - Expected RR=1.0 and RR=0.5, got RR=${rr1} and RR=${rr2}\n`);
    failed++;
  }

  // Test 4: Mean Reciprocal Rank
  console.log('Test 4: Mean Reciprocal Rank across multiple queries');
  const evaluations: QueryEvaluation[] = [
    { query: 'q1', results: results1, relevantDocs: relevant1 }, // RR = 1.0
    { query: 'q2', results: results2, relevantDocs: relevant1 }, // RR = 0.5
  ];
  const mrr = QualityMetrics.meanReciprocalRank(evaluations);

  if (Math.abs(mrr - 0.75) < 0.001) {
    console.log('  ✅ PASSED - MRR=0.75 (average of 1.0 and 0.5)\n');
    passed++;
  } else {
    console.log(`  ❌ FAILED - Expected MRR=0.75, got MRR=${mrr}\n`);
    failed++;
  }

  // Test 5: Full Report Generation
  console.log('Test 5: Full metrics report generation');
  try {
    const report = QualityMetrics.generateReport(evaluations);

    // Query 1: top result IS relevant (doc1.txt) -> P@1 = 1.0
    // Query 2: top result is NOT relevant (doc4.txt) -> P@1 = 0.0
    // Average P@1 = (1.0 + 0.0) / 2 = 0.5
    const expectedP1 = 0.5;
    const expectedMRR = 0.75;

    if (Math.abs(report.precisionAt1 - expectedP1) < 0.001 &&
        Math.abs(report.mrr - expectedMRR) < 0.001 &&
        report.queryResults.length === 2) {
      console.log('  ✅ PASSED - Report generated with correct metrics\n');
      passed++;
    } else {
      console.log(`  ❌ FAILED - Report metrics incorrect\n`);
      console.log(`     Expected: P@1=${expectedP1}, MRR=${expectedMRR}, queries=2`);
      console.log(`     Got: P@1=${report.precisionAt1}, MRR=${report.mrr}, queries=${report.queryResults.length}\n`);
      failed++;
    }
  } catch (error) {
    console.log(`  ❌ FAILED - Error generating report: ${error}\n`);
    failed++;
  }

  // Test 6: Report Formatting
  console.log('Test 6: Report formatting');
  try {
    const report = QualityMetrics.generateReport(evaluations);
    const formatted = QualityMetrics.formatReport(report, false);

    if (formatted.includes('QUALITY METRICS REPORT') &&
        formatted.includes('Precision@1') &&
        formatted.includes('MRR') &&
        formatted.length > 100) {
      console.log('  ✅ PASSED - Report formatted correctly\n');
      passed++;
    } else {
      console.log('  ❌ FAILED - Report format incomplete\n');
      failed++;
    }
  } catch (error) {
    console.log(`  ❌ FAILED - Error formatting report: ${error}\n`);
    failed++;
  }

  // Test 7: Edge case - Empty results
  console.log('Test 7: Edge case - No relevant documents found');
  const emptyResults = [
    { path: 'doc5.txt', score: 0.5, rank: 1 },
    { path: 'doc6.txt', score: 0.4, rank: 2 },
  ];
  const relevant7 = new Set(['doc1.txt', 'doc2.txt']);
  const p7 = QualityMetrics.precisionAtK(emptyResults, relevant7, 2);
  const rr7 = QualityMetrics.reciprocalRank(emptyResults, relevant7);

  if (p7 === 0 && rr7 === 0) {
    console.log('  ✅ PASSED - Correctly handles no relevant results (P=0, RR=0)\n');
    passed++;
  } else {
    console.log(`  ❌ FAILED - Expected P=0, RR=0, got P=${p7}, RR=${rr7}\n`);
    failed++;
  }

  // Test 8: Quality Assessment
  console.log('Test 8: Quality assessment grading');
  const excellentEvals: QueryEvaluation[] = [
    {
      query: 'test',
      results: [
        { path: 'doc1.txt', score: 0.95, rank: 1 },
        { path: 'doc2.txt', score: 0.92, rank: 2 },
        { path: 'doc3.txt', score: 0.88, rank: 3 },
      ],
      relevantDocs: new Set(['doc1.txt', 'doc2.txt', 'doc3.txt'])
    }
  ];
  const excellentReport = QualityMetrics.generateReport(excellentEvals);
  const formatted = QualityMetrics.formatReport(excellentReport, false);

  if (formatted.includes('⭐⭐⭐⭐⭐') || formatted.includes('⭐⭐⭐⭐')) {
    console.log('  ✅ PASSED - Quality grading works\n');
    passed++;
  } else {
    console.log('  ❌ FAILED - Quality grading not working\n');
    failed++;
  }

  // Summary
  console.log('═══════════════════════════════════════════════');
  console.log(`📊 TEST SUMMARY: ${passed}/${passed + failed} passed`);
  console.log('═══════════════════════════════════════════════');

  if (failed > 0) {
    console.log(`\n❌ ${failed} test(s) failed`);
    process.exit(1);
  } else {
    console.log('\n✅ All tests passed!');
    console.log('\n💡 The metrics module is working correctly.');
    console.log('   To run the full quality evaluation with real embeddings:');
    console.log('   1. Ensure Semantica is built: npm run build');
    console.log('   2. Run: npx tsx tests/search-accuracy-test.ts');
  }
}

runTests();
