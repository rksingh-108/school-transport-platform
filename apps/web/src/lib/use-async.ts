import { useEffect, useMemo, useState, type DependencyList } from 'react';

interface AsyncResult<T> {
  data: T | null;
  error: unknown;
  loading: boolean;
  reload: () => void;
}

/**
 * Fetches `fn()` whenever `deps` change, ignoring any response that resolves
 * after a newer request has already started (e.g. a slow request for a
 * stale search term can never clobber a newer one). `loading` is derived by
 * comparing the in-flight request's identity token against the last
 * resolved one, rather than set synchronously inside the effect — and
 * resolution happens via a `.then()` callback rather than `async`/`await`.
 * react-hooks/set-state-in-effect flags any setState call that appears to
 * run as part of the effect's own synchronous body, which async/await
 * syntax does even after an `await`; a `.then()` callback is treated as the
 * "subscribe to an external callback" pattern the rule expects (see
 * https://react.dev/learn/you-might-not-need-an-effect).
 */
export function useAsync<T>(fn: () => Promise<T>, deps: DependencyList): AsyncResult<T> {
  const [state, setState] = useState<{ data: T | null; error: unknown }>({ data: null, error: null });
  const [resolvedToken, setResolvedToken] = useState<{ key: string } | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  const depsKey = JSON.stringify(deps) + '|' + reloadTick;
  const requestToken = useMemo(() => ({ key: depsKey }), [depsKey]);

  useEffect(() => {
    let ignore = false;
    fn().then(
      (data) => {
        if (ignore) return;
        setState({ data, error: null });
        setResolvedToken(requestToken);
      },
      (error: unknown) => {
        if (ignore) return;
        setState({ data: null, error });
        setResolvedToken(requestToken);
      },
    );
    return () => {
      ignore = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestToken]);

  return {
    data: state.data,
    error: state.error,
    loading: resolvedToken !== requestToken,
    reload: () => setReloadTick((t) => t + 1),
  };
}
