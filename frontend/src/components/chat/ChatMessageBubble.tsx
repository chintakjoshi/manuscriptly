import type { MessageDto } from "../../lib/api";
import { MessageContextTooltip } from "./MessageContextTooltip";

type ChatMessageBubbleProps = {
  message: MessageDto;
};

export function ChatMessageBubble({ message }: ChatMessageBubbleProps) {
  const isUser = message.role === "user";
  const contextUsed = !isUser && message.context_used ? message.context_used : null;
  const wrapperClasses = isUser ? "justify-end" : "justify-start";
  const bubbleClasses = isUser
    ? "bg-[var(--app-bg-soft)] text-[var(--text-primary)]"
    : "bg-black text-white";
  const messageTextClasses = isUser ? "text-[var(--text-secondary)]" : "text-[#f0f0f0]";

  return (
    <li className={`fade-slide-in flex ${wrapperClasses}`}>
      <article className={`max-w-[90%] rounded-2xl px-4 py-3 ${bubbleClasses}`}>
        {contextUsed ? (
          <div className="mb-1 flex justify-end">
            <MessageContextTooltip contextUsed={contextUsed} messageId={message.id} />
          </div>
        ) : null}
        <p className={`whitespace-pre-wrap text-[14px] leading-6 ${messageTextClasses}`}>{message.content}</p>
      </article>
    </li>
  );
}
