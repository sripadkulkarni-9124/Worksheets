import { useCallback, useRef, useState } from 'react';

interface Props {
  onTranscript: (text: string) => void;
}

export default function VoiceInput({ onTranscript }: Props) {
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<InstanceType<typeof window.SpeechRecognition> | null>(null);

  const startListening = useCallback(() => {
    const SpeechRecognitionCtor =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognitionCtor) return;

    const recognition = new SpeechRecognitionCtor();
    recognition.lang = 'en-IN';
    recognition.continuous = false;
    recognition.interimResults = false;

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      const transcript = event.results[0]?.[0]?.transcript;
      if (transcript) {
        onTranscript(transcript);
      }
    };

    recognition.onend = () => setIsListening(false);
    recognition.onerror = () => setIsListening(false);

    recognition.start();
    recognitionRef.current = recognition;
    setIsListening(true);
  }, [onTranscript]);

  const stopListening = useCallback(() => {
    recognitionRef.current?.stop();
    setIsListening(false);
  }, []);

  // Check if Speech Recognition is available
  const isSupported = typeof window !== 'undefined' &&
    (window.SpeechRecognition || window.webkitSpeechRecognition);

  if (!isSupported) return null;

  return (
    <button
      onClick={isListening ? stopListening : startListening}
      style={{
        ...styles.micBtn,
        background: isListening
          ? 'rgba(239, 68, 68, 0.2)'
          : 'rgba(255,255,255,0.06)',
        borderColor: isListening
          ? 'rgba(239, 68, 68, 0.4)'
          : 'rgba(255,255,255,0.1)',
        animation: isListening ? 'pulse 1s ease-in-out infinite' : undefined,
      }}
      title={isListening ? 'Stop listening' : 'Voice input'}
    >
      {isListening ? '🔴' : '🎙️'}
    </button>
  );
}

// Add type declarations for Speech Recognition
declare global {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface SpeechRecognition extends EventTarget {
    lang: string;
    continuous: boolean;
    interimResults: boolean;
    onresult: ((event: SpeechRecognitionEvent) => void) | null;
    onend: (() => void) | null;
    onerror: (() => void) | null;
    start(): void;
    stop(): void;
  }
  interface Window {
    SpeechRecognition: new () => SpeechRecognition;
    webkitSpeechRecognition: new () => SpeechRecognition;
  }
}

const styles: Record<string, React.CSSProperties> = {
  micBtn: {
    width: 44,
    height: 44,
    borderRadius: 14,
    border: '1px solid rgba(255,255,255,0.1)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 18,
    cursor: 'pointer',
    transition: 'all 0.2s',
    flexShrink: 0,
  },
};
