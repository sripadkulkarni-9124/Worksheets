import { create } from 'zustand';
import type {
  Attempt,
  AppView,
  ChatMessage,
  Evaluation,
  MobileTab,
  Question,
} from './types';

interface VedStore {
  // Session
  sessionId: string;
  apiKeyConnected: boolean;

  // View
  view: AppView;
  mobileTab: MobileTab;

  // Upload
  uploadedFiles: File[];
  imageUrls: string[];

  // Evaluation
  evaluation: Evaluation | null;
  isEvaluating: boolean;
  currentPage: number;
  selectedQuestion: string | null;  // question_number
  annotationsRevealed: boolean;

  // Chat
  chatMessages: ChatMessage[];
  isChatOpen: boolean;
  isChatStreaming: boolean;
  chatQuestionContext: string | null;  // scoped question_number

  // Voice
  voiceEnabled: boolean;
  isListening: boolean;
  conversationMode: boolean;

  // UI
  showConfetti: boolean;
  showApiKeyBar: boolean;

  // Re-upload / Attempt history
  attemptCount: number;
  previousScorePercent: number | null;
  attempts: Attempt[];
  viewingAttemptIndex: number | null;  // null = viewing latest

  // ── Actions ──
  setSessionId: (id: string) => void;
  setApiKeyConnected: (v: boolean) => void;
  setView: (v: AppView) => void;
  setMobileTab: (t: MobileTab) => void;
  setUploadedFiles: (files: File[]) => void;
  setImageUrls: (urls: string[]) => void;
  setEvaluation: (ev: Evaluation) => void;
  setIsEvaluating: (v: boolean) => void;
  setCurrentPage: (p: number) => void;
  selectQuestion: (qnum: string | null) => void;
  setAnnotationsRevealed: (v: boolean) => void;
  addChatMessage: (msg: ChatMessage) => void;
  updateLastAssistantMessage: (content: string) => void;
  setChatOpen: (v: boolean) => void;
  setChatStreaming: (v: boolean) => void;
  setChatQuestionContext: (qnum: string | null) => void;
  setVoiceEnabled: (v: boolean) => void;
  setListening: (v: boolean) => void;
  setConversationMode: (v: boolean) => void;
  setShowConfetti: (v: boolean) => void;
  setShowApiKeyBar: (v: boolean) => void;
  saveAttemptAndReupload: (newFiles: File[]) => void;
  viewAttempt: (index: number | null) => void;
  reset: () => void;

  // Computed helpers
  currentPageQuestions: () => Question[];
  selectedQuestionData: () => Question | undefined;
  scorePercent: () => number;
}

