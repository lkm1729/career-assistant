import Markdown from 'react-markdown';
import { readableReferences } from '../shared/reference-display';
const allowed = [
  'p',
  'ul',
  'ol',
  'li',
  'strong',
  'em',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'code',
  'pre',
  'br',
  'a',
  'img',
  'blockquote',
];
/** Advice is passive: no HTML, clickable URLs or remote images, including old records. */
export function AdviceText({
  text,
  listFallback = true,
  labels = new Map(),
}: {
  text: string;
  listFallback?: boolean;
  labels?: ReadonlyMap<string, string>;
}) {
  text = readableReferences(text, labels, true);
  const plain = !/(^|\n)\s*(?:#{1,6}\s|[-*+]\s|\d+[.)]\s|```|>)/.test(text);
  const content =
    plain && listFallback
      ? text
          .split(/\r?\n/)
          .filter((line) => line.trim())
          .map((line) => '- ' + line)
          .join('\n')
      : text;
  return (
    <div className="advice-text">
      <Markdown
        skipHtml
        allowedElements={allowed}
        components={{
          a: ({ children }) => <span>{children}</span>,
          img: ({ alt }) => <span>{alt ? `[图片说明：${alt}]` : '[图片不自动加载]'}</span>,
          h1: ({ children }) => <h4>{children}</h4>,
          h2: ({ children }) => <h4>{children}</h4>,
          h3: ({ children }) => <h4>{children}</h4>,
          h4: ({ children }) => <h4>{children}</h4>,
          h5: ({ children }) => <h4>{children}</h4>,
          h6: ({ children }) => <h4>{children}</h4>,
        }}
      >
        {content}
      </Markdown>
    </div>
  );
}
export function AdviceList({
  items,
  labels,
}: {
  items: string[];
  labels?: ReadonlyMap<string, string>;
}) {
  return items.length ? (
    <ul className="advice-list">
      {items.map((text, i) => (
        <li key={i}>
          <AdviceText text={text} listFallback={false} labels={labels} />
        </li>
      ))}
    </ul>
  ) : (
    <p className="field-hint">本次未提供具体条目。</p>
  );
}
