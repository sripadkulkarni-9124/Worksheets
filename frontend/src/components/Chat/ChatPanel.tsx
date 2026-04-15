import { useRef, useEffect, useState, useCallback } from 'react';
import { useStore } from '../../store';
import { streamChat } from '../../api';
import ChatMessage from './ChatMessage';
import QuickActions from './QuickActions';
import VoiceInput from './VoiceInput';
import VedOrb from '../shared/VedOrb';

export default function ChatPanel() {
  const sessionId = useStore((s) => s.sessionId);
  const chatMessages = useStore((s) => s.chatMessages);
  const isChatStreaming = useStore((s) => s.isChatStreaming);
  const currentPage = useStore((s) => s.currentPage);
  const chatQuestionContext = useStore((s) => s.chatQuestionContext);
  const addChatMessage = useStore((s) => s.addChatMessage);
  const updateLastAssistantMessage = useStore((s) => s.updateLastAssistantMessage);
  const setChatStreaming = useStore((s) => s.setChatStreaming);
  const setChatOpen = useStore((s) => s.setChatOpen);

  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  const sendMessage = useCallback(
    (text?: string) => {
      const msg = text || input.trim();
      if (!msg || isChatStreaming) return;

      setInput('');

      // Add user message
      addChatMessage({
        id: crypto.randomUUID(),
        role: 'user',
        content: msg,
        questionNumber: chatQuestionContext || undefined,
        timestamp: Date.now(),
      });

      // Add empty assistant message (will stream into it)
      addChatMessage({
        id: crypto.randomUUID(),
        role: 'assistant',
        content: '',
        questionNumber: chatQuestionContext || undefined,
        timestamp: Date.now(),
      });

      setChatStreaming(true);
      let accumulated = '';

      abortRef.current = streamChat(
        sessionId,
        msg,
        currentPage,
        chatQuestionContext || undefined,
        (chunk) => {
          accumulated += chunk;
          updateLastAssistantMessage(accumulated);
        },
        () => {
          setChatStreaming(false);
        },
      );
    },
    [
      input, isChatStreaming, sessionId, currentPage, chatQuestionContext,
      addChatMessage, updateLastAssistantMessage, setChatStreaming,
    ],
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <VedOrb size={32} speaking={isChatStreaming} />
        <div style={{ flex: 1 }}>
          <h3 style={styles.headerTitle}>Ask Ved</h3>
          {chatQuestionContext && (
            <p style={styles.context}>
              About Q{chatQuestionContext}
            </p>
          )}
        </div>
        <button onClick={() => setChatOpen(false)} style={styles.closeBtn}>
          ✕
        </button>
      </div>

      {/* Messages */}
      <div style={styles.messages}>
        {chatMessages.length === 0 && (
          <div style={styles.welcome}>
            <VedOrb size={48} />
            <p style={styles.welcomeText}>
              Hi there! 👋<br />
              How can I help you understand your worksheet better?
            </p>
            <QuickActions onAction={sendMessage} />
          </div>
        )}

        {chatMessages.map((msg) => (
          <ChatMessage key={msg.id} message={msg} />
        ))}

        {isChatStreaming && (
          <div style={styles.typing}>
            <span style={styles.dot} />
            <span style={{ ...styles.dot, animationDelay: '0.2s' }} />
            <span style={{ ...styles.dot, animationDelay: '0.4s' }} />
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div style={styles.inputArea}>
        <div style={styles.inputWrapper}>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask me anything..."
            rows={1}
            style={styles.textarea}
          />
          <button
            onClick={() => sendMessage()}
            disabled={!input.trim() || isChatStreaming}
            style={{
              ...styles.sendBtn,
              opacity: input.trim() && !isChatStreaming ? 1 : 0.4,
            }}
          >
            ↑
          </button>
        </div>
        <VoiceInput onTranscript={sendMessage} />
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '14px 16px',
    borderBottom: '1px solid rgba(255,255,255,0.06)',
    flexShrink: 0,
  },
  headerTitle: {
    fontFamily: 'var(--font-display)',
    fontSize: 16,
    fontWeight: 600,
    color: 'var(--text-1)',
  },
  context: {
    fontSize: 12,
    color: '#fbbf24',
    fontWeight: 500,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: '50%',
    background: 'rgba(255,255,255,0.06)',
    color: 'var(--text-3)',
    fontSize: 14,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
  },
  messages: {
    flex: 1,
    overflow: 'auto',
    padding: '16px',
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  welcome: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 16,
    padding: '32px 16px',
    textAlign: 'center',
  },
  welcomeText: {
    fontFamily: 'var(--font-display)',
    fontSize: 18,
    fontWeight: 600,
    color: 'var(--text-1)',
    lineHeight: 1.5,
  },
  typing: {
    display: 'flex',
    gap: 4,
    padding: '8px 12px',
    alignSelf: 'flex-start',
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: '50%',
    background: 'var(--text-3)',
    animation: 'pulse 1s ease-in-out infinite',
  },
  inputArea: {
    padding: '12px 16px',
    borderTop: '1px solid rgba(255,255,255,0.06)',
    flexShrink: 0,
    display: 'flex',
    gap: 8,
    alignItems: 'flex-end',
  },
  inputWrapper: {
    flex: 1,
    display: 'flex',
    alignItems: 'flex-end',
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 14,
    padding: '4px 4px 4px 14px',
  },
  textarea: {
    flex: 1,
    resize: 'none',
    background: 'transparent',
    color: 'var(--text-1)',
    fontSize: 14,
    lineHeight: 1.5,
    padding: '8px 0',
    maxHeight: 120,
  },
  sendBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    background: '#f59e0b',
    color: '#1a1a2e',
    fontSize: 18,
    fontWeight: 700,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    flexShrink: 0,
    transition: 'opacity 0.2s',
  },
};
