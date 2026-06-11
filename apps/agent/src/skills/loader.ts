import { SKILL_SOURCES } from './index';

export type SkillSummary = { name: string; description: string };
type ParsedSkill = SkillSummary & { body: string };

// Skills are markdown files with YAML-ish frontmatter:
//   ---
//   name: <kebab>
//   description: <one-line summary>
//   ---
//   <body>
//
// Single-line `key: value` only — multi-line YAML, quoting, and arrays are
// intentionally not supported. The frontmatter is a sidecar contract; if it
// grows it should grow as code, not as a parser feature.
function parse(raw: string): ParsedSkill {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(raw);
  if (!m?.[1] || m[2] === undefined) throw new Error('skill missing frontmatter');
  const fm = m[1];
  const body = m[2];
  const read = (key: string): string => {
    const match = new RegExp(`^${key}:\\s*(.+)$`, 'm').exec(fm);
    if (!match?.[1]) throw new Error(`skill frontmatter missing "${key}"`);
    return match[1].trim();
  };
  return { name: read('name'), description: read('description'), body: body.trim() };
}

const parsed = new Map<string, ParsedSkill>(
  Object.entries(SKILL_SOURCES).map(([name, raw]) => {
    const p = parse(raw);
    if (p.name !== name)
      throw new Error(`skill ${name}.md frontmatter name=${p.name} disagrees with filename`);
    return [name, p];
  }),
);

export function listSkills(): SkillSummary[] {
  return Array.from(parsed.values(), ({ name, description }) => ({ name, description }));
}

export function loadSkill(name: string): string | null {
  return parsed.get(name)?.body ?? null;
}
