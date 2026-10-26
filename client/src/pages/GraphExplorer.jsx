import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import cytoscape from 'cytoscape';
import { api } from '../api.js';
import { useApp } from '../store.jsx';
import { Avatar, Chips, ErrorBox } from '../components.jsx';

const DEPT_COLOR = { CSE: '#8b5cf6', ECE: '#22d3ee', EEE: '#fbbf24', IT: '#34d399', MECH: '#fb7185', CIVIL: '#f97316' };
const EDGE = {
  friendship:    { color: '#a78bfa', label: 'Friendship',        style: 'solid',  arrow: 'none' },
  mentorship:    { color: '#34d399', label: 'Mentorship (mentor → mentee)', style: 'solid', arrow: 'triangle' },
  collaboration: { color: '#22d3ee', label: 'Collaboration',     style: 'dotted', arrow: 'none' },
  request:       { color: '#fbbf24', label: 'Pending request (mentee → mentor)', style: 'dashed', arrow: 'triangle' },
};
const LIVE_TABLES = new Set(['friends_with', 'mentors', 'mentorship_request', 'collaborates_with', 'student']);

const stylesheet = [
  { selector: 'node', style: {
    label: 'data(label)', color: '#e8ebfa', 'font-size': 11, 'text-valign': 'bottom', 'text-margin-y': 6, 'text-outline-color': '#0a0e1f', 'text-outline-width': 3,
    'background-color': 'data(color)', width: 'data(size)', height: 'data(size)', 'border-width': 2, 'border-color': '#0a0e1f',
    'transition-property': 'opacity, width, height, border-color, border-width', 'transition-duration': '0.25s' } },
  { selector: 'node.yr4', style: { 'border-color': '#fff', 'border-width': 3 } },
  { selector: 'node:selected', style: { 'border-color': '#fff', 'border-width': 4 } },
  { selector: 'edge', style: {
    width: 2.2, 'line-color': 'data(color)', 'target-arrow-color': 'data(color)', 'target-arrow-shape': 'data(arrow)', 'arrow-scale': 1.1,
    'curve-style': 'bezier', 'line-style': 'data(lineStyle)', opacity: 0.85,
    'transition-property': 'opacity, width, line-color', 'transition-duration': '0.25s' } },
  { selector: 'edge[type = "mentorship"]', style: { width: 3.4 } },
  { selector: '.faded', style: { opacity: 0.08 } },
  { selector: 'edge.hl', style: { width: 4.5, opacity: 1 } },
  { selector: 'node.hl', style: { 'border-color': '#fff', 'border-width': 4 } },
  { selector: '.hidden', style: { display: 'none' } },
  { selector: '.fresh', style: { 'line-color': '#fff', 'target-arrow-color': '#fff', width: 7, opacity: 1, 'z-index': 99 } },
  { selector: 'node.fresh', style: { 'border-color': '#fff', 'border-width': 7 } },
];

const toNode = (n) => ({
  group: 'nodes',
  data: { id: n.id, label: n.name.split(' ')[0], full: n.name, dept: n.department, year: n.year, color: DEPT_COLOR[n.department] || '#98a2cc', size: 26 + Math.min(n.degree ?? 0, 8) * 3.5 },
  classes: n.year === 4 ? 'yr4' : '',
});
const toEdge = (e) => ({
  group: 'edges',
  data: { id: e.id, source: e.source, target: e.target, type: e.type, label: e.label, color: EDGE[e.type].color, arrow: EDGE[e.type].arrow, lineStyle: EDGE[e.type].style },
});

