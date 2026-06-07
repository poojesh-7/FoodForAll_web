// API contracts derived from Food_waste_backend routes/controllers.
// Response envelopes are the strict contract shape requested for frontend use:
// { success, message, data }. Data shapes below match the backend payloads.

export type DbId = string | number;
export type ISODateString = string;
export type DbRow = Record<string, unknown>;
export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "ALL";
export type UserRole = "user" | "volunteer" | "ngo" | "provider" | "admin";
export type VolunteerRequestAction = "accepted" | "rejected";

export interface ApiResponse<TData> {
  success: boolean;
  message: string;
  data: TData;
}

export interface ApiErrorResponse {
  success: false;
  message: string;
  data: null;
}

export type EmptyData = null;
export type NoRequestBody = Record<string, never>;
export type NoRequestQuery = Record<string, never>;
export type NoRequestParams = Record<string, never>;

export interface IdParams {
  id: string;
}

export interface ListingIdParams {
  listingId: string;
}

export interface ProviderIdParams {
  providerId: string;
}

export interface RequestIDParams {
  requestID: string;
}

export interface PaginationQuery {
  page?: string;
  limit?: string;
}

export interface CoordinatesQuery {
  lat: string;
  lng: string;
  radius?: string;
}

export interface OptionalCoordinatesQuery {
  lat?: string;
  lng?: string;
  radius?: string;
}

export interface AuthUser {
  id: DbId;
  role: UserRole | null;
}

export interface UserProfile {
  id: DbId;
  name: string | null;
  phone: string | null;
  email: string | null;
  role: UserRole | null;
  created_at: ISODateString;
}

export interface UserUpdateResult {
  id: DbId;
  name: string | null;
  email: string | null;
  role: UserRole | null;
  profile_image: string | null;
}

export interface UserLocationResult {
  id: DbId;
  address: string | null;
  latitude: number | string | null;
  longitude: number | string | null;
}

export interface AuthMeUser extends UserProfile {
  is_verified: boolean;
  verification_status?: "unregistered" | "pending" | "approved" | "rejected";
  rejection_reason?: string | null;
  reliability_deposit_amount?: number | string;
  requires_reliability_deposit?: boolean;
  restriction_level?: number | string;
  restriction_reason?: string | null;
  cooldown_until?: ISODateString | null;
  banned_until?: ISODateString | null;
  trust_score?: number | string;
  restriction_type?: string | null;
}

export interface CompleteProfileUser {
  id: DbId;
  name: string;
  email: string;
  role: UserRole;
  address: string | null;
  latitude: number | string | null;
  longitude: number | string | null;
}

export interface RestaurantRegistration {
  id: DbId;
  user_id: DbId;
  restaurant_name: string;
  fssai_number: string;
  is_verified: boolean;
  rejection_reason?: string | null;
  verification_status?: "pending" | "approved" | "rejected";
}

export interface RestaurantProfile extends RestaurantRegistration {
  fssai_certificate_url?: string | null;
  service_radius_km?: number | string;
  latitude?: number | string | null;
  longitude?: number | string | null;
  created_at?: ISODateString;
  updated_at?: ISODateString;
}

export interface NGORegistration {
  id: DbId;
  user_id: DbId;
  organization_name: string;
  service_radius_km: number | string;
  is_verified: boolean;
  rejection_reason?: string | null;
  verification_status?: "pending" | "approved" | "rejected";
}

export interface NGOProfile extends NGORegistration {
  registration_number?: string;
  urgent_flag?: boolean | null;
  latitude?: number | string | null;
  longitude?: number | string | null;
  reliability_deposit_amount?: number | string | null;
  refundable_deposit?: number | string | null;
  requires_reliability_deposit?: boolean | null;
  restriction_level?: number | string | null;
  restriction_reason?: string | null;
  restriction_type?: string | null;
  cooldown_until?: ISODateString | null;
  banned_until?: ISODateString | null;
  trust_score?: number | string | null;
  created_at?: ISODateString;
  updated_at?: ISODateString;
}

export interface FoodListingRow extends DbRow {
  id?: DbId;
  provider_id?: DbId;
  title?: string;
  description?: string | null;
  quantity?: number | string;
  remaining_quantity?: number | string;
  price?: number | string;
  is_free?: boolean;
  pickup_start_time?: ISODateString | null;
  pickup_end_time?: ISODateString;
  latitude?: number | string;
  longitude?: number | string;
  status?: string;
  is_deleted?: boolean;
  deleted_at?: ISODateString | null;
  provider_name?: string | null;
  restaurant_name?: string | null;
  reservation_count?: number | string;
}

export interface FoodListingWithDistance extends FoodListingRow {
  distance: number | string;
}

export interface NearbyFoodListing {
  id: DbId;
  title: string;
  description?: string | null;
  remaining_quantity: number | string;
  pickup_end_time?: ISODateString | null;
  status?: string;
  is_free?: boolean;
  price?: number | string | null;
  provider_name?: string | null;
  restaurant_name?: string | null;
}

export interface FoodNGOOption {
  id: DbId;
  organization_name: string;
  urgent_flag: boolean | null;
}

export interface ReservationRow extends DbRow {
  id?: DbId;
  listing_id?: DbId;
  user_id?: DbId;
  assigned_volunteer_id?: DbId | null;
  quantity_reserved?: number | string;
  pickup_type?: string;
  task_status?: string;
  status?: string;
  pickup_code?: string;
  receive_code?: string;
  payment_status?: string;
  payment_expires_at?: ISODateString | null;
  order_id?: string | null;
  payment_session_id?: string | null;
  reserved_at?: ISODateString | null;
  created_at?: ISODateString | null;
  assigned_at?: ISODateString | null;
  picked_up_at?: ISODateString | null;
  completed_at?: ISODateString | null;
  food_amount?: number | string | null;
  reliability_deposit_amount?: number | string | null;
  reliability_deposit_status?: string | null;
  refundable_deposit?: number | string | null;
  deposit_status?: string | null;
  refund_status?: string | null;
}

export interface PaymentCreateResult {
  order_id: string;
  payment_session_id: string;
  amount: number;
  food_amount?: number;
  reliability_deposit_amount?: number;
}

export interface RestrictionPolicy {
  canReserve?: boolean;
  canTakeTask?: boolean;
  canList?: boolean;
  requiresDeposit?: boolean;
  depositAmount?: number;
  restrictionLevel?: number;
  bannedUntil?: ISODateString | null;
  cooldownUntil?: ISODateString | null;
  restrictionReason?: string | null;
  restrictionType?: string | null;
  trustScore?: number;
}

export interface ReservationWithPaymentData {
  reservation: ReservationRow;
  payment: PaymentCreateResult;
  policy?: RestrictionPolicy;
  pricing?: ReservationPricingPreview;
}

export interface BulkReserveData {
  reservations: ReservationRow[];
  payment: PaymentCreateResult | null;
  policy?: RestrictionPolicy;
  pricing?: ReservationPricingPreview;
}

export interface ReservationPricingPreview {
  foodAmount: number;
  depositAmount: number;
  totalAmount: number;
  requiresDeposit: boolean;
  totalQuantity?: number;
  policy?: RestrictionPolicy;
}

export interface ReservationDetails extends ReservationRow {
  provider_id: DbId;
  title?: string;
  description?: string | null;
  pickup_start_time?: ISODateString | null;
  pickup_end_time?: ISODateString | null;
  is_free?: boolean;
  price?: number | string | null;
  provider_name?: string | null;
  restaurant_name?: string | null;
  provider_phone?: string | null;
  provider_address?: string | null;
  provider_latitude?: number | string | null;
  provider_longitude?: number | string | null;
  requester_name?: string | null;
  requester_phone?: string | null;
  assigned_volunteer_name?: string | null;
  assigned_volunteer_phone?: string | null;
  review_id?: DbId | null;
  review_rating?: number | string | null;
  review_text?: string | null;
}

export interface ReservationHistoryRow extends ReservationRow {
  title: string;
  pickup_end_time: ISODateString;
  description?: string | null;
  pickup_start_time?: ISODateString | null;
  is_free?: boolean;
  price?: number | string | null;
  provider_id?: DbId;
  provider_name?: string | null;
  restaurant_name?: string | null;
  provider_phone?: string | null;
  provider_address?: string | null;
  provider_latitude?: number | string | null;
  provider_longitude?: number | string | null;
  assigned_volunteer_name?: string | null;
  assigned_volunteer_phone?: string | null;
}

export type UserHistoryItem = FoodListingRow | ReservationHistoryRow;

export interface VolunteerAvailableNGO {
  id: DbId;
  organization_name: string;
  urgent_flag: boolean | null;
  active_listings: string;
  total_volunteers: string;
  volunteer_status?: string | null;
}

