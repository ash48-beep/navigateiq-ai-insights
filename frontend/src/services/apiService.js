import { getAuthHeaders, getAuthHeadersGet } from '../utils/authHeaders';

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:3002/api/v1';

class ApiService {
  async fetchDashboardData(dashboardId) {
    const headers  = await getAuthHeadersGet();
    const response = await fetch(`${API_BASE_URL}/dashboard/${dashboardId}`, { headers });
    return response.json();
  }

  async queryDashboard(dashboardId, query) {
    const headers  = await getAuthHeaders();
    const response = await fetch(`${API_BASE_URL}/dashboard/${dashboardId}/query`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ query }),
    });
    return response.json();
  }

  async getChatResponse(message, context) {
    try {
      console.log('Making API call to:', `${API_BASE_URL}/chat/ask`);
      const headers  = await getAuthHeaders();
      const response = await fetch(`${API_BASE_URL}/chat/ask`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ message }),
      });

      if (!response.ok) {
        console.error('API Response Error:', response.status, response.statusText);
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      console.log('API Response:', data);
      return data;
    } catch (error) {
      console.error('API Call Error:', error);
      throw error;
    }
  }
}

export default new ApiService();
