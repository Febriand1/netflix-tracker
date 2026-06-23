export function cleanText(value: string | null | undefined): string | null {
  const text = value?.replace(/\s+/g, ' ').trim() ?? '';
  return text.length > 0 ? text : null;
}

export function getMetaContent(selector: string): string | null {
  const element = document.querySelector<HTMLMetaElement>(selector);
  return cleanText(element?.content);
}

export function getFirstText(selectors: string[]): string | null {
  for (const selector of selectors) {
    const nodes = document.querySelectorAll<HTMLElement>(selector);

    for (const node of nodes) {
      const text = cleanText(node.textContent);
      if (text) {
        return text;
      }
    }
  }

  return null;
}

export function getStructuredDataEntries(root: ParentNode = document): Record<string, unknown>[] {
  const scripts = root.querySelectorAll<HTMLScriptElement>(
    'script[type="application/ld+json"]',
  );
  const allEntries: Record<string, unknown>[] = [];

  for (const script of scripts) {
    const content = cleanText(script.textContent);
    if (!content) continue;

    try {
      const parsed = JSON.parse(content) as
        | Record<string, unknown>
        | Array<Record<string, unknown>>;
      const entries = Array.isArray(parsed) ? parsed : [parsed];
      allEntries.push(...entries);
    } catch {
      continue;
    }
  }

  return allEntries;
}
