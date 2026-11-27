// marketlens-core 的类型。实现是 web/js/core/ 的普通脚本（由 core/build.js 拼成一个文件），这里手写、只描述对外的接口。
// 内部结构（指标、情景的细节）只标了调用方用得到的字段，其余留作 unknown。
// 约定：这些函数只算事实（方向、价位、距离），不给买卖建议；规则的回测没有发现可靠优势（docs/BACKTEST.md）。

export type Tf = '15m' | '1h' | '4h' | '1d' | '1w' | '1M';
/** 一根K线。timestamp 是这根K线的开始时间（毫秒，UTC）；数组按时间从旧到新，最后一根可以还没收盘。 */
export interface Candle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}
export type Bias = 1 | 0 | -1;

/** 一个周期的上下文（ctx 的结果）。只用已收盘的K线。 */
export interface Ctx {
  tf: Tf;
  /** 已收盘K线的根数。 */
  n: number;
  /** 根数够不够（一般要 100 根，月线 60 根）；不够时方向只作参考。 */
  ok: boolean | 0 | 1;
  /** 指标与评分；已收盘K线太少时为 null（这时下面几项都没有）。a.a 是 ATR，a.c 是最后一根收盘。 */
  a: ({ a: number; c: number; s: number; rsi: number } & Record<string, unknown>) | null;
  /** 方向：EMA20 / EMA50 与收盘的位置，1 偏多、-1 偏空、0 震荡。 */
  bias?: Bias;
  /** 最后一根已收盘K线的开始时间。 */
  asof?: number;
  [k: string]: unknown;
}

/** 多周期合并出来的一个价位。 */
export interface Level {
  /** 价格。 */
  p: number;
  /** 这个价位来自的最大周期。 */
  top: Tf;
  /** 参与的周期，大的在前。 */
  tfs: Tf[];
  /** 各周期权重之和。 */
  w: number;
  /** 相对算的时候的价格：1 在下方（支撑），-1 在上方（阻力）。 */
  side: 1 | -1;
  /** 本周期最近 150 根里在这里被挡回的次数。 */
  touch: number;
  zlo: number;
  zhi: number;
}

/** analyzeMTF 的结果。s / v / st / sc 是规则评分、结论和情景：回测没有可靠优势，不要当成建议说给人听。 */
export interface Mtf {
  s: number;
  adj: number;
  raw: Bias;
  v: Bias;
  st: string;
  conf: number;
  chain: { tf: Tf; t: string; d?: Bias }[];
  why: string[];
  /** 本周期的上下文。t.a.a 是 ATR。 */
  t: Ctx & { a: NonNullable<Ctx['a']>; asof: number };
  /** 范围内的全部价位；关键的那些用 isKey 筛。 */
  L: Level[];
  want: Bias;
  sc: unknown[];
}

export interface Analysis {
  tf: Tf;
  /** 各周期的上下文（tf 和比它大的、给了K线的周期）。 */
  C: Partial<Record<Tf, Ctx>>;
  /** 最新价；一根K线都没有时为 null。 */
  px: number | null;
  /** 已收盘K线不足时为 null。 */
  m: Mtf | null;
}

export const VERSION: string;
/** 全部周期，从小到大。 */
export const TFS: Tf[];
/** 周期念出来的说法（'1h' → '1 小时'，'1d' → '日线'）。 */
export const TFN: Record<Tf, string>;
/** 一根K线的下一根从什么时候开始。 */
export function nxt(tf: Tf, timestamp: number): number;
/** 去掉最后那根还没收盘的K线（按现在的时间判断）。 */
export function closed(tf: Tf, candles: Candle[]): Candle[];

/** 一个周期的上下文。 */
export function ctx(tf: Tf, candles: Candle[]): Ctx;
/** 自上而下的多周期分析。C 里要有 tf 本身；now 是最新价，只用来判断价位在上方还是下方。 */
export function analyzeMTF(tf: Tf, C: Partial<Record<Tf, Ctx>>, now?: number): Mtf | null;
/**
 * 从各周期K线直接得到分析。all 里要有 tf 本身，更大的周期有几个算几个（越全，大周期方向和价位越可靠）；
 * 每个周期给最近 500 根左右。px 不给时用 tf 最后一根的收盘。tf 不认识时抛错。
 */
