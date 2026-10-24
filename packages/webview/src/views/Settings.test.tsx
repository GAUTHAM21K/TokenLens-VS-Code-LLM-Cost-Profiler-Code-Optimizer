/**
 * Tests: Settings View Unit Tests (T053, US1, FR-001-FR-007).
 *
 * Exports: none (test suite)
 * Feature: settings / API keys
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Settings } from "./Settings";
import { vscodeBridge } from "../protocol/vscode";
import type { Provider, Model } from "@token-optimizer/core";

describe("Settings View Unit Tests (T053, US1, FR-001-FR-007)", () => {
  const mockProviders: Provider[] = [
    {
      id: "anthropic",
      label: "Anthropic Claude",
      adapterType: "anthropic",
      keyFormatHint: "sk-ant-...",
      enabled: true,
    } as unknown as Provider,
    {
      id: "copilot",
      label: "GitHub Copilot",
      adapterType: "host-lm",
      keyFormatHint: "N/A",
      enabled: true,
    } as unknown as Provider,
  ];

  const mockModels: Model[] = [
    {
      id: "claude-3-5-sonnet",
      providerId: "anthropic",
      label: "Claude 3.5 Sonnet",
      status: "active",
    } as unknown as Model,
    {
      id: "claude-3-5-haiku",
      providerId: "anthropic",
      label: "Claude 3.5 Haiku",
      status: "active",
    } as unknown as Model,
  ];

  const mockConfiguredKeys = [
    {
      providerId: "anthropic",
      keySlot: 0,
      maskedKey: "...1234",
      enabledModels: ["claude-3-5-sonnet"],
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders configured keys with masked key and enabled model chips", () => {
    render(
      <Settings
        platform="vscode"
        configuredKeys={mockConfiguredKeys}
        copilotAvailable={true}
        providers={mockProviders}
        models={mockModels}
      />
    );

    expect(screen.getByText("...1234")).toBeDefined();
    expect(screen.getByText("Claude 3.5 Sonnet")).toBeDefined();
  });

  it("clears key input upon submitting auth/saveKey", () => {
    const postSpy = vi.spyOn(vscodeBridge, "postMessage").mockImplementation(() => {});

    render(
      <Settings
        platform="vscode"
        configuredKeys={[]}
        copilotAvailable={true}
        providers={mockProviders}
        models={mockModels}
      />
    );

    const input = screen.getByPlaceholderText(/Paste key here/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "sk-ant-newkey999" } });
    expect(input.value).toBe("sk-ant-newkey999");

    const saveBtn = screen.getByText("Save Key");
    fireEvent.click(saveBtn);

    // Input must be cleared immediately (Principle I)
    expect(input.value).toBe("");

    expect(postSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "auth/saveKey",
        payload: {
          providerId: "anthropic",
          keySlot: 0,
          key: "sk-ant-newkey999",
        },
      })
    );
  });

  it("dispatches auth/removeKey when remove button is clicked", () => {
    const postSpy = vi.spyOn(vscodeBridge, "postMessage").mockImplementation(() => {});

    render(
      <Settings
        platform="vscode"
        configuredKeys={mockConfiguredKeys}
        copilotAvailable={true}
        providers={mockProviders}
        models={mockModels}
      />
    );

    const removeBtn = screen.getByTitle("Remove Key from Keychain");
    fireEvent.click(removeBtn);

    expect(postSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "auth/removeKey",
        payload: {
          providerId: "anthropic",
          keySlot: 0,
        },
      })
    );
  });

  it("hides host-lm row when copilotAvailable is false", () => {
    render(
      <Settings
        platform="vscode"
        configuredKeys={[]}
        copilotAvailable={false}
        providers={mockProviders}
        models={mockModels}
      />
    );

    // Host LM row should not be rendered
    expect(screen.queryByText("GitHub Copilot Mode")).toBeNull();
  });

  it("shows host-lm row when copilotAvailable is true", () => {
    render(
      <Settings
        platform="vscode"
        configuredKeys={[]}
        copilotAvailable={true}
        providers={mockProviders}
        models={mockModels}
      />
    );

    expect(screen.getByText("GitHub Copilot Mode")).toBeDefined();
  });
});
