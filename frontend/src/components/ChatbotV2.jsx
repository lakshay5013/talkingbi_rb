import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Mic, Send, Bot, User, Sparkles, ChevronRight } from 'lucide-react';
import { apiPost } from '../api';

const FREE_QUEUE_MIN_SEC = 10;
const FREE_QUEUE_MAX_SEC = 15;

export default function ChatbotV2({ isOpen, onClose, plan, filters, onUsageRefresh }) {
  const [messages, setMessages] = useState([
    { role: 'assistant', text: "Systems online. I'm ready to analyze your datasets. Try asking follow-up questions — I'll remember context!", id: 1 }
  ]);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isQueued, setIsQueued] = useState(false);
  const [queueSecondsLeft, setQueueSecondsLeft] = useState(0);
  const sessionIdRef = useRef(`session_${Date.now()}_${Math.random().toString(36).slice(2)}`);
  const queueIntervalRef = useRef(null);
  const speakTimeoutRef = useRef(null);
  const activeUtteranceRef = useRef(null);
  const recognitionRef = useRef(null);
  const messagesEndRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping]);

  useEffect(() => {
    return () => {
      if (queueIntervalRef.current) {
        clearInterval(queueIntervalRef.current);
      }
      if (speakTimeoutRef.current) {
        clearTimeout(speakTimeoutRef.current);
      }
      if (window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
    };
  }, []);

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const speakReply = async (text) => {
    if (!text || typeof window === 'undefined' || !('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') {
      return;
    }

    const sanitized = String(text)
      .replace(/\s+/g, ' ')
      .replace(/₹\s*/g, ' rupees ')
      .replace(/\bKPI\b/gi, 'key performance indicator')
      .trim();

    if (!sanitized) return;

    if (speakTimeoutRef.current) {
      clearTimeout(speakTimeoutRef.current);
      speakTimeoutRef.current = null;
    }

    window.speechSynthesis.cancel();

    speakTimeoutRef.current = setTimeout(() => {
      const utter = new SpeechSynthesisUtterance(sanitized);
      activeUtteranceRef.current = utter;
      utter.lang = 'en-IN';
      utter.pitch = 0.95;
      utter.rate = 1.02;
      utter.volume = 1;

      const voices = window.speechSynthesis.getVoices?.() || [];
      const preferredVoice = voices.find((voice) => /en[-_]?IN|en[-_]?US|en[-_]?GB/i.test(voice.lang || '')) || voices[0];
      if (preferredVoice) {
        utter.voice = preferredVoice;
      }

      utter.onend = () => {
        if (activeUtteranceRef.current === utter) {
          activeUtteranceRef.current = null;
        }
      };

      utter.onerror = () => {
        if (activeUtteranceRef.current === utter) {
          activeUtteranceRef.current = null;
        }
      };

      window.speechSynthesis.speak(utter);
    }, 80);
  };

  const handleSend = async () => {
    if (!input.trim() || isTyping || isQueued) return;
    
    const userMsg = input;
    setMessages(prev => [...prev, { role: 'user', text: userMsg, id: Date.now() }]);
    setInput("");
    setIsTyping(true);

    try {
      const isFreePlan = String(plan || '').toLowerCase() === 'free';

      if (isFreePlan) {
        const queueDelaySec = Math.floor(Math.random() * (FREE_QUEUE_MAX_SEC - FREE_QUEUE_MIN_SEC + 1)) + FREE_QUEUE_MIN_SEC;
        const queueMessageId = Date.now() + 2;
        let remaining = queueDelaySec;

        setIsQueued(true);
        setQueueSecondsLeft(queueDelaySec);
        setMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            text: `Free queue active. Generating in ~${queueDelaySec}s...`,
            id: queueMessageId,
            isQueueStatus: true,
          },
        ]);

        queueIntervalRef.current = setInterval(() => {
          remaining = Math.max(remaining - 1, 0);
          setQueueSecondsLeft(remaining);
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === queueMessageId
                ? {
                    ...msg,
                    text: remaining > 0
                      ? `Free queue active. Generating in ~${remaining}s...`
                      : 'Queue cleared. Generating response...',
                  }
                : msg
            )
          );
        }, 1000);

        await wait(queueDelaySec * 1000);

        if (queueIntervalRef.current) {
          clearInterval(queueIntervalRef.current);
          queueIntervalRef.current = null;
        }

        setQueueSecondsLeft(0);
        setIsQueued(false);
      }

      const response = await apiPost('/api/chat', {
        query: userMsg,
        filters,
        sessionId: sessionIdRef.current,
        usageType: 'chat',
      });

      if (typeof onUsageRefresh === 'function') {
        onUsageRefresh();
      }

      const reply = response?.answer || 'I could not generate a response for that query.';
      const insights = response?.insights || [];

      setIsTyping(false);

      // Main answer
      setMessages(prev => [...prev, {
        role: 'assistant',
        text: reply,
        id: Date.now() + 1,
        insights,
        parsedQuery: response?.parsedQuery,
      }]);
      
      speakReply(reply);
    } catch (err) {
      if (queueIntervalRef.current) {
        clearInterval(queueIntervalRef.current);
        queueIntervalRef.current = null;
      }
      setQueueSecondsLeft(0);
      setIsQueued(false);
      setIsTyping(false);
      setMessages(prev => [
        ...prev,
        { role: 'assistant', text: 'Backend is unavailable. Please try again in a moment.', id: Date.now() + 1 },
      ]);
    }
  };

  const startVoice = () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setInput((prev) => prev || 'What was the total revenue?');
      return;
    }

    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = 'en-IN';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => setIsListening(true);
    recognition.onresult = (event) => {
      const transcript = event.results?.[0]?.[0]?.transcript?.trim();
      if (transcript) {
        setInput(transcript);
      }
    };
    recognition.onerror = () => setIsListening(false);
    recognition.onend = () => {
      setIsListening(false);
      recognitionRef.current = null;
    };

    recognitionRef.current = recognition;
    recognition.start();
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div 
          initial={{ opacity: 0, x: 40 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 40 }}
          transition={{ duration: 0.25 }}
          className="chat-panel"
        >
          <div className="chat-header">
            <div className="chat-header-left">
              <div className="chat-avatar">
                 <Bot className="w-4 h-4" />
              </div>
              <div>
                <h3>Talking BI Assistant <Sparkles className="w-3 h-3"/></h3>
                <p>{plan} plan · Context-aware</p>
              </div>
            </div>
            <button onClick={onClose} className="icon-btn" aria-label="Close chat">
               &times;
            </button>
          </div>

          <div className="chat-messages">
            <AnimatePresence>
              {messages.map(m => (
                <motion.div 
                  key={m.id}
                  initial={{ opacity: 0, y: 10, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  className={`chat-message-row ${m.role === 'user' ? 'user' : 'assistant'}`}
                >
                  <div className={`chat-badge ${m.role === 'user' ? 'user' : 'assistant'}`}>
                    {m.role === 'user' ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
                  </div>
                  <div className={`chat-bubble ${m.role === 'user' ? 'user' : 'assistant'} ${m.isQueueStatus ? 'queue-status' : ''}`}>
                    {m.text}
                    {/* Show inline insights if available */}
                    {m.insights && m.insights.length > 0 && (
                      <div className="chat-inline-insights">
                        {m.insights.map((ins, i) => (
                          <div key={i} className="chat-insight-chip">
                            <ChevronRight size={10} />
                            <span>{ins}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>

            {isQueued && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="queue-indicator">
                <p className="queue-title">High demand on Free plan</p>
                <p className="queue-subtitle">Waiting in queue... {Math.max(queueSecondsLeft, 0)}s</p>
                <div className="queue-bar">
                  <span className="queue-bar-fill" />
                </div>
              </motion.div>
            )}

            {isTyping && !isQueued && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="typing-indicator">
                <span className="typing-dot"></span>
                <span className="typing-dot delay-1"></span>
                <span className="typing-dot delay-2"></span>
              </motion.div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <div className="chat-input-area">
            {isListening && (
              <div className="chat-listening-pulse">
                <span className="wave-bar"></span>
                <span className="wave-bar delay-1"></span>
                <span className="wave-bar delay-2"></span>
              </div>
            )}
            <div className="chat-input-wrap">
               <input 
                 value={input}
                 onChange={e=>setInput(e.target.value)}
                 onKeyDown={e=>e.key==='Enter'&&handleSend()}
                 placeholder={isQueued ? 'Free queue in progress...' : 'Ask a question (I remember context)'}
                 className="chat-input"
                 disabled={isTyping || isQueued}
               />
               <button onClick={startVoice} className={`icon-btn ${isListening ? 'listening' : ''}`} aria-label="Start voice" disabled={isTyping || isQueued}>
                 <Mic className="w-4 h-4" />
               </button>
               <button onClick={handleSend} className="btn-primary" aria-label="Send message" disabled={isTyping || isQueued}>
                 <Send className="w-4 h-4" />
               </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
