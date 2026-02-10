import { useEffect, useRef } from "react";

import type { MessageDto } from "../../lib/api";
import { ChatMessageBubble } from "./ChatMessageBubble";

type ChatMessageListProps = {
  messages: MessageDto[];
  isThinking: boolean;
};

export function ChatMessageList({ messages, isThinking }: ChatMessageListProps) {
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, isThinking]);

  return (
    <div className="h-[52vh] overflow-y-auto rounded-xl border border-slate-200 bg-slate-50 p-3 sm:p-4">
      <ul className="space-y-3">
        {messages.length === 0 && (
          <li className="rounded-lg border border-dashed border-slate-300 bg-white px-4 py-6 text-sm text-slate-500">
            Start the conversation by describing your blog topic and goals.
          </li>
        )}
        {messages.map((message) => (
          <ChatMessageBubble key={message.id} message={message} />
        ))}
        {isThinking && (
          <li className="flex justify-start">
            <article className="max-w-[90%] rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm sm:max-w-[80%]">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Kaka Writer</div>
              <p className="mt-1 text-sm leading-relaxed text-slate-700">Agent is thinking...</p>
            </article>
          </li>
        )}
      </ul>
      <div ref={endRef} />
    </div>
  );
}
