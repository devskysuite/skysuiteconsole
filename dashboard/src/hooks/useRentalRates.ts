import { useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "../firebase";

export type RentalRates = {
  dayRate: number;   // $ per day, for 1–4 days
  weekRate: number;  // flat $ for 5–15 days
  monthRate: number; // flat $ for 16+ days
};

const DEFAULT_RATES: RentalRates = { dayRate: 0, weekRate: 0, monthRate: 0 };

export function calcRental(days: number, rates: RentalRates): number {
  if (days <= 4)  return days * rates.dayRate;
  if (days <= 15) return rates.weekRate;
  return rates.monthRate;
}

export function useRentalRates(): RentalRates | null {
  const [rates, setRates] = useState<RentalRates | null>(null);

  useEffect(() => {
    const unsub = onSnapshot(doc(db, "settings", "rentalRates"), (snap) => {
      if (snap.exists()) {
        setRates(snap.data() as RentalRates);
      } else {
        setRates(DEFAULT_RATES);
      }
    }, () => { setRates(DEFAULT_RATES); });
    return unsub;
  }, []);

  return rates;
}
