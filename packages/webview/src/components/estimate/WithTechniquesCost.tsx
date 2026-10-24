/**
 * "With selected techniques" cost for the Estimate tab. Pure helpers apply savings to a cost: per
 * channel when the estimate splits the cost into input and output (input techniques discount only
 * input spend, output techniques only output spend), else the compounded total range. A hook keeps
 * the host's latest `strategy/savingsUpdate` and asks for an evaluation of the current profile, and
 * a cell renders the reduced cost range.
 *
 * Exports: costWithSavings, costWithChannelSavings, useTechniqueSavings, TechniqueSavings,
 *   WithTechniquesCost
 * Feature: token cost estimator (techniques savings)
 */
import React, { useEffect, useState } from "react";
import type { SavingsRange } from "@token-optimizer/core";
import { vscodeBridge } from "../../protocol/vscode";
import { formatCost } from "../../utils/format";

export interface ChannelRanges {
  input: SavingsRange;
  output: SavingsRange;
}

export interface TechniqueSavings {
  build: SavingsRange;
  runtime: SavingsRange;
  channels?: { build: ChannelRanges; runtime: ChannelRanges };
}

export interface CacheSavings {
  usd: number;
  percent: number;
}

/** Cost after savings: low uses maxPercent, high uses minPercent. */
export function costWithSavings(cost: number, range: SavingsRange): { low: number; high: number } {
  return {
    low: cost * (1 - range.maxPercent / 100),
    high: cost * (1 - range.minPercent / 100),
  };
}

/** Cost after per-channel savings on an input/output cost split. */
export function costWithChannelSavings(
  input: number,
  output: number,
  ch: ChannelRanges
): { low: number; high: number } {
  const i = costWithSavings(input, ch.input);
  const o = costWithSavings(output, ch.output);
  return { low: i.low + o.low, high: i.high + o.high };
}

/**
 * Latest savings for the selected techniques. Posts `strategy/evaluate` for `profileVersion`
 * (the host keeps an existing selection) so a freshly mounted tab gets a savingsUpdate.
 */
export function useTechniqueSavings(profileVersion?: number): TechniqueSavings | null {
  const [savings, setSavings] = useState<TechniqueSavings | null>(null);

  useEffect(
    () =>
      vscodeBridge.onMessage((msg) => {
        if (msg.type === "strategy/savingsUpdate") {
          setSavings({
            build: msg.payload.build,
            runtime: msg.payload.runtime,
            channels: msg.payload.channels,
          });
        }
      }),
    []
  );

  useEffect(() => {
    if (profileVersion) {
      vscodeBridge.postMessage({ version: 1, type: "strategy/evaluate", payload: { profileVersion } });
    }
  }, [profileVersion]);

  return savings;
}

export const WithTechniquesCost: React.FC<{
  cost: number;
  range: SavingsRange | undefined;
  label: string;
  /** Expected input/output cost split of `cost` (from the estimate), when known. */
  split?: { input?: number; output?: number };
  channels?: ChannelRanges;
  cacheSavings?: CacheSavings;
}> = ({ cost, range, label, split, channels, cacheSavings }) => {
  if (!range) {
    return <span className="text-slate-500 text-[10px] italic">pick techniques</span>;
  }
  if (range.maxPercent === 0 && !channels) {
    return <span className="text-slate-500" aria-label={label}>{formatCost(cost)}</span>;
  }
  const exact = channels && split?.input !== undefined && split.output !== undefined;
  const { low, high } = exact
    ? costWithChannelSavings(split.input!, split.output!, channels)
    : costWithSavings(cost, range);
  const title = exact
    ? `Input ${channels.input.minPercent}–${channels.input.maxPercent}% on ${formatCost(split.input!)} input, ` +
      `output ${channels.output.minPercent}–${channels.output.maxPercent}% on ${formatCost(split.output!)} output`
    : `${range.minPercent}–${range.maxPercent}% savings: ${range.basis}`;
  return (
    <span className="text-emerald-400" aria-label={label} title={title}>
      <span>{formatCost(low)} – {formatCost(high)}</span>
      {exact && (
        <span className="block text-[10px] text-slate-400" aria-label={`${label} channel savings`}>
          Input token savings: {formatCost(split.input! * channels.input.minPercent / 100)}–
          {formatCost(split.input! * channels.input.maxPercent / 100)} ({channels.input.minPercent}–{channels.input.maxPercent}%)
          <br />
          Output token savings: {formatCost(split.output! * channels.output.minPercent / 100)}–
          {formatCost(split.output! * channels.output.maxPercent / 100)} ({channels.output.minPercent}–{channels.output.maxPercent}%)
          {cacheSavings && (
            <>
              <br />Cache hit savings: {formatCost(cacheSavings.usd)} ({cacheSavings.percent.toFixed(1)}%)
            </>
          )}
        </span>
      )}
    </span>
  );
};
