import React, { useState, useEffect, useRef } from 'react';
//import './Chatbot.css';
import './Chatbot_v2.css';
import './ResultsTable.css';
import './Timestamp.css';
import './DataTable.css';
import apiService from '../services/apiService';
import { getAuthHeaders, getAuthHeadersGet } from '../utils/authHeaders';
import MarkdownRenderer from './MarkdownRenderer';
import DataInsightsPieChart from './DataInsightsPieChart';
import TimelineChart, { detectDateKey } from './TimelineChart';
import { shouldShowPieChart, shouldShowTimeline, TIMELINE_QUERY_KEYWORDS } from '../utils/chartHelpers';
import headerImage from '../assets/header_image.jpg';
import demandArcLogo from '../assets/DemandARC_Logo_FullColor_Reversed_RGB.png';
import { useClientConfig } from '../context/ClientConfigContext';
// ===============================
// ChatGPT-style Prompt Guard
// ===============================

const CAR_BRANDS = [
  'suzuki','toyota','nissan','hyundai','kia','honda',
  'mg','skoda','renault','chevrolet','ford','mazda'
];

const CAR_KEYWORDS = [
  'car','cars','vehicle','vehicles','brand','brands',
  'buy','purchase','ownership','usage','sentiment',
  'compare','vs','review','consumer','profile',
  'media','lifestyle','dependency','transport'
];

// simple typo-tolerant match
const isNearMatch = (a, b) => {
  let mismatches = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] !== b[i]) mismatches++;
    if (mismatches > 2) return false;
  }
  return true;
};

const isValidCarPrompt = (query) => {
  if (!query) return false;
  const q = query.toLowerCase();
  const words = q.split(/\s+/);

  if (CAR_KEYWORDS.some(k => q.includes(k))) return true;
  if (CAR_BRANDS.some(b => q.includes(b))) return true;

  // typo handling
  for (const w of words) {
    for (const b of CAR_BRANDS) {
      if (isNearMatch(w, b)) return true;
    }
  }

  return false;
};
const getFriendlyFallbackMessage = () => `
I'm here to help with **affordable car insights in the UAE** 🚗

You can ask things like:
• Car ownership and dependency
• Brand comparisons (Suzuki vs Toyota, etc.)
• Consumer profiles and usage behavior
• Purchase intent and sentiment
• Media and lifestyle trends

Try asking a question related to cars.
`;

// shouldShowPieChart, shouldShowTimeline, TIMELINE_QUERY_KEYWORDS
// are imported from ../utils/chartHelpers


