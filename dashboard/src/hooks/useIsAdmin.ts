import { useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { collection, getDocs, query, where } from "firebase/firestore";
import { auth, db } from "../firebase";

/**
 * Returns true if the current user is an admin.
 * - No Firestore record = original admin account
 * - Firestore record with role "admin" = promoted admin
 * - Firestore record with role "user" (or no role) = regular user
 * Returns null while loading.
 */
export function useIsAdmin(): boolean | null {
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);

  useEffect(() => {
    return onAuthStateChanged(auth, async (user) => {
      if (!user) {
        setIsAdmin(false);
        return;
      }
      try {
        const snap = await getDocs(
          query(collection(db, "users"), where("uid", "==", user.uid))
        );
        if (snap.empty) {
          setIsAdmin(true); // No record = original admin
        } else {
          const role = snap.docs[0].data().role;
          setIsAdmin(role === "admin" || role === "owner");
        }
      } catch {
        setIsAdmin(false);
      }
    });
  }, []);

  return isAdmin;
}
