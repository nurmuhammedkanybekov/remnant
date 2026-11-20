import { isSolid, worldToCell, type Cell } from "./grid";
import type { ParsedLevel } from "./levelParser";
import type { ScriptAction } from "../game/script";

/**
 * Design checks beyond "does it parse": can the level actually be finished?
 * Reachability is lock-aware — plain doors can always be opened, security
 * doors only once the keycard has been reached without passing through one.
 * Returns human-readable problems; an empty list means the level is sound.
 */
export function validateLevel(level: ParsedLevel): string[] {
  const problems: string[] = [];
  const id = level.def.id;
  const s = level.spawns;
  const key = (c: Cell) => c.row * level.cols + c.col;
  const doorAt = new Map(s.doors.map((d) => [key(d.cell), d]));
  const hasSecurity = s.doors.some((d) => d.security);

  const flood = (openSecurity: boolean) =>
    floodFill(level, level.startCell, (c) => {
      const door = doorAt.get(key(c));
      if (door) return !door.security || openSecurity;
      return !isSolid(level, c.col, c.row);
    });

  const beforeKeycard = flood(false);
  const reachedBefore = (c: Cell) => beforeKeycard.has(key(c));
  const keycards = s.items.filter((i) => i.type === "keycard");
  const keycardCells = keycards.map((i) => worldToCell(i.pos.x, i.pos.y));
  const keycardReachable = keycardCells.length > 0 && keycardCells.every(reachedBefore);
  const reachable = hasSecurity && keycardReachable ? flood(true) : beforeKeycard;
  const canReach = (c: Cell) => reachable.has(key(c));
  /** For solid things you use from beside them (generators). */
  const canReachSide = (c: Cell) =>
    [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ].some(([dc, dr]) => canReach({ col: c.col + dc, row: c.row + dr }));

  // The outer ring must be solid — collision assumes a closed map.
  for (let col = 0; col < level.cols; col++) {
    if (!level.solid[0][col] || !level.solid[level.rows - 1][col]) problems.push(`${id}: open edge at column ${col}`);
  }
  for (let row = 0; row < level.rows; row++) {
    if (!level.solid[row][0] || !level.solid[row][level.cols - 1]) problems.push(`${id}: open edge at row ${row}`);
  }

  if (!canReach(level.exitCell)) problems.push(`${id}: exit is not reachable from the spawn`);
  if (keycards.length > 1) problems.push(`${id}: more than one keycard`);
  if (hasSecurity && keycards.length === 0) problems.push(`${id}: security doors but no keycard`);
  if (hasSecurity && keycards.length > 0 && !keycardReachable) problems.push(`${id}: keycard is locked behind a security door`);

  const check = (label: string, cells: Cell[], test = canReach) => {
    for (const c of cells) if (!test(c)) problems.push(`${id}: ${label} at ${c.col},${c.row} is not reachable`);
  };
  const cellsOf = (points: { x: number; y: number }[]) => points.map((p) => worldToCell(p.x, p.y));
  for (const item of s.items) check(item.type, cellsOf([item.pos]));
  check("note", cellsOf(s.notes.map((n) => n.pos)));
  check(
    "intercom",
    s.intercoms.map((i) => i.cell)
  );
  check(
    "checkpoint",
    s.checkpoints.map((c) => c.cell)
  );
  check(
    "console",
    s.consoles.map((c) => c.cell)
  );
  check(
    "trigger",
    s.triggers.map((t) => t.cell)
  );
  check(
    "generator",
    s.generators.map((g) => g.cell),
    canReachSide
  );
  check(
    "door",
    s.doors.map((d) => d.cell),
    canReachSide
  );

  for (const d of s.doors) {
    const { col, row } = d.cell;
    const ew = isSolid(level, col - 1, row) && isSolid(level, col + 1, row);
    const ns = isSolid(level, col, row - 1) && isSolid(level, col, row + 1);
    if (ew === ns) problems.push(`${id}: door at ${col},${row} is not in a doorway (needs walls on exactly two opposite sides)`);
  }
  // Kessler's trail must lead to a note that's on the map.
  if (level.def.hum && !s.notes.some((n) => n.key === `${id}:${level.def.hum}`))
    problems.push(`${id}: hum leads to note "${level.def.hum}", which isn't on the map`);
  // Script actions that happen somewhere: on the map, and figures on open floor you can reach.
  const def = level.def;
  // Every action, including those inside a question's reward and both branches of an ifTold.
  const nested = (a: ScriptAction): ScriptAction[] =>
    a.type === "ask"
      ? [a, ...a.reward.flatMap(nested)]
      : a.type === "ifTold" || a.type === "ifTrail"
        ? [a, ...a.then.flatMap(nested), ...a.otherwise.flatMap(nested)]
        : a.type === "bid"
          ? [a, ...a.obeyed.flatMap(nested), ...a.defied.flatMap(nested)]
          : a.type === "ifHeeded"
            ? [a, ...a.obeyed.flatMap(nested), ...a.defied.flatMap(nested), ...a.never.flatMap(nested)]
            : [a];
  const scripts: ScriptAction[] = [
    ...Object.values(def.events ?? {}).flat(2),
    ...Object.values(def.triggers ?? {}).flat(),
    ...(def.intercoms ?? []).flat(),
  ].flatMap(nested);
  const bidIds = new Set<string>();
  for (const a of scripts) {
    if (a.type !== "bid") continue;
    // A bid answered by where you go needs somewhere to go, and you have to be able to get there.
    if (bidIds.has(a.id)) problems.push(`${id}: bid "${a.id}" given twice`);
    bidIds.add(a.id);
    const t = a.test;
    if (t.kind === "avoid" || t.kind === "go") {
      const cells = s.triggers.filter((tr) => tr.key === t.zone);
      if (!cells.length) problems.push(`${id}: bid "${a.id}" watches zone "${t.zone}", which isn't on the map`);
      else if (!cells.some((tr) => canReach(tr.cell))) problems.push(`${id}: bid "${a.id}" zone "${t.zone}" can't be reached`);
    }
    if (t.kind === "leave") {
      const there = s.items.some((i) => {
        const c = worldToCell(i.pos.x, i.pos.y);
        return c.col === t.at.col && c.row === t.at.row;
      });
      if (!there) problems.push(`${id}: bid "${a.id}" asks you to leave what's at ${t.at.col},${t.at.row}, and nothing is`);
      if (!(def.keep ?? []).some(([c, r]) => c === t.at.col && r === t.at.row))
        problems.push(`${id}: bid "${a.id}"'s item at ${t.at.col},${t.at.row} must be in \`keep\` (or a difficulty could thin it out)`);
    }
  }
  for (const a of scripts) {
    if (a.type !== "sound" && a.type !== "apparition") continue;
    const c = a.at;
    if (!c) continue;
    if (c.col < 0 || c.row < 0 || c.col >= level.cols || c.row >= level.rows) {
      problems.push(`${id}: ${a.type} at ${c.col},${c.row} is off the map`);
    } else if (a.type === "apparition" && !canReach(c)) {
      problems.push(`${id}: apparition at ${c.col},${c.row} is not on floor you can reach`);
    }
  }
  if (level.def.finale && s.consoles.length === 0) problems.push(`${id}: the finale needs a detonator console (Z)`);
  for (const e of s.enemies) {
    const cell = worldToCell(e.pos.x, e.pos.y);
    const d = Math.abs(cell.col - level.startCell.col) + Math.abs(cell.row - level.startCell.row);
    if (d < 3) problems.push(`${id}: ${e.kind} at ${cell.col},${cell.row} spawns within 3 cells of the player`);
  }
  return problems;
}

/** Every cell index reachable from `start` (4-connected) through cells `passable` accepts. */
function floodFill(level: ParsedLevel, start: Cell, passable: (c: Cell) => boolean): Set<number> {
  const seen = new Set<number>([start.row * level.cols + start.col]);
  const queue: Cell[] = [start];
  while (queue.length) {
    const { col, row } = queue.pop()!;
    for (const [dc, dr] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const c = { col: col + dc, row: row + dr };
      const i = c.row * level.cols + c.col;
      if (seen.has(i) || c.col < 0 || c.row < 0 || c.col >= level.cols || c.row >= level.rows || !passable(c)) continue;
      seen.add(i);
      queue.push(c);
    }
  }
  return seen;
}
