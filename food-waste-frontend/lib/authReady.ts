export function canResumeReservationFetch(
  state: {
    initialized?: boolean;
    isInitializing?: boolean;
    isAuthenticated?: boolean;
    user?: unknown;
  }
) {
  return Boolean(
    state.initialized &&
      !state.isInitializing &&
      state.isAuthenticated &&
      state.user
  );
}
