import { createContext, useContext } from 'react';
import type { Boot } from './types';

export type Tab = 'today' | 'together' | 'home' | 'memory';
export type AppCtx = {
  boot: Boot;
  go: (tab: Tab, sub?: string) => void;
  reloadBoot: () => void;
  openEventSheet: () => void;
};
export const Ctx = createContext<AppCtx>(null as any);
export const useApp = () => useContext(Ctx);
