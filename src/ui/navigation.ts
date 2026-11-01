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
  { href: '/reports', label: ar.navigation.reports },
  { href: '/directory', label: ar.navigation.directory },
  { href: '/users', label: ar.navigation.users },
  { href: '/settings', label: ar.navigation.settings },
  { href: '/regrade', label: ar.navigation.regrade },
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
