// Inlined at bundle time via bun's `.md:text` loader (see package.json
// `build` script). Adding a skill is two lines: drop a `<name>.md` here
// and append `[<name>]: <name>Source` to the map below.

import alertCalloutSource from './alert-callout.md';
import askingClarifyingQuestionsSource from './asking-clarifying-questions.md';
import codeBlockSource from './code-block.md';
import colorAndContrastSource from './color-and-contrast.md';
import grillTheAskSource from './grill-the-ask.md';
import handoffPrepSource from './handoff-prep.md';
import htmlBlockSource from './html-block.md';
import mermaidDiagramSource from './mermaid-diagram.md';
import planStructureSource from './plan-structure.md';

export const SKILL_SOURCES: Record<string, string> = {
  'alert-callout': alertCalloutSource,
  'asking-clarifying-questions': askingClarifyingQuestionsSource,
  'code-block': codeBlockSource,
  'color-and-contrast': colorAndContrastSource,
  'grill-the-ask': grillTheAskSource,
  'handoff-prep': handoffPrepSource,
  'html-block': htmlBlockSource,
  'mermaid-diagram': mermaidDiagramSource,
  'plan-structure': planStructureSource,
};