export interface VolunteerRequestRow extends DbRow {
  id?: DbId;
  ngo_id?: DbId;
  volunteer_id?: DbId;
  status?: string;
  organization_name: string;
}

export interface VolunteerMembershipRow extends DbRow {
  user_id?: DbId;
  ngo_id?: DbId;
  status?: string;
}

export interface VolunteerTask {
  reservation_id: DbId;
  quantity_reserved: number | string;
  pickup_type?: string;
  status?: string;
  task_status: string;
  listing_id: DbId;
  title: string;
  latitude: number | string;
  longitude: number | string;
  restaurant_latitude?: number | string | null;
  restaurant_longitude?: number | string | null;
  ngo_latitude?: number | string | null;
  ngo_longitude?: number | string | null;
  ngo_name?: string | null;
  pickup_start_time?: ISODateString | null;
  pickup_end_time?: ISODateString | null;
  provider_id?: DbId;
  provider_name?: string | null;
  restaurant_name?: string | null;
  provider_phone?: string | null;
  distance: number | string;
}

export interface VolunteerCurrentTask extends Omit<VolunteerTask, "distance"> {
  pickup_code: string;
  assigned_at: ISODateString | null;
  picked_up_at: ISODateString | null;
  completed_at: ISODateString | null;
}

export interface VolunteerStats {
  total_completed: number | string;
  avg_completion_time: number | string;
}

export interface VolunteerDashboardData {
  active_ngo: VolunteerAvailableNGO | null;
  current_task: VolunteerCurrentTask | null;
  stats: VolunteerStats;
  pending_requests: VolunteerRequestRow[];
}

export interface NGOAssignedVolunteer {
  id: DbId;
  name: string | null;
  status: string;
}

export interface NGOUnassignedVolunteer {
  id: DbId;
  name: string | null;
  is_available: boolean | null;
}

export interface NGOVolunteerJoinRequest {
  request_id: DbId;
  ngo_id: DbId;
  volunteer_id: DbId;
  status: "pending" | "approved" | "rejected" | string;
  requested_at?: ISODateString | null;
  volunteer_name: string | null;
  volunteer_phone?: string | null;
  volunteer_email?: string | null;
  is_available?: boolean | null;
}

export interface NGOIncomingRequest {
  request_id: DbId;
  listing_id: DbId;
  title: string;
  remaining_quantity: number | string;
  provider_name: string | null;
  restaurant_name?: string | null;
  provider_id?: DbId;
  provider_phone?: string | null;
  pickup_end_time?: ISODateString | null;
  requested_at?: ISODateString | null;
  trust_score?: number | string | null;
  restriction_level?: number | string | null;
}

export interface NGOReservationHistoryRow extends ReservationRow {
  id: DbId;
  quantity_reserved: number | string;
  pickup_type: string;
  task_status: string;
  receive_code: string;
  created_at: ISODateString;
  listing_id: DbId;
  title: string;
  description: string | null;
  pickup_start_time: ISODateString | null;
  pickup_end_time: ISODateString | null;
  is_free: boolean;
  price: number | string | null;
  provider_id: DbId;
  provider_name: string | null;
  restaurant_name?: string | null;
  provider_phone: string | null;
  provider_address?: string | null;
  provider_latitude?: number | string | null;
  provider_longitude?: number | string | null;
  assigned_volunteer_name?: string | null;
  assigned_volunteer_phone?: string | null;
  review_id?: DbId | null;
  review_rating?: number | string | null;
  review_text?: string | null;
}

export interface ProviderReservationRow extends ReservationDetails {
  listing_id: DbId;
  requester_id: DbId;
  requester_name: string | null;
  requester_phone: string | null;
  reservation_kind: "user" | "ngo" | string;
  lifecycle_group?: "active" | "history" | string;
}

export interface RatingRow extends DbRow {
  id?: DbId;
  reservation_id?: DbId;
  listing_id?: DbId;
  reviewer_id?: DbId;
  rating?: number | string;
  review?: string | null;
}

export interface ListingRating {
  id?: DbId;
  rating: number | string;
  review: string | null;
  created_at: ISODateString;
  name: string | null;
}

export interface ProviderRatingSummary {
  average_rating: number | string;
  total_reviews: number | string;
}

export interface ImpactSummary {
  total_pickups: number | string;
  total_meals_saved: number | string;
  estimated_co2_saved: number | string;
  self_pickups?: number | string;
  ngo_pickups?: number | string;
  self_pickup_meals?: number | string;
  ngo_meals_rescued?: number | string;
  delivery_pickups?: number | string;
  delivery_meals_rescued?: number | string;
}

export interface NotificationRow extends DbRow {
  id?: DbId;
  user_id?: DbId;
  type?: string;
  title?: string;
  message?: string;
  is_read?: boolean;
  created_at?: ISODateString;
}

export interface UnreadCountData {
  unread: number;
}

export interface PendingNGORow extends DbRow {
  phone: string | null;
}

export interface PendingRestaurantRow extends DbRow {
  phone: string | null;
}

export interface CashfreePaymentDetails {
  payment_method?: string | null;
  cf_payment_id?: string | null;
}

export interface CashfreeRefundPayload {
  refund_id?: string;
  refund_status?: string;
}

export interface CashfreeWebhookData {
  order_id?: string;
  order_status?: "PAID" | "FAILED" | string;
  payment_details?: CashfreePaymentDetails;
  refund?: CashfreeRefundPayload;
}

export interface CashfreeWebhookRequest {
  data?: CashfreeWebhookData;
}

// Auth requests/responses
export interface SendOTPRequest {
  phone: string;
}
export type SendOTPResponse = ApiResponse<EmptyData>;

export interface VerifyOTPRequest {
  phone: string;
  otp: string;
}
export interface VerifyOTPData {
  user: AuthUser;
  isNewUser: boolean;
}
export type VerifyOTPResponse = ApiResponse<VerifyOTPData>;

export interface SetRoleRequest {
  role: UserRole;
}
export interface SetRoleData {
  user: AuthUser;
}
export type SetRoleResponse = ApiResponse<SetRoleData>;

export type RefreshTokenResponse = ApiResponse<EmptyData>;

export interface CompleteProfileRequest {
  phone: string;
  name: string;
  email: string;
  role: UserRole;
  address?: string | null;
  latitude?: number | string | null;
  longitude?: number | string | null;
}
export interface CompleteProfileData {
  user: CompleteProfileUser;
}
export type CompleteProfileResponse = ApiResponse<CompleteProfileData>;

export interface UpdateLocationRequest {
  address?: string | null;
  latitude: number | string;
  longitude: number | string;
}
export interface UpdateLocationData {
  user: UserLocationResult;
}
export type UpdateLocationResponse = ApiResponse<UpdateLocationData>;

export interface GetMeData {
  user: AuthMeUser;
}
export type GetMeResponse = ApiResponse<GetMeData>;
export type LogoutResponse = ApiResponse<EmptyData>;

// User requests/responses
export interface UpdateUserRequest {
  name?: string | null;
  email?: string | null;
  profile_image?: string | null;
}
export type GetUserResponse = ApiResponse<UserProfile>;
export type UpdateUserResponse = ApiResponse<UserUpdateResult>;
export type UserHistoryResponse = ApiResponse<UserHistoryItem[]>;

// Food requests/responses
export interface RegisterRestaurantRequest {
  restaurant_name: string;
  fssai_number: string;
  service_radius_km?: number | string;
  latitude: number | string;
  longitude: number | string;
  fssai_certificate: File;
}
export interface RegisterRestaurantData {
  restaurant: RestaurantRegistration;
}
export type RegisterRestaurantResponse = ApiResponse<RegisterRestaurantData>;
export type GetMyRestaurantResponse = ApiResponse<RestaurantProfile>;

export interface CreateFoodRequest {
  title: string;
  description?: string | null;
  quantity: number | string;
  price?: number | string;
  is_free?: boolean | "true" | "false";
  pickup_start_time?: ISODateString;
  pickup_end_time: ISODateString;
}
export interface FoodListingData {
  listing: FoodListingRow;
}
export type CreateFoodResponse = ApiResponse<FoodListingData>;

export interface UpdateFoodRequest {
  title?: string | null;
  description?: string | null;
  quantity?: number | string | null;
  price?: number | string | null;
  is_free?: boolean | "true" | "false" | null;
  pickup_start_time?: ISODateString | null;
  pickup_end_time?: ISODateString | null;
}
export type UpdateFoodResponse = ApiResponse<FoodListingRow>;
export interface DeleteFoodData {
  listing: FoodListingRow;
}
export type DeleteFoodResponse = ApiResponse<DeleteFoodData>;
export type GetAllFoodResponse = ApiResponse<FoodListingRow[]>;
export type GetActiveFoodResponse = ApiResponse<Array<FoodListingRow | FoodListingWithDistance>>;
export type GetNearbyFoodResponse = ApiResponse<NearbyFoodListing[]>;
export type GetFoodByIdResponse = ApiResponse<FoodListingRow>;
export type ViewNGOsForFoodResponse = ApiResponse<FoodNGOOption[]>;

