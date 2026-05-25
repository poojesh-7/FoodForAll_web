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

type RealtimeState = {
  reservationVersion: number;
  paymentVersion: number;
  volunteerVersion: number;
  listingVersion: number;
  reservations: Record<string, RealtimeEntity>;
  payments: Record<string, RealtimeEntity>;
  listings: Record<string, FoodListingRow>;
  volunteers: Record<string, RealtimeEntity>;
  applyReservation: (payload: ReservationRealtimePayload) => void;
  applyPayment: (payload: PaymentRealtimePayload) => void;
  applyVolunteer: (payload: VolunteerRealtimePayload) => void;
  applyListing: (payload: ListingRealtimePayload) => void;
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
  reservations: {},
  payments: {},
  listings: {},
  volunteers: {},

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

  resetRealtime: () =>
    set({
      reservationVersion: 0,
      paymentVersion: 0,
      volunteerVersion: 0,
      listingVersion: 0,
      reservations: {},
      payments: {},
      listings: {},
      volunteers: {},
    }),
}));
