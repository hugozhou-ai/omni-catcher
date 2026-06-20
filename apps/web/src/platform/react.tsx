import { createContext, useContext, useSyncExternalStore, type ReactNode } from "react";
import type { IInstantiationService, ServiceIdentifier } from "@omni-catcher/shared/platform";
import type { Store } from "./store.js";

const ServiceContext = createContext<IInstantiationService | null>(null);

export function ServiceProvider(props: { services: IInstantiationService; children: ReactNode }): ReactNode {
  return <ServiceContext.Provider value={props.services}>{props.children}</ServiceContext.Provider>;
}

export function useService<T>(id: ServiceIdentifier<T>): T {
  const services = useContext(ServiceContext);
  if (!services) throw new Error("ServiceProvider is missing from the tree");
  return services.get(id);
}

/** Subscribe a component to a Store and re-render on change. */
export function useStore<T>(store: Store<T>): T {
  return useSyncExternalStore(store.subscribe, store.get.bind(store), store.get.bind(store));
}
