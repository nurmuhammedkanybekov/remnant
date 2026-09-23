import { Game } from "./game";

const app = document.getElementById("app");
if (!app) throw new Error("Missing #app container");

new Game(app);
