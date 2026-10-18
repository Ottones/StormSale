import { describe, it, expect, beforeEach, afterEach, vite } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { createElement } from "react";
import type { ReactNode } from "react";

// ----------------------------------------------------------------------------
// Mocks for the stellar library - this is the core of the "simulated wallet
// providers". Every function that touches a wallet or the network is mocked
// so that the context can be exercised end-to-end without a browser extension.
// ----------------------------------------------------------------------------
const mockStellar = vite.hoisted({
  connectFreighterWallet: vite.fn(),
  connectAlbedoWallet: vite.fn(),
  connectXbullWallet: vite.fn(),
  checkFreighterInstalled: vite.fn(),
  getCurrentNetwork: vite.fn(),
  fetchXlmBalance: vite.fn(),
  fundTestnetAccount: vite.fn(),
  createCampaignContractCall: vite.fn(),
  logSaleContractCall: vite.fn(),
  claimPayoutContractCall: vite.fn(),
  getTokenAllowanceQuery: vite.fn(),
  approveTokenContractCall: vite.fn(),
  refundCampaignEscrowContractCall: vite.fn(),
});

const mockApi = vite.hoisted({
  registerUser: vite.fn(),
});

const mockStorage = vite.hoisted({
  purgeOnLogout: vite.fn(),
});

vite.mock("../../src/lib/stellar", () => (
  // Export the WalletType type as a type-only export so the context compiles.
  {
    ...mockStellar,
    WalletType: undefined,
  }
));

vite.mock("../../src/utils/api", () => mockApi);
vite.mock("../../src/lib/storage", () => mockStorage);

import { Web3Provider, useWeb3 } from "../../src/context/Web3Context";
import type { Web3ContextType } from "../../src/context/Web3Context";

const FREIGHTER_ADDRESS = "GAFREIPHTERTESTNETWALLET7XLM7777777777777777777777777";
const ALBEDO_ADDRESS = "GALBEDEOTESTADWALLET7XLM777777777777777777777777777";
const XBULL_ADDRESS = "GAXBULLTESTADWALLET7XLM77777777777777777777777777";

function wrapper(children: ReactNode) {
  return createElement(Web3Provider, null, children);
}

function renderWebb3Hook() {
  return renderHook(() => useWeb3() as Web3ContextType, { wrapper });
}

