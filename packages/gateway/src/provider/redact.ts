/** Secret handling. Keys come from the environment only and must never reach a log, error or viewer. */

const KEY_LIKE = [
  /nvapi-[A-Za-z0-9_-]{8,}/g,
  /Bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  /\b(?:sk|pk|key)-[A-Za-z0-9_-]{12,}/g,
];

/** Remove the exact key and anything that looks like a bearer token or API key from a string. */
export function redactSecrets(text: string, ...secrets: Array<string | undefined>): string {
  let out = text;
  for (const secret of secrets) {
    if (secret && secret.length >= 4) out = out.split(secret).join("[redacted]");
  }
  for (const pattern of KEY_LIKE) out = out.replace(pattern, "[redacted]");
  return out;
}
