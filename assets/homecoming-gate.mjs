// Used when the approved Homecoming design is connected to the homepage.
// Preview never grants approval and no browser storage suppresses repeat visits.
export function shouldCelebrate(config, final, now = Date.now()) {
  return config.approved === true &&
    Number.isFinite(now) && now >= Date.parse(config.opensAt) && now < Date.parse(config.expiresAt) &&
    final?.gameId === config.gameId && final.date === config.gameDate &&
    final.level === 'Varsity' && final.opponent === 'Parowan' && final.status === 'FINAL' &&
    Number.isInteger(final.teamScore) && Number.isInteger(final.opponentScore) &&
    final.opponentScore >= 0 && final.teamScore > final.opponentScore;
}
