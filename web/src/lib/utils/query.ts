import { getGlobalClient } from "$lib/query/globalClient";
import { createMutation, createQuery } from "@tanstack/svelte-query";

export function createErrorQuery(message: string) {
  return createQuery(
    () => ({
      queryKey: ["error", message],
      queryFn: () => {
        throw new Error(message);
      },
    }),
    getGlobalClient(),
  );
}

export function createErrorMutation<TData, TError, TVariables, TContext>(
  message: string,
) {
  return createMutation<TData, TError, TVariables, TContext>(
    () => ({
      mutationFn: () => {
        throw new Error(message);
      },
    }),
    getGlobalClient(),
  );
}
