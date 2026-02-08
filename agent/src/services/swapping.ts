import { createConfig, getQuote, type TransactionRequest } from "@lifi/sdk";
import {
  UNIVERSAL_ROUTER_ADDRESS,
  UniversalRouterVersion,
} from "@uniswap/universal-router-sdk";
import { Actions, V4Planner } from "@uniswap/v4-sdk";
import {
  type Account,
  encodeFunctionData,
  parseAbi,
  type Address,
  type Hash,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import { iUniswapV4Router04Abi } from "../abi/IUniswapV4Router04.js";
import { iV4QuoterAbi as v4QuoterAbi } from "../abi/IV4Quoter.js";
import { stateViewAbi } from "../abi/StateView.js";
import { chains, getOurAddressesForChain, QUERY_POOL_KEYS } from "../config.js";
import { logger } from "../logger.js";
import { createPoolId, type PoolKey } from "../utils/poolIds.js";
import type { UniV4Contracts } from "../contracts/base-contract-addresses.js";
import { executeAsManager } from "../utils/executeAsManager.js";

const ZERO_ADDRESS: Address = "0x0000000000000000000000000000000000000000";
const V4_SWAP_COMMAND = "0x10";
const DEFAULT_DEADLINE_SECONDS = 1800;
const MAX_UINT48 = 2 ** 48 - 1;
const MAX_UINT160 = (1n << 160n) - 1n;
const MAX_UINT128 = (1n << 128n) - 1n;
const SLIPPAGE_DENOMINATOR = 10_000n;
const PERMIT2_ADDRESS: Address = "0x000000000022D473030F116dDEE9F6B43aC78BA3";

export type QuoteSource = "local" | "routing-api" | "lifi";

createConfig({
  integrator: "Cross_Liquid",
});

export interface SwapQuoteRequest {
  chainId: number;
  tokenIn: Address;
  tokenOut: Address;
  amountIn: bigint;
  slippageBps?: number;
  fromAddress: Address;
  recipient: Address;
  hookData?: Hex;
  poolKey?: PoolKey;
  deadlineSeconds?: number;
  forManager?: boolean; // If true, generate calldata for PositionManager execution
  useProductionRouting?: boolean; // If true, force routing API even on local chains
}

export interface SwapQuoteResult {
  chainId: number;
  tokenIn: Address;
  tokenOut: Address;
  amountIn: bigint;
  amountOut: bigint;
  slippageBps: number;
  recipient: Address;
  quoteSource: QuoteSource;
  gasEstimate?: bigint;
  poolKey?: PoolKey;
  zeroForOne?: boolean;
  hookData?: Hex;
  routing?: {
    calldata: Hex;
    value: bigint;
    to?: Address;
  };
}

export interface SwapExecutionPlan {
  chainId: number;
  to: Address;
  data: Hex;
  value: bigint;
  deadline: bigint;
  tokenIn: Address;
  approvalAmount: bigint;
  amountIn: bigint;
  amountOut: bigint;
  quoteSource: QuoteSource;
}

export class SwappingService {
  constructor(
    private publicClient: PublicClient,
    private walletClient: WalletClient,
    private chainId: number,
    private contracts: UniV4Contracts,
  ) {}

  async quoteSwap(request: SwapQuoteRequest): Promise<SwapQuoteResult> {
    const slippageBps = request.slippageBps ?? 50;

    // Use routing API if explicitly requested or if on production chain
    if (request.useProductionRouting || this.chainId !== 31337) {
      return this.quoteLifi({ ...request, slippageBps });
      //return this.quoteRoutingApi({ ...request, slippageBps });
    }

    return this.quoteLocal({ ...request, slippageBps });
  }

  buildExecutionPlan(
    quote: SwapQuoteResult,
    request: SwapQuoteRequest,
  ): SwapExecutionPlan {
    const deadlineSeconds = request.deadlineSeconds ?? DEFAULT_DEADLINE_SECONDS;
    const deadline = BigInt(Math.floor(Date.now() / 1000) + deadlineSeconds);

    if (quote.quoteSource === "routing-api") {
      if (!quote.routing?.calldata) {
        throw new Error("Routing API quote did not include calldata");
      }

      const routerAddress =
        quote.routing.to ?? this.resolveUniversalRouterAddress();
      const value = quote.routing.value ?? 0n;
      const approvalAmount = this.isNativeCurrency(quote.tokenIn)
        ? 0n
        : quote.amountIn;

      return {
        chainId: this.chainId,
        to: routerAddress,
        data: quote.routing.calldata,
        value,
        deadline,
        tokenIn: quote.tokenIn,
        approvalAmount,
        amountIn: quote.amountIn,
        amountOut: quote.amountOut,
        quoteSource: quote.quoteSource,
      };
    }

    if (quote.quoteSource === "lifi") {
      if (!quote.routing?.calldata || !quote.routing.to) {
        throw new Error("LI.FI quote missing data");
      }

      return {
        chainId: this.chainId,
        to: quote.routing.to,
        data: quote.routing.calldata,
        value: quote.routing.value,
        deadline,
        tokenIn: quote.tokenIn,
        approvalAmount: 0n,
        amountIn: quote.amountIn,
        amountOut: quote.amountOut,
        quoteSource: quote.quoteSource,
      };
    }

    if (!quote.poolKey || quote.zeroForOne === undefined) {
      throw new Error("Local quote missing pool metadata");
    }

    const slippageBps = BigInt(quote.slippageBps);
    if (slippageBps < 0n || slippageBps > SLIPPAGE_DENOMINATOR) {
      throw new Error("Invalid slippage bps");
    }

    const amountOutMinimum =
      (quote.amountOut * (SLIPPAGE_DENOMINATOR - slippageBps)) /
      SLIPPAGE_DENOMINATOR;

    const hookData = quote.hookData ?? "0x";

    // For local chains, use IUniswapV4Router04 instead of UniversalRouter
    if (this.chainId === 31337) {
      const routerAddress =
        this.contracts.v4Router ?? this.contracts.universalRouter;
      if (!routerAddress) {
        throw new Error(
          "No v4Router or universalRouter configured for local chain",
        );
      }

      // Router04 uses negative amountSpecified for exact input
      const amountSpecified = -BigInt(quote.amountIn.toString());

      const data = encodeFunctionData({
        abi: iUniswapV4Router04Abi,
        functionName: "swap",
        args: [
          amountSpecified,
          amountOutMinimum,
          quote.zeroForOne,
          quote.poolKey,
          hookData,
          quote.recipient,
          deadline,
        ],
      });

      const value = this.isNativeCurrency(quote.tokenIn) ? quote.amountIn : 0n;
      const approvalAmount = this.isNativeCurrency(quote.tokenIn)
        ? 0n
        : quote.amountIn;

      return {
        chainId: this.chainId,
        to: routerAddress,
        data,
        value,
        deadline,
        tokenIn: quote.tokenIn,
        approvalAmount,
        amountIn: quote.amountIn,
        amountOut: quote.amountOut,
        quoteSource: quote.quoteSource,
      };
    }

    // For production chains, use UniversalRouter with V4Planner
    const planner = new V4Planner();

    planner.addAction(Actions.SWAP_EXACT_IN_SINGLE, [
      {
        poolKey: quote.poolKey,
        zeroForOne: quote.zeroForOne,
        amountIn: quote.amountIn.toString(),
        amountOutMinimum: amountOutMinimum.toString(),
        hookData,
      },
    ]);

    planner.addAction(Actions.SETTLE, [
      this.currencyAddressFor(quote.tokenIn),
      "0",
      true,
    ]);
    planner.addAction(Actions.TAKE, [
      this.currencyAddressFor(quote.tokenOut),
      quote.recipient,
      "0",
    ]);

    const v4ActionsCalldata = planner.finalize() as Hex;
    const commands = V4_SWAP_COMMAND as Hex;
    const inputs = [v4ActionsCalldata];

    const data = encodeFunctionData({
      abi: parseAbi([
        "function execute(bytes calldata commands, bytes[] calldata inputs, uint256 deadline) external payable",
      ]),
      functionName: "execute",
      args: [commands, inputs, deadline],
    });

    const value = this.isNativeCurrency(quote.tokenIn) ? quote.amountIn : 0n;
    const approvalAmount = this.isNativeCurrency(quote.tokenIn)
      ? 0n
      : quote.amountIn;

    return {
      chainId: this.chainId,
      to: this.resolveUniversalRouterAddress(),
      data,
      value,
      deadline,
      tokenIn: quote.tokenIn,
      approvalAmount,
      amountIn: quote.amountIn,
      amountOut: quote.amountOut,
      quoteSource: quote.quoteSource,
    };
  }

  async executeSwap(plan: SwapExecutionPlan): Promise<Hash> {
    const account = this.walletClient.account;
    if (!account) {
      throw new Error("Wallet client is missing an account");
    }

    if (!this.isNativeCurrency(plan.tokenIn) && plan.approvalAmount > 0n) {
      await this.ensurePermit2Allowance(plan.tokenIn, plan.approvalAmount);
    }

    const hash = await this.walletClient.sendTransaction({
      account,
      chain: this.walletClient.chain,
      to: plan.to,
      data: plan.data,
      value: plan.value,
    });

    await this.publicClient.waitForTransactionReceipt({ hash });
    return hash;
  }

  private async quoteLocal(
    request: SwapQuoteRequest & { slippageBps: number },
  ): Promise<SwapQuoteResult> {
    const { poolKey, zeroForOne } = this.resolvePoolKey(request);
    const poolId = createPoolId(poolKey);
    const hookData = request.hookData ?? "0x";

    const [slot0, liquidity] = await Promise.all([
      this.publicClient.readContract({
        address: this.contracts.stateView,
        abi: stateViewAbi,
        functionName: "getSlot0",
        args: [poolId],
      }),
      this.publicClient.readContract({
        address: this.contracts.stateView,
        abi: stateViewAbi,
        functionName: "getLiquidity",
        args: [poolId],
      }),
    ]);

    logger.info(
      {
        poolId,
        sqrtPriceX96: slot0[0],
        tick: slot0[1],
        liquidity: liquidity.toString(),
      },
      "Fetched local pool state",
    );

    if (request.amountIn > MAX_UINT128) {
      throw new Error("Amount exceeds uint128 for local quoting");
    }

    const { result } = await this.publicClient.simulateContract({
      address: this.contracts.quoter,
      abi: v4QuoterAbi,
      functionName: "quoteExactInputSingle",
      args: [
        {
          poolKey,
          zeroForOne,
          exactAmount: request.amountIn,
          hookData,
        },
      ],
    });
    const [amountOut, gasEstimate] = result;

    return {
      chainId: this.chainId,
      tokenIn: request.tokenIn,
      tokenOut: request.tokenOut,
      amountIn: request.amountIn,
      amountOut: BigInt(amountOut),
      slippageBps: request.slippageBps,
      recipient: request.recipient,
      quoteSource: "local",
      gasEstimate: BigInt(gasEstimate),
      poolKey,
      zeroForOne,
      hookData,
    };
  }

  private async quoteLifi(
    request: SwapQuoteRequest & { slippageBps: number },
  ): Promise<SwapQuoteResult> {
    const quote = await getQuote({
      fromChain: request.chainId,
      toChain: request.chainId,
      fromAddress: request.fromAddress,
      fromToken: request.tokenIn,
      toToken: request.tokenOut,
      toAddress: request.recipient,
      fromAmount: request.amountIn.toString(),
    });
    console.log(quote);

    if (!quote.transactionRequest) {
      throw new Error("LI.FI quote missing transaction request");
    }

    // lifi returns value as a 0x string, convert to bigint
    const value = BigInt(quote.transactionRequest.value as `0x${string}`);
    return {
      chainId: request.chainId,
      tokenIn: request.tokenIn,
      tokenOut: request.tokenOut,
      amountIn: request.amountIn,
      amountOut: BigInt(quote.estimate.toAmount),
      slippageBps: request.slippageBps,
      recipient: request.recipient,
      quoteSource: "lifi",
      routing: {
        calldata: quote.transactionRequest.data as `0x${string}`,
        value,
        to: quote.transactionRequest.to as Address,
      },
    };
  }

  private async quoteRoutingApi(
    request: SwapQuoteRequest & { slippageBps: number },
  ): Promise<SwapQuoteResult> {
    const apiUrl = "https://api.uniswap.org/v1/quote";
    const deadlineSeconds = request.deadlineSeconds ?? DEFAULT_DEADLINE_SECONDS;
    const deadline = Math.floor(Date.now() / 1000) + deadlineSeconds;
    const slippageTolerance = request.slippageBps / 100;

    const body = {
      tokenInChainId: request.chainId,
      tokenOutChainId: request.chainId,
      tokenIn: request.tokenIn,
      tokenOut: request.tokenOut,
      amount: request.amountIn.toString(),
      type: "EXACT_INPUT",
      recipient: request.recipient,
      slippageTolerance,
      deadline,
    };

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    const apiKey = process.env.UNISWAP_API_KEY;
    if (apiKey) {
      headers["x-api-key"] = apiKey;
    }

    const response = await fetch(apiUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Routing API error ${response.status}: ${text}`);
    }

    const payload = await response.json();
    const routing = this.extractRoutingCalldata(payload);
    const amountOut = this.extractQuoteAmount(payload, "amountOut");

    if (amountOut === null) {
      throw new Error("Routing API response missing amountOut");
    }

    return {
      chainId: this.chainId,
      tokenIn: request.tokenIn,
      tokenOut: request.tokenOut,
      amountIn: request.amountIn,
      amountOut,
      slippageBps: request.slippageBps,
      recipient: request.recipient,
      quoteSource: "routing-api",
      routing,
    };
  }

  private resolvePoolKey(request: SwapQuoteRequest): {
    poolKey: PoolKey;
    zeroForOne: boolean;
  } {
    const poolKey =
      request.poolKey ?? (QUERY_POOL_KEYS[this.chainId] as PoolKey | undefined);
    if (!poolKey) {
      throw new Error(`No pool key configured for chain ${this.chainId}`);
    }

    const tokenIn = request.tokenIn.toLowerCase();
    const tokenOut = request.tokenOut.toLowerCase();
    const currency0 = poolKey.currency0.toLowerCase();
    const currency1 = poolKey.currency1.toLowerCase();

    if (tokenIn === currency0 && tokenOut === currency1) {
      return { poolKey, zeroForOne: true };
    }

    if (tokenIn === currency1 && tokenOut === currency0) {
      return { poolKey, zeroForOne: false };
    }

    throw new Error("Token pair does not match pool key");
  }

  private resolveUniversalRouterAddress(): Address {
    if (this.chainId === 31337) {
      const local =
        this.contracts.universalRouter ?? process.env.UNIVERSAL_ROUTER_ADDRESS;
      if (!local) {
        throw new Error("UNIVERSAL_ROUTER_ADDRESS is not set for local chain");
      }
      return local as Address;
    }

    return UNIVERSAL_ROUTER_ADDRESS(
      UniversalRouterVersion.V2_0,
      this.chainId,
    ) as Address;
  }

  private isNativeCurrency(token: Address): boolean {
    return token.toLowerCase() === ZERO_ADDRESS;
  }

  private currencyAddressFor(token: Address): Address {
    return this.isNativeCurrency(token) ? ZERO_ADDRESS : token;
  }

  private async ensurePermit2Allowance(token: Address, requiredAmount: bigint) {
    const account = this.walletClient.account;
    if (!account) {
      throw new Error("Wallet client is missing an account");
    }

    if (requiredAmount > MAX_UINT160) {
      throw new Error("Approval amount exceeds uint160");
    }

    const permit2 = PERMIT2_ADDRESS;
    const spender = this.resolveUniversalRouterAddress();
    const nowSeconds = Math.floor(Date.now() / 1000);

    const allowanceData = await this.publicClient.readContract({
      address: permit2,
      abi: parseAbi([
        "function allowance(address user, address token, address spender) view returns (uint160 amount, uint48 expiration, uint48 nonce)",
      ]),
      functionName: "allowance",
      args: [account.address, token, spender],
    });
    const allowance = allowanceData[0] as bigint;
    const expirationRaw = allowanceData[1] as number | bigint;
    const expiration =
      typeof expirationRaw === "bigint" ? Number(expirationRaw) : expirationRaw;

    const isExpired = expiration <= nowSeconds;
    const isSufficient = allowance >= requiredAmount;

    if (!isExpired && isSufficient) {
      return;
    }

    logger.info(
      {
        token,
        spender,
        requiredAmount: requiredAmount.toString(),
        currentAllowance: allowance.toString(),
      },
      "Updating Permit2 allowance",
    );

    const hash = await this.walletClient.writeContract({
      account,
      chain: this.walletClient.chain,
      address: permit2,
      abi: parseAbi([
        "function approve(address token, address spender, uint160 amount, uint48 expiration)",
      ]),
      functionName: "approve",
      args: [token, spender, requiredAmount, MAX_UINT48],
    });

    await this.publicClient.waitForTransactionReceipt({ hash });
  }

  private extractRoutingCalldata(payload: unknown): {
    calldata: Hex;
    value: bigint;
    to?: Address;
  } {
    const response = payload as Record<string, any>;
    const methodParameters =
      response.methodParameters ??
      response.method_parameters ??
      response?.swap?.methodParameters ??
      response?.quote?.methodParameters ??
      response?.route?.methodParameters ??
      response?.data?.methodParameters ??
      null;

    const calldata =
      methodParameters?.calldata ??
      response.calldata ??
      response.data?.calldata ??
      response.tx?.data ??
      response.tx?.calldata;

    if (!calldata) {
      throw new Error("Routing API response missing calldata");
    }

    const rawValue =
      methodParameters?.value ??
      response.value ??
      response.data?.value ??
      response.tx?.value ??
      "0";

    const to =
      methodParameters?.to ??
      response.to ??
      response.data?.to ??
      response.tx?.to;

    return {
      calldata: calldata as Hex,
      value: BigInt(rawValue),
      to: to ? (to as Address) : undefined,
    };
  }

  private extractQuoteAmount(
    payload: unknown,
    field: "amountOut" | "amountIn",
  ): bigint | null {
    const response = payload as Record<string, any>;
    const direct =
      response[field] ??
      response.quote?.[field] ??
      response.route?.quote?.[field] ??
      response.data?.[field] ??
      response.quote ??
      response.outputAmount ??
      response.inputAmount;

    if (direct === undefined || direct === null) {
      return null;
    }

    if (typeof direct === "string" || typeof direct === "number") {
      return BigInt(direct);
    }

    if (typeof direct === "bigint") {
      return direct;
    }

    if (typeof direct === "object") {
      const nested =
        direct[field] ??
        direct.amount ??
        direct.value ??
        direct.amountOut ??
        direct.amountIn;
      if (nested !== undefined && nested !== null) {
        return BigInt(nested);
      }
    }

    return null;
  }
}

// Cross chain swapping

export interface CrossChainRequest {
  fromChain: number;
  toChain: number;
  fromAddress: Address;
  toAddress: Address;
  amount: bigint;
  fromToken: Address;
  toToken: Address;
}

export interface CrossChainQuote {
  request: CrossChainRequest;
  expectedReceive: bigint;
  minReceive: bigint;
  transactionRequest: TransactionRequest;
}

export async function getCrossChainQuote(
  request: CrossChainRequest,
): Promise<CrossChainQuote> {
  const quote = await getQuote({
    fromChain: request.fromChain,
    toChain: request.toChain,
    fromAddress: request.fromAddress,
    fromToken: request.fromToken,
    toToken: request.toToken,
    toAddress: request.toAddress,
    fromAmount: request.amount.toString(),
  });

  if (!quote.transactionRequest) {
    throw new Error("No transaction request found");
  }

  return {
    request,
    expectedReceive: BigInt(quote.estimate.toAmount),
    minReceive: BigInt(quote.estimate.toAmountMin),
    transactionRequest: quote.transactionRequest,
  };
}

export async function executeCrossChainSwap(
  walletClient: WalletClient,
  quote: CrossChainQuote,
  forManager: boolean,
): Promise<string> {
  const publicClient = chains.get(quote.request.fromChain)?.publicClient;
  if (!publicClient) {
    throw new Error(
      `Public client not found for chain ${quote.request.fromChain}`,
    );
  }
  if (forManager) {
    const positionManagerAddress = getOurAddressesForChain(
      quote.request.fromChain,
    ).manager;
    return await executeAsManager(
      publicClient,
      walletClient,
      positionManagerAddress,
      quote.transactionRequest.to as Address,
      quote.transactionRequest.data as Hex,
      BigInt(quote.transactionRequest.value as string),
    );
  } else {
    return await walletClient.sendTransaction({
      account: walletClient.account as Account,
      chain: chains.get(quote.request.fromChain)?.viemChain,
      to: quote.transactionRequest.to as Address,
      data: quote.transactionRequest.data as Hex,
      value: BigInt(quote.transactionRequest.value as string),
    });
  }
}
