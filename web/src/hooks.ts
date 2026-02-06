//import { toastError } from '$lib/utils/toast';
import type { HandleClientError } from "@sveltejs/kit";

export const handleError: HandleClientError = async ({ error, message }) => {
  console.error("error hook", error, message);
  //toastError(message);

  return {
    message: "Whoops!",
  };
};