export interface RequestNGORequest {
  ngo_id: DbId;
}
export type RequestNGOResponse = ApiResponse<EmptyData>;

// NGO requests/responses
export interface RegisterNGORequest {
  organization_name: string;
  registration_number: string;
  service_radius_km?: number | string;
  latitude: number | string;
  longitude: number | string;
}
export interface RegisterNGOData {
  ngo: NGORegistration;
}
export type RegisterNGOResponse = ApiResponse<RegisterNGOData>;
export type GetMyNGOResponse = ApiResponse<NGOProfile>;
export type NGONearbyListingsResponse = ApiResponse<NearbyFoodListing[]>;

export interface BulkReserveItem {
  listing_id: DbId;
  quantity: number | string;
}
export interface BulkReserveRequest {
  reservations: BulkReserveItem[];
}
export type BulkReserveResponse = ApiResponse<BulkReserveData>;
export type ReservationPricingPreviewResponse = ApiResponse<ReservationPricingPreview>;
export type NGOAssignedVolunteersResponse = ApiResponse<NGOAssignedVolunteer[]>;
export type NGOUnassignedVolunteersResponse = ApiResponse<NGOUnassignedVolunteer[]>;
export type NGOVolunteerJoinRequestsResponse = ApiResponse<NGOVolunteerJoinRequest[]>;

export interface RequestVolunteerRequest {
  volunteer_id: DbId;
}
export type RequestVolunteerResponse = ApiResponse<EmptyData>;

export interface SetUrgentRequest {
  urgent_flag: unknown;
}
export type SetUrgentResponse = ApiResponse<EmptyData>;
export type NGOIncomingRequestsResponse = ApiResponse<NGOIncomingRequest[]>;
export type ApproveVolunteerJoinRequestResponse = ApiResponse<EmptyData>;
export type RejectVolunteerJoinRequestResponse = ApiResponse<EmptyData>;
export interface AcceptNGORequestData {
  message?: string;
  reservation: ReservationRow;
  payment: PaymentCreateResult | null;
  policy?: RestrictionPolicy;
}
export type AcceptNGORequestResponse = ApiResponse<AcceptNGORequestData>;
export type RejectNGORequestResponse = ApiResponse<EmptyData>;
export type NGOReservationsResponse = ApiResponse<NGOReservationHistoryRow[]>;

// Volunteer requests/responses
export type VolunteerAvailableResponse = ApiResponse<VolunteerAvailableNGO[]>;
export type VolunteerRequestsResponse = ApiResponse<VolunteerRequestRow[]>;
export type VolunteerDashboardResponse = ApiResponse<VolunteerDashboardData>;

export interface RespondToVolunteerRequestBody {
  action: VolunteerRequestAction;
}
export type RespondToVolunteerRequestResponse = ApiResponse<EmptyData>;

export interface JoinNGORequest {
  ngo_id: DbId;
}
export type JoinNGOResponse = ApiResponse<VolunteerRequestRow>;

export interface LeaveNGORequest {
  ngo_id: DbId;
}
export type LeaveNGOResponse = ApiResponse<EmptyData>;
export type StartTaskResponse = ApiResponse<{ reservation: ReservationRow }>;

export type VolunteerTasksResponse = ApiResponse<VolunteerTask[]>;

export interface CompleteTaskRequest {
  receive_code: string;
}
export type CompleteTaskResponse = ApiResponse<EmptyData>;

// Reservation requests/responses
export interface CreateReservationRequest {
  listing_id: DbId;
  quantity: number | string;
}
export type CreateReservationResponse = ApiResponse<ReservationWithPaymentData>;
export type GetReservationByIdResponse = ApiResponse<ReservationDetails>;
export type GetMyReservationsResponse = ApiResponse<ReservationHistoryRow[]>;
export type GetProviderReservationsResponse = ApiResponse<ProviderReservationRow[]>;
export type CancelReservationResponse = ApiResponse<EmptyData>;

export interface MarkAsPickedUpRequest {
  pickup_code: string;
}
export type MarkAsPickedUpResponse = ApiResponse<EmptyData>;

export interface ReportProviderRequest {
  reason:
    | "fake_listing"
    | "unsafe_food"
    | "expired_food"
    | "provider_unavailable"
    | "repeated_cancellations"
    | "abusive_behavior"
    | "incorrect_listing";
  description?: string | null;
}
export interface ProviderReportAttachmentRow extends DbRow {
  id?: DbId;
  report_id?: DbId;
  uploader_user_id?: DbId;
  file_url?: string;
  mime_type?: string;
  file_size_bytes?: number | string;
  created_at?: ISODateString;
}
export type ModerationCaseStatus =
  | "OPEN"
  | "UNDER_REVIEW"
  | "AWAITING_RESPONSE"
  | "VALIDATED"
  | "DISMISSED"
  | "ESCALATED";

export interface ProviderReportRow extends DbRow {
  id?: DbId;
  provider_id?: DbId;
  reported_by?: DbId;
  reservation_id?: DbId | null;
  moderation_case_id?: DbId | null;
  moderation_case_status?: ModerationCaseStatus | string | null;
  reason?: string;
  description?: string | null;
  status?: string;
  created_at?: ISODateString;
  resolved_at?: ISODateString | null;
  reviewed_by_admin?: DbId | null;
  provider_name?: string | null;
  reporter_name?: string | null;
  reporter_role?: UserRole | string | null;
  reservation_pickup_type?: string | null;
  reservation_status?: string | null;
  reservation_task_status?: string | null;
  listing_title?: string | null;
  attachments?: ProviderReportAttachmentRow[];
}
export type ReportProviderResponse = ApiResponse<ProviderReportRow>;

export interface ModerationCaseEventRow extends DbRow {
  id: DbId;
  case_id: DbId;
  actor_user_id?: DbId | null;
  actor_name?: string | null;
  actor_role?: UserRole | string | null;
  event_type: string;
  from_status?: ModerationCaseStatus | string | null;
  to_status?: ModerationCaseStatus | string | null;
  note?: string | null;
  metadata?: DbRow;
  created_at?: ISODateString;
}

export interface ProviderCaseResponseAttachmentRow extends DbRow {
  id?: DbId;
  response_id?: DbId;
  file_url?: string;
  mime_type?: string;
  file_size_bytes?: number | string;
  created_at?: ISODateString;
}

export interface ProviderCaseResponseRow extends DbRow {
  id?: DbId;
  case_id?: DbId;
  provider_id?: DbId;
  provider_name?: string | null;
  response_text?: string;
  created_at?: ISODateString;
  updated_at?: ISODateString;
  attachments?: ProviderCaseResponseAttachmentRow[];
}

export type ModerationAppealStatus =
  | "SUBMITTED"
  | "UNDER_REVIEW"
  | "ACCEPTED"
  | "REJECTED"
  | "WITHDRAWN";

export interface ModerationAppealAttachmentRow extends DbRow {
  id?: DbId;
  appeal_id?: DbId;
  uploader_user_id?: DbId;
  file_url?: string;
  mime_type?: string;
  file_size_bytes?: number | string;
  created_at?: ISODateString;
}

export interface ModerationAppealEventRow extends DbRow {
  id: DbId;
  appeal_id: DbId;
  case_id: DbId;
  actor_user_id?: DbId | null;
  actor_name?: string | null;
  actor_role?: UserRole | string | null;
  event_type: string;
  from_status?: ModerationAppealStatus | string | null;
  to_status?: ModerationAppealStatus | string | null;
  note?: string | null;
  metadata?: DbRow;
  created_at?: ISODateString;
}

export interface ModerationAppealRow extends DbRow {
  id: DbId;
  case_id: DbId;
  provider_id: DbId;
  provider_name?: string | null;
  reviewed_by_admin_name?: string | null;
  status: ModerationAppealStatus | string;
  appeal_text?: string;
  decision_note?: string | null;
  reviewed_by_admin?: DbId | null;
  submitted_at?: ISODateString;
  reviewed_at?: ISODateString | null;
  withdrawn_at?: ISODateString | null;
  withdrawn_by_user_id?: DbId | null;
  created_at?: ISODateString;
  updated_at?: ISODateString;
  attachments?: ModerationAppealAttachmentRow[];
  events?: ModerationAppealEventRow[];
  case_status?: ModerationCaseStatus | string | null;
  case_reason?: string | null;
  case_summary?: string | null;
  report_id?: DbId | null;
  report_reason?: string | null;
  report_status?: string | null;
  listing_title?: string | null;
  attachment_count?: number | string;
}

