import { ar, type AppRole } from './copy/ar';

export interface NavigationItem {
  readonly href: string;
  readonly label: string;
}

const ownerNavigation: readonly NavigationItem[] = [
  { href: '/today', label: ar.navigation.today },
  { href: '/inventory', label: ar.navigation.inventory },
  { href: '/materials', label: ar.navigation.materials },
  { href: '/parties', label: ar.navigation.parties },
  { href: '/cash', label: ar.navigation.cash },
  { href: '/history', label: ar.navigation.history },
  // This route is present only after an owner-scoped reconciliation API exists.
];

const operatorNavigation: readonly NavigationItem[] = [
  { href: '/today', label: ar.navigation.today },
  { href: '/purchase', label: ar.navigation.purchase },
  { href: '/sale', label: ar.navigation.sale },
  { href: '/history', label: ar.navigation.history },
];

export function navigationFor(role: AppRole): readonly NavigationItem[] {
  return role === 'owner' ? ownerNavigation : operatorNavigation;
}
