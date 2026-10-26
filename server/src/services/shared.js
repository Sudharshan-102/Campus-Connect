// Small SurrealQL fragments reused by several services.

/** Fields we show for a student wherever a student appears inside a relationship. */
export const BRIEF = '{ id, name, department, year, avatar, skills }';

/** Expand an edge's two endpoints into a (a = in, b = out) pair of brief students. */
export const ENDS = `in.${BRIEF} AS a, out.${BRIEF} AS b`;

/** The "other" student of an edge, from the point of view of `me`. */
export function other(edge, me) {
  return edge.a?.id === me ? edge.b : edge.a;
}
