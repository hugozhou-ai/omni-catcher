import type { ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function MarkdownViewer(props: { markdown: string }): ReactNode {
  return (
    <div className="markdown-viewer">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a({ href, children }) {
            return (
              <a href={href} target="_blank" rel="noreferrer">
                {children}
              </a>
            );
          },
          img(props) {
            return <img {...props} draggable={false} />;
          },
        }}
      >
        {stripFrontmatter(props.markdown)}
      </ReactMarkdown>
    </div>
  );
}

function stripFrontmatter(markdown: string): string {
  if (!markdown.startsWith("---")) return markdown;
  const end = markdown.indexOf("\n---\n", 4);
  if (end < 0) return markdown;
  return markdown.slice(end + 5).trimStart();
}
