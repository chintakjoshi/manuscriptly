import { useLayoutEffect, useRef } from "react";

import type { MessageDto } from "../../lib/api";
import { ChatMessageBubble } from "./ChatMessageBubble";

type ChatMessageListProps = {
  messages: MessageDto[];
  isThinking: boolean;
};

export function ChatMessageList({ messages, isThinking }: ChatMessageListProps) {
  const listContainerRef = useRef<HTMLDivElement | null>(null);
  const lastMessageId = messages[messages.length - 1]?.id ?? null;

  useLayoutEffect(() => {
    const container = listContainerRef.current;
    if (!container) {
      return;
    }

    const scrollToBottom = () => {
      container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
    };

    scrollToBottom();
    const rafId = window.requestAnimationFrame(scrollToBottom);
    return () => window.cancelAnimationFrame(rafId);
  }, [lastMessageId, isThinking]);

  return (
    <div ref={listContainerRef} className="min-h-0 flex-1 overflow-y-auto py-3 [scrollbar-gutter:stable_both-edges]">
      <ul className="m-0 w-full list-none space-y-3 p-0">
        {messages.length === 0 && (
          <li className="rounded-2xl bg-[var(--app-bg-soft)]/80 px-5 py-8 text-sm text-[var(--text-secondary)]">
            Start the conversation by describing your blog topic and goals.
          </li>
        )}
        {messages.map((message) => (
          <ChatMessageBubble key={message.id} message={message} />
        ))}
        {isThinking && (
          <li className="fade-slide-in flex justify-start">
            <article className="w-full rounded-2xl bg-[var(--app-bg-soft)] px-4 py-3">
              <p className="text-[14px] leading-6 text-[var(--text-secondary)]">
                Agent is thinking<span className="animate-pulse">...</span>
              </p>
            </article>
          </li>
        )}
      </ul>
    </div>
  );
}
