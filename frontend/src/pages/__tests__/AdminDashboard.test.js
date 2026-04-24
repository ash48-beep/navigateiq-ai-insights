
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { fetchAuthSession, signOut } from 'aws-amplify/auth';
import AdminDashboard from '../AdminDashboard';

jest.mock('aws-amplify/auth');
jest.mock('../AdminDashboard.css', () => ({}), { virtual: true });

const mockSession = {
  tokens: { accessToken: { toString: () => 'test-token' } },
};

const mockClients = [
  {
    clientSlug: 'alpha',
    name: 'Alpha',
    url: 'https://alpha.example.com',
    status: 'active',
    createdAt: '2026-01-15T10:00:00.000Z',
    primaryColor: '#2A598F',
    primaryColorLight: '#6895BF',
    accentColor: '#4e9af1',
    bgFrom: '#0f1419',
    bgTo: '#1a1d29',
    logoUrl: '',
    headerImageUrl: '',
    faviconUrl: '',
    cognitoUserPoolId: 'us-east-1_abc',
    cognitoClientId: 'client123',
    cognitoRegion: 'us-east-1',
  },
  {
    clientSlug: 'beta',
    name: 'Beta',
    url: 'https://beta.example.com',
    status: 'inactive',
    createdAt: '2026-01-10T10:00:00.000Z',
    primaryColor: '#cc0000',
    primaryColorLight: '#ff4444',
    accentColor: '#ffaa00',
    bgFrom: '#111',
    bgTo: '#222',
    logoUrl: 'https://s3.example.com/logo.png',
    headerImageUrl: '',
    faviconUrl: '',
    cognitoUserPoolId: 'us-east-1_xyz',
    cognitoClientId: 'client456',
    cognitoRegion: 'us-east-1',
  },
];

beforeEach(() => {
  fetchAuthSession.mockResolvedValue(mockSession);
  global.fetch = jest.fn();
  delete window.location;
  window.location = { reload: jest.fn() };
});

afterEach(() => {
  jest.clearAllMocks();
});

function setupFetch(clients = mockClients) {
  global.fetch.mockImplementation((_url, opts) => {
    if (!opts?.method || opts.method === 'GET') {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(clients) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true }) });
  });
}

describe('AdminDashboard — loading and rendering', () => {
  it('shows loading spinner then renders clients table', async () => {
    setupFetch();
    render(<AdminDashboard />);

    expect(screen.getByText(/Loading clients/i)).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('Alpha')).toBeInTheDocument();
    });
    expect(screen.getByText('Beta')).toBeInTheDocument();
  });

  it('shows "No clients yet" when list is empty', async () => {
    setupFetch([]);
    render(<AdminDashboard />);

    await waitFor(() => {
      expect(screen.getByText(/No clients yet/i)).toBeInTheDocument();
    });
  });

  it('shows "Add First Client" button when list is empty', async () => {
    setupFetch([]);
    render(<AdminDashboard />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Add First Client/i })).toBeInTheDocument();
    });
  });
});

describe('AdminDashboard — stat cards', () => {
  it('renders stat card labels', async () => {
    setupFetch();
    render(<AdminDashboard />);

    await waitFor(() => screen.getByText('Alpha'));

    expect(screen.getByText('Total Clients')).toBeInTheDocument();
    expect(screen.getAllByText('Active').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Inactive').length).toBeGreaterThan(0);
    expect(screen.getByText('With Logo')).toBeInTheDocument();
  });
});

describe('AdminDashboard — search and filter', () => {
  it('filters clients by search query', async () => {
    setupFetch();
    render(<AdminDashboard />);

    await waitFor(() => screen.getByText('Alpha'));

    fireEvent.change(screen.getByPlaceholderText(/Search by name, slug or URL/i), {
      target: { value: 'alpha' },
    });

    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.queryByText('Beta')).not.toBeInTheDocument();
  });

  it('filters clients by inactive status pill', async () => {
    setupFetch();
    render(<AdminDashboard />);

    await waitFor(() => screen.getByText('Alpha'));

    const inactiveBtn = screen.getByRole('button', { name: 'Inactive' });
    fireEvent.click(inactiveBtn);

    expect(screen.queryByText('Alpha')).not.toBeInTheDocument();
    expect(screen.getByText('Beta')).toBeInTheDocument();
  });

  it('shows "No matches" when search has no results', async () => {
    setupFetch();
    render(<AdminDashboard />);

    await waitFor(() => screen.getByText('Alpha'));

    fireEvent.change(screen.getByPlaceholderText(/Search by name, slug or URL/i), {
      target: { value: 'zzznomatch' },
    });

    expect(screen.getByText(/No matches/i)).toBeInTheDocument();
  });
});

