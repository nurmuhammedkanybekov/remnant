/** Narrative text that isn't tied to a level: the prologue and the endings. See docs/STORY.md. */

export const PROLOGUE = {
  title: "OBJECT 9",
  lines: [
    "1961. The Soviet Union cuts a research station two and a half kilometres into the Tian Shan mountains. Officially, it studies geothermal energy.",
    "1987. At the bottom of the deepest shaft, the drill breaks into a cavity lined with something that is neither rock nor tissue. The researchers call it the Remnant.",
    "1991. The station is sealed and struck from every record.",
    "Now. A mining consortium reopens Object 9 to strip it for rare earth metals. Forty-one contractors go down. Eleven days ago, the shafts collapsed behind them.",
    "You are Aida Serik, structural engineer. You wake up on Sublevel 10.",
  ],
};

export type EndingId = "seal" | "leave";

export interface Ending {
  title: string;
  tag: string;
  lines: string[];
}

export const ENDINGS: Record<EndingId, Ending> = {
  seal: {
    title: "SEALED",
    tag: "DAYLIGHT WAS NEVER THE POINT",
    lines: [
      "The charges go off one after another, all the way down the shaft.",
      "The radio screams in forty-one voices, then in one, then goes quiet.",
      "Object 9 is under a mountain again. Nobody will open it this time. There's nobody left who knows it's there.",
    ],
  },
  leave: {
    title: "DAYLIGHT",
    tag: "YOU MADE IT OUT",
    lines: [
      "The blast door grinds open on a white, blinding morning. Snow. Wind. The valley far below.",
      "You walk until the mountain is behind you and you can't hear anything but your own breathing.",
      "Three weeks later, in a village clinic in the valley, a radio nobody has turned on crackles to life. A calm voice asks if anyone can hear it.",
    ],
  },
};
