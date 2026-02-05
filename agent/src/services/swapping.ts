import { Actions, V4Planner } from "@uniswap/v4-sdk";
import {
  UNIVERSAL_ROUTER_ADDRESS,
  UniversalRouterVersion,
} from "@uniswap/universal-router-sdk";
import {
  encodeFunctionData,
  type Address,
  type Hash,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import { permit2Abi } from "../abi/Permit2";
import { stateViewAbi } from "../abi/StateView";
import { universalRouterAbi } from "../abi/UniversalRouter";
import { v4QuoterAbi } from "../abi/V4Quoter";
import { DEFAULT_POOL_KEYS, type UniV4Contracts } from "../config";
import { logger } from "../logger";
import { createPoolId, type PoolKey } from "../utils/poolIds";

const ZERO_ADDRESS: Address = "0x0000000000000000000000000000000000000000";
const V4_SWAP_COMMAND = "0x10";
const DEFAULT_DEADLINE_SECONDS = 1800;
const MAX_UINT48 = 2 ** 48 - 1;
const MAX_UINT160 = (1n << 160n) - 1n;
const MAX_UINT128 = (1n << 128n) - 1n;
const SLIPPAGE_DENOMINATOR = 10_000n;
const PERMIT2_ADDRESS_MAINNET: Address =
  "0x000000000022D473030F116dDEE9F6B43aC78BA3";

export type SwapTradeType = "EXACT_INPUT" | "EXACT_OUTPUT";
export type QuoteSource = "local" | "routing-api";

export interface SwapQuoteRequest {
  chainId: number;
  tokenIn: Address;
  tokenOut: Address;
  amount: bigint;
  tradeType?: SwapTradeType;
  slippageBps?: number;
  recipient: Address;
  hookData?: Hex;
  poolKey?: PoolKey;
  deadlineSeconds?: number;
}

export interface SwapQuoteResult {
  chainId: number;
  tokenIn: Address;
  tokenOut: Address;
  tradeType: SwapTradeType;
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
    const tradeType = request.tradeType ?? "EXACT_INPUT";
    const slippageBps = request.slippageBps ?? 50;

    if (this.chainId === 31337) {
      return this.quoteLocal({ ...request, tradeType, slippageBps });
    }

    return this.quoteRoutingApi({ ...request, tradeType, slippageBps });
  }

  buildExecutionPlan(
    quote: SwapQuoteResult,
    request: SwapQuoteRequest,
  ): SwapExecutionPlan {
    const deadlineSeconds =
      request.deadlineSeconds ?? DEFAULT_DEADLINE_SECONDS;
    const deadline = BigInt(
      Math.floor(Date.now() / 1000) + deadlineSeconds,
    );

    if (quote.quoteSource === "routing-api") {
      if (!quote.routing?.calldata) {
        throw new Error("Routing API quote did not include calldata");
      }

      const routerAddress =
        quote.routing.to ?? this.resolveUniversalRouterAddress();
      const value = quote.routing.value ?? 0n;
      const slippageBps = BigInt(quote.slippageBps);
      const approvalAmount = this.isNativeCurrency(quote.tokenIn)
        ? 0n
        : quote.tradeType === "EXACT_INPUT"
          ? quote.amountIn
          : (quote.amountIn * (SLIPPAGE_DENOMINATOR + slippageBps)) /
            SLIPPAGE_DENOMINATOR;

      return {
        chainId: this.chainId,
        to: routerAddress,
        data: quote.routing.calldata,
        value,
        deadline,
        tokenIn: quote.tokenIn,
        approvalAmount,
        amountIn:
          quote.tradeType === "EXACT_INPUT" ? quote.amountIn : approvalAmount,
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
    const amountInMaximum =
      (quote.amountIn * (SLIPPAGE_DENOMINATOR + slippageBps)) /
      SLIPPAGE_DENOMINATOR;

    const planner = new V4Planner();
    const hookData = quote.hookData ?? "0x";

    if (quote.tradeType === "EXACT_INPUT") {
      planner.addAction(Actions.SWAP_EXACT_IN_SINGLE, [
        {
          poolKey: quote.poolKey,
          zeroForOne: quote.zeroForOne,
          amountIn: quote.amountIn.toString(),
          amountOutMinimum: amountOutMinimum.toString(),
          hookData,
        },
      ]);
    } else {
      planner.addAction(Actions.SWAP_EXACT_OUT_SINGLE, [
        {
          poolKey: quote.poolKey,
          zeroForOne: quote.zeroForOne,
          amountOut: quote.amountOut.toString(),
          amountInMaximum: amountInMaximum.toString(),
          hookData,
        },
      ]);
    }

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
      abi: universalRouterAbi,
      functionName: "execute",
      args: [commands, inputs, deadline],
    });

    const value = this.isNativeCurrency(quote.tokenIn)
      ? quote.tradeType === "EXACT_INPUT"
        ? quote.amountIn
        : amountInMaximum
      : 0n;

    const approvalAmount = this.isNativeCurrency(quote.tokenIn)
      ? 0n
      : quote.tradeType === "EXACT_INPUT"
        ? quote.amountIn
        : amountInMaximum;

    return {
      chainId: this.chainId,
      to: this.resolveUniversalRouterAddress(),
      data,
      value,
      deadline,
      tokenIn: quote.tokenIn,
      approvalAmount,
      amountIn: quote.tradeType === "EXACT_INPUT" ? quote.amountIn : amountInMaximum,
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
    request: SwapQuoteRequest & { tradeType: SwapTradeType; slippageBps: number },
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

    if (request.amount > MAX_UINT128) {
      throw new Error("Amount exceeds uint128 for local quoting");
    }

    if (request.tradeType === "EXACT_INPUT") {
      const { result } = await this.publicClient.simulateContract({
        address: this.contracts.quoter,
        abi: v4QuoterAbi,
        functionName: "quoteExactInputSingle",
        args: [
          {
            poolKey,
            zeroForOne,
            exactAmount: request.amount,
            hookData,
          },
        ],
      });
      const [amountOut, gasEstimate] = result;

      return {
        chainId: this.chainId,
        tokenIn: request.tokenIn,
        tokenOut: request.tokenOut,
        tradeType: request.tradeType,
        amountIn: request.amount,
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

    const { result } = await this.publicClient.simulateContract({
      address: this.contracts.quoter,
      abi: v4QuoterAbi,
      functionName: "quoteExactOutputSingle",
      args: [
        {
          poolKey,
          zeroForOne,
          exactAmount: request.amount,
          hookData,
        },
      ],
    });
    const [amountIn, gasEstimate] = result;

    return {
      chainId: this.chainId,
      tokenIn: request.tokenIn,
      tokenOut: request.tokenOut,
      tradeType: request.tradeType,
      amountIn: BigInt(amountIn),
      amountOut: request.amount,
      slippageBps: request.slippageBps,
      recipient: request.recipient,
      quoteSource: "local",
      gasEstimate: BigInt(gasEstimate),
      poolKey,
      zeroForOne,
      hookData,
    };
  }

  private async quoteRoutingApi(
    request: SwapQuoteRequest & { tradeType: SwapTradeType; slippageBps: number },
  ): Promise<SwapQuoteResult> {
    const apiUrl = "https://api.uniswap.org/v1/quote";
    const deadlineSeconds =
      request.deadlineSeconds ?? DEFAULT_DEADLINE_SECONDS;
    const deadline = Math.floor(Date.now() / 1000) + deadlineSeconds;
    const slippageTolerance = request.slippageBps / 100;

    const body = {
      tokenInChainId: request.chainId,
      tokenOutChainId: request.chainId,
      tokenIn: request.tokenIn,
      tokenOut: request.tokenOut,
      amount: request.amount.toString(),
      type: request.tradeType,
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
    const quoteAmount =
      request.tradeType === "EXACT_INPUT"
        ? this.extractQuoteAmount(payload, "amountOut")
        : this.extractQuoteAmount(payload, "amountIn");

    if (quoteAmount === null) {
      throw new Error("Routing API response missing quote amount");
    }

    const amountIn =
      request.tradeType === "EXACT_INPUT" ? request.amount : quoteAmount;
    const amountOut =
      request.tradeType === "EXACT_INPUT" ? quoteAmount : request.amount;

    return {
      chainId: this.chainId,
      tokenIn: request.tokenIn,
      tokenOut: request.tokenOut,
      tradeType: request.tradeType,
      amountIn,
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
      request.poolKey ??
      (DEFAULT_POOL_KEYS[this.chainId] as PoolKey | undefined);
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
      const local = this.contracts.universalRouter ?? process.env.UNIVERSAL_ROUTER_ADDRESS;
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

  private resolvePermit2Address(): Address {
    if (this.chainId === 31337) {
      const local = this.contracts.permit2 ?? process.env.PERMIT2_ADDRESS;
      if (!local) {
        throw new Error("PERMIT2_ADDRESS is not set for local chain");
      }
      return local as Address;
    }

    return PERMIT2_ADDRESS_MAINNET;
  }

  private isNativeCurrency(token: Address): boolean {
    return token.toLowerCase() === ZERO_ADDRESS;
  }

  private currencyAddressFor(token: Address): Address {
    return this.isNativeCurrency(token) ? ZERO_ADDRESS : token;
  }

  private async ensurePermit2Allowance(
    token: Address,
    requiredAmount: bigint,
  ) {
    const account = this.walletClient.account;
    if (!account) {
      throw new Error("Wallet client is missing an account");
    }

    if (requiredAmount > MAX_UINT160) {
      throw new Error("Approval amount exceeds uint160");
    }

    const permit2 = this.resolvePermit2Address();
    const spender = this.resolveUniversalRouterAddress();
    const nowSeconds = Math.floor(Date.now() / 1000);

    const allowanceData = await this.publicClient.readContract({
      address: permit2,
      abi: permit2Abi,
      functionName: "allowance",
      args: [account.address, token, spender],
    });
    const allowance = allowanceData[0] as bigint;
    const expirationRaw = allowanceData[1] as number | bigint;
    const expiration =
      typeof expirationRaw === "bigint"
        ? Number(expirationRaw)
        : expirationRaw;

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
      abi: permit2Abi,
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
