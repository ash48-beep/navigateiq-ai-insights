# Navigate IQ Insights — Chatbot Frontend

## Project Overview

Navigate IQ Insights is a React-based AI chatbot that lets users ask natural-language questions about their Snowflake data. Questions are processed by **Snowflake Cortex Analyst**, which generates and executes SQL automatically. The results are then enhanced by **OpenAI GPT-4o-mini** into CXO-ready markdown narratives, complete with data tables, pie charts, and timeline visualisations rendered directly in the chat.

The frontend communicates with a **NestJS REST/SSE API** (backend) over HTTP. Responses are streamed token-by-token via Server-Sent Events so the answer appears progressively, like a live typing effect.

---

## Architecture

```
Browser (React)
  └─► NestJS API  (port 3002)
        ├─► Snowflake Cortex Analyst  — translates NL query → SQL → executes it
        └─► OpenAI GPT-4o-mini        — enhances raw results → markdown narrative
```

---

## Features

| Feature | Description |
|---|---|
| Natural-language querying | Ask anything in plain English; Cortex Analyst writes the SQL |
| Streaming responses | Answers stream token-by-token via SSE |
| Pie chart auto-detection | A `INDUSTRY`/`COUNT`-style result set automatically renders as an interactive pie chart |
| Timeline auto-detection | A date + metric result set renders as a line/bar timeline chart |
| Paginated data table | All result rows are displayed in a client-side paginated table |
| Technical insights modal | Users can expand a panel to see the SQL query that was run |
| Chat history sidebar | Recent queries are stored server-side and shown per session |
| FAQ / suggested questions | Curated questions appear in the sidebar; the AI also surfaces clarifying suggestions when a question is ambiguous |
| Responsive layout | Optimised for mobile (≤480 px), small tablet (481–768 px), laptop (769–1439 px), and desktop (≥1440 px) |

---

## File Structure

```
frontend/
├── public/
│   └── index.html
├── src/
│   ├── components/
│   │   ├── Chatbot.js                 # Main chat UI — handles state, SSE streaming, chart detection
│   │   ├── Chatbot_v2.css             # All styles (base + media queries)
│   │   ├── ChatMessage.jsx            # Single message bubble (user / assistant)
│   │   ├── DataInsightsPieChart.jsx   # Chart.js pie chart wrapper
│   │   ├── MarkdownRenderer.jsx       # react-markdown + remark-gfm renderer
│   │   ├── PaginatedDataTable.jsx     # Client-side paginated result table
│   │   ├── TimelineChart.jsx          # Chart.js timeline (line/bar) + detectDateKey helper
│   │   └── __tests__/
│   │       └── TimelineChart.test.js  # Unit tests for detectDateKey (16 tests)
│   ├── services/
│   │   └── apiService.js              # Fetch wrappers for the NestJS backend
│   ├── utils/
│   │   ├── chartHelpers.js            # Pure functions: shouldShowPieChart, shouldShowTimeline
│   │   └── __tests__/
│   │       └── chartHelpers.test.js   # Unit tests for chart helpers (27 tests)
│   ├── App.js
│   ├── App.test.js                    # Smoke test (mocks Chatbot to avoid ESM issues)
│   ├── index.js
│   └── setupTests.js
├── package.json
└── CHATBOT_README.md
```

---

## Getting Started

### Prerequisites

- Node.js 18+
- The NestJS backend running on port 3002 (see `../backend/README.md`)

### Install dependencies

```bash
cd frontend
npm install
```

### Environment variables

Create a `.env` file in `frontend/` (or set these in your shell / CI):

| Variable | Default | Description |
|---|---|---|
| `REACT_APP_API_URL` | `http://localhost:3002/api/v1` | Base URL of the NestJS API |

### Start development server

```bash
npm start
```

Open `http://localhost:3000` in your browser.

### Production build

```bash
npm run build
```

The optimised static files are written to `frontend/build/`.

---

## How It Works

### 1. Session initialisation

