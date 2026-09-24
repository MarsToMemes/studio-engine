export type Severity = 'error' | 'warning';

export interface ValidationIssue {
  severity: Severity;
  /** Stable machine-readable code, e.g. `layer.asset.missing`. Safe to switch on. */
  code: string;
  /** JSON path of the offending value, e.g. `scenes[3].layers[1].opacity`. */
  path: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}

export class IssueCollector {
  readonly issues: ValidationIssue[] = [];

  error(path: string, code: string, message: string): void {
    this.issues.push({ severity: 'error', code, path, message });
  }

  warn(path: string, code: string, message: string): void {
    this.issues.push({ severity: 'warning', code, path, message });
  }

  result(): ValidationResult {
    const errors = this.issues.filter((i) => i.severity === 'error');
    return { valid: errors.length === 0, errors, warnings: this.issues.filter((i) => i.severity === 'warning') };
  }
}

export class SceneValidationError extends Error {
  constructor(readonly result: ValidationResult) {
    super(
      `Invalid scene data (${result.errors.length} error${result.errors.length === 1 ? '' : 's'}):\n` +
        result.errors
          .slice(0, 20)
          .map((e) => `  - ${e.path}: ${e.message} [${e.code}]`)
          .join('\n'),
    );
    this.name = 'SceneValidationError';
  }
}

/** Human / LLM friendly report, suitable for an AI self-repair loop. */
export function formatIssues(result: ValidationResult): string {
  const lines = [...result.errors, ...result.warnings].map((i) => `${i.severity.toUpperCase()} ${i.path} [${i.code}] ${i.message}`);
  return lines.length ? lines.join('\n') : 'OK';
}