function generateSessionId(): string {
  return crypto.randomUUID?.() || `s_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

const savedSessionId = typeof localStorage !== 'undefined'
  ? localStorage.getItem('ved_session_id') || generateSessionId()
  : generateSessionId();

if (typeof localStorage !== 'undefined') {
  localStorage.setItem('ved_session_id', savedSessionId);
}

export const useStore = create<VedStore>((set, get) => ({
  // Initial state
  sessionId: savedSessionId,
  apiKeyConnected: false,
  view: 'upload',
  mobileTab: 'worksheet',
  uploadedFiles: [],
  imageUrls: [],
  evaluation: null,
  isEvaluating: false,
  currentPage: 0,
  selectedQuestion: null,
  annotationsRevealed: false,
  chatMessages: [],
  isChatOpen: false,
  isChatStreaming: false,
  chatQuestionContext: null,
  voiceEnabled: true,
  isListening: false,
  conversationMode: false,
  showConfetti: false,
  showApiKeyBar: true,
  attemptCount: 1,
  previousScorePercent: null,
  attempts: [],
  viewingAttemptIndex: null,

  // Actions
  setSessionId: (id) => {
    localStorage.setItem('ved_session_id', id);
    set({ sessionId: id });
  },
  setApiKeyConnected: (v) => set({ apiKeyConnected: v, showApiKeyBar: !v }),
  setView: (v) => set({ view: v }),
  setMobileTab: (t) => set({ mobileTab: t }),
  setUploadedFiles: (files) => set({ uploadedFiles: files }),
  setImageUrls: (urls) => set({ imageUrls: urls }),
  setEvaluation: (ev) => {
    set({ evaluation: ev, view: 'review', annotationsRevealed: false });
    // Auto-select first wrong question
    const firstWrong = ev.questions.find((q) => !q.is_correct);
    if (firstWrong) {
      set({ selectedQuestion: firstWrong.question_number });
    } else if (ev.questions.length > 0) {
      set({ selectedQuestion: ev.questions[0].question_number });
    }
    // Check for perfect score → confetti
    const allCorrect = ev.questions.every((q) => q.is_correct);
    if (allCorrect && ev.questions.length > 0) {
      set({ showConfetti: true });
      setTimeout(() => set({ showConfetti: false }), 4000);
    }
  },
  setIsEvaluating: (v) => set({ isEvaluating: v }),
  setCurrentPage: (p) => set({ currentPage: p }),
  selectQuestion: (qnum) => set({ selectedQuestion: qnum }),
  setAnnotationsRevealed: (v) => set({ annotationsRevealed: v }),
  addChatMessage: (msg) =>
    set((s) => ({ chatMessages: [...s.chatMessages, msg] })),
  updateLastAssistantMessage: (content) =>
    set((s) => {
      const msgs = [...s.chatMessages];
      for (let i = msgs.length - 1; i >= 0; i--) {
        if (msgs[i].role === 'assistant') {
          msgs[i] = { ...msgs[i], content };
          break;
        }
      }
      return { chatMessages: msgs };
    }),
  setChatOpen: (v) => set({ isChatOpen: v }),
  setChatStreaming: (v) => set({ isChatStreaming: v }),
  setChatQuestionContext: (qnum) => set({ chatQuestionContext: qnum }),
  setVoiceEnabled: (v) => {
    localStorage.setItem('ved_voice', v ? 'on' : 'off');
    set({ voiceEnabled: v });
  },
  setListening: (v) => set({ isListening: v }),
  setConversationMode: (v) => set({ conversationMode: v }),
  setShowConfetti: (v) => set({ showConfetti: v }),
  setShowApiKeyBar: (v) => set({ showApiKeyBar: v }),
  saveAttemptAndReupload: async (newFiles: File[]) => {
    const { evaluation, attemptCount, sessionId, imageUrls, attempts, addChatMessage } = get();

    // 1. Save current attempt to history
    if (evaluation) {
      const correct = evaluation.questions.filter((q) => q.is_correct).length;
      const total = evaluation.questions.length;
      const pct = Math.round((correct / total) * 100);

      const attempt: Attempt = {
        index: attemptCount,
        imageUrls: [...imageUrls],
        // Deep-clone so future evaluations can never mutate this attempt's data
        evaluation: JSON.parse(JSON.stringify(evaluation)),
        scorePercent: pct,
        timestamp: Date.now(),
      };

      // Save to chat as a card
      addChatMessage({
        id: crypto.randomUUID(),
        role: 'system',
        content: `📋 **Attempt ${attemptCount} Results** — Score: ${correct}/${total} (${pct}%)\n${evaluation.summary || ''}`,
        timestamp: Date.now(),
      });

      // 2. CLEAR evaluation + image immediately so old annotations don't persist
      set({
        attempts: [...attempts, attempt],
        evaluation: null,
        imageUrls: [],
        isEvaluating: true,
        uploadedFiles: newFiles,
        currentPage: 0,
        selectedQuestion: null,
        annotationsRevealed: false,
        viewingAttemptIndex: null,
        attemptCount: attemptCount + 1,
        previousScorePercent: pct,
      });
    } else {
      set({
        isEvaluating: true,
        uploadedFiles: newFiles,
        evaluation: null,
        imageUrls: [],
        viewingAttemptIndex: null,
      });
    }

    // 3. Clear backend session images
    await fetch('/api/clear', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: sessionId, target: 'answer_sheets' }),
    }).catch(() => {});

    try {
      // 4. Upload new files
      const { uploadSheets, evaluateStandalone } = await import('./api');
      const uploadResult = await uploadSheets(sessionId, newFiles);

      // 5. Auto-evaluate
      const result = await evaluateStandalone(sessionId);

      // 6. Update state with new results
      set({
        imageUrls: uploadResult.image_urls,
        isEvaluating: false,
        currentPage: 0,
        annotationsRevealed: false,
        selectedQuestion: null,
      });
      get().setEvaluation(result.evaluation);

      // 7. Add result comparison to chat
      const newCorrect = result.evaluation.questions.filter((q: { is_correct: boolean }) => q.is_correct).length;
      const newTotal = result.evaluation.questions.length;
      const newPct = Math.round((newCorrect / newTotal) * 100);
      const prevPct = get().previousScorePercent;
      const diff = prevPct !== null ? newPct - prevPct : 0;
      const emoji = diff > 0 ? '📈' : diff === 0 ? '➡️' : '📉';

      addChatMessage({
        id: crypto.randomUUID(),
        role: 'assistant',
        content: `${emoji} **Attempt ${get().attemptCount} complete!** Score: ${newCorrect}/${newTotal} (${newPct}%)${prevPct !== null ? `\n${diff > 0 ? `+${diff}%` : `${diff}%`} from last attempt` : ''}\n\n${diff > 0 ? 'Great improvement! 🎉' : diff === 0 ? 'Same score — try reviewing the hints!' : 'Keep trying — check the step-by-step solutions!'}`,
        timestamp: Date.now(),
      });
    } catch (err) {
      set({ isEvaluating: false });
      addChatMessage({
        id: crypto.randomUUID(),
        role: 'assistant',
        content: `❌ Oops! Something went wrong evaluating your new worksheet. ${err instanceof Error ? err.message : 'Try again?'}`,
        timestamp: Date.now(),
      });
    }
  },
  viewAttempt: (index: number | null) => {
    if (index === null) {
      // Back to latest — reset page so we don't land on a missing page
      set({ viewingAttemptIndex: null, currentPage: 0 });
      return;
    }
    const { attempts } = get();
    const attempt = attempts.find((a) => a.index === index);
    if (attempt) {
      // Reset page when switching to past attempt (it may have fewer pages)
      set({ viewingAttemptIndex: index, currentPage: 0 });
    }
  },
  reset: () => {
    const newId = generateSessionId();
    localStorage.setItem('ved_session_id', newId);
    set({
      sessionId: newId,
      view: 'upload',
      uploadedFiles: [],
      imageUrls: [],
      evaluation: null,
      isEvaluating: false,
      currentPage: 0,
      selectedQuestion: null,
      annotationsRevealed: false,
      chatMessages: [],
      isChatOpen: false,
      chatQuestionContext: null,
      showConfetti: false,
      attemptCount: 1,
      previousScorePercent: null,
      attempts: [],
      viewingAttemptIndex: null,
    });
  },

  // Computed
  currentPageQuestions: () => {
    const { evaluation, currentPage } = get();
    if (!evaluation) return [];
    return evaluation.questions.filter(
      (q) => q.page_number === currentPage + 1,
    );
  },
  selectedQuestionData: () => {
    const { evaluation, selectedQuestion } = get();
    if (!evaluation || !selectedQuestion) return undefined;
    return evaluation.questions.find(
      (q) => q.question_number === selectedQuestion,
    );
  },
  scorePercent: () => {
    const { evaluation } = get();
    if (!evaluation || evaluation.questions.length === 0) return 0;
    const correct = evaluation.questions.filter((q) => q.is_correct).length;
    return Math.round((correct / evaluation.questions.length) * 100);
  },
}));
