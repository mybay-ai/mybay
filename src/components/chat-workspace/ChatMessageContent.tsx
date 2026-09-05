import { splitChatUrlToken } from './chatUrlBoundary';
import { useChatCallback } from './useChatCallback';
import { Children, isValidElement, useMemo } from 'react';
import type { ReactNode } from 'react';
import { ExternalLink } from 'lucide-react';
import type { PendingAttachment } from './ChatInputBar';
import { GENERATED_FILE_PATH_PATTERN } from './generatedFilePath';
import { MarkdownCodeBlock } from './ChatMarkdownCodeBlock';
import { ChatInlineFile } from './ChatInlineFile';
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

export function ChatMarkdownRenderer({ content, components }: { content: string; components: Components }) {
  return (
    // Markdown inserts newline text nodes between blocks. Preserve line breaks
    // only inside paragraphs/code so those structural newlines do not add rows.
    <div className="chat-message-markdown min-w-0 space-y-2 whitespace-normal break-words leading-[22px] [overflow-wrap:anywhere] [&>:first-child]:mt-0 [&>:last-child]:mb-0">
      <Markdown remarkPlugins={[remarkGfm]} components={components}>{content}</Markdown>
    </div>
  );
}

function escapeRegExp(value: string) {
  return value.replace(/[|\\{}()[\]^$+*?.]/g, "\\$&");
}

const MARKDOWN_URL_WRAPPERS = ["**", "__", "`", "*", "_"];

function normalizeUrlHref(rawValue: string) {
  const trimmed = rawValue.replace(/[\]\)}>),.;:!?\uFF0C\u3002\uFF1B\uFF1A\uFF01\uFF1F]+$/u, "");
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^www\./i.test(trimmed)) return "https://" + trimmed;
  return "http://" + trimmed;
}

function splitUrlToken(value: string) {
  let core = value;
  let trailing = "";
  const trailingMatch = core.match(/([\]\)}>),.;:!?\uFF0C\u3002\uFF1B\uFF1A\uFF01\uFF1F]+)$/u);
  if (trailingMatch?.[1]) {
    trailing = trailingMatch[1];
    core = core.slice(0, -trailing.length);
  }

  for (const wrapper of MARKDOWN_URL_WRAPPERS) {
    while (core.endsWith(wrapper)) {
      core = core.slice(0, -wrapper.length);
    }
  }

  return { core, trailing };
}

function trimOpeningMarkdownWrapper(beforeText: string, tokenRaw: string) {
  for (const wrapper of MARKDOWN_URL_WRAPPERS) {
    if (beforeText.endsWith(wrapper) && tokenRaw.endsWith(wrapper)) {
      return beforeText.slice(0, -wrapper.length);
    }
  }
  return beforeText;
}

