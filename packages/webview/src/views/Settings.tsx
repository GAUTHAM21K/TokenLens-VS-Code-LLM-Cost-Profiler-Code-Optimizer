/**
 * Settings tab: provider API keys, enabled models and platform.
 *
 * Exports: ConfiguredKey, SettingsProps, Settings
 * Feature: settings / API keys
 */
import React, { useState } from "react";
import { KeyRound, ShieldCheck, Trash2, Cpu, EyeOff, CheckSquare, Square } from "lucide-react";
import { vscodeBridge } from "../protocol/vscode";
import type { Provider, Model } from "@token-optimizer/core";

export interface ConfiguredKey {
  providerId: string;
  keySlot: number;
  maskedKey: string;
  enabledModels: string[];
}

export interface SettingsProps {
  platform: string;
  configuredKeys: ConfiguredKey[];
  copilotAvailable: boolean;
  providers?: Provider[];
  models?: Model[];
  initialCopilotOnly?: boolean;
}

export const Settings: React.FC<SettingsProps> = ({
  platform,
  configuredKeys,
  copilotAvailable,
  providers = [],
  models = [],
  initialCopilotOnly = false,
}) => {
  const activeProviders = providers.filter((p) => p.enabled !== false && p.adapterType !== "host-lm");
  const hostLmProvider = providers.find((p) => p.adapterType === "host-lm");

  const [selectedProvider, setSelectedProvider] = useState(activeProviders[0]?.id || "anthropic");
  const [keyInput, setKeyInput] = useState("");
  const [copilotOnly, setCopilotOnly] = useState(initialCopilotOnly);

  const handleSaveKey = () => {
    if (!keyInput.trim()) return;

    const existingSlots = configuredKeys
      .filter((k) => k.providerId === selectedProvider)
      .map((k) => k.keySlot);
    const nextSlot = existingSlots.length > 0 ? Math.max(...existingSlots) + 1 : 0;

    vscodeBridge.postMessage({
      version: 1,
      type: "auth/saveKey",
      payload: {
        providerId: selectedProvider,
        keySlot: nextSlot,
        key: keyInput.trim(),
      },
    });

    // Principle I: Clear raw key from component memory immediately!
    setKeyInput("");
  };

  const handleRemoveKey = (providerId: string, keySlot: number) => {
    vscodeBridge.postMessage({
      version: 1,
      type: "auth/removeKey",
      payload: {
        providerId,
        keySlot,
      },
    });
  };

  const handleToggleModel = (providerId: string, modelId: string, currentEnabled: string[]) => {
    const next = currentEnabled.includes(modelId)
      ? currentEnabled.filter((id) => id !== modelId)
      : [...currentEnabled, modelId];

    vscodeBridge.postMessage({
      version: 1,
      type: "auth/setEnabledModels",
      payload: {
        providerId,
        enabledModels: next,
      },
    });
  };

  const handleToggleCopilotOnly = (checked: boolean) => {
    setCopilotOnly(checked);
    vscodeBridge.postMessage({
      version: 1,
      type: "auth/setCopilotOnly",
      payload: {
        copilotOnly: checked,
      },
    });
  };

  const currentProviderHint = activeProviders.find((p) => p.id === selectedProvider)?.keyFormatHint;

  return (
    <div className="space-y-6">
      {/* Security Notice */}
      <div className="glass-panel p-4 rounded-xl border border-indigo-500/30 bg-indigo-950/20 text-xs text-indigo-300 flex items-start gap-3">
        <ShieldCheck className="w-5 h-5 text-indigo-400 shrink-0 mt-0.5" />
        <div>
          <span className="font-semibold block text-indigo-200">
            Constitution Principle I Enforced
          </span>
          API keys are write-only in the webview. Once submitted, raw keys are stored exclusively
          in VS Code SecretStorage and never returned to the webview or logged.
        </div>
      </div>

      {/* Add New Key Form */}
      <div className="glass-panel p-5 rounded-xl border border-slate-800 space-y-4">
        <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
          <KeyRound className="w-3.5 h-3.5 text-indigo-400" />
          <span>Add Provider API Key</span>
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
          <div>
            <label className="text-slate-400 block mb-1">Target Provider</label>
            <select
              value={selectedProvider}
              onChange={(e) => setSelectedProvider(e.target.value)}
              className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-slate-200 focus:outline-none focus:border-indigo-500"
            >
              {activeProviders.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-slate-400 block mb-1">Active Platform</label>
            <div className="bg-slate-900/60 border border-slate-800 rounded-lg p-2.5 text-slate-300 font-mono">
              {platform || "vscode"}
            </div>
          </div>
        </div>

        <div>
          <label className="text-slate-400 block mb-1 text-xs">
            API Secret Key ({currentProviderHint || "write-only"})
          </label>
          <div className="flex gap-2">
            <input
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              placeholder="Paste key here (write-only)..."
              className="flex-1 bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 font-mono"
            />
            <button
              onClick={handleSaveKey}
              disabled={!keyInput.trim()}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-lg text-xs font-semibold transition-colors"
            >
              Save Key
            </button>
          </div>
        </div>
      </div>

      {/* Configured Keys & Model Selection List */}
      <div className="glass-panel p-5 rounded-xl border border-slate-800 space-y-4">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
          Configured Provider Keys & Enabled Models
        </h3>

        {configuredKeys.length > 0 ? (
          <div className="space-y-4">
            {configuredKeys.map((k) => {
              const providerModels = models.filter((m) => m.providerId === k.providerId);
              return (
                <div
                  key={`${k.providerId}-${k.keySlot}`}
                  className="p-3.5 rounded-lg border border-slate-850 bg-slate-900/50 space-y-3"
                >
                  <div className="flex items-center justify-between text-xs">
                    <div>
                      <span className="font-semibold text-slate-200 uppercase">
                        {k.providerId} [slot {k.keySlot}]
                      </span>
                      <div className="flex items-center gap-1.5 text-slate-400 font-mono text-[11px] mt-0.5">
                        <EyeOff className="w-3 h-3 text-slate-500" />
                        <span>{k.maskedKey}</span>
                      </div>
                    </div>

                    <button
                      onClick={() => handleRemoveKey(k.providerId, k.keySlot)}
                      className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-rose-950/30 rounded transition-colors"
                      title="Remove Key from Keychain"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {/* Model Multi-Select (FR-002) */}
                  {providerModels.length > 0 && (
                    <div className="pt-2 border-t border-slate-800/80">
                      <span className="text-[11px] font-medium text-slate-400 block mb-1.5">
                        Enabled Models for Optimization:
                      </span>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                        {providerModels.map((m) => {
                          const isEnabled = k.enabledModels.includes(m.id);
                          return (
                            <button
                              key={m.id}
                              type="button"
                              onClick={() => handleToggleModel(k.providerId, m.id, k.enabledModels)}
                              className="flex items-center gap-2 p-1.5 rounded hover:bg-slate-800/50 text-left text-xs text-slate-300 transition-colors"
                            >
                              {isEnabled ? (
                                <CheckSquare className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                              ) : (
                                <Square className="w-3.5 h-3.5 text-slate-600 shrink-0" />
                              )}
                              <span className="truncate">{m.label}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-center py-6 text-xs text-slate-500">
            No API keys configured.
          </div>
        )}
      </div>

      {/* Host LM (Copilot) Option (Shown only when its adapter is available, FR-007) */}
      {copilotAvailable && hostLmProvider && (
        <div className="glass-panel p-5 rounded-xl border border-slate-800 flex items-center justify-between flex-wrap gap-y-2">
          <div className="flex items-center gap-3">
            <Cpu className="w-5 h-5 text-indigo-400" />
            <div>
              <span className="text-xs font-semibold text-slate-200 block">
                {hostLmProvider.label} Mode
              </span>
              <p className="text-[11px] text-slate-400">
                Use built-in Language Model API directly without third-party API keys.
              </p>
            </div>
          </div>

          <input
            type="checkbox"
            checked={copilotOnly}
            onChange={(e) => handleToggleCopilotOnly(e.target.checked)}
            className="rounded border-slate-700 text-indigo-600 focus:ring-0 bg-slate-950 w-4 h-4 cursor-pointer"
          />
        </div>
      )}
    </div>
  );
};
