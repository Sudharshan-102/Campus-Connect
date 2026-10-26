import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api, getIdentity, setIdentity } from './api.js';

const Ctx = createContext(null);
export const useApp = () => useContext(Ctx);

let toastId = 0;

export function AppProvider({ children }) {
  const [me, setMe] = useState(getIdentity());
  const [students, setStudents] = useState([]);
  const [toasts, setToasts] = useState([]);
  const [live, setLive] = useState('connecting'); // connecting | live | offline
  const listeners = useRef(new Set());
  const seen = useRef(new Set());
  const studentsRef = useRef([]);
  const meRef = useRef(me);
  meRef.current = me;

  const toast = useCallback((message, kind = 'info', ms = 4500) => {
    const id = ++toastId;
    setToasts((t) => [...t.slice(-3), { id, message, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), ms);
  }, []);

  const loadStudents = useCallback(async () => {
    try {
      const rows = await api.students();
      studentsRef.current = rows;
      setStudents(rows);
      // if the chosen identity was deleted, clear it
      if (meRef.current && !rows.some((s) => s.id === meRef.current)) {
        setIdentity('');
        setMe('');
      }
    } catch { /* offline: pages show their own error */ }
  }, []);

  useEffect(() => { loadStudents(); }, [loadStudents]);

  const chooseMe = useCallback((id) => { setIdentity(id); setMe(id); }, []);

  const nameOf = useCallback((id) => studentsRef.current.find((s) => s.id === id)?.name || id?.split(':')[1] || 'Someone', []);

  // ---- Live updates: one EventSource per browser tab ----------------------
  useEffect(() => {
    const es = new EventSource('/api/events');
    es.addEventListener('hello', () => setLive('live'));
    es.onerror = () => setLive('offline'); // the browser retries automatically
    es.onopen = () => setLive('live');
    es.addEventListener('change', (msg) => {
      let ev;
      try { ev = JSON.parse(msg.data); } catch { return; }
      if (seen.current.has(ev.seq)) return; // duplicate (e.g. replay after reconnect)
      seen.current.add(ev.seq);
      if (seen.current.size > 1000) seen.current = new Set([...seen.current].slice(-500));

      if (ev.table === 'student') loadStudents();

      // Friendly pop-ups for things that concern the student this tab is acting as
      const mine = meRef.current;
      if (ev.table === 'mentorship_request' && ev.action === 'CREATE' && ev.value.out === mine) {
        toast(`New mentorship request from ${nameOf(ev.value.in)} (${ev.value.expertise})`, 'live');
      }
      if (ev.table === 'mentorship_request' && ev.action === 'UPDATE' && ev.value.in === mine) {
        toast(`${nameOf(ev.value.out)} ${ev.value.status} your mentorship request`, ev.value.status === 'accepted' ? 'success' : 'info');
      }
      if (ev.table === 'friends_with' && ev.action === 'CREATE' && (ev.value.in === mine || ev.value.out === mine)) {
        toast(`You and ${nameOf(ev.value.in === mine ? ev.value.out : ev.value.in)} are now friends`, 'success');
      }
      listeners.current.forEach((fn) => fn(ev));
    });
    return () => es.close();
  }, [loadStudents, toast, nameOf]);

  const subscribe = useCallback((fn) => {
    listeners.current.add(fn);
    return () => listeners.current.delete(fn);
  }, []);

  const value = useMemo(
    () => ({ me, chooseMe, students, loadStudents, toast, toasts, live, subscribe, nameOf }),
    [me, chooseMe, students, loadStudents, toast, toasts, live, subscribe, nameOf],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/**
 * Run `load` now and again whenever a live event touches one of `tables`
 * (debounced, so a transaction that changes 3 tables causes one refresh).
 */
export function useLiveData(load, tables, deps = []) {
  const { subscribe } = useApp();
  const [state, setState] = useState({ data: undefined, error: null, loading: true });
  const loadRef = useRef(load);
  loadRef.current = load;
  const timer = useRef(null);

  const refresh = useCallback(async () => {
    try {
      const data = await loadRef.current();
      setState({ data, error: null, loading: false });
    } catch (error) {
      setState((s) => ({ ...s, error, loading: false }));
    }
  }, []);

  useEffect(() => { setState((s) => ({ ...s, loading: true })); refresh(); }, [refresh, ...deps]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => subscribe((ev) => {
    if (!tables.includes(ev.table)) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(refresh, 150);
  }), [subscribe, refresh, tables.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => clearTimeout(timer.current), []);
  return { ...state, refresh };
}
