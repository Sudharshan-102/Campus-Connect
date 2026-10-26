// Thin fetch wrapper. The acting student ("demo identity") lives in sessionStorage,
// so two browser tabs can act as two different students at the same time.
const KEY = 'cc-demo-user';

export const getIdentity = () => {
  try { return sessionStorage.getItem(KEY) || ''; } catch { return ''; }
};
export const setIdentity = (id) => {
  try { id ? sessionStorage.setItem(KEY, id) : sessionStorage.removeItem(KEY); } catch { /* ignore */ }
};

export class ApiError extends Error {
  constructor(message, code, status) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

async function request(method, path, { body, headers } = {}) {
  const who = getIdentity();
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(who ? { 'X-Demo-User': who } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError('Cannot reach the Campus Connect API. Is the server running on port 4000?', 'E_NETWORK', 0);
  }
  let json;
  try { json = await res.json(); } catch { throw new ApiError(`Unexpected response (${res.status})`, 'E_BAD_RESPONSE', res.status); }
  if (!json.ok) throw new ApiError(json.error?.message || 'Request failed', json.error?.code, res.status);
  return json.data;
}

const qs = (o = {}) => {
  const p = new URLSearchParams();
  Object.entries(o).forEach(([k, v]) => v !== undefined && v !== null && v !== '' && p.set(k, v));
  const s = p.toString();
  return s ? `?${s}` : '';
};

export const api = {
  // students
  students: (f) => request('GET', `/students${qs(f)}`),
  student: (id) => request('GET', `/students/${id}`),
  createStudent: (b) => request('POST', '/students', { body: b }),
  updateStudent: (id, b) => request('PUT', `/students/${id}`, { body: b }),
  deleteStudent: (id) => request('DELETE', `/students/${id}`, { headers: { 'X-Confirm': 'DELETE' } }),
  network: (id, depth) => request('GET', `/students/${id}/network${qs({ depth })}`),
  // graph
  graph: () => request('GET', '/graph'),
  // friendships
  addFriend: (friendId, level) => request('POST', '/friendships', { body: { friendId, level } }),
  updateFriendship: (id, level) => request('PUT', `/friendships/${id}`, { body: { level } }),
  removeFriendship: (id) => request('DELETE', `/friendships/${id}`),
  // collaborations
  addCollab: (partnerId, projectTitle, type) => request('POST', '/collaborations', { body: { partnerId, projectTitle, type } }),
  updateCollab: (id, b) => request('PUT', `/collaborations/${id}`, { body: b }),
  removeCollab: (id) => request('DELETE', `/collaborations/${id}`),
  // mentorship
  requests: (f) => request('GET', `/mentorship-requests${qs(f)}`),
  mentorships: (f) => request('GET', `/mentorships${qs(f)}`),
  requestMentorship: (b) => request('POST', '/mentorship-requests', { body: b }),
  accept: (id) => request('POST', `/mentorship-requests/${id}/accept`),
  reject: (id) => request('POST', `/mentorship-requests/${id}/reject`),
  cancel: (id) => request('DELETE', `/mentorship-requests/${id}`),
  rollbackDemo: (id) => request('POST', `/mentorship-requests/${id}/rollback-demo`),
  transactionSql: () => request('GET', '/mentorship-requests/transaction-sql'),
  endMentorship: (id) => request('PUT', `/mentorships/${id}/end`),
  // dashboard
  stats: () => request('GET', '/dashboard/stats'),
  activity: (limit) => request('GET', `/activity${qs({ limit })}`),
  // query lab
  queries: () => request('GET', '/queries'),
  runQuery: (id, p) => request('GET', `/queries/${id}${qs(p)}`),
  // admin
  reseed: () => request('POST', '/admin/reseed', { headers: { 'X-Confirm': 'RESET' } }),
};
