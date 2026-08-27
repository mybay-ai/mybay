import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

export function ChatMarkdownRenderer({ content, components }: { content: string; components: Components }) {
  return (
    <div className="chat-message-markdown min-w-0 space-y-2 break-words [overflow-wrap:anywhere]">
      <Markdown remarkPlugins={[remarkGfm]} components={components}>{content}</Markdown>
    </div>
  );
}
