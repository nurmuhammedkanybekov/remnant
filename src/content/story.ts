/** Narrative text that isn't tied to a level: the prologue and the endings. See docs/STORY.md. */

export const PROLOGUE = {
  title: "OBJECT 9",
  lines: [
    "1961. The Soviet Union cuts a research station two and a half kilometres into the Tian Shan mountains. Officially, it studies geothermal energy.",
    "1987. At the bottom of the deepest shaft, the drill breaks into a cavity lined with something that is neither rock nor tissue. The researchers call it the Remnant.",
    "1991. The station is sealed and struck from every record.",
    "Now. A mining consortium reopens Object 9 to strip it for rare earth metals. Forty-one contractors go down. Eleven days ago, the shafts collapsed behind them.",
    "You are Nur Kanybekov, structural engineer. You wake up on Sublevel 10.",
  ],
};

/** Part One ends in "seal" or "leave"; Part Two in "silence" or "dawn". */
export type EndingId = "seal" | "leave" | "silence" | "dawn";

export const ENDING_IDS: readonly EndingId[] = ["seal", "leave", "silence", "dawn"];

export function isEndingId(v: unknown): v is EndingId {
  return typeof v === "string" && (ENDING_IDS as readonly string[]).includes(v);
}

/** Part Two's opening, after either ending of Part One. */
export const PROLOGUE_TWO = {
  title: "THE VALLEY",
  lines: [
    "Three weeks after Object 9. You woke in the clinic at Ak-Suu, the village at the foot of the mountain, with frostbite and no memory of the walk down.",
    "The snow melted early this year. The meltwater came down the mountain, through the old drainage tunnels, into the wells.",
    "Last night the clinic radio switched itself on. Nobody has touched it since the Soviets left. A calm voice asked if anyone could hear it.",
    "This morning the village is empty.",
    "You are Nur Kanybekov. You know that voice.",
  ],
};

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
  silence: {
    title: "SILENCE",
    tag: "THE CHOIR STOPS SINGING",
    lines: [
      "The charges were meant for the whole mountain. They take the cavity, the shaft and the Source with it, and the ground under the valley drops a metre and stays there.",
      "Every radio in Ak-Suu goes quiet at the same moment. Then the wells go quiet. Then the dogs.",
      "In spring, people come back to the village. The meltwater runs clear. Nobody talks about Object 9, and nobody hears it talking back.",
    ],
  },
  dawn: {
    title: "DAWN",
    tag: "YOU WALK OUT A SECOND TIME",
    lines: [
      "The Choir is dead. Its voices go out one by one, like lamps down a corridor, until there is only yours.",
      "You climb out of the drainage tunnel into a pink, freezing morning. The valley is white and very still.",
      "Far off, a radio you left in the clinic crackles once. Then nothing. You tell yourself that nothing is all it was.",
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

/**
 * What a Mimic says in the Operator's voice to draw you in. It has been
 * listening to the radio too.
 */
export const MIMIC_LINES = [
  "Nur. Over here.",
  "This way. Quickly. I found a way up.",
  "Nur? Can you hear me? Follow my voice.",
  "It's safe in here. Come and see.",
  "Keep going, Nur. Nearly there. This way.",
];

/** Radio fragments that scroll along the bottom of the main menu. */
export const TRANSMISSIONS = [
  "…is anyone on ten? Anyone at all? Pick up the intercom…",
  "…stay off the main corridors. They follow the noise…",
  "…the lift needs all three generators. Come up to me, Nur…",
  "…this is Voss. If you're reading this, don't answer the radio…",
  "…forty-one on the manifest. Forty-one voices on the channel…",
  "…Zenit control, do you copy. Zenit control. Zenit…",
  "…we only want to see the sky…",
  "…Ak-Suu clinic, Ak-Suu clinic, is anyone at the radio…",
  "…the wells taste of iron. Don't drink the water, Nur…",
  "…the observatory still has power. Something is using it…",
];
