import { useEffect, useState } from "react";
import { collection, getDocs, orderBy, query } from "firebase/firestore";
import { db } from "../firebase";

/** Returns a sorted list of category names from Firestore. */
export function useCategories(): string[] {
  const [categories, setCategories] = useState<string[]>([]);

  useEffect(() => {
    getDocs(query(collection(db, "categories"), orderBy("name", "asc")))
      .then((snap) => setCategories(snap.docs.map((d) => d.data().name as string)))
      .catch(() => {});
  }, []);

  return categories;
}