export default function GraphExplorer() {
  const { subscribe, students } = useApp();
  const [params, setParams] = useSearchParams();
  const box = useRef(null);
  const cyRef = useRef(null);
  const first = useRef(true);
  const [error, setError] = useState(null);
  const [counts, setCounts] = useState({ n: 0, e: 0 });
  const [visible, setVisible] = useState({ friendship: true, mentorship: true, collaboration: true, request: true });
  const [selected, setSelected] = useState(null); // student data
  const [depth, setDepth] = useState(0); // 0 = off
  const [layoutName, setLayoutName] = useState('cose');
  const [flash, setFlash] = useState(null);
  const infoRef = useRef(new Map());
  const depthRef = useRef(0);
  const selectedRef = useRef(null);
  depthRef.current = depth;
  selectedRef.current = selected;

  const runLayout = useCallback((name = 'cose', animate = true, fit = true) => {
    const cy = cyRef.current;
    if (!cy) return;
    const opts = {
      cose: { name: 'cose', animate, animationDuration: 600, fit, padding: 50, nodeRepulsion: 14000, idealEdgeLength: 90, edgeElasticity: 80, gravity: 0.7, randomize: false },
      concentric: { name: 'concentric', animate, animationDuration: 500, fit, padding: 50, concentric: (n) => n.degree(), levelWidth: () => 2, minNodeSpacing: 30 },
      circle: { name: 'circle', animate, animationDuration: 500, fit, padding: 50 },
      grid: { name: 'grid', animate, animationDuration: 500, fit, padding: 50 },
    }[name];
    cy.layout(opts).run();
  }, []);

  const applyFilters = useCallback((vis) => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.batch(() => {
      cy.edges().forEach((e) => e.toggleClass('hidden', !vis[e.data('type')]));
    });
  }, []);

  const clearHighlight = useCallback(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.batch(() => { cy.elements().removeClass('faded hl'); });
  }, []);

  const highlightNeighbours = useCallback((node) => {
    const cy = cyRef.current;
    cy.batch(() => {
      cy.elements().addClass('faded').removeClass('hl');
      const hood = node.closedNeighborhood();
      hood.removeClass('faded');
      node.connectedEdges().addClass('hl');
      node.addClass('hl');
    });
  }, []);

  /** N-hop view: ask SurrealDB (recursive graph traversal) which students are within N hops. */
  const showDepth = useCallback(async (id, d) => {
    const cy = cyRef.current;
    if (!cy) return;
    if (!d) { highlightNeighbours(cy.getElementById(id)); return; }
    try {
      const net = await api.network(id, d);
      const hop = new Map(net.nodes.map((n) => [n.id, n.hops]));
      cy.batch(() => {
        cy.elements().addClass('faded').removeClass('hl');
        cy.nodes().forEach((n) => {
          if (hop.has(n.id())) {
            n.removeClass('faded');
            n.data('size', n.data('size')); // keep
          }
        });
        cy.edges().forEach((e) => {
          if (hop.has(e.source().id()) && hop.has(e.target().id())) e.removeClass('faded');
        });
        cy.getElementById(id).addClass('hl');
      });
      infoRef.current.set('hops', hop);
      setSelected((s) => (s ? { ...s, hops: hop } : s));
    } catch (e) { setError(e); }
  }, [highlightNeighbours]);

  /** Load (or live-refresh) the graph and animate whatever changed. */
  const load = useCallback(async () => {
    try {
      const g = await api.graph();
      const cy = cyRef.current;
      if (!cy) return;
      setError(null);
      infoRef.current.set('students', new Map(g.nodes.map((n) => [n.id, n])));

      const wantNodes = new Map(g.nodes.map((n) => [n.id, n]));
      const wantEdges = new Map(g.edges.map((e) => [e.id, e]));
      const addedNodes = [];
      const addedEdges = [];

      cy.batch(() => {
        cy.nodes().forEach((n) => { if (!wantNodes.has(n.id())) cy.remove(n); });
        cy.edges().forEach((e) => { if (!wantEdges.has(e.id())) cy.remove(e); });
        g.nodes.forEach((n) => {
          const ex = cy.getElementById(n.id);
          if (ex.nonempty()) {
            ex.data('size', 26 + Math.min(n.degree ?? 0, 8) * 3.5);
            ex.data('label', n.name.split(' ')[0]);
            ex.data('color', DEPT_COLOR[n.department] || '#98a2cc');
          } else addedNodes.push(cy.add(toNode(n)));
        });
        g.edges.forEach((e) => {
          if (cy.getElementById(e.id).empty() && cy.getElementById(e.source).nonempty() && cy.getElementById(e.target).nonempty()) {
            addedEdges.push(cy.add(toEdge(e)));
          }
        });
      });

      setCounts({ n: g.nodes.length, e: g.edges.length });
      applyFilters(visibleRef.current);

      if (first.current) {
        first.current = false;
        runLayout('cose', false, true);
        const focus = paramsRef.current.get('focus');
        if (focus && cy.getElementById(focus).nonempty()) {
          const n = cy.getElementById(focus);
          n.select();
          setTimeout(() => { highlightNeighbours(n); cy.animate({ center: { eles: n }, zoom: 1.3 }, { duration: 500 }); }, 650);
          setSelected({ ...wantNodes.get(focus) });
        }
        return;
      }

      if (addedNodes.length) runLayout(layoutRef.current, true, false);
      // visible "something just changed" animation
      [...addedNodes, ...addedEdges].forEach((el) => {
        el.addClass('fresh');
        setTimeout(() => el.removeClass('fresh'), 2600);
      });
      if (addedEdges.length) {
        const e = addedEdges[addedEdges.length - 1];
        const label = { friendship: 'New friendship', mentorship: 'Mentorship created', collaboration: 'New collaboration', request: 'Mentorship request arrived' }[e.data('type')];
        setFlash(`${label}: ${e.source().data('full')} → ${e.target().data('full')}`);
        setTimeout(() => setFlash(null), 3500);
      }
      // re-apply focus / depth view after data changed
      const sel = selectedRef.current;
      if (sel && cy.getElementById(sel.id).nonempty()) {
        if (depthRef.current) showDepth(sel.id, depthRef.current); else highlightNeighbours(cy.getElementById(sel.id));
      }
    } catch (e) { setError(e); }
  }, [applyFilters, runLayout, highlightNeighbours, showDepth]);

  const visibleRef = useRef(visible); visibleRef.current = visible;
  const layoutRef = useRef(layoutName); layoutRef.current = layoutName;
  const paramsRef = useRef(params); paramsRef.current = params;

  // create the Cytoscape instance once
  useEffect(() => {
    const cy = cytoscape({ container: box.current, style: stylesheet, wheelSensitivity: 0.25, minZoom: 0.2, maxZoom: 3 });
    cyRef.current = cy;
    first.current = true;

    cy.on('tap', 'node', (evt) => {
      const n = evt.target;
      const info = infoRef.current.get('students')?.get(n.id());
      setSelected(info ? { ...info } : { id: n.id(), name: n.data('full') });
      setDepth(0);
      highlightNeighbours(n);
    });
    cy.on('tap', (evt) => {
      if (evt.target === cy) { setSelected(null); setDepth(0); clearHighlight(); }
    });
    load();
    const ro = new ResizeObserver(() => cy.resize());
    ro.observe(box.current);
    return () => { ro.disconnect(); cy.destroy(); cyRef.current = null; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // live updates: graph changes come from SurrealDB LIVE SELECT -> SSE
  useEffect(() => {
    let t;
    const off = subscribe((ev) => {
      if (!LIVE_TABLES.has(ev.table)) return;
      clearTimeout(t);
      t = setTimeout(load, 180);
    });
    return () => { off(); clearTimeout(t); };
  }, [subscribe, load]);

  useEffect(() => { applyFilters(visible); }, [visible, applyFilters]);

  useEffect(() => {
    if (selected && cyRef.current) {
      if (depth) showDepth(selected.id, depth);
      else highlightNeighbours(cyRef.current.getElementById(selected.id));
    }
  }, [depth]); // eslint-disable-line react-hooks/exhaustive-deps

  const zoom = (f) => { const cy = cyRef.current; cy.zoom({ level: cy.zoom() * f, renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 } }); };
  const fit = () => cyRef.current.animate({ fit: { padding: 50 } }, { duration: 400 });
  const pick = (id) => {
    const cy = cyRef.current; const n = cy.getElementById(id);
    if (n.empty()) return;
    n.select(); setSelected({ ...infoRef.current.get('students')?.get(id) }); setDepth(0); highlightNeighbours(n);
    cy.animate({ center: { eles: n }, zoom: 1.4 }, { duration: 450 });
    setParams({}, { replace: true });
  };

  return (
    <div className="page" style={{ maxWidth: 1500 }}>
      <div className="page-head">
        <div><h1>Graph Explorer</h1><p>{counts.n} students · {counts.e} relationships, read live from SurrealDB. Click a student to highlight their connections.</p></div>
        <div className="row">
          <select value={layoutName} onChange={(e) => { setLayoutName(e.target.value); runLayout(e.target.value); }} aria-label="Layout" style={{ width: 'auto' }}>
            <option value="cose">Force layout</option><option value="concentric">Concentric (by connections)</option><option value="circle">Circle</option><option value="grid">Grid</option>
          </select>
          <select value="" onChange={(e) => e.target.value && pick(e.target.value)} aria-label="Find student" style={{ width: 'auto' }}>
            <option value="">Find a student…</option>{students.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
      </div>
      <ErrorBox error={error} />
      <div className="graph-wrap">
        <div className="cy-box">
          <div className="cy-tools">
            <button className="btn sm" onClick={() => zoom(1.25)} aria-label="Zoom in">＋</button>
            <button className="btn sm" onClick={() => zoom(0.8)} aria-label="Zoom out">−</button>
            <button className="btn sm" onClick={fit}>Fit to screen</button>
            <button className="btn sm" onClick={() => runLayout(layoutName)}>Re-layout</button>
          </div>
          {flash && <div className="live-toast-inline">⚡ {flash}</div>}
          <div className="cy" ref={box} />
          <div className="legend">
            <b style={{ display: 'block', marginBottom: 4 }}>Relationships (tick to show)</b>
            {Object.entries(EDGE).map(([k, v]) => (
              <label key={k}>
                <input type="checkbox" checked={visible[k]} onChange={() => setVisible({ ...visible, [k]: !visible[k] })} />
                <span className="swatch" style={{ borderTopColor: v.color, borderTopStyle: v.style }} />{v.label}
              </label>
            ))}
            <div className="hint" style={{ marginTop: 6 }}>Node colour = department · white ring = final year</div>
            <div style={{ marginTop: 4 }}>{Object.entries(DEPT_COLOR).slice(0, 4).map(([d, c]) => <span key={d} style={{ marginRight: 8 }}><span style={{ color: c }}>●</span> {d}</span>)}</div>
          </div>
        </div>

        <div className="card side">
          {!selected ? (
            <div><h2>How to use</h2>
              <p className="hint">Click any student to highlight their direct connections. Then use the slider to reveal people up to N hops away, found with SurrealDB's recursive graph traversal.</p>
              <p className="hint">Open this page in two windows, act as a mentor in one and send a mentorship request from the other: a dashed amber edge appears here instantly, and turns into a green mentorship edge when accepted.</p>
            </div>
          ) : (
            <div>
              <div className="person" style={{ marginBottom: 10 }}>
                <Avatar s={selected} />
                <div className="meta"><div className="nm" style={{ whiteSpace: 'normal' }}>{selected.name}</div><div className="sub">{selected.department} · Year {selected.year}</div></div>
              </div>
              {selected.skills && <Chips items={selected.skills} />}
              {selected.interests && <Chips items={selected.interests} alt />}
              <div className="row" style={{ margin: '8px 0 14px' }}>
                <Link className="btn sm primary" to={`/students/${selected.id}`}>Open profile</Link>
              </div>
              <h3>Reach (multi-hop)</h3>
              <div className="range">
                <input type="range" min="0" max="4" value={depth} onChange={(e) => setDepth(Number(e.target.value))} aria-label="Hop depth" />
                <b style={{ minWidth: 74 }}>{depth === 0 ? 'direct only' : `${depth} hop${depth > 1 ? 's' : ''}`}</b>
              </div>
              <p className="hint">0 = direct connections. 1–4 asks SurrealDB for everyone within that many hops over friend, mentor and collaboration edges.</p>
              {depth > 0 && selected.hops && (
                <div className="list" style={{ marginTop: 10 }}>
                  {[...selected.hops.entries()].filter(([id]) => id !== selected.id).sort((a, b) => a[1] - b[1]).map(([id, h]) => (
                    <div className="item" key={id} onClick={() => pick(id)} style={{ cursor: 'pointer' }}>
                      <span>{infoRef.current.get('students')?.get(id)?.name ?? id}</span>
                      <span className={`badge ${h === 1 ? 'direct' : 'multi-hop'}`}>{h === 1 ? 'direct' : `${h} hops`}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
