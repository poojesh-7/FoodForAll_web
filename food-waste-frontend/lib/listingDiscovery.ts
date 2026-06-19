import type {
  DietaryTag,
  FoodCategory,
  ListingSort,
} from "@shared/contracts/api-contracts";

export const foodCategoryOptions: Array<{ value: FoodCategory; label: string }> = [
  { value: "meals", label: "Meals" },
  { value: "bakery", label: "Bakery" },
  { value: "beverages", label: "Beverages" },
  { value: "fruits", label: "Fruits" },
  { value: "vegetables", label: "Vegetables" },
  { value: "dairy", label: "Dairy" },
  { value: "snacks", label: "Snacks" },
  { value: "prepared_food", label: "Prepared Food" },
  { value: "grocery", label: "Grocery" },
  { value: "other", label: "Other" },
];

export const dietaryTagOptions: Array<{ value: DietaryTag; label: string }> = [
  { value: "vegetarian", label: "Vegetarian" },
  { value: "vegan", label: "Vegan" },
  { value: "egg", label: "Egg" },
  { value: "non_veg", label: "Non Veg" },
  { value: "halal", label: "Halal" },
  { value: "jain", label: "Jain" },
  { value: "gluten_free", label: "Gluten Free" },
];

export const listingSortOptions: Array<{ value: ListingSort; label: string }> = [
  { value: "nearest", label: "Nearest" },
  { value: "newest", label: "Newest" },
  { value: "pickup_ending_soon", label: "Pickup Ending Soon" },
  { value: "highest_quantity", label: "Highest Quantity" },
  { value: "lowest_price", label: "Lowest Price" },
  { value: "highest_price", label: "Highest Price" },
];

export type ListingDiscoveryFilters = {
  search: string;
  category: string;
  dietaryTags: string[];
  distance: string;
  minQuantity: string;
  maxPrice: string;
  pickupEndingSoon: boolean;
  sort: ListingSort;
};

export const defaultListingDiscoveryFilters: ListingDiscoveryFilters = {
  search: "",
  category: "",
  dietaryTags: [],
  distance: "",
  minQuantity: "",
  maxPrice: "",
  pickupEndingSoon: false,
  sort: "pickup_ending_soon",
};

export function formatFoodCategory(value?: string | null) {
  return (
    foodCategoryOptions.find((option) => option.value === value)?.label ||
    "Other"
  );
}

export function formatDietaryTag(value?: string | null) {
  if (!value) return "";
  return (
    dietaryTagOptions.find((option) => option.value === value)?.label ||
    value.replace(/_/g, " ")
  );
}

export function getDietaryTags(source?: { dietary_tags?: unknown }) {
  return Array.isArray(source?.dietary_tags)
    ? source.dietary_tags.map(String).filter(Boolean)
    : [];
}

export function getDiscoveryParams(filters: ListingDiscoveryFilters) {
  return {
    search: filters.search.trim() || undefined,
    category: filters.category || undefined,
    dietaryTags:
      filters.dietaryTags.length > 0 ? filters.dietaryTags.join(",") : undefined,
    distance: filters.distance || undefined,
    minQuantity: filters.minQuantity || undefined,
    maxPrice: filters.maxPrice || undefined,
    sort: filters.pickupEndingSoon ? "pickup_ending_soon" : filters.sort,
  };
}

export function toggleDietaryTag(tags: string[], value: string) {
  return tags.includes(value)
    ? tags.filter((tag) => tag !== value)
    : [...tags, value];
}
