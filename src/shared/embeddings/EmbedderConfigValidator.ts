import { EmbedderConfig } from './IEmbedder';
import { ModelPathResolver } from './ModelPathResolver';

/**
 * Validation result for embedder configuration
 */
export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  normalizedConfig: Required<EmbedderConfig>;
}

/**
 * Validation rules for embedder configuration
 */
export interface ValidationRules {
  // Model validation
  modelName: {
    required: boolean;
    pattern?: RegExp;
    allowedValues?: string[];
  };

  // Memory validation
  maxMemoryMB: {
    min: number;
    max: number;
    recommended?: { min: number; max: number };
  };

  // File processing validation
  maxFilesBeforeRestart: {
    min: number;
    max: number;
    recommended?: { min: number; max: number };
  };

  // Batch size validation
  batchSize: {
    min: number;
    max: number;
    recommended?: { min: number; max: number };
  };

  // Custom validation functions
  customValidators?: Array<{
    name: string;
    validator: (config: EmbedderConfig) => { isValid: boolean; message?: string };
  }>;
}

/**
 * Environment-specific configuration schemas
 */
export const CONFIG_SCHEMAS = {
  development: {
    modelName: {
      required: true,
      pattern: /^[a-zA-Z0-9\-_\/]+$/
    },
    maxMemoryMB: {
      min: 50,
      max: 4000,
      recommended: { min: 100, max: 1500 }
    },
    maxFilesBeforeRestart: {
      min: 1,
      max: 10000,
      recommended: { min: 10, max: 500 }
    },
    batchSize: {
      min: 1,
      max: 128,
      recommended: { min: 8, max: 64 }
    }
  },

  production: {
    modelName: {
      required: true,
      pattern: /^[a-zA-Z0-9\-_\/]+$/
    },
    maxMemoryMB: {
      min: 100,
      max: 8000,
      recommended: { min: 500, max: 2000 }
    },
    maxFilesBeforeRestart: {
      min: 100,
      max: 50000,
      recommended: { min: 1000, max: 10000 }
    },
    batchSize: {
      min: 1,
      max: 256,
      recommended: { min: 16, max: 64 }
    }
  },

  test: {
    modelName: {
      required: false // Tests might use mock embedders
    },
    maxMemoryMB: {
      min: 10,
      max: 500,
      recommended: { min: 50, max: 200 }
    },
    maxFilesBeforeRestart: {
      min: 1,
      max: 100,
      recommended: { min: 5, max: 20 }
    },
    batchSize: {
      min: 1,
      max: 32,
      recommended: { min: 2, max: 8 }
    }
  }
} as const;

/**
 * Default configuration values for different environments
 */
export const DEFAULT_CONFIGS = {
  development: {
    modelName: 'Xenova/multilingual-e5-small',
    maxMemoryMB: 1000,
    maxFilesBeforeRestart: 200,
    batchSize: 16
  },

  production: {
    modelName: 'Xenova/multilingual-e5-small',
    maxMemoryMB: 1500,
    maxFilesBeforeRestart: 5000,
    batchSize: 32
  },

  test: {
    modelName: 'Xenova/multilingual-e5-small',
    maxMemoryMB: 100,
    maxFilesBeforeRestart: 10,
    batchSize: 4
  }
} as const;

/**
 * Centralized configuration validator for embedder instances with
 * environment-aware validation rules and automatic normalization.
 */
export class EmbedderConfigValidator {
  private readonly environment: keyof typeof CONFIG_SCHEMAS;
  private readonly rules: ValidationRules;
  constructor(
    environment: keyof typeof CONFIG_SCHEMAS = 'production',
    customRules?: Partial<ValidationRules>
  ) {
    this.environment = environment;
    this.rules = {
      ...CONFIG_SCHEMAS[environment],
      ...customRules
    };
  }

  /**
   * Validate and normalize embedder configuration
   */
  validate(config: Partial<EmbedderConfig> = {}): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Start with environment defaults
    const normalizedConfig = {
      ...DEFAULT_CONFIGS[this.environment],
      ...config
    } as Required<EmbedderConfig>;

    // Validate model name
    const modelValidation = this.validateModelName(normalizedConfig.modelName);
    if (!modelValidation.isValid) {
      errors.push(...modelValidation.errors);
    }
    warnings.push(...modelValidation.warnings);

    // Validate memory configuration
    const memoryValidation = this.validateMemory(normalizedConfig.maxMemoryMB);
    if (!memoryValidation.isValid) {
      errors.push(...memoryValidation.errors);
    }
    warnings.push(...memoryValidation.warnings);