describe('AdminDashboard — add client form', () => {
  it('opens add form modal when "+ Add Client" is clicked', async () => {
    setupFetch();
    render(<AdminDashboard />);

    await waitFor(() => screen.getByText('Alpha'));

    fireEvent.click(screen.getByRole('button', { name: /\+ Add Client/i }));

    expect(screen.getByText('Add a new tenant')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Create Client/i })).toBeInTheDocument();
  });

  it('shows validation error when required fields are empty', async () => {
    setupFetch();
    render(<AdminDashboard />);

    await waitFor(() => screen.getByText('Alpha'));

    fireEvent.click(screen.getByRole('button', { name: /\+ Add Client/i }));
    fireEvent.click(screen.getByRole('button', { name: /Create Client/i }));

    expect(screen.getByText(/Slug, name and URL are required/i)).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalledWith(
      expect.stringContaining('/admin/clients'),
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('closes form when Cancel is clicked', async () => {
    setupFetch();
    render(<AdminDashboard />);

    await waitFor(() => screen.getByText('Alpha'));

    fireEvent.click(screen.getByRole('button', { name: /\+ Add Client/i }));
    expect(screen.getByText('Add a new tenant')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Cancel/i }));
    expect(screen.queryByText('Add a new tenant')).not.toBeInTheDocument();
  });

  it('calls POST API and reloads list on successful create', async () => {
    const newClient = { ...mockClients[0], clientSlug: 'gamma', name: 'Gamma', url: 'https://gamma.com' };
    global.fetch.mockImplementation((_url, opts) => {
      if (opts?.method === 'POST') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(newClient) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve([...mockClients, newClient]) });
    });

    render(<AdminDashboard />);
    await waitFor(() => screen.getByText('Alpha'));

    fireEvent.click(screen.getByRole('button', { name: /\+ Add Client/i }));

    fireEvent.change(screen.getByPlaceholderText('demandARC'), { target: { value: 'gamma' } });
    fireEvent.change(screen.getByPlaceholderText('DemandARC'), { target: { value: 'Gamma' } });
    fireEvent.change(screen.getByPlaceholderText(/https:\/\/navigateiq/i), { target: { value: 'https://gamma.com' } });

    fireEvent.click(screen.getByRole('button', { name: /Create Client/i }));

    await waitFor(() => {
      const postCalls = global.fetch.mock.calls.filter(c => c[1]?.method === 'POST');
      expect(postCalls.length).toBeGreaterThan(0);
    });
  });

  it('shows API error message on failed create', async () => {
    global.fetch.mockImplementation((_url, opts) => {
      if (opts?.method === 'POST') {
        return Promise.resolve({
          ok: false,
          status: 409,
          json: () => Promise.resolve({ message: 'Slug already exists' }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve(mockClients) });
    });

    render(<AdminDashboard />);
    await waitFor(() => screen.getByText('Alpha'));

    fireEvent.click(screen.getByRole('button', { name: /\+ Add Client/i }));
    fireEvent.change(screen.getByPlaceholderText('demandARC'), { target: { value: 'alpha' } });
    fireEvent.change(screen.getByPlaceholderText('DemandARC'), { target: { value: 'Alpha' } });
    fireEvent.change(screen.getByPlaceholderText(/https:\/\/navigateiq/i), { target: { value: 'https://alpha.com' } });
    fireEvent.click(screen.getByRole('button', { name: /Create Client/i }));

    await waitFor(() => {
      expect(screen.getByText(/Slug already exists/i)).toBeInTheDocument();
    });
  });
});

describe('AdminDashboard — edit client', () => {
  it('opens edit form with existing client data', async () => {
    setupFetch();
    render(<AdminDashboard />);

    await waitFor(() => screen.getByText('Alpha'));

    fireEvent.click(screen.getAllByTitle('Edit')[0]);

    expect(screen.getByText('Edit Client')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Save Changes/i })).toBeInTheDocument();
  });

  it('calls PATCH API on save', async () => {
    global.fetch.mockImplementation((_url, opts) => {
      if (opts?.method === 'PATCH') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true }) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve(mockClients) });
    });

    render(<AdminDashboard />);
    await waitFor(() => screen.getByText('Alpha'));

    fireEvent.click(screen.getAllByTitle('Edit')[0]);
    fireEvent.click(screen.getByRole('button', { name: /Save Changes/i }));

    await waitFor(() => {
      const patchCalls = global.fetch.mock.calls.filter(c => c[1]?.method === 'PATCH');
      expect(patchCalls.length).toBeGreaterThan(0);
    });
  });
});

describe('AdminDashboard — delete client', () => {
  it('shows delete confirmation modal when delete icon clicked', async () => {
    setupFetch();
    render(<AdminDashboard />);

    await waitFor(() => screen.getByText('Alpha'));

    fireEvent.click(screen.getAllByTitle('Delete')[0]);
    expect(screen.getByText(/Delete client\?/i)).toBeInTheDocument();
    expect(screen.getByText(/This will permanently remove/i)).toBeInTheDocument();
  });

  it('calls DELETE API on confirm', async () => {
    global.fetch.mockImplementation((_url, opts) => {
      if (opts?.method === 'DELETE') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true }) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve(mockClients) });
    });

    render(<AdminDashboard />);
    await waitFor(() => screen.getByText('Alpha'));

    fireEvent.click(screen.getAllByTitle('Delete')[0]);
    fireEvent.click(screen.getByRole('button', { name: /Yes, delete/i }));

    await waitFor(() => {
      const deleteCalls = global.fetch.mock.calls.filter(c => c[1]?.method === 'DELETE');
      expect(deleteCalls.length).toBeGreaterThan(0);
    });
  });

  it('dismisses delete modal on Cancel', async () => {
    setupFetch();
    render(<AdminDashboard />);

    await waitFor(() => screen.getByText('Alpha'));

    fireEvent.click(screen.getAllByTitle('Delete')[0]);
    expect(screen.getByText(/Delete client\?/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^Cancel$/i }));
    expect(screen.queryByText(/Delete client\?/i)).not.toBeInTheDocument();
  });
});

describe('AdminDashboard — sign out', () => {
  it('calls signOut and reloads page', async () => {
    setupFetch();
    signOut.mockResolvedValue(undefined);
    render(<AdminDashboard />);

    await waitFor(() => screen.getByText('Alpha'));

    fireEvent.click(screen.getByRole('button', { name: /Sign out/i }));

    await waitFor(() => {
      expect(signOut).toHaveBeenCalled();
      expect(window.location.reload).toHaveBeenCalled();
    });
  });
});
