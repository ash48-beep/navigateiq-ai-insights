import MarkdownRenderer from './MarkdownRenderer';

const ChatMessage = ({ message, isBot }) => {
  const renderContent = () => {
    // If the message is a JSON response with markdown
    if (typeof message === 'string' && message.startsWith('{')) {
      try {
        const parsed = JSON.parse(message);
        if (parsed.success && parsed.markdown) {
          return <MarkdownRenderer content={parsed.markdown} />;
        }
      } catch (error) {
        console.error('Failed to parse JSON message:', error);
      }
    }
    
    // Regular text message
    return <div className="text-content">{message}</div>;
  };

  return (
    <div className={`chat-message ${isBot ? 'bot-message' : 'user-message'}`}>
      {renderContent()}
    </div>
  );
};

export default ChatMessage;