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
    ? "bg-slate-900 text-white border-slate-900"
    : "bg-white text-slate-900 border-slate-200";
  const label = isUser ? "You" : "Kaka Writer";

  return (
    <li className={`flex ${wrapperClasses}`}>
      <article className={`max-w-[90%] rounded-xl border px-4 py-3 shadow-sm sm:max-w-[80%] ${bubbleClasses}`}>
        <div className="flex items-center justify-between gap-2">
          <div className={`text-[11px] font-semibold uppercase tracking-wide ${isUser ? "text-slate-200" : "text-slate-500"}`}>
            {label}
          </div>
          {contextUsed ? <MessageContextTooltip contextUsed={contextUsed} messageId={message.id} /> : null}
        </div>
        <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed">{message.content}</p>
      </article>
    </li>
  );
}
