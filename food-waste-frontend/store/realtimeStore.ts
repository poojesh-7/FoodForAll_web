import { create } from "zustand";
import type { DbId, FoodListingRow } from "@shared/contracts/api-contracts";

type RealtimeEntity = Record<string, unknown> & { id?: DbId; reservation_id?: DbId };

export type ReservationRealtimePayload = {
  action?: string;
  reservation?: RealtimeEntity;
};

export type PaymentRealtimePayload = {
  action?: string;
  payment?: RealtimeEntity | null;
  reservation?: RealtimeEntity;
};

export type VolunteerRealtimePayload = {
  action?: string;
  reservation?: RealtimeEntity;
  volunteer?: RealtimeEntity | null;
};

export type ListingRealtimePayload = {
  action?: string;
  listing?: FoodListingRow;
};

export type ModerationCaseRealtimePayload = {
  action?: string;
  case_id?: DbId;
  status?: string | null;
  response_id?: DbId | null;
  appeal_id?: DbId | null;
  attachment_count?: number | string | null;
};

export type ProviderFinancialRealtimePayload = {
  action?: string;
  provider_id?: DbId | null;
  payout_account_id?: DbId | null;
  previous_payout_account_id?: DbId | null;
  settlement_id?: DbId | null;
  status?: string | null;
};

type RealtimeState = {
  reservationVersion: number;
  paymentVersion: number;
  volunteerVersion: number;
  listingVersion: number;
  moderationCaseVersion: number;
  providerFinancialVersion: number;
  reservations: Record<string, RealtimeEntity>;
  payments: Record<string, RealtimeEntity>;
  listings: Record<string, FoodListingRow>;
  volunteers: Record<string, RealtimeEntity>;
  moderationCases: Record<string, ModerationCaseRealtimePayload>;
  providerFinancialEvents: Record<string, ProviderFinancialRealtimePayload>;
  applyReservation: (payload: ReservationRealtimePayload) => void;
  applyPayment: (payload: PaymentRealtimePayload) => void;
  applyVolunteer: (payload: VolunteerRealtimePayload) => void;
  applyListing: (payload: ListingRealtimePayload) => void;
  applyModerationCase: (payload: ModerationCaseRealtimePayload) => void;
  applyProviderFinancial: (payload: ProviderFinancialRealtimePayload) => void;
  resetRealtime: () => void;
};

function entityKey(entity?: RealtimeEntity | null) {
  const id = entity?.id ?? entity?.reservation_id;
  return id === undefined || id === null ? null : String(id);
}

export const useRealtimeStore = create<RealtimeState>((set) => ({
  reservationVersion: 0,
  paymentVersion: 0,
  volunteerVersion: 0,
  listingVersion: 0,
  moderationCaseVersion: 0,
  providerFinancialVersion: 0,
  reservations: {},
  payments: {},
  listings: {},
  volunteers: {},
  moderationCases: {},
  providerFinancialEvents: {},

  applyReservation: (payload) =>
    set((state) => {
      const key = entityKey(payload.reservation);
      return {
        reservationVersion: state.reservationVersion + 1,
        reservations: key
          ? {
              ...state.reservations,
              [key]: {
                ...(state.reservations[key] ?? {}),
                ...payload.reservation,
              },
            }
          : state.reservations,
      };
    }),

  applyPayment: (payload) =>
    set((state) => {
      const paymentKey = entityKey(payload.payment);
      const reservationKey = entityKey(payload.reservation);

      return {
        paymentVersion: state.paymentVersion + 1,
        reservationVersion: payload.reservation
          ? state.reservationVersion + 1
          : state.reservationVersion,
        payments: paymentKey
          ? {
              ...state.payments,
              [paymentKey]: {
                ...(state.payments[paymentKey] ?? {}),
                ...payload.payment,
              },
            }
          : state.payments,
        reservations: reservationKey
          ? {
              ...state.reservations,
              [reservationKey]: {
                ...(state.reservations[reservationKey] ?? {}),
                ...payload.reservation,
              },
            }
          : state.reservations,
      };
    }),

  applyVolunteer: (payload) =>
    set((state) => {
      const reservationKey = entityKey(payload.reservation);
      const volunteerKey = entityKey(payload.volunteer);

      return {
        volunteerVersion: state.volunteerVersion + 1,
        reservationVersion: payload.reservation
          ? state.reservationVersion + 1
          : state.reservationVersion,
        reservations: reservationKey
          ? {
              ...state.reservations,
              [reservationKey]: {
                ...(state.reservations[reservationKey] ?? {}),
                ...payload.reservation,
              },
            }
          : state.reservations,
        volunteers: volunteerKey
          ? {
              ...state.volunteers,
              [volunteerKey]: {
                ...(state.volunteers[volunteerKey] ?? {}),
                ...payload.volunteer,
              },
            }
          : state.volunteers,
      };
    }),

  applyListing: (payload) =>
    set((state) => {
      const key = entityKey(payload.listing);
      return {
        listingVersion: state.listingVersion + 1,
        listings: key
          ? {
              ...state.listings,
              [key]: {
                ...(state.listings[key] ?? {}),
                ...payload.listing,
              },
            }
          : state.listings,
      };
    }),

  applyModerationCase: (payload) =>
    set((state) => {
      const key =
        payload.case_id === undefined || payload.case_id === null
          ? null
          : String(payload.case_id);
      return {
        moderationCaseVersion: state.moderationCaseVersion + 1,
        moderationCases: key
          ? {
              ...state.moderationCases,
              [key]: {
                ...(state.moderationCases[key] ?? {}),
                ...payload,
              },
            }
          : state.moderationCases,
      };
    }),

  applyProviderFinancial: (payload) =>
    set((state) => {
      const key = [
        payload.action || "provider_financial_updated",
        payload.provider_id || "provider",
        payload.payout_account_id || payload.settlement_id || "latest",
      ].join(":");
      return {
        providerFinancialVersion: state.providerFinancialVersion + 1,
        providerFinancialEvents: {
          ...state.providerFinancialEvents,
          [key]: payload,
        },
      };
    }),

  resetRealtime: () =>
    set({
      reservationVersion: 0,
      paymentVersion: 0,
      volunteerVersion: 0,
      listingVersion: 0,
      moderationCaseVersion: 0,
      providerFinancialVersion: 0,
      reservations: {},
      payments: {},
      listings: {},
      volunteers: {},
      moderationCases: {},
      providerFinancialEvents: {},
    }),
}));
