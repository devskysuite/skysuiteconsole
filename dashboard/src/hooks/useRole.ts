import { useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { collection, getDocs, query, where } from "firebase/firestore";
import { auth, db } from "../firebase";

export type UserRole = "owner" | "admin" | "manager" | "user" | null;

/**
 * Returns the current user's role.
 * - null = still loading
 * - "owner"   = full access, cannot be deleted
 * - "admin"   = day-to-day ops
 * - "manager" = can approve/deny time off
 * - "user"    = standard access
 * - No Firestore record = treated as "owner" (original bootstrap account)
 */
export function useRole(): UserRole {
  const [role, setRole] = useState<UserRole>(null);

  useEffect(() => {
    return onAuthStateChanged(auth, async (user) => {
      if (!user) {
        setRole("user");
        return;
      }
      try {
        const snap = await getDocs(
          query(collection(db, "users"), where("uid", "==", user.uid))
        );
        if (snap.empty) {
          setRole("owner"); // bootstrap account
        } else {
          const r = snap.docs[0].data().role as UserRole;
          setRole(r ?? "user");
        }
      } catch {
        setRole("user");
      }
    });
  }, []);

  return role;
}

/** Convenience helpers */
export const isOwnerRole = (r: UserRole) => r === "owner";
export const isAdminRole = (r: UserRole) => r === "owner" || r === "admin";
export const isManagerRole = (r: UserRole) => r === "owner" || r === "manager";
export const canApproveTimeOff = (r: UserRole) => r === "owner" || r === "admin" || r === "manager";
