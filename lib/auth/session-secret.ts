const MIN_PRODUCTION_SECRET_LENGTH = 32;
const PLACEHOLDER_PATTERNS = [
  /^dev-session-secret$/i,
  /change[_-]?me/i,
  /replace/i,
  /placeholder/i,
  /example/i,
  /your[-_ ]?secret/i,
];

export function getValidatedSessionSecret(
  secret: string | undefined,
  nodeEnv = process.env.NODE_ENV ?? "development",
): string {
  const normalized = secret?.trim() ?? "";

  if (nodeEnv === "production") {
    const isPlaceholder = PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(normalized));

    if (!normalized || isPlaceholder || normalized.length < MIN_PRODUCTION_SECRET_LENGTH) {
      throw new Error(
        "SESSION_SECRET must be a secure value (>=32 chars, not a placeholder) in production.",
      );
    }

    return normalized;
  }

  return normalized || "dev-session-secret";
}
