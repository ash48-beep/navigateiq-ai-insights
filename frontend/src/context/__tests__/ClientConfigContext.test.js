import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { ClientConfigProvider, useClientConfig } from '../ClientConfigContext';
import { Amplify } from 'aws-amplify';

jest.mock('aws-amplify');

const mockConfigResponse = {
  name: 'Alpha',
  cognito: {
    userPoolId: 'us-east-1_abc',
    clientId: 'client123',
    region: 'us-east-1',
  },
  theme: {
    primaryColor: '#2A598F',
    primaryColorLight: '#6895BF',
    bgFrom: '#0f1419',
    bgTo: '#1a1d29',
    accentColor: '#4e9af1',
    logoUrl: 'https://s3.example.com/logo.png',
    headerImageUrl: 'https://s3.example.com/header.png',
    faviconUrl: 'https://s3.example.com/favicon.ico',
  },
};

function ConfigConsumer() {
  const config = useClientConfig();
  if (!config) return null;
  return (
    <div>
      <span data-testid="name">{config.name}</span>
      <span data-testid="pool">{config.cognito?.userPoolId}</span>
      <span data-testid="logo">{config.theme?.logoUrl}</span>
    </div>
  );
}

beforeEach(() => {
  global.fetch = jest.fn();
  jest.spyOn(document.documentElement.style, 'setProperty').mockImplementation(() => {});
  Amplify.configure.mockClear();
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

describe('ClientConfigProvider', () => {
  it('shows loading spinner while fetching', () => {
    global.fetch.mockReturnValue(new Promise(() => {}));
    render(
      <ClientConfigProvider slug="alpha">
        <div>Content</div>
      </ClientConfigProvider>,
    );
    expect(screen.queryByText('Content')).not.toBeInTheDocument();
  });

  it('shows error when slug is missing', async () => {
    render(
      <ClientConfigProvider slug="">
        <div>Content</div>
      </ClientConfigProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText(/No client slug provided/i)).toBeInTheDocument();
    });
  });

  it('shows error when fetch returns non-ok response', async () => {
    global.fetch.mockResolvedValue({ ok: false });
    render(
      <ClientConfigProvider slug="unknown">
        <div>Content</div>
      </ClientConfigProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText(/unknown.*not found/i)).toBeInTheDocument();
    });
  });

  it('shows error when fetch throws', async () => {
    global.fetch.mockRejectedValue(new Error('Network error'));
    render(
      <ClientConfigProvider slug="alpha">
        <div>Content</div>
      </ClientConfigProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText(/Network error/i)).toBeInTheDocument();
    });
  });

  it('renders children and exposes config via context on success', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockConfigResponse),
    });

    render(
      <ClientConfigProvider slug="alpha">
        <ConfigConsumer />
      </ClientConfigProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('name').textContent).toBe('Alpha');
    });
    expect(screen.getByTestId('pool').textContent).toBe('us-east-1_abc');
  });

  it('configures Amplify with the fetched Cognito settings', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockConfigResponse),
    });

    render(
      <ClientConfigProvider slug="alpha">
        <div>ok</div>
      </ClientConfigProvider>,
    );

    await waitFor(() => screen.getByText('ok'));

    expect(Amplify.configure).toHaveBeenCalledWith(
      expect.objectContaining({
        Auth: expect.objectContaining({
          Cognito: expect.objectContaining({
            userPoolId: 'us-east-1_abc',
            userPoolClientId: 'client123',
          }),
        }),
      }),
    );
  });

  it('sets CSS custom properties for theme colors', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockConfigResponse),
    });

    render(
      <ClientConfigProvider slug="alpha">
        <div>ok</div>
      </ClientConfigProvider>,
    );

    await waitFor(() => screen.getByText('ok'));

    expect(document.documentElement.style.setProperty).toHaveBeenCalledWith('--primary', '#2A598F');
    expect(document.documentElement.style.setProperty).toHaveBeenCalledWith('--primary-light', '#6895BF');
    expect(document.documentElement.style.setProperty).toHaveBeenCalledWith('--accent', '#4e9af1');
  });

  it('appends cache-bust query param to S3 image URLs', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockConfigResponse),
    });

    render(
      <ClientConfigProvider slug="alpha">
        <ConfigConsumer />
      </ClientConfigProvider>,
    );

    await waitFor(() => screen.getByTestId('logo'));

    const logoUrl = screen.getByTestId('logo').textContent;
    expect(logoUrl).toMatch(/^https:\/\/s3\.example\.com\/logo\.png\?v=\d+$/);
  });

  it('sets document.title from client name', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockConfigResponse),
    });

    render(
      <ClientConfigProvider slug="alpha">
        <div>ok</div>
      </ClientConfigProvider>,
    );

    await waitFor(() => screen.getByText('ok'));
    expect(document.title).toBe('Alpha');
  });

  it('fetches config from the correct URL', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockConfigResponse),
    });

    render(
      <ClientConfigProvider slug="alpha">
        <div>ok</div>
      </ClientConfigProvider>,
    );

    await waitFor(() => screen.getByText('ok'));

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/client-config/alpha'),
    );
  });
});
