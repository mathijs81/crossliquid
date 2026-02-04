import type {
  Abi,
  ContractFunctionArgs,
  ContractFunctionName,
  ContractFunctionReturnType,
  Hash,
  PublicClient,
  TransactionReceipt,
  WalletClient,
  Address,
  WriteContractParameters,
  Account,
  ExtractAbiFunctionForArgs,
} from "viem";

export type ContractCallParams<
  TAbi extends Abi,
  TFunctionName extends ContractFunctionName<TAbi, "nonpayable" | "payable">,
  TArgs extends ContractFunctionArgs<
    TAbi,
    "nonpayable" | "payable",
    TFunctionName
  >,
> = {
  address: Address;
  abi: TAbi;
  functionName: TFunctionName;
  args: TArgs;
  value?: bigint;
  account?: Account;
};

export async function executeContractWrite<
  const TAbi extends Abi,
  TFunctionName extends ContractFunctionName<TAbi, "nonpayable" | "payable">,
  TArgs extends ContractFunctionArgs<
    TAbi,
    "payable" | "nonpayable",
    TFunctionName
  >,
>(
  publicClient: PublicClient,
  walletClient: WalletClient,
  params: ContractCallParams<TAbi, TFunctionName, TArgs>,
): Promise<{
  result: ContractFunctionReturnType<
    TAbi,
    "nonpayable" | "payable",
    TFunctionName,
    TArgs
  >;
  hash: Hash;
  receipt: TransactionReceipt;
}> {
  const { request, result } = await publicClient.simulateContract({
    address: params.address,
    abi: params.abi,
    functionName: params.functionName,
    args: params.args,
    account: params.account,
    value: params.value,
  });
  const hash = await walletClient.writeContract(
    request as WriteContractParameters<TAbi, TFunctionName, TArgs>,
  );
  const receipt = await publicClient.waitForTransactionReceipt({ hash });

  if (receipt.status === "reverted") {
    throw new Error("Transaction reverted");
  }

  return {
    result: result as ContractFunctionReturnType<
      TAbi,
      "nonpayable" | "payable",
      TFunctionName,
      TArgs
    >,
    hash,
    receipt,
  };
}
