// Tipos generados desde el contrato de Python (npm run types). No editar a mano api-types.ts.
import type { components } from "./api-types";

type S = components["schemas"];
export type LiveState = S["LiveState"];
export type Settings = S["Settings"];
export type Content = S["Content"];
export type RuleStatus = S["RuleStatus"];
export type WsMsg = S["WSMessage"]["msg"];
export type EventMsg = Exclude<WsMsg, LiveState>;
export type Preview = Settings["preview"];
export type AlbumItem = S["AlbumItem"];
export type PackOpened = Extract<EventMsg, { type: "pack_opened" }>;
export type WeekResponse = S["WeekResponse"];
export type Summary = S["Summary"];
export type SummaryPayload = S["SummaryPayload"];
export type AIStatus = S["AIStatus"];
export type PingResult = S["PingResult"];
export type DayStat = S["DayStat"];
export type SlotStat = S["SlotStat"];
