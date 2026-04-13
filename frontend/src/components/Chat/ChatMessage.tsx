import type { ChatMessage as ChatMessageType } from '../../types';
import VedOrb from '../shared/VedOrb';

interface Props {
  message: ChatMessageType;
}

/** Simple markdown-like formatting */
function formatText(text: string): string {
  return text
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/`(.*?)`/g, '<code style="background:rgba(255,255,255,0.08);padding:1px 4px;border-radius:4px;font-size:13px">$1</code>')
    .replace(/\n/g, '<br/>');
}

export default function ChatMessage({ message }: Props) {
  const isUser = message.role === 'user';
  const isSystem = message.role === 'system';

  // System messages render as full-width cards (attempt summaries)
  if (isSystem) {
    return (
      <div style={styles.systemCard}>
        <div
          style={styles.systemText}
          dangerouslySetInnerHTML={{ __html: formatText(message.content) }}
        />
      </div>
    );
  }

  return (
    <div
      style={{
        ...styles.container,
        flexDirection: isUser ? 'row-reverse' : 'row',
      }}
    >
      {/* Avatar */}
      {!isUser && (
        <div style={styles.avatar}>
          <VedOrb size={28} />
        </div>
      )}

      {/* Bubble */}
      <div
        style={{
          ...styles.bubble,
          background: isUser
            ? 'rgba(245, 158, 11, 0.15)'
            : 'rgba(255, 255, 255, 0.05)',
          borderColor: isUser
            ? 'rgba(245, 158, 11, 0.2)'
            : 'rgba(255, 255, 255, 0.08)',
          borderBottomRightRadius: isUser ? 4 : 16,
          borderBottomLeftRadius: isUser ? 16 : 4,
        }}
      >
        <div
          style={styles.text}
          dangerouslySetInnerHTML={{ __html: formatText(message.content) }}
        />
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    gap: 8,
    maxWidth: '85%',
    animation: 'slideUp 0.25s ease',
  },
  avatar: {
    flexShrink: 0,
    paddingTop: 4,
  },
  bubble: {
    padding: '10px 14px',
    borderRadius: 16,
    border: '1px solid transparent',
    maxWidth: '100%',
  },
  text: {
    fontSize: 14,
    lineHeight: 1.6,
    color: 'var(--text-1)',
    wordBreak: 'break-word' as const,
  },
  systemCard: {
    width: '100%',
    padding: '12px 16px',
    borderRadius: 14,
    background: 'rgba(245, 158, 11, 0.06)',
    border: '1px solid rgba(245, 158, 11, 0.15)',
    animation: 'slideUp 0.25s ease',
  },
  systemText: {
    fontSize: 13,
    lineHeight: 1.6,
    color: 'var(--text-2)',
    textAlign: 'center' as const,
    wordBreak: 'break-word' as const,
  },
};