When the user first opens the chatbot, the frontend sends `GET /chat/top-queries` to load the most recent queries for the chat history sidebar. A UUID session ID is generated client-side and sent with every subsequent request so the backend can maintain per-session conversation context.

### 2. Sending a message

The user types a question and presses Enter or clicks Send. The frontend calls `POST /chat/stream` with `{ message, sessionId }` and opens an SSE connection.

### 3. Streaming pipeline

The backend:
1. Fetches conversation history for the session
2. Sends the question (plus history) to Snowflake Cortex Analyst
3. Cortex generates SQL, executes it, and returns rows + an explanation text
4. If Cortex returns `suggestions` (ambiguous prompt), those are streamed back immediately — no GPT call
5. Otherwise, the rows + explanation are sent to OpenAI which streams a GPT-4o-mini markdown response token-by-token

The frontend accumulates the streamed tokens and renders them progressively using `MarkdownRenderer`.

### 4. Chart detection

After the stream completes, the frontend inspects `cortexData.results`:

- **Pie chart** (`shouldShowPieChart`): result has exactly 2 columns — one string (category) and one number (value). Renders `DataInsightsPieChart`.
- **Timeline** (`shouldShowTimeline`): result has a date column + at least one numeric column, or the query contains keywords like "trend", "over time", "timeline". Renders `TimelineChart`.
- **Data table**: always rendered for non-empty results via `PaginatedDataTable`.

### 5. Technical insights

The SQL generated by Cortex Analyst is returned in `technical_insights`. Users can click the info icon on any assistant message to open a modal showing the SQL.

---

## API Endpoints (Backend)

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v1/chat/ask` | Single-shot (non-streaming) chat request |
| `POST` | `/api/v1/chat/stream` | SSE streaming chat request |
| `GET` | `/api/v1/chat/top-queries` | Returns up to 10 recent unique queries |

---

## Running Tests

```bash
npm test
```

Jest runs in watch mode by default. To run once:

```bash
npm test -- --watchAll=false
```

### Test coverage summary

| File | Tests | Coverage |
|---|---|---|
| `utils/chartHelpers.js` | 27 | `shouldShowPieChart`, `shouldShowTimeline`, keyword regex |
| `components/TimelineChart.jsx` | 16 | `detectDateKey` — key-name heuristics + value-based detection |
| `App.js` | 1 | Smoke test (renders without crashing) |
| `services/apiService.js` | 12 | Fetch calls, HTTP errors, network failures |

### ESM note

`react-markdown` v10 and `remark-gfm` v4 are pure ESM packages. CRA's Jest runs in CommonJS mode. The `Chatbot` component is mocked in `App.test.js` to avoid pulling in the ESM chain. The `transformIgnorePatterns` list in `package.json` allows Jest to transform those packages for tests that do import them directly.

---

## Key Dependencies

| Package | Purpose |
|---|---|
| `react-markdown` | Render GPT markdown responses |
| `remark-gfm` | GFM tables, strikethrough, task lists |
| `chart.js` + `react-chartjs-2` | Pie charts and timeline charts |
| `chartjs-plugin-datalabels` | Percentage labels on pie slices |
| `@testing-library/react` | Component render tests |

---

## Environment — Backend `.env` Reference

The backend expects these variables (see `backend/` for full details):

```
PORT=3002
SNOWFLAKE_ACCOUNT=
SNOWFLAKE_USER=
SNOWFLAKE_ROLE=
SNOWFLAKE_WAREHOUSE=
SNOWFLAKE_DATABASE=
SNOWFLAKE_SCHEMA=
SNOWFLAKE_STAGE=
SNOWFLAKE_MODEL=
SNOWFLAKE_PRIVATE_KEY=        # PEM string, or use SNOWFLAKE_PRIVATE_KEY_PATH
SNOWFLAKE_PRIVATE_KEY_PATH=   # Path to .p8 file
SNOWFLAKE_PRIVATE_KEY_PASSPHRASE=
OPENAI_API_KEY=
```
