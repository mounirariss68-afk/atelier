import { createContext, useContext, useMemo, type ReactNode } from "react";
import {
  INITIATIVES,
  SPONSORS,
  BUSINESS_UNITS,
  type Initiative,
  type Sponsor,
  type BusinessUnit,
} from "@/data/value-realization-seed";

export interface ValueRealizationData {
  initiatives: Initiative[];
  sponsors: Sponsor[];
  businessUnits: BusinessUnit[];
}

const EMPTY: ValueRealizationData = {
  initiatives: [],
  sponsors: [],
  businessUnits: [],
};

const Ctx = createContext<ValueRealizationData>(EMPTY);

let _snapshot: ValueRealizationData = EMPTY;

export function getValueRealizationSnapshot(): ValueRealizationData {
  return _snapshot;
}

export function ValueRealizationDataProvider({ children }: { children: ReactNode }) {
  const value = useMemo<ValueRealizationData>(() => {
    const v: ValueRealizationData = {
      initiatives: INITIATIVES,
      sponsors: SPONSORS,
      businessUnits: BUSINESS_UNITS,
    };
    _snapshot = v;
    return v;
  }, []);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useValueRealizationData(): ValueRealizationData {
  return useContext(Ctx);
}
