import { Game } from "./game/game";

const app = document.getElementById("app");
if (!app) throw new Error("Missing #app container");

// Let the loading screen paint before the (synchronous) texture painting and level building.
requestAnimationFrame(() =>
  setTimeout(() => {
    try {
      new Game(app);
    } catch (err) {
      console.error(err);
      const boot = document.getElementById("boot");
      boot?.querySelector(".bar")?.remove();
      boot?.insertAdjacentHTML(
        "beforeend",
        `<div class="err">REMNANT couldn't start. It needs WebGL — try another browser, or turn on hardware acceleration.</div>`
      );
    }
  })
);
