const REDACTED_VALUE = "[REDACTED]";
const SENSITIVE_ENV_NAME_PATTERN =
  /(api[_-]?key|access[_-]?token|refresh[_-]?token|(?:^|[_-])token(?:$|[_-])|secret|password|authorization)/i;
const SENSITIVE_OBJECT_KEY_PATTERN =
  /^(api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password|authorization)$/i;
const INLINE_SECRET_PATTERNS = [
  /\bBearer\s+[A-Za-z0-9\-._~+/]+=*\b/gi,
  /\b(?:sk|pk|rk)-[A-Za-z0-9_-]{12,}\b/g,
  /\bsk-ant-[A-Za-z0-9_-]{12,}\b/g,
  /\b(xox[baprs]-[A-Za-z0-9-]{10,})\b/g
] as const;
const SENSITIVE_ASSIGNMENT_PATTERN =
  /\b([A-Z0-9_]*(?:API[_-]?KEY|ACCESS[_-]?TOKEN|REFRESH[_-]?TOKEN|TOKEN|SECRET|PASSWORD|AUTHORIZATION)[A-Z0-9_]*\b\s*[=:]\s*)([^\s"'`,;]+)/gi;

export function redactForLogging<T>(value: T): T {
  return redactUnknown(value, new WeakSet<object>()) as T;
}

export function redactText(value: string): string {
  return redactString(value);
}

function redactUnknown(value: unknown, activePath: WeakSet<object>): unknown {
  if (typeof value === "string") {
    return redactString(value);
  }

  if (
    value === null ||
    value === undefined ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactString(value.message),
      stack: value.stack ? redactString(value.stack) : undefined
    };
  }

  if (Array.isArray(value)) {
    if (activePath.has(value)) {
      return "[Circular]";
    }

    activePath.add(value);
    try {
      return value.map((entry) => redactUnknown(entry, activePath));
    } finally {
      activePath.delete(value);
    }
  }

  if (value instanceof Set) {
    if (activePath.has(value)) {
      return "[Circular]";
    }

    activePath.add(value);
    try {
      return Array.from(value.values(), (entry) => redactUnknown(entry, activePath));
    } finally {
      activePath.delete(value);
    }
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === "object") {
    if (activePath.has(value)) {
      return "[Circular]";
    }

    activePath.add(value);

    try {
      const output: Record<string, unknown> = {};
      for (const [key, nestedValue] of Object.entries(value)) {
        output[key] = SENSITIVE_OBJECT_KEY_PATTERN.test(key)
          ? REDACTED_VALUE
          : redactUnknown(nestedValue, activePath);
      }
      return output;
    } finally {
      activePath.delete(value);
    }
  }

  return String(value);
}

function redactString(value: string): string {
  let redacted = value;

  for (const secret of getSensitiveEnvValues()) {
    redacted = redacted.split(secret).join(REDACTED_VALUE);
  }

  redacted = redacted.replace(SENSITIVE_ASSIGNMENT_PATTERN, `$1${REDACTED_VALUE}`);

  for (const pattern of INLINE_SECRET_PATTERNS) {
    redacted = redacted.replace(pattern, REDACTED_VALUE);
  }

  return redacted;
}

function getSensitiveEnvValues(): string[] {
  return Object.entries(process.env)
    .filter(([key, value]) => SENSITIVE_ENV_NAME_PATTERN.test(key) && typeof value === "string" && value.length >= 8)
    .map(([, value]) => value as string);
}
