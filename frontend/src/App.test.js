/**
 * App smoke test.
 *
 * The Chatbot component imports react-markdown (pure ESM) which Jest in CRA
 * cannot transform without ejecting or complex babel config.
 * We mock the heavy component so App.test.js stays fast and stable.
 */
import { render } from '@testing-library/react';

// Mock Chatbot so Jest never needs to load react-markdown / remark-gfm
jest.mock('./components/Chatbot', () => () => <div data-testid="chatbot-mock" />);

import App from './App';

test('App renders without crashing', () => {
  const { container } = render(<App />);
  expect(container).toBeTruthy();
});
