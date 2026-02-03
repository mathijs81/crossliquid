import CrossLiquidVault from "$lib/components/cross-liquid/CrossLiquidVault.svelte";
import { readCrossLiquidVaultBalanceOf } from "$lib/contracts/generated.local";
import { getGlobalClient } from "$lib/query/globalClient";
import { vaultChain } from "$lib/wagmi/chains";
import { config } from "$lib/wagmi/config";
import { render, screen, waitFor } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { connect, disconnect, getConnection } from "@wagmi/core";
import { describe, expect } from "vitest";
import { TEST_ACCOUNTS } from "../../../tests/anvil";
import { test } from "../../../tests/setup";

describe("CrossLiquidVault - minting flow", () => {
  test("mints 1 token and updates balance", async ({ testConfig }) => {
    render(CrossLiquidVault);

    const user = userEvent.setup();

    const accountAddress = TEST_ACCOUNTS.account0.address;

    await connect(testConfig, {
      connector: testConfig.connectors[0],
      chainId: vaultChain.id,
    });

    expect(getConnection(testConfig)?.isConnected).toBe(true);

    const initialBalance = await readCrossLiquidVaultBalanceOf(config, {
      args: [accountAddress],
    });
    expect(initialBalance).toBe(0n);

    let balance = screen.getByTestId("balance");
    expect(balance).toHaveTextContent("0");

    // Price of 1 token not yet calculated
    expect(screen.queryByText(/11.88/)).toBeNull();

    const amountInput = screen.getByLabelText("ETH Amount");
    await user.clear(amountInput);
    await user.type(amountInput, "12");

    await waitFor(() => {
      expect(screen.getByText(/11.88/)).toBeInTheDocument();
    });

    const mintButton = screen.getByRole("button", { name: "Mint" });
    expect(mintButton).not.toBeDisabled();
    await user.click(mintButton);

    expect(await screen.findByText(/Confirmed/i)).toBeInTheDocument();

    getGlobalClient()?.().invalidateQueries({
      queryKey: ["readContract"],
    });

    await waitFor(() => {
      balance = screen.getByTestId("balance");
      expect(balance).toHaveTextContent("1");
    });

    await disconnect(testConfig);
  });
});
