// Draws the contribution snake: it eats every square, and grows one segment
// for each darker square (second level and up). Output: two animated SVGs.
//
//   GITHUB_TOKEN=... node generate.mjs <user> <out-dir>
//
// No dependencies. The snake follows a path that sweeps the grid column by
// column, so a growing body can never run into itself.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [user = "ouda711", outDir = "dist"] = process.argv.slice(2);
const token = process.env.GITHUB_TOKEN;
if (!token) throw new Error("GITHUB_TOKEN is required");

const PITCH = 16; // grid spacing
const DOT = 12; // square size
const STEP_MS = 100; // time per move
const START_LENGTH = 4;
const LEVELS = ["NONE", "FIRST_QUARTILE", "SECOND_QUARTILE", "THIRD_QUARTILE", "FOURTH_QUARTILE"];
const GROW_FROM_LEVEL = 2; // darker squares: second quartile and up

const THEMES = {
  "github-contribution-grid-snake.svg": {
    dots: ["#ebedf0", "#9be9a8", "#40c463", "#30a14e", "#216e39"],
    snake: "#f97316",
  },
  "github-contribution-grid-snake-dark.svg": {
    dots: ["#161b22", "#0e4429", "#006d32", "#26a641", "#39d353"],
    snake: "#f97316",
  },
};

async function fetchCalendar() {
  const query = `query($login:String!){user(login:$login){contributionsCollection{contributionCalendar{weeks{contributionDays{weekday contributionLevel}}}}}}`;
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { Authorization: `bearer ${token}`, "Content-Type": "application/json", "User-Agent": "profile-snake" },
    body: JSON.stringify({ query, variables: { login: user } }),
  });
  if (!res.ok) throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
  const body = await res.json();
  if (body.errors) throw new Error(JSON.stringify(body.errors));
  const weeks = body.data.user.contributionsCollection.contributionCalendar.weeks;
  const cells = new Map(); // "x,y" -> level index
  weeks.forEach((week, x) =>
    week.contributionDays.forEach((day) => cells.set(`${x},${day.weekday}`, LEVELS.indexOf(day.contributionLevel)))
  );
  return { width: weeks.length, cells };
}

function buildPath(width) {
  const path = [[-1, 0]]; // start just off the left edge
  for (let x = 0; x < width; x++) {
    for (let i = 0; i < 7; i++) path.push([x, x % 2 === 0 ? i : 6 - i]);
  }
  return path;
}

const pct = (step, total) => ((step / total) * 100).toFixed(4).replace(/\.?0+$/, "") + "%";

function render({ width, cells }, theme) {
  const path = buildPath(width);

  // When is each square eaten, and when does the snake grow?
  const eatenAt = new Map();
  const growAt = [];
  path.forEach(([x, y], step) => {
    const level = cells.get(`${x},${y}`);
    if (level === undefined) return;
    if (level > 0) eatenAt.set(`${x},${y}`, step);
    if (level >= GROW_FROM_LEVEL) growAt.push(step);
  });
  const maxLength = START_LENGTH + growAt.length;

  // After the last square the snake slides off the right edge, then loops.
  const last = path[path.length - 1];
  for (let i = 1; i <= maxLength + 2; i++) path.push([last[0] + i, last[1]]);
  const total = path.length;
  const duration = (total * STEP_MS) / 1000;

  const css = [];
  const head = path
    .map(([x, y], step) => `${pct(step, total)}{transform:translate(${x * PITCH}px,${y * PITCH}px)}`)
    .join("");
  css.push(`@keyframes m{${head}}`);
  css.push(`.s{animation:m ${duration}s linear infinite;fill:${theme.snake}}`);

  const dots = [];
  for (const [key, level] of cells) {
    const [x, y] = key.split(",").map(Number);
    const at = eatenAt.get(key);
    const attrs = `x="${x * PITCH + 2}" y="${y * PITCH + 2}" width="${DOT}" height="${DOT}" rx="2"`;
    if (at === undefined) {
      dots.push(`<rect ${attrs} fill="${theme.dots[level]}"/>`);
      continue;
    }
    const name = `e${x}_${y}`;
    css.push(
      `@keyframes ${name}{0%,${pct(at, total)}{fill:${theme.dots[level]}}${pct(at + 0.5, total)},100%{fill:${theme.dots[0]}}}`
    );
    dots.push(`<rect ${attrs} class="d" style="animation-name:${name}"/>`);
  }
  css.push(`.d{animation-duration:${duration}s;animation-timing-function:linear;animation-iteration-count:infinite}`);

  // Segment i trails the head by i moves; it appears when the snake grows.
  const segments = [];
  for (let i = maxLength - 1; i >= 0; i--) {
    const size = Math.max(7, DOT + 2 - Math.round((i / maxLength) * 6));
    const offset = 2 + (DOT - size) / 2;
    let style = `animation-delay:${((i * STEP_MS) / 1000).toFixed(2)}s`;
    if (i >= START_LENGTH) {
      const at = growAt[i - START_LENGTH];
      css.push(`@keyframes g${i}{0%,${pct(at - 0.01, total)}{opacity:0}${pct(at, total)},100%{opacity:1}}`);
      style = `animation:m ${duration}s linear ${((i * STEP_MS) / 1000).toFixed(2)}s infinite,g${i} ${duration}s linear infinite`;
    }
    segments.push(
      `<rect class="s" x="${offset}" y="${offset}" width="${size}" height="${size}" rx="${Math.min(4, size / 2)}" style="${style}"/>`
    );
  }

  const w = width * PITCH;
  const h = 7 * PITCH;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">`,
    `<style>${css.join("")}</style>`,
    ...dots,
    ...segments,
    `</svg>`,
  ].join("\n");
}

const calendar = await fetchCalendar();
mkdirSync(outDir, { recursive: true });
for (const [file, theme] of Object.entries(THEMES)) {
  const svg = render(calendar, theme);
  writeFileSync(join(outDir, file), svg);
  console.log(`${file}: ${(svg.length / 1024).toFixed(1)} KB`);
}
