import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ReactNode } from "react";
import { useToast } from "../components/toast";

/** A mutation that toasts its outcome and refreshes every query (the databases changed). */
export function useAction<TArgs, TResult>(fn: (args: TArgs) => Promise<TResult>, success?: (r: TResult) => ReactNode) {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: fn,
    onSuccess: (r) => {
      if (success) toast("ok", success(r));
      qc.invalidateQueries();
    },
    onError: (e: any) => toast("bad", e?.message ?? String(e)),
  });
}
