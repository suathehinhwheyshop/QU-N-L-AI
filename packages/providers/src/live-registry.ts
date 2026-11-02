import { openaiWire } from "./openai";
import { anthropicWire } from "./anthropic";
import { googleWire } from "./google";
import { xaiWire } from "./xai";
import { createLiveAdapter } from "./live-adapter";
export const wires = [openaiWire, anthropicWire, googleWire, xaiWire];
export const liveProviders = wires.map((wire) => createLiveAdapter(wire));
