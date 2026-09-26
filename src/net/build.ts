/** This copy of the game's build id (see vite.config.ts), or "dev" where it isn't defined. */
export const BUILD_ID: string = typeof __BUILD_ID__ === "string" ? __BUILD_ID__ : "dev";
