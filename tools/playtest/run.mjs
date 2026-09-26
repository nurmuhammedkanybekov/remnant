/**
 * Automated playtest: a bot plays the campaign in a real browser and prints
 * one line of stats per level (time, deaths, damage, kills, ammo, …).
 *
 *   npm run build && npx vite preview --port 4173   # in another terminal
 *   node tools/playtest/run.mjs [difficulty] [level|-] [average|good]
 *
 * `difficulty` defaults to normal. A level index plays just that chapter;
 * "-" (the default) plays the whole campaign, carrying the loadout over.
 * "average" reacts slower, aims worse and doesn't know the boss's weak
 * spot; "good" does. Needs Playwright (`npx playwright install chromium`
 * once, or set PLAYWRIGHT_MODULE to an installed copy's index.mjs).
 * Set TRACE=1 to log the bot's position and goal every ten seconds.
 */
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const here = dirname(fileURLToPath(import.meta.url));
const difficulty = process.argv[2] ?? "normal";
const only = process.argv[3] && process.argv[3] !== "-" ? Number(process.argv[3]) : null;
const skill = process.argv[4] ?? "average";
const url = process.env.PLAYTEST_URL ?? "http://localhost:4173/?debug";

const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 800, height: 500 } });
const errors = [];
page.on("pageerror", (e) => errors.push(`${e.message}\n${e.stack}`));
await page.goto(url);
await page.waitForTimeout(2500);
await page.addScriptTag({ content: readFileSync(join(here, "bot.js"), "utf8") });
await page.evaluate(([d, level]) => window.game.debugStart(level ?? 0, d), [difficulty, only]);
for (let i = only ?? 0; i < 10; i++) {
  const r = await page.evaluate(([s, trace]) => window.botPlayLevel(480, { skill: s, trace }), [skill, !!process.env.TRACE]);
  console.log(JSON.stringify(r));
  if (r.state !== "levelComplete" || only !== null) break;
  await page.evaluate(() => window.game.startLevel(true));
}
if (errors.length) console.log("PAGE ERRORS:\n" + errors.join("\n"));
await browser.close();