export function analyzeCandles(tf: Tf, all: Partial<Record<Tf, Candle[]>>, px?: number): Analysis;
/** 某周期相对 px 的前高、前低（hi / lo），以及刚被突破、跌破的那个（hiB / loB）。 */
export function prevHL(
  z: Ctx | undefined,
  px: number
): Partial<Record<'hi' | 'lo' | 'hiB' | 'loB', { p: number; ts: number }>>;
/** 是不是关键价位：多个周期都有，或被挡回 3 次以上，或来自更大的周期。 */
export function isKey(level: Level, tf: Tf): boolean;
/** 每侧最多 3 个主要价位（页面图上画的那几条）。 */
export function mainLv(levels: Level[], px: number, atr: number, tf: Tf): { sup: Level[]; res: Level[] };

export interface StateFacts {
  tf: Tf;
  px: number | null;
  atr: number | null;
  /** 从大周期到 tf。bias 为 null 是K线太少；ok 为 false 是根数偏少、仅作参考。 */
  trend: { tf: Tf; bias: Bias | null; ok: boolean }[];
  /** 最近的关键支撑 / 阻力；atr 是离现价几个 ATR。没有算出来时为 null。 */
  support: { price: number; tfs: Tf[]; touch: number; atr: number } | null;
  resistance: { price: number; tfs: Tf[]; touch: number; atr: number } | null;
  /** 分析用到的最后一根已收盘K线的开始时间。 */
  asof: number | null;
}
/**
 * 把分析压成几句只有事实的话：现价、各周期方向、离最近的关键支撑和阻力多远、平常的波动。
 * 不带评分、结论和情景。name 是念出来的品种名（“黄金 GOLD”），dp 是价格小数位（默认 2）。
 */
export function describeState(o: Analysis & { name: string; dp?: number }): { text: string; lines: string[]; facts: StateFacts };

/** 分析包的输入，见 web/js/core/aipack.js 开头的说明。 */
export interface PackInput {
  item: { sym: string; name: string; p: number; source: string };
  tf: Tf;
  all: Partial<Record<Tf, Candle[]>>;
  C: Partial<Record<Tf, Ctx>>;
  m: Mtf | null;
  now: number;
  tz?: string;
  market?: string | null;
  events?: { coverage?: string; list?: unknown[]; data?: unknown[]; ccy?: string[] } | null;
  news?: { coverage?: string; items?: unknown[] } | null;
  trades?: { demo?: boolean; open?: unknown[]; closed?: unknown[] } | null;
}
/** 给 AI 的分析包（JSON）：多周期状态、价位、情景、K线、事件、新闻标题。新闻标题是未核实的外部文字。 */
export function buildPack(input: PackInput): Record<string, unknown>;
/** 提问模板 + 分析包，可以直接交给 AI。 */
export function packPrompt(pack: Record<string, unknown>): string;

/** 预警的布防状态，原样存起来、下次再传进来。sc 为 null 时这一次只建立基准、不提醒。 */
export interface AlertState {
  arm: Record<string, boolean>;
  sc: Record<string, string> | null;
}
export type AlertHit = { type: 'lv'; l: Level } | { type: 'sc' | 'scx'; g: Record<string, unknown> };
/**
 * 这一次该发哪些提醒（原地更新 st）。价位：进入 ±0.15 ATR 提醒一次，离开 0.5 ATR 后重新布防；
 * 第一次见到时已经在范围内的不提醒。情景：新触发的、触发后失效或到目标的。lv / sc 传 0 可以关掉那一类。
 */
export function alCheck(m: Mtf, tf: Tf, px: number, st: AlertState, opt?: { lv?: 0 | 1; sc?: 0 | 1; dp?: number }): AlertHit[];
/** 一条提醒的文字：text 给人看（信息密），say 给语音念（短）；ck 是类型 lv / sc / scx。 */
export function alText(
  hit: AlertHit,
  o: { sym: string; name: string; T: Tf; px: number; dp?: number }
): { text: string; say: string; kind: string; ck: 'lv' | 'sc' | 'scx' };

/* ===== 情境（0.3.0 起）：都只列数，不说谁带动谁，也不由此推以后 ===== */

