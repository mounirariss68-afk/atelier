import { useState, useRef, useEffect } from "react";
import { motion } from "framer-motion";
import { X, Send, Bot, User, Tag, ListOrdered, Package, Target, ShoppingCart } from "lucide-react";
import { matchDealerIntent, type DealerChatResponse } from "./dealerChatIntents";

interface Message {
  id: number;
  role: "user" | "agent";
  text: string;
  type?: DealerChatResponse["type"];
  data?: Record<string, unknown>;
}

const QUICK_PROMPTS = [
  { label: "Aktif Kampanyalar", icon: Tag },
  { label: "Fiyat Listesi", icon: ListOrdered },
  { label: "Stok Durumu", icon: Package },
  { label: "Hedef Takibi", icon: Target },
  { label: "Sipariş Ver", icon: ShoppingCart },
];

const WELCOME: Message = {
  id: 0, role: "agent",
  text: "Merhaba! Ben Arçelik Bayi Asistanı. Kampanyalar, fiyat listesi, stok durumu, hedefleriniz ve siparişleriniz hakkında size yardımcı olabilirim. Ne sormak istersiniz?",
};

export default function DealerChat({ onClose }: { onClose: () => void }) {
  const [messages, setMessages] = useState<Message[]>([WELCOME]);
  const [input, setInput] = useState("");
  const [typing, setTyping] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const idRef = useRef(1);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, typing]);

  const send = (text: string) => {
    if (!text.trim()) return;
    const userMsg: Message = { id: idRef.current++, role: "user", text: text.trim() };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setTyping(true);

    setTimeout(() => {
      const response = matchDealerIntent(text.trim());
      const agentMsg: Message = {
        id: idRef.current++, role: "agent",
        text: response.text,
        type: response.type,
        data: response.data,
      };
      setMessages((prev) => [...prev, agentMsg]);
      setTyping(false);
    }, 400);
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); }
  };

  return (
    <motion.div
      initial={{ x: "100%" }}
      animate={{ x: 0 }}
      exit={{ x: "100%" }}
      transition={{ type: "spring", damping: 25, stiffness: 250 }}
      className="fixed top-0 right-0 h-full w-[400px] max-w-full bg-white shadow-2xl z-50 flex flex-col border-l border-gray-200"
    >
      <div className="flex-shrink-0 h-14 bg-[#E30613] text-white flex items-center px-4 gap-3">
        <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center">
          <Bot size={18} />
        </div>
        <div className="flex-1">
          <p className="text-sm font-bold">Arçelik Bayi Asistanı</p>
          <p className="text-[10px] text-white/70">Kampanya, fiyat ve stok desteği</p>
        </div>
        <button onClick={onClose} className="p-1.5 hover:bg-white/20 rounded-lg transition-colors"><X size={18} /></button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-50">
        {messages.map((msg) => (
          <div key={msg.id} className={`flex gap-2 ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            {msg.role === "agent" && (
              <div className="w-7 h-7 rounded-full bg-[#E30613] flex items-center justify-center flex-shrink-0 mt-0.5">
                <Bot size={14} className="text-white" />
              </div>
            )}
            <div className={`max-w-[85%] rounded-xl px-4 py-3 ${
              msg.role === "user" ? "bg-[#0E2841] text-white" : "bg-white border border-gray-100 shadow-sm"
            }`}>
              <p className="text-xs whitespace-pre-line leading-relaxed">{msg.text}</p>
              {msg.type === "table" && !!msg.data?.headers && (
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full text-[11px]">
                    <thead>
                      <tr className="border-b border-gray-100">
                        {(msg.data.headers as string[]).map((h, i) => (
                          <th key={i} className="px-2 py-1.5 text-left font-semibold text-gray-500">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {(msg.data.rows as string[][]).map((row, i) => (
                        <tr key={i} className="border-b border-gray-50">
                          {row.map((cell, j) => (
                            <td key={j} className="px-2 py-1.5">{cell}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {msg.type === "progress" && msg.data?.current !== undefined && (
                <div className="mt-3">
                  <div className="flex items-end gap-1 mb-1">
                    <span className="text-lg font-bold text-[#E30613]">{String(msg.data.current)}</span>
                    <span className="text-xs text-gray-400">/ {String(msg.data.target)}</span>
                  </div>
                  <div className="h-2.5 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full bg-[#E30613]" style={{ width: `${Math.min(Number(msg.data.percent ?? 0), 100)}%` }} />
                  </div>
                </div>
              )}
              {msg.type === "metric" && !!msg.data?.value && (
                <div className="mt-2 px-3 py-2 bg-gray-50 rounded-lg flex items-center gap-3">
                  <span className="text-lg font-bold text-[#E30613]">{String(msg.data.value)}</span>
                  {!!msg.data.label && <span className="text-[10px] text-gray-500">{String(msg.data.label)}</span>}
                </div>
              )}
            </div>
            {msg.role === "user" && (
              <div className="w-7 h-7 rounded-full bg-gray-200 flex items-center justify-center flex-shrink-0 mt-0.5">
                <User size={14} className="text-gray-600" />
              </div>
            )}
          </div>
        ))}

        {typing && (
          <div className="flex gap-2">
            <div className="w-7 h-7 rounded-full bg-[#E30613] flex items-center justify-center flex-shrink-0">
              <Bot size={14} className="text-white" />
            </div>
            <div className="bg-white border border-gray-100 shadow-sm rounded-xl px-4 py-3">
              <div className="flex gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: "0ms" }} />
                <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: "150ms" }} />
                <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: "300ms" }} />
              </div>
            </div>
          </div>
        )}

        {messages.length === 1 && (
          <div className="flex flex-wrap gap-2">
            {QUICK_PROMPTS.map((qp) => (
              <button
                key={qp.label}
                onClick={() => send(qp.label)}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold bg-white border border-gray-200 rounded-lg hover:border-[#E30613] hover:text-[#E30613] transition-colors"
              >
                <qp.icon size={13} />{qp.label}
              </button>
            ))}
          </div>
        )}

        <div ref={endRef} />
      </div>

      <div className="flex-shrink-0 border-t border-gray-200 p-3 bg-white">
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Mesajınızı yazın..."
            rows={1}
            className="flex-1 resize-none text-sm border border-gray-200 rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-[#E30613]/20 focus:border-[#E30613]"
          />
          <button
            onClick={() => send(input)}
            disabled={!input.trim() || typing}
            className="p-2.5 rounded-lg bg-[#E30613] text-white disabled:opacity-40 hover:bg-[#C00511] transition-colors"
          >
            <Send size={16} />
          </button>
        </div>
      </div>
    </motion.div>
  );
}