function findNextToken(text: string, files: PendingAttachment[]) {
  const urlRegex = /(?:https?:\/\/|www\.)[^\s<>"']+|\b(?:\d{1,3}\.){3}\d{1,3}(?::\d{1,5})?(?:\/[^\s<>"']*)?/giu;
  let best: { index: number; raw: string; type: "url" | "file" | "path"; file?: PendingAttachment } | null = null;
  const urlMatch = urlRegex.exec(text);
  if (urlMatch) best = { index: urlMatch.index, raw: urlMatch[0], type: "url" };

  GENERATED_FILE_PATH_PATTERN.lastIndex = 0;
  const pathMatch = GENERATED_FILE_PATH_PATTERN.exec(text);
  if (pathMatch && (!best || pathMatch.index < best.index)) {
    best = { index: pathMatch.index, raw: pathMatch[0], type: "path" };
  }

  for (const file of files) {
    const name = file.originalName?.trim();
    if (!name) continue;
    const fileMatch = new RegExp(escapeRegExp(name), "iu").exec(text);
    if (fileMatch && (!best || fileMatch.index < best.index)) {
      best = { index: fileMatch.index, raw: fileMatch[0], type: "file", file };
    }
  }
  return best;
}

export function LinkedChatContent({
  content,
  isUser,
  conversationFiles,
  onOpenConversationFile,
  onOpenInstanceFilePath
}: {
  content: string;
  isUser: boolean;
  conversationFiles: PendingAttachment[];
  onOpenConversationFile?: (file: PendingAttachment) => void;
  onOpenInstanceFilePath?: (filePath: string) => void;
}) {
  if (!content) return null;
  const nodes: React.ReactNode[] = [];
  let remaining = content;
  let key = 0;

  while (remaining.length > 0) {
    const token = findNextToken(remaining, conversationFiles);
    if (!token) {
      nodes.push(remaining);
      break;
    }
    const beforeToken = remaining.slice(0, token.index);

    if (token.type === "file" && token.file && onOpenConversationFile) {
      if (beforeToken) nodes.push(beforeToken);
      nodes.push(<ChatInlineFile key={"file-" + key++} path={token.raw} isUser={isUser} onOpen={() => onOpenConversationFile(token.file!)} />);
      remaining = remaining.slice(token.index + token.raw.length);
      continue;
    }

    if (token.type === "path" && onOpenInstanceFilePath) {
      const beforePath = trimOpeningMarkdownWrapper(beforeToken, token.raw);
      if (beforePath) nodes.push(beforePath);
      const { core, trailing } = splitUrlToken(token.raw);
      nodes.push(<ChatInlineFile key={"path-" + key++} path={core} isUser={isUser} onOpen={() => onOpenInstanceFilePath(core)} />);
      if (trailing) nodes.push(trailing);
      remaining = remaining.slice(token.index + token.raw.length);
      continue;
    }

    if (token.type === "url") {
      const beforeUrl = trimOpeningMarkdownWrapper(beforeToken, token.raw);
      if (beforeUrl) nodes.push(beforeUrl);
      const { core, trailing } = splitChatUrlToken(token.raw);
      const href = normalizeUrlHref(core);
      nodes.push(
        <a
          key={"url-" + key++}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className={
            "inline-flex max-w-full items-center gap-1 break-all font-semibold underline underline-offset-2 " +
            (isUser
              ? "text-white decoration-white/55 hover:decoration-white"
              : "text-indigo-700 decoration-indigo-300 hover:text-indigo-800 hover:decoration-indigo-600 dark:text-indigo-300 dark:decoration-indigo-500/60 dark:hover:text-indigo-200")
          }
          title={href}
        >
          <span className="min-w-0">{core}</span>
          <ExternalLink className="h-3 w-3 shrink-0" />
        </a>
      );
      if (trailing) nodes.push(trailing);
      remaining = remaining.slice(token.index + token.raw.length);
      continue;
    }

    if (beforeToken) nodes.push(beforeToken);
    nodes.push(token.raw);
    remaining = remaining.slice(token.index + token.raw.length);
  }

  return <>{nodes}</>;
}


type LinkedContentContext = {
  isUser: boolean;
  conversationFiles: PendingAttachment[];
  onOpenConversationFile?: (file: PendingAttachment) => void;
  onOpenInstanceFilePath?: (filePath: string) => void;
};

function linkifyMarkdownChildren(children: ReactNode, context: LinkedContentContext): ReactNode {
  return Children.map(children, (child) => {
    if (typeof child === "string") {
      return (
        <LinkedChatContent
          content={child}
          isUser={context.isUser}
          conversationFiles={context.conversationFiles}
          onOpenConversationFile={context.onOpenConversationFile}
          onOpenInstanceFilePath={context.onOpenInstanceFilePath}
        />
      );
    }

    if (Array.isArray(child)) return linkifyMarkdownChildren(child, context);
    return child;
  });
}

function getPlainNodeText(children: ReactNode): string {
  if (typeof children === "string" || typeof children === "number") return String(children);
  if (Array.isArray(children)) return children.map(getPlainNodeText).join("");
  if (isValidElement<{ children?: ReactNode }>(children)) return getPlainNodeText(children.props.children);
  return "";
}

function hasLinkableInlineToken(value: string, context: LinkedContentContext) {
  const token = findNextToken(value, context.conversationFiles);
  if (!token) return false;
  if (token.type === "url") return true;
  if (token.type === "file") return Boolean(token.file && context.onOpenConversationFile);
  if (token.type === "path") return Boolean(context.onOpenInstanceFilePath);
  return false;
}

export function MarkdownChatContent({
  content,
  conversationFiles,
  onOpenConversationFile: openFile,
  onOpenInstanceFilePath: openPath
}: {
  content: string;
  conversationFiles: PendingAttachment[];
  onOpenConversationFile?: (file: PendingAttachment) => void;
  onOpenInstanceFilePath?: (filePath: string) => void;
}) {
  const onOpenConversationFile = useChatCallback(openFile);
  const onOpenInstanceFilePath = useChatCallback(openPath);
  return useMemo(() => {
  const linkContext: LinkedContentContext = {
    isUser: false,
    conversationFiles,
    onOpenConversationFile,
    onOpenInstanceFilePath
  };

  return (
      <ChatMarkdownRenderer
        content={content}
        components={{
          p: ({ children }) => <p className="my-2 whitespace-pre-wrap leading-[22px] first:mt-0 last:mb-0">{linkifyMarkdownChildren(children, linkContext)}</p>,
          strong: ({ children }) => <strong className="font-semibold text-slate-950 dark:text-white">{linkifyMarkdownChildren(children, linkContext)}</strong>,
          em: ({ children }) => <em className="italic">{linkifyMarkdownChildren(children, linkContext)}</em>,
          ul: ({ children }) => <ul className="my-2 list-disc space-y-1.5 pl-5">{children}</ul>,
          ol: ({ children }) => <ol className="my-2 list-decimal space-y-1.5 pl-5">{children}</ol>,
          li: ({ children }) => <li className="pl-0.5 leading-[22px] [&>p+p]:mt-2">{linkifyMarkdownChildren(children, linkContext)}</li>,
          blockquote: ({ children }) => (
            <blockquote className="my-2 space-y-2 border-l-2 border-indigo-200 pl-3 text-content-secondary dark:border-indigo-400/40">
              {children}
            </blockquote>
          ),
          code: ({ children, className }) => {
            const value = getPlainNodeText(children);
            const isBlock = Boolean(className) || value.includes("\n");
            if (isBlock) return <code className={className}>{children}</code>;
            if (hasLinkableInlineToken(value, linkContext)) {
              return (
                <LinkedChatContent
                  content={value}
                  isUser={false}
                  conversationFiles={conversationFiles}
                  onOpenConversationFile={onOpenConversationFile}
                  onOpenInstanceFilePath={onOpenInstanceFilePath}
                />
              );
            }
            return (
              <code className="rounded-md border border-outline bg-surface-muted px-1.5 py-0.5 text-[12px] font-semibold text-content-secondary">
                {children}
              </code>
            );
          },
          pre: ({ children }) => <MarkdownCodeBlock>{children}</MarkdownCodeBlock>,
          a: ({ href, children, node }) => {
            const safeHref = href || '';
            if (!/^https?:\/\//i.test(safeHref)) return <span>{linkifyMarkdownChildren(children, linkContext)}</span>;
            const visible = getPlainNodeText(children);
            const start = node?.position?.start.offset;
            const end = node?.position?.end.offset;
            const source = start === undefined || end === undefined ? '' : content.slice(start, end);
            const bare = /^(?:https?:\/\/|www\.)/i.test(source);
            const { core, trailing } = bare ? splitChatUrlToken(visible) : { core: visible, trailing: '' };
            const target = bare ? normalizeUrlHref(core) : safeHref;
            return <><a href={target} target="_blank" rel="noopener noreferrer" className="inline-flex max-w-full items-center gap-1 break-all font-semibold text-indigo-700 underline underline-offset-2 dark:text-indigo-300" title={target}><span className="min-w-0">{bare ? core : children}</span><ExternalLink className="h-3 w-3 shrink-0" /></a>{trailing}</>;
          },
          h1: ({ children }) => <h1 className="mt-4 text-xl font-bold leading-tight text-slate-950 dark:text-white">{linkifyMarkdownChildren(children, linkContext)}</h1>,
          h2: ({ children }) => <h2 className="mt-4 text-lg font-bold leading-tight text-slate-950 dark:text-white">{linkifyMarkdownChildren(children, linkContext)}</h2>,
          h3: ({ children }) => <h3 className="mt-3 text-base font-bold leading-tight text-slate-950 dark:text-white">{linkifyMarkdownChildren(children, linkContext)}</h3>,
          hr: () => <hr className="my-4 border-0 border-t border-outline" />,
          del: ({ children }) => <del className="text-content-muted">{linkifyMarkdownChildren(children, linkContext)}</del>,
          table: ({ children }) => (
            <div className="my-3 max-w-full overflow-x-auto rounded-xl border border-outline">
              <table className="min-w-[520px] border-collapse text-left text-[12px]">{children}</table>
            </div>
          ),
          thead: ({ children }) => <thead className="bg-surface-muted">{children}</thead>,
          th: ({ children }) => <th className="whitespace-nowrap border-b border-outline px-2.5 py-2 font-semibold">{linkifyMarkdownChildren(children, linkContext)}</th>,
          td: ({ children }) => <td className="border-b border-outline px-2.5 py-2 align-top break-words">{linkifyMarkdownChildren(children, linkContext)}</td>
        }}
      />
  );
  }, [content, conversationFiles, onOpenConversationFile, onOpenInstanceFilePath]);
}