/** 相关品种里的一样（relRow 的结果）。pct 时变化是比例（0.0031 = +0.31%），bp 时是基点。 */
export interface RelRow {
  /** 最新一根的收盘，和它是哪一天的。 */
  last: number;
  ts: number;
  /** 最新一根比前一根、比 5 根之前；K线不到 6 根时 d5 为 null。 */
  d1: number;
  d5: number | null;
  /** 近的那个相关用了几个共同的交易日（最多 20）、相关系数；不到 12 个或有一边没动时 r 为 null。 */
  n: number;
  r: number | null;
  /** 1 同向、-1 反向、0 看不出（|r| 不到 0.55）、null 没算出来。 */
  rel: Bias | null;
  /** 长的那个（最多 60 个交易日）：比近的多才有；relL 要至少 40 个交易日、|rL| 到 0.33 才给方向。 */
  nL: number | null;
  rL: number | null;
  relL: Bias | null;
}
/**
 * 一样相关的东西最近动了多少、和被比的那个是一起动还是反着动。base、bars 是两边的日线（旧到新，只用 timestamp 和 close）。
 * 相关按两边都有K线的日子算（一边休市的那天两边都跳过）。unit 是 'bp' 时变化按基点（收益率这类本身是百分数的）。K线不到 2 根返回 null。
 */
export function relRow(
  base: Pick<Candle, 'timestamp' | 'close'>[],
  bars: Pick<Candle, 'timestamp' | 'close'>[],
  opt?: { unit?: 'pct' | 'bp'; win?: number; long?: number }
): RelRow | null;
/** 一个变化写成字：'+0.31%'、'−4.3 基点'；null 写成 '—'。 */
export function relChg(v: number | null, unit?: 'pct' | 'bp'): string;
/**
 * 几样合成一句：“最近 20 个交易日：白银期货和黄金多半同涨同跌；美元指数和黄金看不出明显关系。”
 * rows 里每项是 relRow 的结果加一个 name；没算出相关的（rel 为 null）不提。name 是被比的那个品种念出来的名字。一条都没有时返回空串。
 */
export function relText(rows: (({ name: string } & Pick<RelRow, 'n' | 'rel'> & Partial<Pick<RelRow, 'r' | 'nL' | 'relL'>>) | null)[], name: string): string;

/** CFTC 每周持仓报告里的一期：管理基金（Managed Money）的多、空手数和总未平仓。marketlens-core/data 的 createCftc 取回来的就是这个。 */
export interface CotRow {
  /** 那一期是哪天的（UTC 零点，通常是周二）。 */
  ts: number;
  oi: number;
  long: number;
  short: number;
}
export interface CotState {
  ts: number;
  long: number;
  short: number;
  /** 净多 = 多减空；负数是净空。 */
  net: number;
  oi: number;
  prev: { ts: number; long: number; short: number; net: number } | null;
  /** 和之前几期比（最多 52 期）、其中几期的净多比这一期低；能比的不到 10 期时 pct 为 null。 */
  n: number;
  below: number;
  pct: number | null;
}
/** 最新一期的净多、前一期、在之前 52 期里排在哪。rows 旧到新；一期都没有返回 null。 */
export function cotState(rows: CotRow[]): CotState | null;
/**
 * 写成一句：“截至 11 月 17 日（周二）：管理基金在黄金期货上净多 102,942 手（多 121,994、空 19,052），前一期是净多 112,341 手；之前 52 期里有 35% 比这一期低。”
 * 这是至少三天前的持仓，不是信号：别说成“看涨 / 看跌”。name 是合约念出来的名字。
 */
export function cotText(v: CotState, o: { name: string; who?: string }): string;

/** 一次 AI 分析的记录（server/ailog.js 存的那些字段里打分要用的）。 */
export interface AiRecord {
  id: string;
  at: number;
  bias?: string | null;
  price: number;
  atr: number;
  barTime?: number | null;
}
export interface AiScore {
  id: string;
  dir: Bias;
  at: number;
  5: { move: number; signed: number | null; hit: boolean | null } | null;
  20: { move: number; signed: number | null; hit: boolean | null } | null;
}
/** 按之后第 5 / 20 根已收盘K线给一条记录打分（按 ATR 计、乘以方向）；还没走到的是 null。 */
export function scoreAi(record: AiRecord, candles: Candle[], tf: Tf): AiScore;
/** 汇总某个持有期：能打分的笔数、方向对的笔数、平均值，10 笔以上给粗略的 95% 区间。 */
export function aiStats(
  scored: AiScore[],
  h: 5 | 20
): { h: number; n: number; hits: number; mean: number | null; ci: [number, number] | null; neutral: number; pending: number };
