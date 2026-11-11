/** Drop comment lines (starting with '#') and blank lines at the ends. */
export function stripComments(text: string): string {
  return text.split("\n").filter((l) => !l.trimStart().startsWith("#")).join("\n").trim();
}

/** Replace `<name>` placeholders. An unknown name is an error, so a typo in a template cannot reach an agent. */
export function fillPlaceholders(text: string, values: Readonly<Record<string, string | number>>): string {
  return text.replace(/<([a-z_]+)>/g, (_m, name: string) => {
    const v = values[name];
    if (v === undefined) throw new Error(`prompt template has an unknown placeholder <${name}>`);
    return String(v);
  });
}
