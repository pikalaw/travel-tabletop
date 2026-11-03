// The app's screens and how to move between them.
import type { GuestGameMeta, Deck } from '../types/storage';

export interface RouteArgs {
  loading: undefined;
  home: { notice?: string } | undefined;
  setup: undefined;
  decks: undefined;
  deck: string;
  import: undefined;
  backup: undefined;
  restore: undefined;
  game: undefined;
  rejoin: GuestGameMeta & { decks: Deck[] };
}

export type RouteName = keyof RouteArgs;
export type Route = { [N in RouteName]: { name: N; arg?: RouteArgs[N] } }[RouteName];
export type Go = <N extends RouteName>(name: N, arg?: RouteArgs[N]) => void;