export interface ModerationCaseDetail extends DbRow {
  id: DbId;
  case_type: string;
  subject_type: string;
  subject_id: DbId;
  status: ModerationCaseStatus | string;
  opened_by_user_id?: DbId | null;
  assigned_admin_id?: DbId | null;
  source_report_id?: DbId | null;
  reason?: string | null;
  summary?: string | null;
  created_at?: ISODateString;
  updated_at?: ISODateString;
  closed_at?: ISODateString | null;
  provider_name?: string | null;
  assigned_admin_name?: string | null;
  report?: ProviderReportRow | null;
  provider_response?: ProviderCaseResponseRow | null;
  provider_responses?: ProviderCaseResponseRow[];
  appeal?: ModerationAppealRow | null;
  appeals?: ModerationAppealRow[];
  events: ModerationCaseEventRow[];
}

// Rating requests/responses
export interface CreateRatingRequest {
  reservation_id: DbId;
  rating: number | string;
  review?: string | null;
}
export type CreateRatingResponse = ApiResponse<RatingRow>;
export type ListingRatingsResponse = ApiResponse<ListingRating[]>;
export type ProviderRatingsResponse = ApiResponse<ProviderRatingSummary>;

// Impact responses
export type ImpactSummaryResponse = ApiResponse<ImpactSummary>;

// Notification requests/responses
export type GetNotificationsResponse = ApiResponse<NotificationRow[]>;
export type MarkNotificationReadResponse = ApiResponse<NotificationRow>;
export type UnreadCountResponse = ApiResponse<UnreadCountData>;
export type MarkAllNotificationsReadResponse = ApiResponse<EmptyData>;

export interface SaveTokenRequest {
  token: string;
}
export type SaveTokenResponse = ApiResponse<EmptyData>;

// Admin responses
export type PendingNGOsResponse = ApiResponse<PendingNGORow[]>;
export type PendingRestaurantsResponse = ApiResponse<PendingRestaurantRow[]>;
export type ApproveNGOResponse = ApiResponse<EmptyData>;
export interface RejectNGOAdminRequest {
  reason?: string;
}
export type RejectNGOAdminResponse = ApiResponse<EmptyData>;
export type ApproveRestaurantResponse = ApiResponse<EmptyData>;
export interface RejectRestaurantRequest {
  reason?: string;
}
export type RejectRestaurantResponse = ApiResponse<EmptyData>;
export interface ProviderReportsAdminData {
  reports: ProviderReportRow[];
}
export interface ProviderReportsAdminQuery {
  status?: "pending" | "all" | string;
}
export type ProviderReportsAdminResponse = ApiResponse<ProviderReportsAdminData>;
export interface ModerationAppealsAdminData {
  appeals: ModerationAppealRow[];
}
export interface ModerationAppealsAdminQuery {
  status?: "open" | "all" | ModerationAppealStatus | string;
}
export type ModerationAppealsAdminResponse =
  ApiResponse<ModerationAppealsAdminData>;
export interface ModerationCaseData {
  case: ModerationCaseDetail;
}
export type GetModerationCaseResponse = ApiResponse<ModerationCaseData>;
export interface UpdateModerationCaseStatusRequest {
  status: ModerationCaseStatus;
  note?: string | null;
}
export type UpdateModerationCaseStatusResponse = ApiResponse<ModerationCaseData>;
export interface UpdateModerationAppealStatusRequest {
  note?: string | null;
}
export interface UpdateModerationAppealStatusData extends ModerationCaseData {
  appeal: ModerationAppealRow;
}
export type UpdateModerationAppealStatusResponse =
  ApiResponse<UpdateModerationAppealStatusData>;

export type TrustSubjectType = "user" | "ngo" | "volunteer" | "provider";
export type AdminTrustActionType =
  | "MANUAL_RESTRICTION"
  | "MANUAL_COOLDOWN"
  | "MANUAL_RECOVERY_CREDIT"
  | "VERIFIED_GOOD_BEHAVIOR"
  | "TRUST_REVIEW_FLAG";

export interface TrustSubjectRef {
  subjectType: TrustSubjectType | string;
  subjectId: DbId;
}

export interface TrustExplanationSourceEvent {
  eventType: string;
  title: string;
  timestamp?: ISODateString | null;
  impact: string[];
}

export interface TrustExplanationSection {
  active?: boolean;
  current?: string | number | null;
  reason: string;
  triggerSources?: string[];
  previousScore?: number | string | null;
  projectedScore?: number | string | null;
  recoveryCredit?: number | string;
  decayCredit?: number | string;
  sourceEvents?: TrustExplanationSourceEvent[];
}

export interface TrustRecoveryExplanation {
  progress: number | string;
  successStreak: number | string;
  failureStreak: number | string;
  requirements?: DbRow;
}

export interface TrustCurrentState {
  trustScore: number | string;
  penaltyLevel: number | string;
  restrictionLevel: number | string;
  cooldownUntil?: ISODateString | null;
  depositMultiplier: number | string;
  riskCategory: string;
  recoveryProgress: number | string;
  successStreak: number | string;
  failureStreak: number | string;
  lastEventAt?: ISODateString | null;
  updatedAt?: ISODateString | null;
}

export interface TrustTimelineEvent {
  id?: DbId;
  eventKey?: string;
  eventType: string;
  title: string;
  timestamp?: ISODateString | null;
  sourceType?: string | null;
  sourceId?: string | null;
  processingStatus?: string | null;
  impact: string[];
  polarity: "positive" | "negative" | "neutral" | string;
}

export interface TrustProjectionDiagnostics {
  currentTrustState: TrustCurrentState;
  generatedFromEventCount: number | string;
  firstEventAt?: ISODateString | null;
  lastEventAt?: ISODateString | null;
  replayConsistent: boolean;
  mismatchCount: number | string;
  checksumMatch: boolean;
}

export interface AdminTrustActionRow extends DbRow {
  id: DbId;
  admin_user_id?: DbId | null;
  admin_name?: string | null;
  subject_type: string;
  subject_id: DbId;
  action_type: AdminTrustActionType | string;
  action_label?: string;
  reason: string;
  idempotency_key?: string | null;
  trust_event_key: string;
  details?: DbRow;
  created_at?: ISODateString;
  trust_event_id?: DbId | null;
  event_type?: string | null;
  processing_status?: string | null;
  processed_at?: ISODateString | null;
}

export interface TrustExplainability {
  subject: TrustSubjectRef;
  currentState: TrustCurrentState;
  explanations: {
    restriction: TrustExplanationSection;
    cooldown: TrustExplanationSection;
    deposit: TrustExplanationSection;
    scoreChange: TrustExplanationSection;
    recovery: TrustRecoveryExplanation;
  };
  timeline: TrustTimelineEvent[];
  eventBreakdown: Array<{
    eventType: string;
    title: string;
    timestamp?: ISODateString | null;
    impact: string[];
    processingStatus?: string | null;
  }>;
  projectionDiagnostics: TrustProjectionDiagnostics;
  auditHistory: AdminTrustActionRow[];
}

export interface GetTrustExplainabilityData {
  subject: TrustSubjectRef;
  explanation: TrustExplainability;
}
export type GetTrustExplainabilityResponse = ApiResponse<GetTrustExplainabilityData>;

export interface RecordAdminTrustActionRequest {
  actionType: AdminTrustActionType;
  reason: string;
  details?: DbRow;
  idempotencyKey?: string;
}
export interface RecordAdminTrustActionData {
  subject: TrustSubjectRef;
  action: AdminTrustActionRow;
  trustEvent?: DbRow | null;
  inserted: boolean;
  duplicate?: boolean;
}
export type RecordAdminTrustActionResponse = ApiResponse<RecordAdminTrustActionData>;
export interface ProviderModerationCaseSummary extends DbRow {
  id: DbId;
  case_type?: string;
  subject_type?: string;
  subject_id?: DbId;
  status: ModerationCaseStatus | string;
  reason?: string | null;
  summary?: string | null;
  source_report_id?: DbId | null;
  created_at?: ISODateString;
  updated_at?: ISODateString;
  closed_at?: ISODateString | null;
  report_id?: DbId | null;
  report_reason?: string | null;
  report_status?: string | null;
  report_created_at?: ISODateString | null;
  listing_title?: string | null;
  provider_response_id?: DbId | null;
  provider_response_updated_at?: ISODateString | null;
  provider_response_attachment_count?: number | string;
  appeal_id?: DbId | null;
  appeal_status?: ModerationAppealStatus | string | null;
  appeal_updated_at?: ISODateString | null;
  appeal_attachment_count?: number | string;
}
export interface ProviderModerationCasesData {
  cases: ProviderModerationCaseSummary[];
}
export type ProviderModerationCasesResponse = ApiResponse<ProviderModerationCasesData>;
export type ProviderModerationCaseResponse = ApiResponse<ModerationCaseData>;
export interface SubmitProviderCaseResponseRequest {
  response_text: string;
  attachments?: File[];
}
export interface SubmitProviderCaseResponseData extends ModerationCaseData {
  response: ProviderCaseResponseRow;
}
export type SubmitProviderCaseResponseResponse =
  ApiResponse<SubmitProviderCaseResponseData>;