    // Validate file restart threshold
    const fileValidation = this.validateFileThreshold(normalizedConfig.maxFilesBeforeRestart);
    if (!fileValidation.isValid) {
      errors.push(...fileValidation.errors);
    }
    warnings.push(...fileValidation.warnings);

    // Validate batch size
    const batchValidation = this.validateBatchSize(normalizedConfig.batchSize);
    if (!batchValidation.isValid) {
      errors.push(...batchValidation.errors);
    }
    warnings.push(...batchValidation.warnings);

    // Run custom validators
    if (this.rules.customValidators) {
      for (const { name, validator } of this.rules.customValidators) {
        try {
          const result = validator(normalizedConfig);
          if (!result.isValid) {
            errors.push(`Custom validation '${name}': ${result.message || 'Validation failed'}`);
          }
        } catch (error: any) {
          errors.push(`Custom validation '${name}' threw error: ${error.message}`);
        }
      }
    }

    // Additional cross-field validation
    const crossValidation = this.validateCrossFieldConstraints(normalizedConfig);
    if (!crossValidation.isValid) {
      errors.push(...crossValidation.errors);
    }
    warnings.push(...crossValidation.warnings);

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      normalizedConfig
    };
  }

  /**
   * Validate model name and check model availability
   */
  private validateModelName(modelName: string): { isValid: boolean; errors: string[]; warnings: string[] } {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (this.rules.modelName.required && !modelName) {
      errors.push('Model name is required');
      return { isValid: false, errors, warnings };
    }

    if (modelName) {
      // Check pattern if specified
      if (this.rules.modelName.pattern && !this.rules.modelName.pattern.test(modelName)) {
        errors.push(`Model name '${modelName}' does not match required pattern`);
      }

      // Check allowed values if specified
      if (this.rules.modelName.allowedValues && !this.rules.modelName.allowedValues.includes(modelName)) {
        errors.push(`Model name '${modelName}' is not in allowed values: ${this.rules.modelName.allowedValues.join(', ')}`);
      }

      // Check model availability (warning only)
      try {
        const tempResolver = new ModelPathResolver(modelName);
        const modelInfo = tempResolver.getModelInfo();
        if (!modelInfo.exists) {
          warnings.push(`Model '${modelName}' not found at expected path: ${modelInfo.path}`);
        }
      } catch (error: any) {
        warnings.push(`Could not validate model existence: ${error.message}`);
      }
    }

    return { isValid: errors.length === 0, errors, warnings };
  }

  /**
   * Validate memory configuration
   */
  private validateMemory(maxMemoryMB: number): { isValid: boolean; errors: string[]; warnings: string[] } {
    const errors: string[] = [];
    const warnings: string[] = [];
    const rules = this.rules.maxMemoryMB;

    if (maxMemoryMB < rules.min) {
      errors.push(`maxMemoryMB (${maxMemoryMB}) is below minimum (${rules.min})`);
    }

    if (maxMemoryMB > rules.max) {
      errors.push(`maxMemoryMB (${maxMemoryMB}) exceeds maximum (${rules.max})`);
    }

    if (rules.recommended) {
      if (maxMemoryMB < rules.recommended.min) {
        warnings.push(`maxMemoryMB (${maxMemoryMB}) is below recommended minimum (${rules.recommended.min})`);
      }
      if (maxMemoryMB > rules.recommended.max) {
        warnings.push(`maxMemoryMB (${maxMemoryMB}) exceeds recommended maximum (${rules.recommended.max})`);
      }
    }

    return { isValid: errors.length === 0, errors, warnings };
  }

  /**
   * Validate file restart threshold
   */
  private validateFileThreshold(maxFiles: number): { isValid: boolean; errors: string[]; warnings: string[] } {
    const errors: string[] = [];
    const warnings: string[] = [];
    const rules = this.rules.maxFilesBeforeRestart;

    if (maxFiles < rules.min) {
      errors.push(`maxFilesBeforeRestart (${maxFiles}) is below minimum (${rules.min})`);
    }

    if (maxFiles > rules.max) {
      errors.push(`maxFilesBeforeRestart (${maxFiles}) exceeds maximum (${rules.max})`);
    }

    if (rules.recommended) {
      if (maxFiles < rules.recommended.min) {
        warnings.push(`maxFilesBeforeRestart (${maxFiles}) is below recommended minimum (${rules.recommended.min})`);
      }
      if (maxFiles > rules.recommended.max) {
        warnings.push(`maxFilesBeforeRestart (${maxFiles}) exceeds recommended maximum (${rules.recommended.max})`);
      }
    }

    return { isValid: errors.length === 0, errors, warnings };
  }

  /**
   * Validate batch size
   */
  private validateBatchSize(batchSize: number): { isValid: boolean; errors: string[]; warnings: string[] } {
    const errors: string[] = [];
    const warnings: string[] = [];
    const rules = this.rules.batchSize;

    if (batchSize < rules.min) {
      errors.push(`batchSize (${batchSize}) is below minimum (${rules.min})`);
    }

    if (batchSize > rules.max) {
      errors.push(`batchSize (${batchSize}) exceeds maximum (${rules.max})`);
    }

    if (rules.recommended) {
      if (batchSize < rules.recommended.min) {
        warnings.push(`batchSize (${batchSize}) is below recommended minimum (${rules.recommended.min})`);
      }
      if (batchSize > rules.recommended.max) {
        warnings.push(`batchSize (${batchSize}) exceeds recommended maximum (${rules.recommended.max})`);
      }
    }

    // Additional batch size logic checks
    if (batchSize > 64 && this.environment === 'production') {
      warnings.push('Large batch sizes may cause memory issues in production');
    }

    if (batchSize === 1) {
      warnings.push('Batch size of 1 may significantly reduce performance');
    }

    return { isValid: errors.length === 0, errors, warnings };
  }

  /**
   * Validate cross-field constraints and logical consistency
   */
  private validateCrossFieldConstraints(config: Required<EmbedderConfig>): { isValid: boolean; errors: string[]; warnings: string[] } {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Memory vs batch size relationship
    const estimatedMemoryPerBatch = config.batchSize * 0.5; // Rough estimate: 0.5MB per text
    if (estimatedMemoryPerBatch > config.maxMemoryMB * 0.8) {
      warnings.push(`Batch size (${config.batchSize}) may cause memory issues with current memory limit (${config.maxMemoryMB}MB)`);
    }

    // Environment-specific constraints
    if (this.environment === 'production') {
      if (config.maxFilesBeforeRestart < 1000) {
        warnings.push('Low file restart threshold in production may cause frequent restarts');
      }
    }

    if (this.environment === 'test') {
      if (config.maxMemoryMB > 200) {
        warnings.push('High memory limit in test environment may slow down tests');
      }
    }

    return { isValid: errors.length === 0, errors, warnings };
  }

  /**
   * Get the current validation rules
   */
  getRules(): ValidationRules {
    return { ...this.rules };
  }

  /**
   * Get default configuration for the current environment
   */
  getDefaults(): Required<EmbedderConfig> {
    return { ...DEFAULT_CONFIGS[this.environment] };
  }

  /**
   * Create a validator with custom rules
   */
  static withCustomRules(
    environment: keyof typeof CONFIG_SCHEMAS,
    customRules: Partial<ValidationRules>
  ): EmbedderConfigValidator {
    return new EmbedderConfigValidator(environment, customRules);
  }

  /**
   * Quick validation for common use cases
   */
  static validateQuick(config: Partial<EmbedderConfig>, environment: keyof typeof CONFIG_SCHEMAS = 'production'): ValidationResult {
    const validator = new EmbedderConfigValidator(environment);
    return validator.validate(config);
  }

  /**
   * Validate configuration and throw if invalid
   */
  validateOrThrow(config: Partial<EmbedderConfig> = {}): Required<EmbedderConfig> {
    const result = this.validate(config);

    if (!result.isValid) {
      throw new Error(`Invalid embedder configuration: ${result.errors.join(', ')}`);
    }

    if (result.warnings.length > 0) {
      console.warn(`[EmbedderConfig] Warnings: ${result.warnings.join(', ')}`);
    }

    return result.normalizedConfig;
  }
}

/**
 * Helper functions for common validation scenarios
 */
export const ConfigValidatorHelpers = {
  /**
   * Create a development validator with relaxed rules
   */
  forDevelopment(): EmbedderConfigValidator {
    return new EmbedderConfigValidator('development');
  },

  /**
   * Create a production validator with strict rules
   */
  forProduction(): EmbedderConfigValidator {
    return new EmbedderConfigValidator('production');
  },

  /**
   * Create a test validator with minimal requirements
   */
  forTesting(): EmbedderConfigValidator {
    return new EmbedderConfigValidator('test');
  },

  /**
   * Validate and get production-ready config
   */
  getProductionConfig(overrides: Partial<EmbedderConfig> = {}): Required<EmbedderConfig> {
    const validator = ConfigValidatorHelpers.forProduction();
    return validator.validateOrThrow(overrides);
  },

  /**
   * Check if a configuration is valid without throwing
   */
  isValidConfig(config: Partial<EmbedderConfig>, environment: keyof typeof CONFIG_SCHEMAS = 'production'): boolean {
    const result = EmbedderConfigValidator.validateQuick(config, environment);
    return result.isValid;
  }
};