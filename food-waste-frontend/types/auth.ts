export type Role =
  | "user"
  | "volunteer"
  | "provider"
  | "ngo";

export interface User {
  id: number;
  name: string;
  email: string;
  phone: string;
  role: Role;
}