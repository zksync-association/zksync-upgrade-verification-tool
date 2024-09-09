import type { FetcherWithComponents } from "@remix-run/react";
import { useFetcher } from "@remix-run/react";
import { useEffect, useState } from "react";
import type { AppData } from "@remix-run/react/dist/data";
import type { SerializeFrom } from "@remix-run/node";

/**
 * A higher-order function that creates a new FetcherWithComponentsReset instance, which extends the FetcherWithComponents interface.
 * The new instance includes an additional method `reset` that can be used to reset the state of the fetcher.
 *
 * @template T - The type of data returned by the fetcher.
 * @param fetcherWithComponents - The FetcherWithComponents instance to be extended.
 * @returns A new FetcherWithComponentsReset instance.
 */
export type FetcherWithComponentsReset<T> = FetcherWithComponents<T> & {
  reset: () => void;
};

/**
 * Custom hook that wraps the useFetcher hook with the ability to reset data.
 *
 * @param {Object} opts - Optional options to pass to the useFetcher hook.
 * @returns {Object} - An object containing fetcher properties with added reset functionality.
 */
export function useFetcherWithReset<T = AppData>(
  opts?: Parameters<typeof useFetcher>[0]
): FetcherWithComponentsReset<SerializeFrom<T>> {
  const fetcher = useFetcher<T>(opts);
  const [data, setData] = useState(fetcher.data);
  useEffect(() => {
    if (fetcher.state === "idle") {
      setData(fetcher.data);
    }
  }, [fetcher.state, fetcher.data]);
  return {
    ...fetcher,
    data: data as SerializeFrom<T>,
    reset: () => setData(undefined),
  };
}
