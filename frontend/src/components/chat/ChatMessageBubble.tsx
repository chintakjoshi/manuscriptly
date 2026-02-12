import type { MessageDto } from "../../lib/api";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { MessageContextTooltip } from "./MessageContextTooltip";

type ChatMessageBubbleProps = {
  message: MessageDto;
};

export function ChatMessageBubble({ message }: ChatMessageBubbleProps) {
  const isUser = message.role === "user";
  const contextUsed = !isUser && message.context_used ? message.context_used : null;
  const wrapperClasses = isUser ? "justify-end" : "justify-start";
  const sizeClasses = isUser ? "max-w-[90%]" : "w-full max-w-none";
  const bubbleClasses = isUser
    ? "bg-[var(--app-bg-soft)] text-[var(--text-primary)]"
    : "bg-black text-white";
  const messageTextClasses = isUser ? "text-[var(--text-secondary)]" : "text-[#f0f0f0]";

  return (
    <li className={`fade-slide-in flex w-full ${wrapperClasses}`}>
      <article className={`${sizeClasses} rounded-2xl px-4 py-3 ${bubbleClasses}`}>
        {contextUsed ? (
          <div className="mb-1 flex justify-end">
            <MessageContextTooltip contextUsed={contextUsed} messageId={message.id} />
          </div>
        ) : null}
        {isUser ? (
          <p className={`whitespace-pre-wrap text-[14px] leading-6 ${messageTextClasses}`}>{message.content}</p>
        ) : (
          <div className="markdown-preview chat-markdown text-[14px] leading-6 text-[#f0f0f0]">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
          </div>
        )}
      </article>
    </li>
  );
}
