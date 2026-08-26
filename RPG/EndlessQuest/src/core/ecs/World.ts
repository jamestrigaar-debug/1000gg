import type { EntityId } from './Entity';
import type { Component, ComponentMap } from './Component';

/**
 * Internal entity record storing its identifier and associated component instances.
 */
export interface EntityRecord {
  id: EntityId;
  components: Map<string, Component>;
}

/**
 * World container managing entities, components, and optimized indexed queries.
 */
export class World {
  private entities: Map<EntityId, EntityRecord> = new Map();
  private componentIndices: Map<string, Set<EntityId>> = new Map();
  private nextId: number = 1;

  /**
   * Creates a new entity with a unique EntityId.
   * @returns Newly allocated EntityId
   */
  createEntity(): EntityId {
    const id = this.nextId++;
    this.entities.set(id, { id, components: new Map() });
    return id;
  }

  /**
   * Destroys an entity and removes it from all internal indexes.
   * @param id EntityId of the entity to destroy
   */
  destroyEntity(id: EntityId): void {
    const record = this.entities.get(id);
    if (!record) return;

    for (const type of record.components.keys()) {
      const set = this.componentIndices.get(type);
      if (set) {
        set.delete(id);
        if (set.size === 0) {
          this.componentIndices.delete(type);
        }
      }
    }

    this.entities.delete(id);
  }

  /**
   * Attaches a component to an entity and updates component indexing.
   * @param entity EntityId to attach component to
   * @param component Component instance
   * @throws Error if entity does not exist
   */
  addComponent<T extends Component>(entity: EntityId, component: T): void {
    const record = this.entities.get(entity);
    if (!record) throw new Error(`Entity ${entity} does not exist`);

    record.components.set(component.type, component);

    let indexSet = this.componentIndices.get(component.type);
    if (!indexSet) {
      indexSet = new Set();
      this.componentIndices.set(component.type, indexSet);
    }
    indexSet.add(entity);
  }

  /**
   * Retrieves a component from an entity by its type discriminant.
   * @param entity EntityId
   * @param type Component type string
   * @returns Component instance or undefined if entity/component does not exist
   */
  getComponent<K extends keyof ComponentMap>(entity: EntityId, type: K): ComponentMap[K] | undefined;
  getComponent<T extends Component>(entity: EntityId, type: string): T | undefined;
  getComponent<T extends Component>(entity: EntityId, type: string): T | undefined {
    const record = this.entities.get(entity);
    if (!record) return undefined;
    return record.components.get(type) as T | undefined;
  }

  /**
   * Removes a component from an entity by its type string.
   * @param entity EntityId
   * @param type Component type string
   */
  removeComponent(entity: EntityId, type: string): void {
    const record = this.entities.get(entity);
    if (!record) return;

    record.components.delete(type);

    const indexSet = this.componentIndices.get(type);
    if (indexSet) {
      indexSet.delete(entity);
      if (indexSet.size === 0) {
        this.componentIndices.delete(type);
      }
    }
  }

  /**
   * Checks whether an entity has a specific component.
   * @param entity EntityId
   * @param type Component type string
   * @returns true if component exists on entity
   */
  hasComponent(entity: EntityId, type: string): boolean {
    const record = this.entities.get(entity);
    if (!record) return false;
    return record.components.has(type);
  }

  /**
   * Queries entities that possess all specified component types using indexed intersection.
   * @param componentTypes List of required component type identifiers
   * @returns Array of matching EntityIds
   */
  query(...componentTypes: string[]): EntityId[] {
    if (componentTypes.length === 0) {
      return this.getAllEntities();
    }

    // Find the smallest index set to minimize intersection tests
    let smallestSet: Set<EntityId> | undefined;
    for (const ct of componentTypes) {
      const set = this.componentIndices.get(ct);
      if (!set || set.size === 0) {
        return []; // If any component type has 0 entities, intersection is empty
      }
      if (!smallestSet || set.size < smallestSet.size) {
        smallestSet = set;
      }
    }

    if (!smallestSet) return [];

    const result: EntityId[] = [];
    for (const entityId of smallestSet) {
      const record = this.entities.get(entityId);
      if (!record) continue;

      let matches = true;
      for (const ct of componentTypes) {
        if (!record.components.has(ct)) {
          matches = false;
          break;
        }
      }
      if (matches) {
        result.push(entityId);
      }
    }

    return result;
  }

  /**
   * Retrieves raw entity record.
   * @param id EntityId
   * @returns EntityRecord or undefined
   */
  getEntity(id: EntityId): EntityRecord | undefined {
    return this.entities.get(id);
  }

  /**
   * Retrieves array of all active EntityIds.
   * @returns Array of EntityIds
   */
  getAllEntities(): EntityId[] {
    return Array.from(this.entities.keys());
  }

  /**
   * Clears all entities and component indices.
   */
  clear(): void {
    this.entities.clear();
    this.componentIndices.clear();
    this.nextId = 1;
  }

  /**
   * Returns current active entity count.
   */
  get size(): number {
    return this.entities.size;
  }

  /**
   * Produces a plain-object snapshot of every entity and component.
   *
   * Components are plain data by contract, so a structural copy is sufficient and no
   * per-component serializer is required.
   *
   * @returns Serializable snapshot
   */
  serialize(): SerializedWorld {
    const entities: SerializedEntity[] = [];
    for (const record of this.entities.values()) {
      entities.push({
        id: record.id,
        components: Array.from(record.components.values()),
      });
    }
    return { nextId: this.nextId, entities };
  }

  /**
   * Rebuilds a World from a snapshot produced by serialize().
   *
   * Components are deep-copied out of the snapshot. Without this the restored world
   * would share component objects with the snapshot, so playing on a loaded game would
   * mutate the save it came from and two loads of one save would alias each other.
   *
   * @param data Snapshot to restore
   * @returns Reconstructed World with identical entity ids
   */
  static deserialize(data: SerializedWorld): World {
    const world = new World();
    for (const entity of data.entities) {
      const record: EntityRecord = { id: entity.id, components: new Map() };
      world.entities.set(entity.id, record);
      for (const source of entity.components) {
        const component = JSON.parse(JSON.stringify(source)) as Component;
        record.components.set(component.type, component);
        let indexSet = world.componentIndices.get(component.type);
        if (!indexSet) {
          indexSet = new Set();
          world.componentIndices.set(component.type, indexSet);
        }
        indexSet.add(entity.id);
      }
    }
    world.nextId = data.nextId;
    return world;
  }
}

/**
 * Snapshot of a single entity.
 */
export interface SerializedEntity {
  id: EntityId;
  components: Component[];
}

/**
 * Snapshot of an entire World, including the entity id counter.
 */
export interface SerializedWorld {
  nextId: number;
  entities: SerializedEntity[];
}
