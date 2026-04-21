import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import PaginatedDataTable from './PaginatedDataTable';
import '../styles/markdown.css';

const PLACEHOLDER = '{{DATA_TABLE}}';

// Matches any partial or full occurrence of {{DATA_TABLE}} as it streams in
// e.g. {{, {{D, {{DATA_TAB, {{DATA_TABLE}, {{DATA_TABLE}}
const PARTIAL_RE = /\{\{[^}]*\}*/g;

const MarkdownRenderer = ({ content, data }) => {
  if (!content) return null;

  // Once the full placeholder is present AND we have data — split and inject table
  if (content.includes(PLACEHOLDER) && data?.length) {
    const parts = content.split(PLACEHOLDER);
    return (
      <div className="markdown-content">
        {parts.map((part, index) => (
          <span key={index}>
            {part && (
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{part}</ReactMarkdown>
            )}
            {index < parts.length - 1 && (
              <PaginatedDataTable data={data} />
            )}
          </span>
        ))}
      </div>
    );
  }

  // During streaming the placeholder builds up character by character —
  // strip any partial match so {{DATA_TAB... never appears as visible text
  const cleanContent = content.replace(PARTIAL_RE, '');

  return (
    <div className="markdown-content">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{cleanContent}</ReactMarkdown>
    </div>
  );
};

export default MarkdownRenderer;
