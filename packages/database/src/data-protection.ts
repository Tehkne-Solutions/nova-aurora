export function dataEncryptionKey(): string {
  const configured = process.env.DATA_ENCRYPTION_KEY;
  if (configured && configured.length >= 32) return configured;
  if (process.env.NODE_ENV === "production") {
    throw new Error("DATA_ENCRYPTION_KEY deve possuir pelo menos 32 caracteres.");
  }
  return "nova-aurora-development-encryption-key-only";
}