export interface SubmitProviderModerationAppealRequest {
  appeal_text: string;
  attachments?: File[];
}
export interface SubmitProviderModerationAppealData extends ModerationCaseData {
  appeal: ModerationAppealRow;
}
export type SubmitProviderModerationAppealResponse =
  ApiResponse<SubmitProviderModerationAppealData>;
export interface WithdrawProviderModerationAppealData extends ModerationCaseData {
  appeal: ModerationAppealRow;
}
export type WithdrawProviderModerationAppealResponse =
  ApiResponse<WithdrawProviderModerationAppealData>;
export interface AdminOperationalSummary {
  total_ngos: number | string;
  total_restaurants: number | string;
  active_reservations: number | string;
  expired_reservations: number | string;
  active_volunteers: number | string;
}
export interface AdminQueueCounts {
  active?: number;
  waiting?: number;
  delayed?: number;
  failed?: number;
  completed?: number;
  paused?: number;
  "waiting-children"?: number;
}
export interface AdminQueueJob {
  id?: string | number;
  name?: string;
  attemptsMade?: number;
  attempts?: number;
  failedReason?: string | null;
  timestamp?: number;
  processedOn?: number | null;
  finishedOn?: number | null;
  delay?: number;
  data?: {
    reservationId?: DbId | null;
    reservationIds?: DbId[];
    userId?: DbId | null;
    orderId?: string | null;
  };
}
export interface AdminWorkerHeartbeat {
  worker_name?: string;
  queue_name?: string | null;
  status?: string;
  last_job_id?: string | null;
  last_seen_at?: ISODateString;
  metadata?: DbRow;
}
export interface AdminQueueHealth {
  name: string;
  status?: "healthy" | "degraded" | string;
  is_paused: boolean;
  counts: AdminQueueCounts;
  retry_exhausted_count?: number;
  stuck_active_count?: number;
  worker?: AdminWorkerHeartbeat | null;
  failed_jobs?: AdminQueueJob[];
  active_jobs?: AdminQueueJob[];
  delayed_jobs?: AdminQueueJob[];
}
export interface AdminQueueHealthData {
  queues: AdminQueueHealth[];
}
export interface AdminPaymentHealth {
  summary?: DbRow;
  webhooks?: DbRow;
  stale_sessions?: DbRow[];
}
export interface AdminOperationalAlert {
  id: DbId;
  alert_key: string;
  category: string;
  severity: string;
  message: string;
  metadata?: DbRow;
  status: string;
  first_seen_at?: ISODateString;
  last_seen_at?: ISODateString;
  occurrences?: number;
}
export interface AdminSecurityEvent {
  id: DbId;
  severity: string;
  event_name: string;
  request_id?: string | null;
  user_id?: DbId | null;
  role?: string | null;
  reservation_id?: DbId | null;
  metadata?: DbRow;
  created_at?: ISODateString;
}
export type AdminOperationalSummaryResponse = ApiResponse<AdminOperationalSummary>;
export type AdminQueueHealthResponse = ApiResponse<AdminQueueHealthData>;
export type AdminPaymentHealthResponse = ApiResponse<{ payments: AdminPaymentHealth }>;
export type AdminOperationalAlertsResponse = ApiResponse<{ alerts: AdminOperationalAlert[] }>;
export type AdminSecurityEventsResponse = ApiResponse<{ events: AdminSecurityEvent[] }>;

// Payment webhook response is documented as strict target contract.
// Current backend sends bare 200 with no JSON body.
export type CashfreeWebhookResponse = ApiResponse<EmptyData>;
export type BullBoardResponse = unknown;

export interface RouteContract {
  method: HttpMethod;
  path: string;
  auth: "public" | "protected" | "cookie" | "webhook";
  middleware: readonly string[];
  request: {
    params: string;
    query: string;
    body: string;
    contentType?: string;
  };
  response: string;
  statusCodes: readonly number[];
  notes?: string;
}

