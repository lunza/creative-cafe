import { useState, useCallback, useRef } from 'react';

export interface UseModalReturn<T = undefined> {
  isOpen: boolean;
  data: T | undefined;
  open: (data?: T) => void;
  close: () => void;
  toggle: () => void;
  reset: () => void;
}

export function useModal<T = undefined>(initialData?: T): UseModalReturn<T> {
  const [isOpen, setIsOpen] = useState(false);
  const [data, setData] = useState<T | undefined>(initialData);
  const initialDataRef = useRef(initialData);

  const open = useCallback((newData?: T) => {
    setData(newData ?? initialDataRef.current);
    setIsOpen(true);
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
    setData(undefined);
  }, []);

  const toggle = useCallback(() => {
    setIsOpen(prev => !prev);
  }, []);

  const reset = useCallback(() => {
    setIsOpen(false);
    setData(initialDataRef.current);
  }, []);

  return {
    isOpen,
    data,
    open,
    close,
    toggle,
    reset
  };
}
