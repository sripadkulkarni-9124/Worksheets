import { useState, useEffect, useRef, useCallback } from 'react'
import { EvaluatedQuestion, ChatMessage } from '../types'
import { sendChat, saveChatMessage, fetchChatMessages } from '../api'

interface Props {
  question: EvaluatedQuestion
  sessionId: string
  onClose: () => void
}

export default function AskVedChat({ question, sessionId, onClose }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [loadingHistory, setLoadingHistory] = useState(true)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  useEffect(() => {
    scrollToBottom()
  }, [messages, scrollToBottom])

  // Load chat history on open
  useEffect(() => {
    const load = async () => {
      setLoadingHistory(true)
      try {
        const history = await fetchChatMessages(sessionId, question.number)
        if (history && history.length > 0) {
          setMessages(history.map((m: ChatMessage) => ({ ...m, role: m.role as 'user' | 'assistant' })))
        } else {
          // Auto-trigger welcome message
          await sendAutoGreeting()
        }
      } catch {
        await sendAutoGreeting()
      } finally {
        setLoadingHistory(false)
      }
    }
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const sendAutoGreeting = async () => {
    const statusText = {
      correct: "got this right",
      incorrect: "got this wrong",
      partially_correct: "partially answered this",
      unanswered: "left this unanswered"
    }[question.status] || "answered this"

    const greeting = `Hi! I'm VED, your AI tutor. I see you ${statusText}. Would you like me to explain the concept or walk you through the solution?`

    const welcomeMsg: ChatMessage = {
      id: Date.now().toString(),
      role: 'assistant',
      content: greeting,
      timestamp: new Date().toISOString()
    }
    setMessages([welcomeMsg])
    if (sessionId !== 'temp') {
      await saveChatMessage(sessionId, question.number, 'assistant', greeting)
    }
  }

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || loading) return

    const userMsg: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: text.trim(),
      timestamp: new Date().toISOString()
    }

    setMessages(prev => [...prev, userMsg])
    setInput('')
    setLoading(true)

    if (sessionId !== 'temp') {
      await saveChatMessage(sessionId, question.number, 'user', text.trim())
    }

    try {
      const history = messages.map(m => ({ role: m.role, content: m.content }))
      const res = await sendChat({
        message: text.trim(),
        questionText: question.questionText,
        correctAnswer: question.correctAnswer,
        studentAnswer: question.studentAnswer,
        status: question.status,
        history
      })

      const aiMsg: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: res.response,
        timestamp: new Date().toISOString()
      }
      setMessages(prev => [...prev, aiMsg])

      if (sessionId !== 'temp') {
        await saveChatMessage(sessionId, question.number, 'assistant', res.response)
      }
    } catch {
      const errMsg: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: "Sorry, I couldn't connect. Please try again!",
        timestamp: new Date().toISOString()
      }
      setMessages(prev => [...prev, errMsg])
    } finally {
      setLoading(false)
      setTimeout(() => inputRef.current?.focus(), 100)
    }
  }, [loading, messages, question, sessionId])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage(input)
    }
  }

  const statusColor = {
    correct: 'text-green-400',
    incorrect: 'text-red-400',
    partially_correct: 'text-amber-400',
    unanswered: 'text-gray-400'
  }[question.status]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
      <div className="bg-[#1A2332] rounded-2xl shadow-2xl w-full max-w-lg mx-4 flex flex-col" style={{ height: '80vh', maxHeight: 600 }}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-gradient-to-br from-purple-500 to-blue-600 flex items-center justify-center text-white font-bold text-sm">
              V
            </div>
            <div>
              <h2 className="text-white font-semibold text-sm">Ask VED</h2>
              <p className={`text-xs ${statusColor} capitalize`}>
                Q{question.number} • {question.status.replace('_', ' ')}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-white/50 hover:text-white transition-colors text-2xl leading-none">
            &times;
          </button>
        </div>

        {/* Question context banner */}
        <div className="px-5 py-3 bg-white/5 border-b border-white/10 flex-shrink-0">
          <p className="text-white/50 text-xs">
            <span className="text-white/30">Question: </span>
            {question.questionText.length > 80
              ? question.questionText.slice(0, 80) + '...'
              : question.questionText}
          </p>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3 min-h-0">
          {loadingHistory ? (
            <div className="flex items-center justify-center h-full">
              <div className="w-6 h-6 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            messages.map(msg => (
              <div
                key={msg.id}
                className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                {msg.role === 'assistant' && (
                  <div className="w-7 h-7 rounded-full bg-gradient-to-br from-purple-500 to-blue-600 flex items-center justify-center text-white text-xs font-bold flex-shrink-0 mr-2 mt-0.5">
                    V
                  </div>
                )}
                <div
                  className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm ${
                    msg.role === 'user'
                      ? 'bg-gradient-to-br from-orange-500 to-orange-400 text-white rounded-tr-sm'
                      : 'bg-white/10 text-white/85 rounded-tl-sm'
                  }`}
                >
                  {msg.content}
                </div>
              </div>
            ))
          )}

          {loading && (
            <div className="flex justify-start">
              <div className="w-7 h-7 rounded-full bg-gradient-to-br from-purple-500 to-blue-600 flex items-center justify-center text-white text-xs font-bold flex-shrink-0 mr-2 mt-0.5">
                V
              </div>
              <div className="bg-white/10 rounded-2xl rounded-tl-sm px-4 py-2.5">
                <div className="flex gap-1 items-center h-5">
                  <div className="w-2 h-2 bg-white/50 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                  <div className="w-2 h-2 bg-white/50 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                  <div className="w-2 h-2 bg-white/50 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Quick prompts */}
        <div className="px-5 py-2 border-t border-white/10 flex-shrink-0">
          <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
            {[
              "Explain this concept",
              "Show me the steps",
              "Where did I go wrong?",
              "Give me a hint"
            ].map(prompt => (
              <button
                key={prompt}
                onClick={() => sendMessage(prompt)}
                disabled={loading}
                className="flex-shrink-0 px-3 py-1.5 rounded-full bg-white/5 border border-white/15 text-white/60 text-xs hover:bg-white/10 hover:text-white/80 transition-colors disabled:opacity-40"
              >
                {prompt}
              </button>
            ))}
          </div>
        </div>

        {/* Input */}
        <div className="px-5 py-4 border-t border-white/10 flex-shrink-0">
          <div className="flex gap-3">
            <input
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask VED anything..."
              disabled={loading}
              className="flex-1 bg-white/5 border border-white/15 rounded-xl px-4 py-2.5 text-white text-sm placeholder-white/30 focus:outline-none focus:border-purple-400/60 disabled:opacity-50"
            />
            <button
              onClick={() => sendMessage(input)}
              disabled={!input.trim() || loading}
              className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-blue-600 flex items-center justify-center text-white hover:opacity-90 transition-opacity disabled:opacity-40 flex-shrink-0"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
