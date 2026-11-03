import { useCallback, useEffect, useRef, useState } from 'react';

export function useAsync<T>(loader: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [tick, setTick] = useState(0);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    loaderRef
      .current()
      .then((result) => {
        if (active) setData(result);
      })
      .catch((reason: unknown) => {
        if (active) setError(reason);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  const reload = useCallback(() => setTick((value) => value + 1), []);
  return { data, loading, error, reload, setData };
}

function readDraft<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function useDraft<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => readDraft<T>(key) ?? initial);
  const [restored] = useState(() => readDraft<T>(key) !== null);
  const initialRef = useRef(initial);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        if (JSON.stringify(value) === JSON.stringify(initialRef.current)) {
          localStorage.removeItem(key);
        } else {
          localStorage.setItem(key, JSON.stringify(value));
        }
      } catch {
        // 存储空间不足时不影响主流程，界面仍会提示“结果未知/可重试”。
      }
    }, 350);
    return () => window.clearTimeout(timer);
  }, [key, value]);

  const clear = useCallback(() => {
    localStorage.removeItem(key);
    setValue(initialRef.current);
  }, [key]);

  return { value, setValue, restored, clear };
}

export function useIntentKey(seed = '') {
  const [key, setKey] = useState(() => `${seed}${crypto.randomUUID()}`);
  const renew = useCallback(() => setKey(`${seed}${crypto.randomUUID()}`), [seed]);
  return { key, renew };
}

export function useDocumentTitle(title: string): void {
  useEffect(() => {
    document.title = title ? `${title} · 厂序` : '厂序 · 工厂业务协同';
  }, [title]);
}
