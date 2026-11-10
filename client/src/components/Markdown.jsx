import { useMemo } from 'react';
import { marked } from 'marked';

marked.setOptions({ gfm: true, breaks: false });

// Rules files are our own repo content, but strip raw HTML anyway.
const renderer = new marked.Renderer();
renderer.html = () => '';

export function Markdown({ source }) {
  const html = useMemo(() => marked.parse(source ?? '', { renderer }), [source]);
  return <div className="markdown" dangerouslySetInnerHTML={{ __html: html }} />;
}
