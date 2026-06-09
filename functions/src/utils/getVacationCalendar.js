// There is ONE shared Outlook calendar. On-call and vacation events live on it,
// distinguished by their subject ("… On Call" vs "… Vacation").
export const SHARED_CAL_ID = "AAMkADgyOGUwMDUyLTNiZjMtNGQzNi1hNTgwLTQ2M2IzYzE2YmQ5MgBGAAAAAACGxuDePTlOQawDDU8UfW0gBwBxt6lSDH0kQY0tk4wDjNk8AAAAAAEGAABxt6lSDH0kQY0tk4wDjNk8AAALmQObAAA=";

// Kept for backwards compatibility — vacations use the same shared calendar.
export async function getVacationCalendarId() {
  return SHARED_CAL_ID;
}
