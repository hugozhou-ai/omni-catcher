import type { ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { stripFrontmatter } from "../util/markdown.js";

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
