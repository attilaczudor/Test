import { Send } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function ChatPage() {
  const { t } = useTranslation("common");
  const [message, setMessage] = useState("");

  const handleSend = () => {
    if (!message.trim()) {
      return;
    }
    // Placeholder: future integration with inference backend
    setMessage("");
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex h-full flex-col p-6">
      {/* Header */}
      <div className="mb-4">
        <h1 className="text-3xl font-bold tracking-tight">{t("sidebar.chat")}</h1>
      </div>

      {/* Message area */}
      <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed">
        <p className="text-muted-foreground">Start a conversation</p>
      </div>

      {/* Input bar */}
      <div className="mt-4 flex gap-2">
        <Input
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a message..."
          className="flex-1"
        />
        <Button onClick={handleSend} size="icon" disabled={!message.trim()}>
          <Send className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
