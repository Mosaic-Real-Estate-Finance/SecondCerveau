// When a meeting took place, the way the card says it:
//   Aujourd'hui, à 14:30 · Hier, à 14:30 · Il y a 3 jours, à 14:30
//   Le 24 Octobre à 14:30 (a week or more ago; the year too if not this one)
// Days are calendar days: a meeting at 23:00 is « Hier » at 08:00.

const DAY_MS = 86_400_000;

const time = (date: Date) =>
  date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

const midnight = (date: Date) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

export function formatWhen(date: Date, now = new Date()): string {
  // Rounded: a daylight-saving change makes one day 23 or 25 hours long.
  const days = Math.round((midnight(now) - midnight(date)) / DAY_MS);
  if (days <= 0) return `Aujourd'hui, à ${time(date)}`;
  if (days === 1) return `Hier, à ${time(date)}`;
  if (days < 7) return `Il y a ${days} jours, à ${time(date)}`;
  const month = date.toLocaleDateString("fr-FR", { month: "long" });
  const year =
    date.getFullYear() === now.getFullYear() ? "" : ` ${date.getFullYear()}`;
  return `Le ${date.getDate()} ${month[0].toUpperCase()}${month.slice(1)}${year} à ${time(date)}`;
}