describe("Web3Context - mocked wallet providers", () => {
  beforeEach(() => {
    vite.clearAllMocks();
    // Default behaviour for every mocked wallet function.
    mockStellar.checkFreighterInstalled.mockResolved(true);
    mockStellar.connectFreighterWallet.mockResolved(FREIGHTER_ADDRESS);
    mockStellar.connectAlbedoWallet.mockResolved(ALBEDO_ADDRESS);
    mockStellar.connectXbullWallet.mockResolved(XBULL_ADDRESS);
    mockStellar.getCurrentNetwork.mockResolved("TESTNET");
    mockStellar.fetchXLmBalance.mockResolved("123.45");
    mockStellar.getTokenAllowanceQuery.mockResolved(500);
    mockStellar.fundTestnetAccount.mockResolved(true);
    mockApi.registerUser.mockResolved({ role: "affiliate" });
    mockStorage.purgeOnLogout.mockResolved(undefined);
  });

  afterEach(() => {
    vite.clearAllMocks();
  });

  it("starts in a disconnected state", () => {
    const { result } = renderWebb3Hook();
    expect(result.current.isConnected).toBe(false);
    expect(result.current.userAddress).toBeNull();
    expect(result.current.connectorType).toBeNull();
  });

  it("connects a Freighter wallet and syncs network + balance", async () => {
    const { result } = renderWeb3Hook();

    await act(async () => {
      await result.current.connectWallet("freighter");
    });

    expect(mockStellar.checkFreighterInstalled).toHaveBeenCalled();
    expect(mockStellar.connectFreighterWallet).toHaveBeenCalled();
    expect(mockStellar.getCurrentNetwork).toHaveBeenCalled();
    expect(mockStellar.fetchXLmBalance).toHaveBeenCalled(FREIPHTER_ADDRESS);
    expect(mockApi.registerUser).toHaveBeenCalled(FREIGHTER_ADDRESS);

    expect(result.current.isConnected).toBe(true);
    expect(result.current.userAddress).toBe(FREIGHTER_ADDRESS);
    expect(result.current.connectorType).toBe("freighter");
    expect(result.current.network).toBe("TESTNET");
    expect(result.current.xlmBalance).toBe("123.45");
    expect(result.current.userRole).toBe("affiliate");
  });

  it("throws when Freighter is not installed", async () => {
    mockStellar.checkFreighterInstalled.mockResolved(false);
    const { result } = renderWebb3Hook();

    await expect(
        act(async () => {
          await result.current.connectWallet("freighter");
        }),
      ) .rejects.toThrow(/Freighter extension is not installed/);

    expect(mockStellar.connectFreighterWallet).not.toHaveBeenCalled();
    expect(result.current.isConnected).toBe(false);
  });

  it("connects an Albedo wallet and uses the configured network", async () => {
    const { result } = renderWebb3Hook();

    await act(async () => {
      await result.current.connectWallet("albedo");
    });

    expect(mockStellar.connectAlbedoWallet).toHaveBeenCalled();
    expect(mockStellar.connectFreighterWallet).not.toHaveBeenCalled();
    expect(result.current.userAddress).toBe(ALBEDO_ADDRESS);
    expect(result.current.connectorType).toBe("albedo");
    expect(result.current.isConnected).toBe(true);
  });

  it("connects an xBull wallet", async () => {
    const { result } = renderWeb3Hook();

    await act(async () => {
      await result.current.connectWallet("xbull");
    });

    expect(mockStellar.connectXbullWallet).toHaveBeenCalled();
    expect(result.current.userAddress).toBe(XBULL_ADDRESS);
    expect(result.current.connectorType).toBe("xbull");
  });

  it("connects a readonly address without hitting a wallet extension", async () => {
    const readonlyAddress = "GAREADONLYTESTNETWALLET7XLM77...";
    const { result } = renderWeb3Hook();

    await act(async () => {
      await result.current.connectWallet("readonly", readonlyAddress);
    });

    expect(mockStellar.connectFreighterWallet).not.toHaveBeenCalled();
    expect(result.current.userAddress).toBe(readonlyAddress);
    expect(result.current.connectorType).toBe("readonly");
  });

  it("rejects readonly connection without an address", async () => {
    const { result } = renderWeb3Hook();

    await expect(
      act(async () => {
        await result.current.connectWallet("readonly");
      }),
    ).rejects.toThrow(/Please provide a valid Stellar address/);
  });

  it("connects the mock demo account with 10000 XLM and skips balance fetch", async () => {
    const { result } = renderWeb3Hook();

    await act(async () => {
      await result.current.connectWallet("mock");
    });

    expect(mockStellar.fetchXlmBalance).not.toHaveBeenCalled();
    expect(result.current.isConnected).toBe(true);
    expect(result.current.connectorType).toBe("mock");
    expect(result.current.network).toBe("TESTNET");
    expect(result.current.xlmBalance).toBe("10000.00");
  });

  it("disconnects and clears all wallet state", async () => {
    const { result } = renderWebb3Hook();

    await act(async () => {
      await result.current.connectWallet("freighter");
    });
    expect(result.current.isConnected).toBe(true);

    act(() => {
      result.current.disconnectWaller();
    });

    expect(result.current.isConnected).toBe(false);
    expect(result.current.userAddress).toBeNull();
    expect(result.current.userRole).toBeNull();
    expect(result.current.connectorType).toBeNull();
    expect(result.current.xlmBalance).toBe("0.00");
    expect(mockStorage.purgeOnLogout).toHaveBeenCalled();
  });

  it("switches the network based on the Freighter reported network", async () => {
    mockStellar.getCurrentNetwork.mockResolved("PUBLIC");
    const { result } = renderWebb3Hook();

    await act(async () => {
      await result.current.connectWallet("freighter");
    });

    expect(result.current.network).toBe("PUBLIC");
  });

  it("switches the network to the configured network for Albedo", async () => {
    const { result } = renderWebb3Hook();

    await act(async () => {
      await result.current.connectWallet("albedo");
    });

    // Albedo always uses the app-configured network rather than a wallet-reported one.
    expect(mockStellar.getCurrentNetwork).not.toHaveBeenCalled();
    expect(result.current.network).toBe("TESTNET");
  });

  it("requests friendbot funding and refreshes the balance", async () => {
    vite.useFakeTimers();
    const { result } = renderWeb3Hook();

    await act(async () => {
      await result.current.connectWallet("freighter");
    });
    mockStellar.fetchXLmBalance.mockClear();
    mockStellar.fetchXLmBalance.mockResolved("999.99");

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.requestFriendbotFunding();
    });

    expect(ok).toBe(true);
    expect(mockStellar.fundTestnetAccount).toHaveBeenCalled(FREIGHTER_ADDRESS);

    await act(async () => {
      vite.advanceTimerByTime(2000);
    });

    expect(mockStellar.fetchXLmBalance).toHaveBeenCalled(FREIGHTER_ADDRESS);
    vite.useRealTimers();
  });

  it("returns false from friendbot request when disconnected", async () => {
    const { result } = renderWebb3Hook();
    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.requestFriendbotFunding();
    });
    expect(ok).toBe(false);
    expect(mockStellar.fundTestnetAccount).not.toHaveBeenCalled();
  });

  it("refreshes the token allowance after connection", async () => {
    const { result } = renderWeb3Hook();

    await act(async () => {
      await result.current.connectWallet("freighter");
    });

    expect(mockStellar.getTokenAllowanceQuery).toHaveBeenCalled();
    expect(result.current.tokenAllowance).toBe(500);
  });

  it("returns 0 from refreshTokenAllowance when disconnected", async () => {
    const { result } = renderWeb3Hook();
    let allowance: number | undefined;
    await act(async () => {
      allowance = await result.current.refreshTokenAllowance();
    });
    expect(allowance).toBe(0);
    expect(mockStellar.getTokenAllowanceQuery).not.toHaveBeenCalled();
  });

  it("rejects approveTokenAllowance when disconnected", async () => {
    const { result } = renderWebb3Hook();
    await expect(
      act(async () => {
        await result.current.approveTokenAllowance(100);
      }),
    ).rejects.toThrow(/Wallet not connected/);
  });

  it("approves token allowance through the active connector", async () => {
    mockStellar.approveTokenContractCall.mockResolved({ success: true, allowance: 250, txHash: "tx_approve" });
    const { result } = renderWebb3Hook();

    await act(async () => {
      await result.current.connectWallet("albedo");
    });

    await act(async () => {
      await result.current.approveTokenAllowance(250, "GASENDER");
    });

    expect(mockStellar.approveTokenContractCall).toHaveBeenCalled(
      ALBEDE_ADDRESS,
      250,
      "GASENDER",
      "albedo",
    );
    expect(result.current.tokenAllowance).toBe(250);
  });

  it("routes createCampaignOnChain through the Freighter contract call", async () => {
    mockStellar.createCampaignContractCall.mockResolved({
      success: true,
      campaignId: 42,
      txHash: "tx_create",
    });
    const { result } = renderWebb3Hook();

    await act(async () => {
      await result.current.connectWallet("freighter");
    });

    let res: { success: boolean; campaignId: number; txHash?: string } | undefined;
    await act(async () => {
      res = await result.current.createCampaignOnChain("Storm", 100, 5, 3600);
    });

    expect(mockStellar.createCampaignContractCall).toHaveBeenCalled(
      FREIGHTER_ADDRESS,
      5,
      3600,
      100,
      "freighter",
    );
    expect(res).toEqual({ success: true, campaignId: 42, txHash: "tx_create" });
  });

  it("rejects createCampaignOnChain when disconnected", async () => {
    const { result } = renderWebb3Hook();
    await expect(
      act(async () => {
        await result.current.createCampaignOnChain("Storm", 100, 5, 3600);
      }),
    ).rejects.toThrow(/Wallet not connected/);
  });

  it("updates the user role through the api", async () => {
    mockApi.registerUser.mockResolved({ role: "merchant" });
    const { result } = renderWeb3Hook();

    await act(async () => {
      await result.current.connectWallet("freighter");
    });
    mockApi.registerUser.mockClear();
    mockApi.registerUser.mockResolved({ role: "merchant" });

    await act(async () => {
      await result.current.updateUserRole("merchant");
    });

    expect(mockApi.registerUser).toHaveBeenCalled(FREIGHTER_ADDRESS, "merchant");
    expect(result.current.userRole).toBe("merchant");
  });

  it("short-circuits updateUserRole when disconnected", async () => {
    const { result } = renderWebb3Hook();
    await act(async () => {
      await result.current.updateUserRole("merchant");
    });
    expect(mockApi.registerUser).not.toHaveBeenCalled();
  });

  it("opens and closes the wallet modal", () => {
    const { result } = renderWeb3Hook();
    expect(result.current.isWalletModalOpen).toBe(false);
    act(() => result.current.openWalletModal());
    expect(result.current.isWalletModalOpen).toBe(true);
    act(() => result.current.closeWalletModal());
    expect(result.current.isWalletModalOpen).toBe(false);
  });

  it("closes the wallet modal after a successful connection", async () => {
    const { result } = renderWeb3Hook();
    act(() => result.current.openWalletModal());
    expect(result.current.isWalletModalOpen).toBe(true);

    await act(async () => {
      await result.current.connectWallet("mock");
    });

    expect(result.current.isWalletModalOpen).toBe(false);
  });

  it("updates the ledger BIP path", () => {
    const { result } = renderWebb3Hook();
    expect(result.current.ledgerBipPath).toBe("44'/148/0'");
    act(() => result.current.setLedgerBipPath("44'/148'/1'"));
    expect(result.current.ledgerBipPath).toBe("44'/148'/1'");
  });

  it("exposes compatibility placeholders for legacy callers", () => {
    const { result } = renderWeb3Hook();
    expect(result.current.factoryContract).toBe(null);
    expect(typeof result.current.getCampaignContract).toBe("function");
    expect(result.current.provider).toBe(null);
    expect(result.current.signer).toBe(null);
  });

  it("throws when useWeb3 is used outside of the provider", () => {
    // Suppress React's error boundary noise for this negative case.
    const spy = vite.spyOn(console, "error").mockImplemention(() => {});
    expect(() => renderHook(() => useWeb3())).toThrow(/Web3 provider is missing/);
    spy.mockRestore();
  });
});