export const apiContracts = {
  auth: [
    {
      method: "POST",
      path: "/api/v1/auth/send-otp",
      auth: "public",
      middleware: [],
      request: { params: "NoRequestParams", query: "NoRequestQuery", body: "SendOTPRequest" },
      response: "SendOTPResponse",
      statusCodes: [200, 400, 500],
    },
    {
      method: "POST",
      path: "/api/v1/auth/verify-otp",
      auth: "public",
      middleware: [],
      request: { params: "NoRequestParams", query: "NoRequestQuery", body: "VerifyOTPRequest" },
      response: "VerifyOTPResponse",
      statusCodes: [200, 400, 500],
    },
    {
      method: "POST",
      path: "/api/v1/auth/set-role",
      auth: "protected",
      middleware: ["authMiddleware"],
      request: { params: "NoRequestParams", query: "NoRequestQuery", body: "SetRoleRequest" },
      response: "SetRoleResponse",
      statusCodes: [200, 400, 401, 500],
    },
    {
      method: "POST",
      path: "/api/v1/auth/refresh-token",
      auth: "cookie",
      middleware: ["cookieParser"],
      request: { params: "NoRequestParams", query: "NoRequestQuery", body: "NoRequestBody" },
      response: "RefreshTokenResponse",
      statusCodes: [200, 401, 500],
    },
    {
      method: "POST",
      path: "/api/v1/auth/complete-profile",
      auth: "public",
      middleware: [],
      request: { params: "NoRequestParams", query: "NoRequestQuery", body: "CompleteProfileRequest" },
      response: "CompleteProfileResponse",
      statusCodes: [200, 400, 409, 500],
    },
    {
      method: "PUT",
      path: "/api/v1/auth/update-location",
      auth: "protected",
      middleware: ["authMiddleware"],
      request: { params: "NoRequestParams", query: "NoRequestQuery", body: "UpdateLocationRequest" },
      response: "UpdateLocationResponse",
      statusCodes: [200, 400, 401, 500],
    },
    {
      method: "GET",
      path: "/api/v1/auth/me",
      auth: "protected",
      middleware: ["authMiddleware"],
      request: { params: "NoRequestParams", query: "NoRequestQuery", body: "NoRequestBody" },
      response: "GetMeResponse",
      statusCodes: [200, 401, 404, 500],
    },
    {
      method: "POST",
      path: "/api/v1/auth/logout",
      auth: "public",
      middleware: [],
      request: { params: "NoRequestParams", query: "NoRequestQuery", body: "NoRequestBody" },
      response: "LogoutResponse",
      statusCodes: [200, 500],
    },
  ],
  users: [
    {
      method: "GET",
      path: "/api/v1/users/:id",
      auth: "protected",
      middleware: ["authMiddleware"],
      request: { params: "IdParams", query: "NoRequestQuery", body: "NoRequestBody" },
      response: "GetUserResponse",
      statusCodes: [200, 400, 401, 404],
    },
    {
      method: "PUT",
      path: "/api/v1/users/:id",
      auth: "protected",
      middleware: ["authMiddleware"],
      request: { params: "IdParams", query: "NoRequestQuery", body: "UpdateUserRequest" },
      response: "UpdateUserResponse",
      statusCodes: [200, 400, 401, 403],
    },
    {
      method: "GET",
      path: "/api/v1/users/:id/history",
      auth: "protected",
      middleware: ["authMiddleware"],
      request: { params: "IdParams", query: "NoRequestQuery", body: "NoRequestBody" },
      response: "UserHistoryResponse",
      statusCodes: [200, 400, 401, 403],
    },
  ],
  food: [
    {
      method: "POST",
      path: "/api/v1/food/register",
      auth: "protected",
      middleware: ["authMiddleware", "upload.single('fssai_certificate')"],
      request: { params: "NoRequestParams", query: "NoRequestQuery", body: "RegisterRestaurantRequest", contentType: "multipart/form-data" },
      response: "RegisterRestaurantResponse",
      statusCodes: [201, 400, 401, 403, 404, 409, 500],
    },
    {
      method: "GET",
      path: "/api/v1/food/me",
      auth: "protected",
      middleware: ["authMiddleware", "requireVerified"],
      request: { params: "NoRequestParams", query: "NoRequestQuery", body: "NoRequestBody" },
      response: "GetMyRestaurantResponse",
      statusCodes: [200, 401, 403, 404, 500],
    },
    {
      method: "POST",
      path: "/api/v1/food",
      auth: "protected",
      middleware: ["authMiddleware", "requireVerified"],
      request: { params: "NoRequestParams", query: "NoRequestQuery", body: "CreateFoodRequest" },
      response: "CreateFoodResponse",
      statusCodes: [201, 400, 401, 403, 404, 409, 500],
    },
    {
      method: "PUT",
      path: "/api/v1/food/:id",
      auth: "protected",
      middleware: ["authMiddleware", "requireVerified"],
      request: { params: "IdParams", query: "NoRequestQuery", body: "UpdateFoodRequest" },
      response: "UpdateFoodResponse",
      statusCodes: [200, 400, 401, 403, 404, 500],
    },
    {
      method: "DELETE",
      path: "/api/v1/food/:id",
      auth: "protected",
      middleware: ["authMiddleware", "requireVerified"],
      request: { params: "IdParams", query: "NoRequestQuery", body: "NoRequestBody" },
      response: "DeleteFoodResponse",
      statusCodes: [200, 400, 401, 403, 404, 409, 500],
    },
    {
      method: "GET",
      path: "/api/v1/food/ngos",
      auth: "protected",
      middleware: ["authMiddleware", "requireVerified"],
      request: { params: "NoRequestParams", query: "NoRequestQuery", body: "NoRequestBody" },
      response: "ViewNGOsForFoodResponse",
      statusCodes: [200, 401, 403, 500],
    },
    {
      method: "POST",
      path: "/api/v1/food/:id/request-ngo",
      auth: "protected",
      middleware: ["authMiddleware", "requireVerified"],
      request: { params: "IdParams", query: "NoRequestQuery", body: "RequestNGORequest" },
      response: "RequestNGOResponse",
      statusCodes: [200, 400, 401, 403, 404, 409, 500],
    },
    {
      method: "GET",
      path: "/api/v1/food",
      auth: "public",
      middleware: [],
      request: { params: "NoRequestParams", query: "PaginationQuery", body: "NoRequestBody" },
      response: "GetAllFoodResponse",
      statusCodes: [200],
    },
    {
      method: "GET",
      path: "/api/v1/food/active",
      auth: "public",
      middleware: [],
      request: { params: "NoRequestParams", query: "OptionalCoordinatesQuery", body: "NoRequestBody" },
      response: "GetActiveFoodResponse",
      statusCodes: [200, 400],
    },
    {
      method: "GET",
      path: "/api/v1/food/nearby",
      auth: "public",
      middleware: [],
      request: { params: "NoRequestParams", query: "CoordinatesQuery", body: "NoRequestBody" },
      response: "GetNearbyFoodResponse",
      statusCodes: [200, 400],
    },
    {
      method: "GET",
      path: "/api/v1/food/:id",
      auth: "public",
      middleware: [],
      request: { params: "IdParams", query: "NoRequestQuery", body: "NoRequestBody" },
      response: "GetFoodByIdResponse",
      statusCodes: [200, 400, 404],
    },
  ],
  reservations: [
    {
      method: "POST",
      path: "/api/v1/reservations",
      auth: "protected",
      middleware: ["authMiddleware"],
      request: { params: "NoRequestParams", query: "NoRequestQuery", body: "CreateReservationRequest" },
      response: "CreateReservationResponse",
      statusCodes: [201, 400, 401, 403, 404, 409],
    },
    {
      method: "GET",
      path: "/api/v1/reservations/my",
      auth: "protected",
      middleware: ["authMiddleware"],
      request: { params: "NoRequestParams", query: "NoRequestQuery", body: "NoRequestBody" },
      response: "GetMyReservationsResponse",
      statusCodes: [200, 401],
    },
    {
      method: "GET",
      path: "/api/v1/reservations/provider",
      auth: "protected",
      middleware: ["authMiddleware"],
      request: { params: "NoRequestParams", query: "NoRequestQuery", body: "NoRequestBody" },
      response: "GetProviderReservationsResponse",
      statusCodes: [200, 401, 403],
    },
    {
      method: "GET",
      path: "/api/v1/reservations/:id",
      auth: "protected",
      middleware: ["authMiddleware"],
      request: { params: "IdParams", query: "NoRequestQuery", body: "NoRequestBody" },
      response: "GetReservationByIdResponse",
      statusCodes: [200, 400, 401, 404],
    },
    {
      method: "PUT",
      path: "/api/v1/reservations/:id/cancel",
      auth: "protected",
      middleware: ["authMiddleware"],
      request: { params: "IdParams", query: "NoRequestQuery", body: "NoRequestBody" },
      response: "CancelReservationResponse",
      statusCodes: [200, 400, 401, 403, 404, 409],
    },
    {
      method: "PUT",
      path: "/api/v1/reservations/:id/pickup",
      auth: "protected",
      middleware: ["authMiddleware"],
      request: { params: "IdParams", query: "NoRequestQuery", body: "MarkAsPickedUpRequest" },
      response: "MarkAsPickedUpResponse",
      statusCodes: [200, 400, 401, 403, 404],
    },
  ],
  providerModeration: [
    {
      method: "GET",
      path: "/api/v1/provider/moderation-cases",
      auth: "protected",
      middleware: ["authMiddleware", "requireVerifiedProvider"],
      request: { params: "NoRequestParams", query: "NoRequestQuery", body: "NoRequestBody" },
      response: "ProviderModerationCasesResponse",
      statusCodes: [200, 401, 403, 500],
    },
    {
      method: "GET",
      path: "/api/v1/provider/moderation-cases/:id",
      auth: "protected",
      middleware: ["authMiddleware", "requireVerifiedProvider"],
      request: { params: "IdParams", query: "NoRequestQuery", body: "NoRequestBody" },
      response: "ProviderModerationCaseResponse",
      statusCodes: [200, 400, 401, 403, 404, 500],
    },
    {
      method: "POST",
      path: "/api/v1/provider/moderation-cases/:id/response",
      auth: "protected",
      middleware: ["authMiddleware", "requireVerifiedProvider", "reportLimiter", "upload.providerReportAttachments.array('attachments', 3)"],
      request: { params: "IdParams", query: "NoRequestQuery", body: "SubmitProviderCaseResponseRequest", contentType: "multipart/form-data" },
      response: "SubmitProviderCaseResponseResponse",
      statusCodes: [201, 400, 401, 403, 404, 409, 500],
    },
    {
      method: "POST",
      path: "/api/v1/provider/moderation-cases/:id/appeal",
      auth: "protected",
      middleware: ["authMiddleware", "requireVerifiedProvider", "reportLimiter", "upload.providerReportAttachments.array('attachments', 3)"],
      request: { params: "IdParams", query: "NoRequestQuery", body: "SubmitProviderModerationAppealRequest", contentType: "multipart/form-data" },
      response: "SubmitProviderModerationAppealResponse",
      statusCodes: [201, 400, 401, 403, 404, 409, 500],
    },
    {
      method: "PATCH",
      path: "/api/v1/provider/moderation-cases/:id/appeal/withdraw",
      auth: "protected",
      middleware: ["authMiddleware", "requireVerifiedProvider", "reportLimiter"],
      request: { params: "IdParams", query: "NoRequestQuery", body: "NoRequestBody" },
      response: "WithdrawProviderModerationAppealResponse",
      statusCodes: [200, 400, 401, 403, 404, 409, 500],
    },
  ],
  ngo: [
    {
      method: "POST",
      path: "/api/v1/ngos/register",
      auth: "protected",
      middleware: ["authMiddleware"],
      request: { params: "NoRequestParams", query: "NoRequestQuery", body: "RegisterNGORequest" },
      response: "RegisterNGOResponse",
      statusCodes: [201, 400, 401, 403, 409, 500],
    },
    {
      method: "GET",
      path: "/api/v1/ngos/me",
      auth: "protected",
      middleware: ["authMiddleware", "requireVerified"],
      request: { params: "NoRequestParams", query: "NoRequestQuery", body: "NoRequestBody" },
      response: "GetMyNGOResponse",
      statusCodes: [200, 401, 403, 404, 500],
    },
    {
      method: "GET",
      path: "/api/v1/ngos/listings/nearby",
      auth: "protected",
      middleware: ["authMiddleware", "requireVerified"],
      request: { params: "NoRequestParams", query: "CoordinatesQuery", body: "NoRequestBody" },
      response: "NGONearbyListingsResponse",
      statusCodes: [200, 400, 401, 403, 404, 500],
    },
    {
      method: "POST",
      path: "/api/v1/ngos/bulk-reserve",
      auth: "protected",
      middleware: ["authMiddleware", "requireVerified"],
      request: { params: "NoRequestParams", query: "NoRequestQuery", body: "BulkReserveRequest" },
      response: "BulkReserveResponse",
      statusCodes: [200, 400, 401, 403, 404, 409, 500],
    },
    {
      method: "GET",
      path: "/api/v1/ngos/reservations",
      auth: "protected",
      middleware: ["authMiddleware", "requireVerified"],
      request: { params: "NoRequestParams", query: "NoRequestQuery", body: "NoRequestBody" },
      response: "NGOReservationsResponse",
      statusCodes: [200, 401, 403, 500],
    },
    {
      method: "GET",
      path: "/api/v1/ngos/volunteers/assigned",
      auth: "protected",
      middleware: ["authMiddleware", "requireVerified"],
      request: { params: "NoRequestParams", query: "NoRequestQuery", body: "NoRequestBody" },
      response: "NGOAssignedVolunteersResponse",
      statusCodes: [200, 401, 403, 500],
    },
    {
      method: "GET",
      path: "/api/v1/ngos/volunteers",
      auth: "protected",
      middleware: ["authMiddleware", "requireVerified"],
      request: { params: "NoRequestParams", query: "NoRequestQuery", body: "NoRequestBody" },
      response: "NGOUnassignedVolunteersResponse",
      statusCodes: [200, 401, 403, 500],
    },
    {
      method: "POST",
      path: "/api/v1/ngos/request-volunteer",
      auth: "protected",
      middleware: ["authMiddleware", "requireVerified"],
      request: { params: "NoRequestParams", query: "NoRequestQuery", body: "RequestVolunteerRequest" },
      response: "RequestVolunteerResponse",
      statusCodes: [200, 400, 401, 403, 404, 500],
    },
    {
      method: "PUT",
      path: "/api/v1/ngos/urgent",
      auth: "protected",
      middleware: ["authMiddleware", "requireVerified"],
      request: { params: "NoRequestParams", query: "NoRequestQuery", body: "SetUrgentRequest" },
      response: "SetUrgentResponse",
      statusCodes: [200, 400, 401, 403, 404, 500],
    },
    {
      method: "GET",
      path: "/api/v1/ngos/requests",
      auth: "protected",
      middleware: ["authMiddleware", "requireVerified"],
      request: { params: "NoRequestParams", query: "NoRequestQuery", body: "NoRequestBody" },
      response: "NGOIncomingRequestsResponse",
      statusCodes: [200, 401, 403, 404, 500],
    },
    {
      method: "PUT",
      path: "/api/v1/ngos/requests/:requestID/accept",
      auth: "protected",
      middleware: ["authMiddleware", "requireVerified"],
      request: { params: "RequestIDParams", query: "NoRequestQuery", body: "NoRequestBody" },
      response: "AcceptNGORequestResponse",
      statusCodes: [200, 400, 401, 403, 404, 409, 500],
    },
    {
      method: "PUT",
      path: "/api/v1/ngos/requests/:requestID/reject",
      auth: "protected",
      middleware: ["authMiddleware", "requireVerified"],
      request: { params: "RequestIDParams", query: "NoRequestQuery", body: "NoRequestBody" },
      response: "RejectNGORequestResponse",
      statusCodes: [200, 400, 401, 403, 404, 500],
    },
  ],
  volunteers: [
    {
      method: "GET",
      path: "/api/v1/volunteers/available",
      auth: "protected",
      middleware: ["authMiddleware"],
      request: { params: "NoRequestParams", query: "NoRequestQuery", body: "NoRequestBody" },
      response: "VolunteerAvailableResponse",
      statusCodes: [200, 401, 403],
    },
    {
      method: "POST",
      path: "/api/v1/volunteers/join",
      auth: "protected",
      middleware: ["authMiddleware"],
      request: { params: "NoRequestParams", query: "NoRequestQuery", body: "JoinNGORequest" },
      response: "JoinNGOResponse",
      statusCodes: [200, 201, 400, 401, 403, 409, 500],
    },
    {
      method: "PUT",
      path: "/api/v1/volunteers/leave",
      auth: "protected",
      middleware: ["authMiddleware"],
      request: { params: "NoRequestParams", query: "NoRequestQuery", body: "LeaveNGORequest" },
      response: "LeaveNGOResponse",
      statusCodes: [200, 400, 401, 403],
    },
    {
      method: "GET",
      path: "/api/v1/volunteers/requests",
      auth: "protected",
      middleware: ["authMiddleware"],
      request: { params: "NoRequestParams", query: "NoRequestQuery", body: "NoRequestBody" },
      response: "VolunteerRequestsResponse",
      statusCodes: [200, 401],
    },
    {
      method: "PUT",
      path: "/api/v1/volunteers/requests/:id/respond",
      auth: "protected",
      middleware: ["authMiddleware"],
      request: { params: "IdParams", query: "NoRequestQuery", body: "RespondToVolunteerRequestBody" },
      response: "RespondToVolunteerRequestResponse",
      statusCodes: [200, 400, 401, 403, 409],
    },
    {
      method: "PUT",
      path: "/api/v1/volunteers/tasks/:id/start",
      auth: "protected",
      middleware: ["authMiddleware"],
      request: { params: "IdParams", query: "NoRequestQuery", body: "NoRequestBody" },
      response: "StartTaskResponse",
      statusCodes: [200, 400, 401, 403, 404, 409],
    },
    {
      method: "PUT",
      path: "/api/v1/volunteers/tasks/:id/complete",
      auth: "protected",
      middleware: ["authMiddleware"],
      request: { params: "IdParams", query: "NoRequestQuery", body: "CompleteTaskRequest" },
      response: "CompleteTaskResponse",
      statusCodes: [200, 400, 401, 403, 404, 409],
    },
    {
      method: "GET",
      path: "/api/v1/volunteers/tasks",
      auth: "protected",
      middleware: ["authMiddleware"],
      request: { params: "NoRequestParams", query: "CoordinatesQuery", body: "NoRequestBody" },
      response: "VolunteerTasksResponse",
      statusCodes: [200, 400, 401, 403, 404, 500],
    },
  ],
  ratings: [
    {
      method: "POST",
      path: "/api/v1/ratings",
      auth: "protected",
      middleware: ["authMiddleware"],
      request: { params: "NoRequestParams", query: "NoRequestQuery", body: "CreateRatingRequest" },
      response: "CreateRatingResponse",
      statusCodes: [201, 400, 401, 403, 409],
    },
    {
      method: "GET",
      path: "/api/v1/ratings/listing/:listingId",
      auth: "public",
      middleware: [],
      request: { params: "ListingIdParams", query: "NoRequestQuery", body: "NoRequestBody" },
      response: "ListingRatingsResponse",
      statusCodes: [200, 400, 500],
    },
    {
      method: "GET",
      path: "/api/v1/ratings/provider/:providerId",
      auth: "public",
      middleware: [],
      request: { params: "ProviderIdParams", query: "NoRequestQuery", body: "NoRequestBody" },
      response: "ProviderRatingsResponse",
      statusCodes: [200, 400, 500],
    },
  ],
  impact: [
    {
      method: "GET",
      path: "/api/v1/impact/summary",
      auth: "public",
      middleware: [],
      request: { params: "NoRequestParams", query: "NoRequestQuery", body: "NoRequestBody" },
      response: "ImpactSummaryResponse",
      statusCodes: [200],
    },
    {
      method: "GET",
      path: "/api/v1/impact/user/:id",
      auth: "public",
      middleware: [],
      request: { params: "IdParams", query: "NoRequestQuery", body: "NoRequestBody" },
      response: "ImpactSummaryResponse",
      statusCodes: [200, 400],
    },
    {
      method: "GET",
      path: "/api/v1/impact/listing/:id",
      auth: "public",
      middleware: [],
      request: { params: "IdParams", query: "NoRequestQuery", body: "NoRequestBody" },
      response: "ImpactSummaryResponse",
      statusCodes: [200, 400],
    },
    {
      method: "GET",
      path: "/api/v1/impact/ngo/:id",
      auth: "public",
      middleware: [],
      request: { params: "IdParams", query: "NoRequestQuery", body: "NoRequestBody" },
      response: "ImpactSummaryResponse",
      statusCodes: [200, 400],
    },
  ],
  notifications: [
    {
      method: "GET",
      path: "/api/v1/notifications",
      auth: "protected",
      middleware: ["authMiddleware"],
      request: { params: "NoRequestParams", query: "NoRequestQuery", body: "NoRequestBody" },
      response: "GetNotificationsResponse",
      statusCodes: [200, 401],
    },
    {
      method: "PUT",
      path: "/api/v1/notifications/:id/read",
      auth: "protected",
      middleware: ["authMiddleware"],
      request: { params: "IdParams", query: "NoRequestQuery", body: "NoRequestBody" },
      response: "MarkNotificationReadResponse",
      statusCodes: [200, 400, 401, 404],
    },
    {
      method: "GET",
      path: "/api/v1/notifications/count/unread",
      auth: "protected",
      middleware: ["authMiddleware"],
      request: { params: "NoRequestParams", query: "NoRequestQuery", body: "NoRequestBody" },
      response: "UnreadCountResponse",
      statusCodes: [200, 401],
    },
    {
      method: "PUT",
      path: "/api/v1/notifications/read-all",
      auth: "protected",
      middleware: ["authMiddleware"],
      request: { params: "NoRequestParams", query: "NoRequestQuery", body: "NoRequestBody" },
      response: "MarkAllNotificationsReadResponse",
      statusCodes: [200, 401],
    },
    {
      method: "POST",
      path: "/api/v1/notifications/save-token",
      auth: "protected",
      middleware: ["authMiddleware"],
      request: { params: "NoRequestParams", query: "NoRequestQuery", body: "SaveTokenRequest" },
      response: "SaveTokenResponse",
      statusCodes: [200, 400, 401, 500],
    },
  ],
  admin: [
    {
      method: "GET",
      path: "/api/v1/admin/ngos/pending",
      auth: "protected",
      middleware: ["authMiddleware"],
      request: { params: "NoRequestParams", query: "NoRequestQuery", body: "NoRequestBody" },
      response: "PendingNGOsResponse",
      statusCodes: [200, 401, 500],
    },
    {
      method: "PATCH",
      path: "/api/v1/admin/ngos/:id/approve",
      auth: "protected",
      middleware: ["authMiddleware"],
      request: { params: "IdParams", query: "NoRequestQuery", body: "NoRequestBody" },
      response: "ApproveNGOResponse",
      statusCodes: [200, 400, 401, 404, 500],
    },
    {
      method: "PATCH",
      path: "/api/v1/admin/ngos/:id/reject",
      auth: "protected",
      middleware: ["authMiddleware"],
      request: { params: "IdParams", query: "NoRequestQuery", body: "RejectNGOAdminRequest" },
      response: "RejectNGOAdminResponse",
      statusCodes: [200, 400, 401, 404, 500],
    },
    {
      method: "GET",
      path: "/api/v1/admin/restaurants/pending",
      auth: "protected",
      middleware: ["authMiddleware"],
      request: { params: "NoRequestParams", query: "NoRequestQuery", body: "NoRequestBody" },
      response: "PendingRestaurantsResponse",
      statusCodes: [200, 401, 500],
    },
    {
      method: "PATCH",
      path: "/api/v1/admin/restaurants/:id/approve",
      auth: "protected",
      middleware: ["authMiddleware"],
      request: { params: "IdParams", query: "NoRequestQuery", body: "NoRequestBody" },
      response: "ApproveRestaurantResponse",
      statusCodes: [200, 400, 401, 404, 500],
    },
    {
      method: "PATCH",
      path: "/api/v1/admin/restaurants/:id/reject",
      auth: "protected",
      middleware: ["authMiddleware"],
      request: { params: "IdParams", query: "NoRequestQuery", body: "RejectRestaurantRequest" },
      response: "RejectRestaurantResponse",
      statusCodes: [200, 400, 401, 404, 500],
    },
    {
      method: "GET",
      path: "/api/v1/admin/trust/:subjectType/:subjectId/explain",
      auth: "protected",
      middleware: ["authMiddleware", "requireAdmin"],
      request: { params: "TrustSubjectRef", query: "NoRequestQuery", body: "NoRequestBody" },
      response: "GetTrustExplainabilityResponse",
      statusCodes: [200, 400, 401, 403, 500],
    },
    {
      method: "POST",
      path: "/api/v1/admin/trust/:subjectType/:subjectId/actions",
      auth: "protected",
      middleware: ["authMiddleware", "requireAdmin", "adminActionLimiter"],
      request: { params: "TrustSubjectRef", query: "NoRequestQuery", body: "RecordAdminTrustActionRequest" },
      response: "RecordAdminTrustActionResponse",
      statusCodes: [200, 201, 400, 401, 403, 409, 500],
    },
    {
      method: "GET",
      path: "/api/v1/admin/provider-reports",
      auth: "protected",
      middleware: ["authMiddleware", "requireAdmin"],
      request: { params: "NoRequestParams", query: "ProviderReportsAdminQuery", body: "NoRequestBody" },
      response: "ProviderReportsAdminResponse",
      statusCodes: [200, 401, 403, 500],
    },
    {
      method: "GET",
      path: "/api/v1/admin/moderation-appeals",
      auth: "protected",
      middleware: ["authMiddleware", "requireAdmin"],
      request: { params: "NoRequestParams", query: "ModerationAppealsAdminQuery", body: "NoRequestBody" },
      response: "ModerationAppealsAdminResponse",
      statusCodes: [200, 400, 401, 403, 500],
    },
    {
      method: "PATCH",
      path: "/api/v1/admin/moderation-appeals/:id/review",
      auth: "protected",
      middleware: ["authMiddleware", "requireAdmin", "adminActionLimiter"],
      request: { params: "IdParams", query: "NoRequestQuery", body: "UpdateModerationAppealStatusRequest" },
      response: "UpdateModerationAppealStatusResponse",
      statusCodes: [200, 400, 401, 403, 404, 409, 500],
    },
    {
      method: "PATCH",
      path: "/api/v1/admin/moderation-appeals/:id/accept",
      auth: "protected",
      middleware: ["authMiddleware", "requireAdmin", "adminActionLimiter"],
      request: { params: "IdParams", query: "NoRequestQuery", body: "UpdateModerationAppealStatusRequest" },
      response: "UpdateModerationAppealStatusResponse",
      statusCodes: [200, 400, 401, 403, 404, 409, 500],
    },
    {
      method: "PATCH",
      path: "/api/v1/admin/moderation-appeals/:id/reject",
      auth: "protected",
      middleware: ["authMiddleware", "requireAdmin", "adminActionLimiter"],
      request: { params: "IdParams", query: "NoRequestQuery", body: "UpdateModerationAppealStatusRequest" },
      response: "UpdateModerationAppealStatusResponse",
      statusCodes: [200, 400, 401, 403, 404, 409, 500],
    },
    {
      method: "GET",
      path: "/api/v1/admin/moderation-cases/:id",
      auth: "protected",
      middleware: ["authMiddleware", "requireAdmin"],
      request: { params: "IdParams", query: "NoRequestQuery", body: "NoRequestBody" },
      response: "GetModerationCaseResponse",
      statusCodes: [200, 400, 401, 403, 404, 500],
    },
    {
      method: "PATCH",
      path: "/api/v1/admin/moderation-cases/:id/status",
      auth: "protected",
      middleware: ["authMiddleware", "requireAdmin", "adminActionLimiter"],
      request: { params: "IdParams", query: "NoRequestQuery", body: "UpdateModerationCaseStatusRequest" },
      response: "UpdateModerationCaseStatusResponse",
      statusCodes: [200, 400, 401, 403, 404, 409, 500],
    },
    {
      method: "GET",
      path: "/api/v1/admin/operations/summary",
      auth: "protected",
      middleware: ["authMiddleware", "requireAdmin"],
      request: { params: "NoRequestParams", query: "NoRequestQuery", body: "NoRequestBody" },
      response: "AdminOperationalSummaryResponse",
      statusCodes: [200, 401, 403, 500],
    },
    {
      method: "GET",
      path: "/api/v1/admin/queues/health",
      auth: "protected",
      middleware: ["authMiddleware", "requireAdmin"],
      request: { params: "NoRequestParams", query: "NoRequestQuery", body: "NoRequestBody" },
      response: "AdminQueueHealthResponse",
      statusCodes: [200, 401, 403, 500],
    },
    {
      method: "ALL",
      path: "/admin/queues/*",
      auth: "protected",
      middleware: ["authMiddleware", "requireAdmin", "bullBoardServer.getRouter()"],
      request: { params: "NoRequestParams", query: "NoRequestQuery", body: "NoRequestBody" },
      response: "BullBoardResponse",
      statusCodes: [200],
      notes: "Current backend mounts the third-party Bull Board router here; it is not a strict JSON API envelope.",
    },
  ],
  payments: [
    {
      method: "POST",
      path: "/api/v1/payments/webhook",
      auth: "webhook",
      middleware: ["express.raw({ type: 'application/json' })"],
      request: { params: "NoRequestParams", query: "NoRequestQuery", body: "CashfreeWebhookRequest", contentType: "application/json" },
      response: "CashfreeWebhookResponse",
      statusCodes: [200],
    },
  ],
} as const satisfies Record<string, readonly RouteContract[]>;
