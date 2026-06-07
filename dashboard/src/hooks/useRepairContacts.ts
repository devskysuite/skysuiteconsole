import { useEffect, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import { db } from "../firebase";

export const CONTACT_TYPES = ["Equipment Repair", "Technical Support", "General"] as const;
export type ContactType = (typeof CONTACT_TYPES)[number];

export type RepairContact = {
  id: string;
  header: string;
  company?: string;
  contact?: string;
  phone?: string;
  address?: string;
  contactType?: ContactType;
  categories?: string[];
  notes?: string;
  order?: number;
};

/** Returns all repair contacts sorted by order field. */
export function useRepairContacts(): RepairContact[] {
  const [contacts, setContacts] = useState<RepairContact[]>([]);

  useEffect(() => {
    getDocs(collection(db, "repairContacts"))
      .then((snap) => {
        const list = snap.docs
          .map((d) => ({ id: d.id, ...d.data() } as RepairContact))
          .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
        setContacts(list);
      })
      .catch(() => {});
  }, []);

  return contacts;
}
