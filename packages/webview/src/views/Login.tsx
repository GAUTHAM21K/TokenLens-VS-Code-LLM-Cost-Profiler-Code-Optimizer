/**
 * Login/API-key onboarding view (currently unused by App).
 *
 * Exports: LoginProps, Login
 * Feature: settings / API keys
 */
import React, { useState } from "react";
import { KeyRound, ShieldCheck, CheckCircle2, ArrowRight, Cpu } from "lucide-react";
import { vscodeBridge } from "../protocol/vscode";
import type { Provider } from "@token-optimizer/core";

export interface LoginProps {
  providers: Provider[];
  configuredKeys: Array<{
    providerId: string;
    keySlot: number;
    maskedKey: string;
    enabledModels: string[];
  }>;
  copilotAvailable: boolean;
  onNavigateToEnhance?: () => void;
  onNavigateToSettings?: () => void;
}

export const Login: React.FC<LoginProps> = ({
  providers,
  configuredKeys,
  copilotAvailable,
  onNavigateToEnhance,
  onNavigateToSettings,
}) => {
  const activeProviders = providers.filter((p) => p.enabled !== false && p.adapterType !== "host-lm");
  const hostLmProvider = providers.find((p) => p.adapterType === "host-lm");

  const [selectedProviderId, setSelectedProviderId] = useState(
    activeProviders[0]?.id || "anthropic"
  );
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const selectedProvider = activeProviders.find((p) => p.id === selectedProviderId);
  const isConnected = configuredKeys.length > 0;

  const handleSaveKey = () => {
    if (!apiKeyInput.trim()) return;

    setIsSubmitting(true);
    vscodeBridge.postMessage({
      version: 1,
      type: "auth/saveKey",
      payload: {
        providerId: selectedProviderId,
        keySlot: 0,
        key: apiKeyInput.trim(),
      },
    });

    // Principle I: Clear raw key from component memory immediately!
    setApiKeyInput("");
    setTimeout(() => setIsSubmitting(false), 800);
  };

  const handleUseCopilot = () => {
    vscodeBridge.postMessage({
      version: 1,
      type: "auth/setCopilotOnly",
      payload: {
        copilotOnly: true,
      },
    });
    if (onNavigateToEnhance) onNavigateToEnhance();
  };

  return (
    <div className="space-y-6 max-w-lg mx-auto py-2">
      {/* Title */}
      <div className="text-center space-y-1.5">
        <h2 className="text-base font-bold text-slate-100 flex items-center justify-center gap-2">
          <KeyRound className="w-5 h-5 text-indigo-400" />
          <span>Connect Provider</span>
        </h2>
        <p className="text-xs text-slate-400">
          Add an API key to run estimates and project optimizations. Keys never leave this machine.
        </p>
      </div>

      {/* Security Assurance Badge */}
      <div className="glass-panel p-3.5 rounded-xl border border-indigo-500/20 bg-indigo-950/20 text-xs text-indigo-300 flex items-start gap-2.5">
        <ShieldCheck className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
        <div>
          <span className="font-semibold block text-indigo-200 text-[11px]">
            Device-Only Secret Storage (Principle I)
          </span>
          Your API keys are stored solely inside VS Code's SecretStorage keychain. No proxies, relays, or cloud loggers ever see your key.
        </div>
      </div>

      {/* Connected Status Card if already connected */}
      {isConnected && (
        <div className="p-4 rounded-xl border border-emerald-500/30 bg-emerald-950/20 text-xs text-emerald-300 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <div>
              <span className="font-semibold block text-emerald-200">
                {configuredKeys.length} Provider Key{configuredKeys.length > 1 ? "s" : ""} Configured
              </span>
              <span className="text-[11px] text-emerald-400/80 font-mono">
                {configuredKeys.map((k) => `${k.providerId} (${k.maskedKey})`).join(", ")}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {onNavigateToSettings && (
              <button
                type="button"
                onClick={onNavigateToSettings}
                className="px-3 py-1.5 border border-emerald-600/40 hover:border-emerald-500 text-emerald-300 rounded-lg text-xs font-semibold transition-colors"
              >
                Settings
              </button>
            )}
            {onNavigateToEnhance && (
              <button
                type="button"
                onClick={onNavigateToEnhance}
                className="flex items-center gap-1 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold transition-colors"
              >
                <span>Continue</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* Provider & Key Input Card */}
      <div className="glass-panel p-5 rounded-xl border border-slate-800 space-y-4">
        <div>
          <label className="text-xs font-semibold text-slate-300 block mb-1.5">
            Select LLM Provider
          </label>
          <div className="grid grid-cols-2 gap-2">
            {activeProviders.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setSelectedProviderId(p.id)}
                className={`p-2.5 rounded-lg border text-left transition-colors text-xs flex flex-col gap-0.5 ${
                  selectedProviderId === p.id
                    ? "bg-indigo-600/20 border-indigo-500 text-indigo-200"
                    : "bg-slate-900 border-slate-800 text-slate-400 hover:border-slate-700"
                }`}
              >
                <span className="font-medium">{p.label}</span>
                {p.keyFormatHint && (
                  <span className="text-[10px] text-slate-500 font-mono">
                    {p.keyFormatHint}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="text-xs font-semibold text-slate-300 block mb-1.5">
            API Secret Key
          </label>
          <div className="flex gap-2">
            <input
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={apiKeyInput}
              onChange={(e) => setApiKeyInput(e.target.value)}
              placeholder={`Enter ${selectedProvider?.label || ""} key...`}
              className="flex-1 bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 font-mono"
            />
            <button
              type="button"
              onClick={handleSaveKey}
              disabled={!apiKeyInput.trim() || isSubmitting}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-lg text-xs font-semibold transition-colors shrink-0"
            >
              {isSubmitting ? "Validating..." : "Save Key"}
            </button>
          </div>
        </div>
      </div>

      {/* Host LM (Copilot) Option (Shown only when available, FR-007) */}
      {copilotAvailable && hostLmProvider && (
        <div className="glass-panel p-4 rounded-xl border border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Cpu className="w-5 h-5 text-indigo-400" />
            <div>
              <span className="text-xs font-semibold text-slate-200 block">
                {hostLmProvider.label} Mode Available
              </span>
              <p className="text-[11px] text-slate-400">
                Use your active IDE Language Model without providing external API keys.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleUseCopilot}
            className="px-3 py-1.5 border border-slate-700 hover:border-slate-600 text-slate-300 rounded-lg text-xs font-medium transition-colors"
          >
            Use {hostLmProvider.label}
          </button>
        </div>
      )}
    </div>
  );
};
