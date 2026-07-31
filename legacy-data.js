/* ============================================================
   Historical league totals imported from the Google Sheet
   ("UFC Picks" leaderboard tab, snapshot July 2026).
   Years run 2019 through 2026. Gnarl joined in 2023.
   These seed the all-time leaderboard; the app adds new
   results on top of them going forward.
   ============================================================ */

window.LEGACY_DATA = {
  importedFrom: "UFC Picks.xlsx (Google Sheets export)",
  snapshotDate: "2026-07-30",
  years: [2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026],
  totalFightsByYear: { "2023": 505, "2024": 514, "2025": 492, "2026": 287 },
  players: {
    beezus: {
      name: "Beezus",
      joinedYear: 2019,
      perfects: 0,
      noHitters: 1,
      correctPicks: 2204,
      percentage: 64.41,
      totalPointsWithBonus: 1922,
      pickemPercentage: 50.37,
      correctByYear:    { "2019": 115, "2020": 270, "2021": 314, "2022": 328, "2023": 329, "2024": 343, "2025": 319, "2026": 186 },
      withBonusByYear:  { "2019": 118, "2020": 298, "2021": 330, "2022": 359, "2023": 359, "2024": 458, "2025": 465, "2026": 271 }
    },
    teetee: {
      name: "Tee Tee",
      joinedYear: 2019,
      perfects: 1,
      noHitters: 2,
      correctPicks: 2191,
      percentage: 63.82,
      totalPointsWithBonus: 1913,
      pickemPercentage: 50.0,
      correctByYear:    { "2019": 111, "2020": 282, "2021": 316, "2022": 316, "2023": 328, "2024": 333, "2025": 317, "2026": 188 },
      withBonusByYear:  { "2019": 116, "2020": 296, "2021": 340, "2022": 346, "2023": 362, "2024": 453, "2025": 469, "2026": 282 }
    },
    dripple: {
      name: "Dripple",
      joinedYear: 2019,
      perfects: 0,
      noHitters: 1,
      correctPicks: 2253,
      percentage: 65.65,
      totalPointsWithBonus: 1944,
      pickemPercentage: 49.63,
      correctByYear:    { "2019": 118, "2020": 287, "2021": 324, "2022": 320, "2023": 327, "2024": 345, "2025": 331, "2026": 201 },
      withBonusByYear:  { "2019": 119, "2020": 303, "2021": 348, "2022": 349, "2023": 358, "2024": 467, "2025": 477, "2026": 299 }
    },
    gnarl: {
      name: "Gnarl",
      joinedYear: 2023,
      perfects: 0,
      noHitters: 0,
      correctPicks: 1197,
      percentage: 66.57,
      totalPointsWithBonus: 846,
      pickemPercentage: 0.67,
      correctByYear:    { "2023": 323, "2024": 344, "2025": 334, "2026": 196 },
      withBonusByYear:  { "2023": 362, "2024": 484, "2025": 487, "2026": 292 }
    }
  }
};
