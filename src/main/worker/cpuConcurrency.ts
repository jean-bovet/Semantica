import os from 'node:os';

/**
 * Calculates optimal concurrency settings based on CPU cores
 * @param cpuCount - Number of CPU cores (defaults to system CPU count)
 * @returns Object with optimal and throttled concurrency values
 */
export function calculateOptimalConcurrency(cpuCount?: number): {
  cpuCount: number;
  optimal: number;
  throttled: number;
} {
  const cores = cpuCount ?? os.cpus().length;
  
  // Use all cores minus 1 for system responsiveness, minimum 4
  const optimal = Math.max(4, cores - 1);
  
  // Use 1/4 of cores when throttled (memory pressure), minimum 2
  const throttled = Math.max(2, Math.floor(cores / 4));
  
  return {
    cpuCount: cores,
    optimal,
    throttled
  };
}

/**
 * Gets a descriptive message about the concurrency settings
 * @param settings - The concurrency settings from calculateOptimalConcurrency
 * @returns A formatted log message
 */
export function getConcurrencyMessage(settings: ReturnType<typeof calculateOptimalConcurrency>): string {
  return `CPU cores detected: ${settings.cpuCount}, setting concurrency to ${settings.optimal} (throttled: ${settings.throttled})`;
}