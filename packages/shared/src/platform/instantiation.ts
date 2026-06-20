/**
 * A minimal, dependency-free dependency-injection container modeled after the
 * VS Code `instantiation` service: typed service identifiers, a service
 * collection, lazy descriptors, and an accessor-based instantiation service.
 */

export interface ServiceIdentifier<T> {
  readonly id: string;
  /** Phantom type carrier; never read at runtime. */
  readonly _serviceBrand: T;
}

const identifiers = new Map<string, ServiceIdentifier<unknown>>();

/** Create (or reuse) a typed service identifier, e.g. the VS Code `createDecorator`. */
export function createServiceIdentifier<T>(id: string): ServiceIdentifier<T> {
  const existing = identifiers.get(id);
  if (existing) {
    return existing as ServiceIdentifier<T>;
  }
  const identifier = { id } as unknown as ServiceIdentifier<T>;
  identifiers.set(id, identifier as ServiceIdentifier<unknown>);
  return identifier;
}

/** Describes a service that should be lazily constructed from the container. */
export class SyncDescriptor<T> {
  constructor(
    public readonly ctor: new (accessor: ServicesAccessor) => T,
  ) {}
}

export interface ServicesAccessor {
  get<T>(id: ServiceIdentifier<T>): T;
}

type ServiceEntry<T> = T | SyncDescriptor<T>;

export class ServiceCollection {
  private readonly entries = new Map<string, ServiceEntry<unknown>>();

  set<T>(id: ServiceIdentifier<T>, entry: ServiceEntry<T>): void {
    this.entries.set(id.id, entry as ServiceEntry<unknown>);
  }

  get<T>(id: ServiceIdentifier<T>): ServiceEntry<T> | undefined {
    return this.entries.get(id.id) as ServiceEntry<T> | undefined;
  }

  has<T>(id: ServiceIdentifier<T>): boolean {
    return this.entries.has(id.id);
  }
}

export interface IInstantiationService extends ServicesAccessor {
  invokeFunction<R>(fn: (accessor: ServicesAccessor) => R): R;
}

export class InstantiationService implements IInstantiationService {
  private readonly resolving = new Set<string>();

  constructor(private readonly collection: ServiceCollection) {}

  get<T>(id: ServiceIdentifier<T>): T {
    const entry = this.collection.get(id);
    if (entry === undefined) {
      throw new Error(`[instantiation] no service registered for "${id.id}"`);
    }
    if (entry instanceof SyncDescriptor) {
      if (this.resolving.has(id.id)) {
        throw new Error(`[instantiation] cyclic dependency while resolving "${id.id}"`);
      }
      this.resolving.add(id.id);
      try {
        const instance = new entry.ctor(this);
        this.collection.set(id, instance);
        return instance;
      } finally {
        this.resolving.delete(id.id);
      }
    }
    return entry as T;
  }

  invokeFunction<R>(fn: (accessor: ServicesAccessor) => R): R {
    return fn(this);
  }
}