const Chatbot = () => {
  // Live client branding from admin dashboard → backend → context.
  // Falls back to bundled assets if the client config has no S3 URL set.
  const clientConfig  = useClientConfig();
  const dynamicLogo   = clientConfig?.theme?.logoUrl        || demandArcLogo;
  const dynamicHeader = clientConfig?.theme?.headerImageUrl || headerImage;

  const [messages, setMessages] = useState([
    { text: "Hello! I'm your AI Data Assistant. I can help you analyze and retrieve insights from your data. Ask me anything!", sender: "bot", type: "text", timestamp: new Date() }
  ]);
  const [currentStep, setCurrentStep] = useState('queries');
  const [selectedDashboard, setSelectedDashboard] = useState('analytics');
  const [customQuery, setCustomQuery] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [expandedMessages, setExpandedMessages] = useState(new Set());
  const [showTechnicalInsights, setShowTechnicalInsights] = useState(false);
  const [latestTechnicalData, setLatestTechnicalData] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [activeTab, setActiveTab] = useState('sql');
  const [copySuccess, setCopySuccess] = useState(false);
  const messagesContainerRef = useRef(null);
  const chartRef = useRef(null); //  ADD
  // Stable session ID per mount — sent with every request so the backend can
  // maintain Cortex Analyst conversation history across follow-up questions
  const sessionIdRef = useRef(`session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`);
  const [promptHistory, setPromptHistory] = useState([]);
  const [latestQuery, setLatestQuery] = useState(''); // query that triggered the current Technical Insights modal


  const scrollToBottom = (smooth = false) => {
    if (messagesContainerRef.current) {
      messagesContainerRef.current.scrollTo({
        top: messagesContainerRef.current.scrollHeight,
        behavior: smooth ? 'smooth' : 'auto'
      });
    }
  };

 
  
  const scrollToRecentQuestion = () => {
    setTimeout(() => {
      if (messagesContainerRef.current) {
        const messageElements = messagesContainerRef.current.children;
        // Find the last user message (most recent question)
        for (let i = messageElements.length - 1; i >= 0; i--) {
          const messageElement = messageElements[i];
          if (messageElement.classList.contains('user')) {
            messagesContainerRef.current.scrollTo({
              top: messageElement.offsetTop - 50,
              behavior: 'smooth'
            });
            break;
          }
        }
      }
    }, 200);
  };

  const fetchPromptHistory = async () => {
    try {
      const API_BASE_URL =
        process.env.REACT_APP_API_URL || 'http://localhost:3002/api/v1';

      const headers = await getAuthHeadersGet();
      const res = await fetch(`${API_BASE_URL}/history`, { headers });

      const data = await res.json();
      setPromptHistory(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Failed to fetch prompt history', err);
    }
  };

  useEffect(() => {
    if (messages.length <= 1) {
      scrollToBottom();
    }
  }, [messages]);

  useEffect(() => {
    fetchPromptHistory();
  }, []);

  // Refresh history every time a query finishes processing
  const prevIsProcessingRef = useRef(false);
  useEffect(() => {
    if (prevIsProcessingRef.current === true && isProcessing === false) {
      fetchPromptHistory();
    }
    prevIsProcessingRef.current = isProcessing;
  }, [isProcessing]);


  const dashboards = [
    { id: 'analytics', name: 'Analytics Dashboard', icon: 'fas fa-chart-line' },
    { id: 'sales', name: 'Sales Performance', icon: 'fas fa-chart-pie' },
    { id: 'operations', name: 'Operations Monitor', icon: 'fas fa-server' },
    { id: 'finance', name: 'Financial Reports', icon: 'fas fa-coins' }
  ];

  const dashboardQueries = {
  'analytics': [
  'Which asset has the most decision makers?',
  'Leads count based on industry',
  'What is the count of leads, by buying roles by asset?',
  'Top 10 accounts with the most leads'
]
};

  const handleDashboardSelect = (dashboard) => {
    setSelectedDashboard(dashboard.id);
    setCurrentStep('queries');
    setIsTyping(true);

    setMessages(prev => [
      ...prev,
      { text: dashboard.name, sender: "user", type: "text", timestamp: new Date() }
    ]);

    setTimeout(() => {
      setIsTyping(false);
      setMessages(prev => [
        ...prev,
        { text: `Perfect! I'm now connected to your ${dashboard.name}. Here are some insights I can provide:`, sender: "bot", type: "text", timestamp: new Date() }
      ]);
    }, 1000);
  };

  const formatApiResponse = (response) => {
    // console.log('API Response:', response);

    if (!response.success) {
      return { text: response.error || 'Query failed', type: 'text' };
    }

    const technicalData = {
      sql: response.technical_insights || response.sql,
      dataInsights: response.data_insights,
      executionTime: response.executionTime,
      rowCount: response.results ? response.results.length : undefined,
      database: response.database,
      queryType: response.queryType,
      processingTime: response.processingTime,
      dataSource: response.dataSource
    };

    if (response.markdown) {
      return {
        text: response.markdown,
        type: 'markdown',
        technicalData
      };
    }

    const explanation = response.explanation || '';

    if (response.results && response.results.length > 0) {
      return {
        text: explanation,
        type: 'markdown',
        technicalData: {
          ...technicalData,
          dataInsights: response.results,
          rowCount: response.results.length
        }
      };
    }

    return {
      text: explanation || response.sql || 'Query completed but no data returned',
      type: 'text',
      technicalData
    };
  };

  const updateThinking = (id, newText) => {
    setMessages(prev =>
      prev.map(msg =>
        msg.id === id && msg.type === "thinking"
          ? { ...msg, text: newText }
          : msg
      )
    );
  };

  const handleStreamingResponse = async (query, retryCount = 0) => {
    const maxRetries = 2;

    try {
      const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:3002/api/v1';

      const headers = await getAuthHeaders();
      const response = await fetch(`${API_BASE_URL}/chat/ask/stream`, {
        method: 'POST',
        headers,
        credentials: 'same-origin',
        body: JSON.stringify({ message: query, sessionId: sessionIdRef.current })
      });

      // console.log('Response status:', response.status);
      // console.log('Response headers:', response.headers);

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      let streamedContent = '';
      let initialData = null;
      let buffer = ''; // Buffer for incomplete JSON chunks

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          // Process any remaining data in buffer
          if (buffer.trim() && buffer.startsWith('data: ')) {
            const dataStr = buffer.slice(6).trim();
            if (dataStr && dataStr !== '[DONE]') {
              try {
                const data = JSON.parse(dataStr);
                if (data.type === 'start' && data.cortexData && !initialData) {
                  initialData = {
                    sql: data.cortexData.sql,
                    results: data.cortexData.results || data.cortexData.data || data.cortexData.rows,
                    explanation: data.cortexData.explanation
                  };
                }
              } catch (e) {
                // Ignore parse errors for final buffer
              }
            }
          }

          // Final check - ensure message has technical data
          if (!initialData) {
            console.warn('Stream ended without initialData, adding empty technical data');
            setMessages(prev => {
              const newMessages = [...prev];
              const lastMessage = newMessages[newMessages.length - 1];
              if (lastMessage && lastMessage.sender === 'bot' && !lastMessage.technicalData) {
                lastMessage.technicalData = { sql: null, dataInsights: null, rowCount: 0 };
              }
              return newMessages;
            });
          }
          break;
        }
        
        const chunk = decoder.decode(value);
        buffer += chunk;

        // Process complete lines from buffer
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep incomplete line in buffer

        for (const line of lines) {
          if (line.trim() && line.startsWith('data: ')) {
            const dataStr = line.slice(6).trim();
            if (dataStr === '[DONE]') {
              // Ensure final message has technical data before finishing
              setMessages(prev => {
                const newMessages = [...prev];
                const lastMessage = newMessages[newMessages.length - 1];
                if (lastMessage && lastMessage.sender === 'bot' && !lastMessage.technicalData) {
                  lastMessage.technicalData = {
                    sql: initialData?.sql || null,
                    dataInsights: initialData?.results || null,
                    rowCount: initialData?.results?.length || 0
                  };
                }
                return newMessages;
              });
              setIsProcessing(false);
              setTimeout(() => scrollToBottom(true), 200);
              return;
            }

            try {
              // Skip empty data strings
              if (!dataStr || dataStr.trim() === '') continue;

              const data = JSON.parse(dataStr);

              // Handle suggestions (ambiguous prompt)
              if (data.type === 'suggestions') {
                setMessages(prev => {
                  const newMessages = [...prev];
                  newMessages[newMessages.length - 1] = {
                    text: data.message,
                    suggestions: data.suggestions,
                    sender: 'bot',
                    type: 'suggestions',
                    timestamp: new Date()
                  };
                  return newMessages;
                });
                setIsProcessing(false);
                return;
              }

              // Handle error responses
              if (data.type === 'error' || data.success === false) {
                console.error('API Error:', data);
                setMessages(prev => {
                  const newMessages = [...prev];
                  const messageIndex = newMessages.length - 1;
                  newMessages[messageIndex] = {
                    text: 'Failed to process query. Please check your question and try again.',
                    sender: "bot",
                    type: "text",
                    timestamp: new Date()
                  };
                  return newMessages;
                });
                setIsProcessing(false);
                return;
              }

              if (data.type === 'start' && data.cortexData) {


                initialData = {
                  sql: data.cortexData.sql,
                  results: data.cortexData.results || data.cortexData.data || data.cortexData.rows,
                  explanation: data.cortexData.explanation
                };



                // Always set technical data
                const techData = {
                  sql: initialData.sql || null,
                  dataInsights: initialData.results || null,
                  rowCount: initialData.results?.length || 0
                };
                setLatestTechnicalData(techData);
              } else if (data.type === 'chunk') {
                streamedContent += data.content || '';

                setMessages(prev => {
                  const newMessages = [...prev];
                  const messageIndex = newMessages.length - 1;

                  // Show complete API content as-is with better table formatting
                  let displayText = streamedContent;

                  // Convert markdown tables to readable format without removing content
                  displayText = displayText.replace(/^\s*\|(.*)\|\s*$/gm, (match, content) => {
                    // Convert table rows to readable format
                    const cells = content.split('|').map(cell => cell.trim()).filter(cell => cell);
                    return cells.join(' | ');
                  });

                  // Remove only table separator lines (lines with just dashes and |)
                  displayText = displayText.replace(/^\s*\|[-\s\|]*\|\s*$/gm, '');

                  // Clean up excessive newlines
                  displayText = displayText.replace(/\n\s*\n\s*\n/g, '\n\n');

                  const messageData = {
                    text: displayText,
                    sender: "bot",
                    type: 'markdown',
                    timestamp: new Date()
                    // No technicalData during streaming
                  };

                  newMessages[messageIndex] = messageData;
                  return newMessages;
                });

                setTimeout(() => scrollToBottom(true), 100);
              } else if (data.type === 'complete') {

                // Add technical data only when streaming is complete
                if (initialData) {
                  setMessages(prev => {
                    const newMessages = [...prev];
                    const lastMessage = newMessages[newMessages.length - 1];
                    if (lastMessage && lastMessage.sender === 'bot') {
                      lastMessage.technicalData = {
                        sql: initialData.sql || null,
                        dataInsights: initialData.results || null,
                        rowCount: initialData.results?.length || 0
                      };
                      console.log(
                        '📊 Data Insights:',
                        lastMessage.technicalData.dataInsights
                      );
                    }
                    return newMessages;
                  });
                }
              }
            } catch (e) {
              // Only log if it's not just an incomplete JSON chunk
              if (!e.message.includes('Unterminated string') && !e.message.includes('Unexpected end')) {
                console.error('Error parsing SSE data:', e);
                console.error('Raw data that failed to parse:', dataStr);
              }
              // Continue processing other chunks instead of breaking
              continue;
            }
          }
        }
      }
    } catch (error) {
      console.error('Streaming error:', error);

      // Retry logic for connection failures
      if (retryCount < maxRetries && (error.message?.includes('terminated') || error.message?.includes('fetch'))) {
        console.log(`Retrying request (${retryCount + 1}/${maxRetries})...`);
        setTimeout(() => {
          handleStreamingResponse(query, retryCount + 1);
        }, 1000 * (retryCount + 1)); // Exponential backoff
        return;
      }

      setMessages(prev => {
        const newMessages = [...prev];
        const messageIndex = newMessages.length - 1;
        let errorMessage;

        if (error.message?.includes('terminated')) {
          errorMessage = 'Connection lost. Please check your internet connection and try again.';
        } else if (error.message?.includes('fetch')) {
          errorMessage = 'Unable to connect to the server. Please try again later.';
        } else {
          errorMessage = 'An unexpected error occurred. Please try again.';
        }

        newMessages[messageIndex] = {
          text: 'Failed to process query. Please check your question and try again.',
          sender: "bot",
          type: "text",
          timestamp: new Date()
        };
        return newMessages;
      });
      setIsProcessing(false);
    }
  };

  const getDemoResponse = (query) => {
    return "Sorry, I'm having trouble accessing the dashboard data right now. Please check your connection and try again.";
  };

  const handleQuerySelect = async (query) => {
    if (isProcessing) return;

    setIsProcessing(true);
    setMessages(prev => [
      ...prev,
      { text: query, sender: "user", type: "text", timestamp: new Date() }
    ]);

    scrollToRecentQuestion();

    setTimeout(() => {
      setMessages(prev => [
        ...prev,
        { text: "Thinking...", sender: "bot", type: "thinking", timestamp: new Date() }
      ]);
    }, 500);

    setTimeout(() => {
      setMessages(prev => {
        const newMessages = [...prev];
        const last = newMessages[newMessages.length - 1];
        if (last && last.type === 'thinking') {
          newMessages[newMessages.length - 1] = { text: "Searching...", sender: "bot", type: "thinking", timestamp: new Date() };
        }
        return newMessages;
      });
    }, 3000);

    setTimeout(() => {
      setMessages(prev => {
        const newMessages = [...prev];
        const last = newMessages[newMessages.length - 1];
        if (last && last.type === 'thinking') {
          newMessages[newMessages.length - 1] = { text: "Analyzing...", sender: "bot", type: "thinking", timestamp: new Date() };
        }
        return newMessages;
      });
    }, 6000);

    setTimeout(() => {
      setMessages(prev => {
        const newMessages = [...prev];
        const last = newMessages[newMessages.length - 1];
        if (last && last.type === 'thinking') {
          newMessages[newMessages.length - 1] = { text: "Generating result...", sender: "bot", type: "thinking", timestamp: new Date() };
        }
        return newMessages;
      });
    }, 9000);

    setTimeout(() => {
      if (!isValidCarPrompt(query)) {
        setMessages(prev => {
          const msgs = [...prev];
          msgs[msgs.length - 1] = {
            text: getFriendlyFallbackMessage(),
            sender: "bot",
            type: "markdown",
            timestamp: new Date()
          };
          return msgs;
        });
        setIsProcessing(false);
        return;
      }

      handleStreamingResponse(query);

    }, 12000);
  };


  // Called when user clicks a suggestion button from an ambiguous response
  const handleSuggestionClick = (suggestion) => {
    if (isProcessing) return;
    // Add the chosen suggestion as a user message and run it as a new query
    setIsProcessing(true);
    setMessages(prev => [
      ...prev,
      { text: suggestion, sender: 'user', type: 'text', timestamp: new Date() }
    ]);
    setTimeout(() => {
      setMessages(prev => [
        ...prev,
        { text: 'Thinking...', sender: 'bot', type: 'thinking', timestamp: new Date() }
      ]);
    }, 300);
    setTimeout(() => handleStreamingResponse(suggestion), 800);
  };

  const handleCustomQuery = async () => {
    if (customQuery.trim() && !isProcessing) {
      setIsProcessing(true);
      const userQuery = customQuery;
      setCustomQuery('');
      setMessages(prev => [
        ...prev,
        { text: userQuery, sender: "user", type: "text", timestamp: new Date() }
      ]);

      scrollToRecentQuestion();

      setTimeout(() => {
        setMessages(prev => [
          ...prev,
          { text: "Thinking...", sender: "bot", type: "thinking", timestamp: new Date() }
        ]);
      }, 500);

      setTimeout(() => {
        setMessages(prev => {
          const newMessages = [...prev];
          const last = newMessages[newMessages.length - 1];
          if (last && last.type === 'thinking') {
            newMessages[newMessages.length - 1] = { text: "Searching...", sender: "bot", type: "thinking", timestamp: new Date() };
          }
          return newMessages;
        });
      }, 3000);

      setTimeout(() => {
        setMessages(prev => {
          const newMessages = [...prev];
          const last = newMessages[newMessages.length - 1];
          if (last && last.type === 'thinking') {
            newMessages[newMessages.length - 1] = { text: "Analyzing...", sender: "bot", type: "thinking", timestamp: new Date() };
          }
          return newMessages;
        });
      }, 6000);

      setTimeout(() => {
        setMessages(prev => {
          const newMessages = [...prev];
          const last = newMessages[newMessages.length - 1];
          if (last && last.type === 'thinking') {
            newMessages[newMessages.length - 1] = { text: "Generating result...", sender: "bot", type: "thinking", timestamp: new Date() };
          }
          return newMessages;
        });
      }, 9000);

      setTimeout(() => {
        handleStreamingResponse(userQuery);
      }, 12000);
    }
  };

  const toggleMessageExpansion = (messageIndex) => {
    setExpandedMessages(prev => {
      const newSet = new Set(prev);
      if (newSet.has(messageIndex)) {
        newSet.delete(messageIndex);
      } else {
        newSet.add(messageIndex);
      }
      return newSet;
    });
  };

  const truncateText = (text, maxLength = 150) => {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength);
  };

  const resetChat = () => {
    setCurrentStep('queries');
    setSelectedDashboard('analytics');
    setCustomQuery('');
    setIsTyping(false);
    setExpandedMessages(new Set());
    setMessages([
      { text: "Hello! I'm your AI Data Assistant. I can help you analyze and retrieve insights from your data. Ask me anything!", sender: "bot", type: "text", timestamp: new Date() }
    ]);
  };

  const copyToClipboard = async (text) => {
    try {
      // Try modern clipboard API first
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        setCopySuccess(true);
        setTimeout(() => setCopySuccess(false), 2000);
      } else {
        // Fallback for older browsers or non-HTTPS
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.style.position = 'fixed';
        textArea.style.left = '-999999px';
        textArea.style.top = '-999999px';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
        setCopySuccess(true);
        setTimeout(() => setCopySuccess(false), 2000);
      }
    } catch (err) {
      console.error('Failed to copy text: ', err);
      // Still show success even if copy failed
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    }
  };
  const downloadCSV = () => {
    const data = latestTechnicalData?.dataInsights;
    if (!data || data.length === 0) return;

    const columns = Object.keys(data[0]);

    // Escape a cell value: wrap in quotes if it contains comma, quote, or newline
    const escapeCell = (val) => {
      const str = val === null || val === undefined ? '' : String(val);
      return str.includes(',') || str.includes('"') || str.includes('\n')
        ? `"${str.replace(/"/g, '""')}"`
        : str;
    };

    const header = columns.map(escapeCell).join(',');
    const rows   = data.map(row => columns.map(col => escapeCell(row[col])).join(','));
    const csv    = [header, ...rows].join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href     = url;
    link.download = 'data-insights.csv';
    link.click();
    URL.revokeObjectURL(url);
  };

  const downloadChart = (type = 'png') => {
    if (!chartRef.current) return;

    const canvas = chartRef.current.canvas;

    const mime =
      type === 'jpg' || type === 'jpeg'
        ? 'image/jpeg'
        : 'image/png';

    const url = canvas.toDataURL(mime, 1.0);

    const link = document.createElement('a');
    link.href = url;
    link.download = `chart-insights.${type}`;
    link.click();
  };

  return (
    <div className="chatbot-v2-container">
      <div
        className="chatbot-v2-header"
        style={{
          backgroundImage: `url(${dynamicHeader})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        }}
      >
        <div className="header-info">
          <h2 className="header-title">
            Navigate IQ Insights&nbsp;&nbsp;by&nbsp;
            <img
              src={dynamicLogo}
              alt={clientConfig?.name || 'Logo'}
              className="header-logo-img"
              onError={(e) => { e.currentTarget.src = demandArcLogo; }}
            />
          </h2>
        </div>
        <div className="header-controls">
          {/* {selectedDashboard && (
            <select
              value={selectedDashboard}
              onChange={(e) => {
                const dashboard = dashboards.find(d => d.id === e.target.value);
                handleDashboardSelect(dashboard);
              }}
              className="dashboard-dropdown"
            >
              {dashboards.map(dashboard => (
                <option key={dashboard.id} value={dashboard.id}>
                  {dashboard.name}
                </option>
              ))}
            </select>
          )} */}
          <button onClick={resetChat} className="reset-btn"><i className="fas fa-redo"></i></button>
        </div>
      </div>
      <div className="powered-by">
        <span>Powered by</span>
        <img
          src="https://xtsworld.com/wp-content/uploads/2025/06/XTS-new-logo-01.png"
          alt="XTS World"
        />
      </div>
      <div className="chatbot-v2-content">
        <div className="sidebar">
          <div className="sidebar-header">
            <h4>Frequently Asked Questions</h4>
          </div>

          {/*FAQ SECTION */}
          {selectedDashboard && (
            <div className="questions-section">
              <div className="questions-list">
                {dashboardQueries[selectedDashboard].map((query, index) => (
                  <button
                    key={index}
                    onClick={() => handleQuerySelect(query)}
                    className={`question-item ${isProcessing ? 'disabled' : ''}`}
                    disabled={isProcessing}
                  >
                    {query}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* PROMPT HISTORY SECTION — per-user, fetched from DynamoDB */}
          {selectedDashboard && (
            <div className="chat-history-section">
              <div className="sidebar-header">
                <h4>Prompt history</h4>
              </div>

              <div className="questions-list">
                {promptHistory.length > 0 ? (
                  promptHistory.map((query, index) => (
                    <button
                      key={`history-${index}`}
                      onClick={() => handleQuerySelect(query)}
                      className={`question-item history ${isProcessing ? 'disabled' : ''}`}
                      disabled={isProcessing}
                      title={query}
                    >
                      {query}
                    </button>
                  ))
                ) : (
                  <p className="chat-history-empty">No prompt history yet.</p>
                )}
              </div>
            </div>
          )}

          {selectedDashboard && (
            <div className="custom-input-section">
              <div className="input-group">
                <textarea
                  value={customQuery}
                  onChange={(e) => setCustomQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleCustomQuery();
                    }
                  }}
                  placeholder={isProcessing ? "Processing..." : "Type your question here..."}
                  className={`custom-textarea ${isProcessing ? 'disabled' : ''}`}
                  disabled={isProcessing}
                  rows="3"
                />
                <button
                  onClick={handleCustomQuery}
                  className={`ask-btn ${isProcessing ? 'disabled' : ''}`}
                  disabled={isProcessing}
                >
                  Ask Question
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="main-area">
          <div className="messages-container" ref={messagesContainerRef}>
            {messages.map((message, index) => (
              <div key={index} className={`message-v2 ${message.sender}`}>
                <div className="message-avatar">
                  {message.sender === 'bot' ? (
                    <div className="bot-avatar"><i className="fas fa-robot"></i></div>
                  ) : (
                    <div className="user-avatar"><i className="fas fa-user-circle"></i></div>
                  )}
                </div>
                <div className="message-content">
                  <div className={`message-bubble ${message.type === 'thinking' ? 'thinking' : ''} ${message.technicalData?.dataInsights ? 'has-data-table' : ''}`}>
                    {message.type === 'thinking' ? (
                      <>
                        {message.text}
                        <div className="thinking-dots">
                          <span></span><span></span><span></span>
                        </div>
                      </>
                    ) : message.type === 'suggestions' ? (
                      <div className="suggestions-container">
                        <p className="suggestions-intro">{message.text}</p>
                        <div className="suggestions-list">
                          {(message.suggestions || []).map((s, i) => (
                            <button
                              key={i}
                              className={`suggestion-btn ${isProcessing ? 'disabled' : ''}`}
                              onClick={() => handleSuggestionClick(s)}
                              disabled={isProcessing}
                            >
                              {s}
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : message.type === 'markdown' ? (
                      <>
                        <MarkdownRenderer content={message.text} data={message.technicalData?.dataInsights} />

                        {message.sender === 'bot' && message.technicalData?.dataInsights && (() => {
                          const insights = message.technicalData.dataInsights;
                          // Grab the user query that preceded this bot message (index - 1)
                          const userQuery = messages[index - 1]?.text || '';
                          if (shouldShowTimeline(insights, userQuery)) {
                            return (
                              <div className="chat-chart-wrapper">
                                <TimelineChart data={insights} />
                              </div>
                            );
                          }
                          if (shouldShowPieChart(insights)) {
                            return (
                              <div className="chat-chart-wrapper">
                                <DataInsightsPieChart data={insights} />
                              </div>
                            );
                          }
                          return null;
                        })()}
                      </>
                    )
                     : message.sender === 'bot' && message.text.length > 150 && !expandedMessages.has(index) ? (

                      <div style={{whiteSpace: 'pre-line'}}>
                        {truncateText(message.text)}
                        <button
                          className="expand-btn"
                          onClick={() => toggleMessageExpansion(index)}
                          style={{display: 'inline', marginLeft: '0'}}
                        >
                          ...more
                        </button>
                      </div>
                    ) : (
                      <>
                        <div style={{whiteSpace: 'pre-line'}}>{message.text}</div>
                        {message.sender === 'bot' && message.text.length > 150 && expandedMessages.has(index) && (
                          <button
                            className="expand-btn"
                            onClick={() => toggleMessageExpansion(index)}
                          >
                            show less
                          </button>
                        )}
                      </>
                    )}
                    {message.technicalData && message.sender === 'bot' && (
                      <button
                        className="tech-insights-inline-btn"
                        onClick={() => {
                          setLatestTechnicalData(message.technicalData);
                          // Grab the user query that preceded this bot message
                          setLatestQuery(messages[index - 1]?.text || '');
                          setActiveTab('sql'); // Always start with SQL tab
                          setShowTechnicalInsights(true);
                        }}
                      >
                        Technical Insights
                      </button>
                    )}
                  </div>
                  <div className="message-timestamp">
                    {message.timestamp ? new Date(message.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : ''}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {showTechnicalInsights && (
        <div className="modal-overlay" onClick={() => setShowTechnicalInsights(false)}>
          <div className="technical-modal" onClick={(e) => e.stopPropagation()}>
          <div className="modal-header">
  <div className="modal-title">
    <i className="fas fa-database"></i> Technical Insights
  </div>

  <div className="modal-header-actions">
    {activeTab === 'chart' && (
      <>
        <button
          className="chart-download-btn"
          onClick={() => downloadChart('png')}
        >
          PNG
        </button>
        <button
          className="chart-download-btn"
          onClick={() => downloadChart('jpg')}
        >
          JPG
        </button>
      </>
    )}

    <button
      className="close-modal-btn"
      onClick={() => setShowTechnicalInsights(false)}
    >
      <i className="fas fa-times"></i>
    </button>
  </div>
</div>

            <div className="modal-tabs">
              <button
                className={`tab-btn ${activeTab === 'sql' ? 'active' : ''}`}
                onClick={() => setActiveTab('sql')}
              >
                SQL Query
              </button>
              <button
                className={`tab-btn ${activeTab === 'data' ? 'active' : ''}`}
                onClick={() => setActiveTab('data')}
              >
                Data Insights
              </button>
              <button
                className={`tab-btn ${activeTab === 'chart' ? 'active' : ''}`}
                onClick={() => setActiveTab('chart')}
              >
                Chart Insights
              </button>

            </div>
            <div className="modal-content">
              {latestTechnicalData ? (
                <div className="tab-content">
                  {activeTab === 'sql' && (
                    <div className="sql-tab">
                      {latestTechnicalData.sql ? (
                        <div className="sql-section">
                          <div className="sql-header">
                            <span className="sql-label">SQL Query</span>
                            <button
                              className="copy-btn"
                              onClick={() => copyToClipboard(latestTechnicalData.sql)}
                              title="Copy SQL query"
                            >
                              {copySuccess ? (
                                <><i className="fas fa-check"></i> Copied!</>
                              ) : (
                                <><i className="fas fa-copy"></i> Copy</>
                              )}
                            </button>
                          </div>
                          <pre className="sql-code">{latestTechnicalData.sql}</pre>
                        </div>
                      ) : (
                        <div className="no-sql-message">
                          <p><i className="fas fa-info-circle"></i> No SQL query was generated for this response.</p>
                          <p className="hint">This might be a general response or the query didn't require database access.</p>
                        </div>
                      )}
                      <div className="tech-metrics">
                        {latestTechnicalData.executionTime && (
                          <div className="tech-metric">
                            <strong>Execution Time:</strong>
                            <span>{latestTechnicalData.executionTime}</span>
                          </div>
                        )}

                        {latestTechnicalData.database && (
                          <div className="tech-metric">
                            <strong>Database:</strong>
                            <span>{latestTechnicalData.database}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                  {activeTab === 'data' && (
                    <div className="data-tab">
                      {latestTechnicalData.dataInsights && Array.isArray(latestTechnicalData.dataInsights) && latestTechnicalData.dataInsights.length > 0 ? (
                        <div className="data-table-container">
                          <div className="data-summary">
                            <span className="row-count">{latestTechnicalData.dataInsights.length} rows</span> returned
                            <button className="csv-download-btn" onClick={downloadCSV} title="Download as CSV">
                              <i className="fas fa-download"></i> Download CSV
                            </button>
                          </div>
                          <table className="insights-table">
                            <thead>
                              <tr>
                                {Object.keys(latestTechnicalData.dataInsights[0]).map(key => (
                                  <th key={key}>{key}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {latestTechnicalData.dataInsights.map((row, idx) => (
                                <tr key={idx}>
                                  {Object.values(row).map((value, valueIdx) => (
                                    <td key={valueIdx}>{value}</td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <div className="no-data-message">
                          <p><i className="fas fa-info-circle"></i> No data results available for this query.</p>
                          <p className="hint">The query may not have returned data or was a non-data operation.</p>
                        </div>
                      )}
                    </div>
                  )}
                  {activeTab === 'chart' && (
        <div className="chart-tab">
          {latestTechnicalData?.dataInsights &&
          Array.isArray(latestTechnicalData.dataInsights) &&
          latestTechnicalData.dataInsights.length > 0 ? (
            <div className="chart-container chart-large">
              {shouldShowTimeline(latestTechnicalData.dataInsights, latestQuery) ? (
                <TimelineChart data={latestTechnicalData.dataInsights} />
              ) : (
                <DataInsightsPieChart
                  ref={chartRef}
                  data={latestTechnicalData.dataInsights}
                />
              )}
            </div>
          ) : (
            <div className="no-data-message">
              <p>
                <i className="fas fa-info-circle"></i>{' '}
                No chartable data available for this query.
              </p>
            </div>
          )}
        </div>
      )}
                </div>
              ) : (
                <div className="no-data">
                  <p>Ask a question to see technical insights here.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Chatbot;

