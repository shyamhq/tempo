// THROWAWAY — delete after mermaid block lands on main
'use client';

import '@blocknote/core/fonts/inter.css';
import '@blocknote/mantine/style.css';
import { BlockNoteView } from '@blocknote/mantine';
import { useCreateBlockNote } from '@blocknote/react';
import { useEffect, useState } from 'react';
import { planSchemaClient } from '@/lib/plan-schema-client';
import planJson from './plan.json';

// Mermaid v11 top-level diagram keywords. Mirrors the sniff regex documented
// in the agent research notes — used here to convert legacy codeBlocks
// (language="text" but mermaid-shaped content) into mermaidDiagram blocks so
// the seeded thread renders the way it WILL render once the agent emits
// `class="language-mermaid"` from its HTML.
const MERMAID_KEYWORD =
  /^\s*(flowchart|graph|sequenceDiagram|classDiagram|stateDiagram|erDiagram|journey|gantt|pie|gitGraph|mindmap|timeline|quadrantChart|requirementDiagram|c4|sankey|xyChart|block|packet|kanban|architecture|radar|treemap)\b/i;

type PmNode = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: PmNode[];
  text?: string;
  marks?: unknown[];
};

// Walk the PM JSON tree, mutating each codeBlock whose textContent starts with
// a mermaid keyword (after stripping a leading `---…---` or `%%{init: …}%%`
// directive) into a mermaidDiagram node. Same tree shape, just the type and
// attrs swap, so BlockNote loads it as a first-class block.
function convertMermaidCodeBlocks(node: PmNode): void {
  if (node.type === 'codeBlock') {
    const text = (node.content ?? [])
      .map((c) => c.text ?? '')
      .join('')
      .trim();
    const stripped = text.replace(/^---[\s\S]*?---\s*|^%%\{[\s\S]*?\}%%\s*/, '');
    if (MERMAID_KEYWORD.test(stripped)) {
      node.type = 'mermaidDiagram';
      node.attrs = { source: text };
      node.content = [];
      return;
    }
  }
  for (const child of node.content ?? []) convertMermaidCodeBlocks(child);
}

function buildSeedPmJson(): PmNode {
  const cloned = JSON.parse(JSON.stringify(planJson)) as PmNode;
  convertMermaidCodeBlocks(cloned);
  return cloned;
}

export default function MermaidPlaygroundPage() {
  const editor = useCreateBlockNote({ schema: planSchemaClient });

  useEffect(() => {
    const pmJson = buildSeedPmJson();
    editor._tiptapEditor.commands.setContent(pmJson as never, { emitUpdate: false });
    setDocJson(JSON.stringify(editor.document, null, 2));
  }, [editor]);

  // Throwaway: expose the editor on window so chrome-devtools MCP can drive
  // parse / export tests without going through UI elements.
  useEffect(() => {
    (window as unknown as { __bnEditor: typeof editor }).__bnEditor = editor;
  }, [editor]);

  const [docJson, setDocJson] = useState<string>('');
  const [pasteHtml, setPasteHtml] = useState('');
  const [showPasteArea, setShowPasteArea] = useState(false);

  return (
    <div style={{ display: 'flex', gap: '1rem', padding: '1rem', fontFamily: 'sans-serif' }}>
      <div style={{ flex: '1 1 60%', minWidth: 0 }}>
        <h2 style={{ marginTop: 0 }}>
          Editor — seeded from <code>thr_01KTHR9GTDJVA4QZACNS4D6BR8</code>
        </h2>
        <p style={{ marginTop: 0, color: '#555', fontSize: '0.875rem' }}>
          Mermaid-shaped <code>codeBlock</code>s in the stored plan are transformed to{' '}
          <code>mermaidDiagram</code> on load — same shape the agent will produce once it emits
          <code>class="language-mermaid"</code>.
        </p>
        <BlockNoteView
          editor={editor}
          theme="light"
          onChange={() => {
            setDocJson(JSON.stringify(editor.document, null, 2));
          }}
        />
        <div style={{ marginTop: '1rem' }}>
          <button
            type="button"
            onClick={() => setShowPasteArea((v) => !v)}
            style={{ padding: '0.25rem 0.75rem', cursor: 'pointer' }}
          >
            {showPasteArea ? 'Hide' : 'Paste HTML'}
          </button>
          {showPasteArea && (
            <div style={{ marginTop: '0.5rem' }}>
              <textarea
                value={pasteHtml}
                onChange={(e) => setPasteHtml(e.target.value)}
                rows={6}
                style={{ width: '100%', fontFamily: 'monospace', fontSize: '0.8rem' }}
                placeholder='<pre><code class="language-mermaid">graph TD&#10;A --> B</code></pre>'
              />
              <button
                type="button"
                style={{ marginTop: '0.25rem', padding: '0.25rem 0.75rem', cursor: 'pointer' }}
                onClick={async () => {
                  const blocks = await editor.tryParseHTMLToBlocks(pasteHtml);
                  editor.replaceBlocks(editor.document, blocks);
                }}
              >
                Insert
              </button>
            </div>
          )}
        </div>
      </div>
      <div style={{ flex: '1 1 40%', minWidth: 0 }}>
        <h2 style={{ marginTop: 0 }}>Document JSON</h2>
        <pre
          style={{
            background: '#f5f5f5',
            padding: '0.75rem',
            borderRadius: '6px',
            fontSize: '0.75rem',
            overflowY: 'auto',
            maxHeight: '80vh',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
          }}
        >
          {docJson}
        </pre>
      </div>
    </div>
  );
}
