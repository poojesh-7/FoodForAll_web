export type Role =
  | "user"
  | "volunteer"
  | "provider"
  | "ngo"
  | "admin";

export interface User {
  id: number;
  name: string;
  email: string;
  phone: string;
  email_verified?: boolean;
  auth_provider?: "otp" | "google" | string;
  phone_verified_at?: string | null;
  role: Role;
}
