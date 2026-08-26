import type { GameState } from '../state/GameState';
import { createInitialGameState, recordEvent, revealArea } from '../state/GameState';
import type { Command } from '../state/Commands';
import { CommandHandler } from '../state/CommandHandler';
import { World } from '../ecs/World';
import { SeededRNG } from '../rng/SeededRNG';
import { MapGenerator } from '../world/MapGenerator';
import type { System } from '../ecs/System';
import { TimeSystem } from './systems/TimeSystem';
import { NeedsSystem } from './systems/NeedsSystem';
import { MarkSystem } from './systems/MarkSystem';
import { EncounterSystem } from './systems/EncounterSystem';
import { NarrativeSystem } from './systems/NarrativeSystem';
import { ErrandSystem } from './systems/ErrandSystem';
import { EventBus } from '../../events/EventBus';
import type { GameEvent } from '../../events/GameEvent';
import type { EntityId } from '../ecs/Entity';
import type {
  PositionComponent,
  PlayerComponent,
  RenderableComponent,
  StatsComponent,
  MarkComponent,
  InventoryComponent,
  AbilitiesComponent,
  CombatantComponent,
  EquipmentComponent,
  NameComponent,
} from '../ecs/Component';
import { OPENING_LINES, RECKONING_OPENING } from '../lore/Lore';
import { bearingTo, describeDistance } from '../world/Reckoning';
import { sightRadiusAtHour } from '../world/TimeOfDay';
import { rollBackground, describeBackground, assignAbilityScores } from '../narrative/Background';
import { ABILITY_LABEL, ABILITY_ORDER, abilityModifier } from '../rules/Abilities';
import { SKILL_NAME } from '../rules/Skills';
import { addItem } from '../state/Inventory';
import { equipItem } from '../state/Equipment';
import { isEquippable, getItem } from '../lore/Items';
import { TERRAIN_NAME } from '../lore/Flavor';
import {
  MARK_MIN,
  LIVE_LOG_LIMIT,
  STARTING_HIT_POINTS,
  UNARMED_DAMAGE,
} from '../SimulationConstants';

/**
 * Result of building a fresh world: the populated ECS container plus spawn details.
 */
interface WorldSetup {
  world: World;
  playerId: EntityId;
  map: ReturnType<MapGenerator['generate']>['map'];
  startX: number;
  startY: number;
  settlements: ReturnType<MapGenerator['generate']>['settlements'];
}

/**
 * Main simulation coordinator managing state, world generation, player entity,
 * command execution pipeline, systems update loop, and event notifications.
 *
 * Systems run in the order prescribed by design document section 12.3: global time
 * first, then entity needs, then the Gallowsmark, then world events. Later systems
 * therefore observe the consequences of earlier ones within the same turn.
 */
export class SimulationLoop {
  state: GameState;
  private commandHandler: CommandHandler;
  private systems: System[] = [];
  private eventBus: EventBus;
  private rng: SeededRNG;
  private mapGenerator: MapGenerator;

  /**
   * Initializes a new simulation instance with a seed and optional event bus.
   * @param seed Seed string or number
   * @param eventBus Optional shared EventBus
   */
  constructor(seed: string | number, eventBus?: EventBus) {
    this.eventBus = eventBus ?? new EventBus();
    this.rng = new SeededRNG(seed);
    this.mapGenerator = new MapGenerator(this.rng);
    this.commandHandler = new CommandHandler(this.eventBus);

    const setup = this.buildWorld();
    this.state = createInitialGameState(
      seed,
      setup.map,
      setup.world,
      setup.playerId,
      this.rng,
      setup.settlements,
      setup.startX,
      setup.startY
    );
    revealArea(this.state, setup.startX, setup.startY, sightRadiusAtHour(this.state.hour));
    this.dealBackground(setup);

    this.systems = this.createSystems();
    this.emitOpening(setup);
  }

  /**
   * Generates a map and populates a world with a fully equipped player entity.
   * @returns The assembled world and spawn coordinates
   */
  private buildWorld(): WorldSetup {
    const world = new World();
    const { map, startX, startY, settlements } = this.mapGenerator.generate();

    const playerId = world.createEntity();

    const pos: PositionComponent = { type: 'position', x: startX, y: startY };
    const player: PlayerComponent = { type: 'player' };
    const renderable: RenderableComponent = { type: 'renderable', color: 0xffffff };
    const stats: StatsComponent = {
      type: 'stats',
      hp: STARTING_HIT_POINTS,
      maxHp: STARTING_HIT_POINTS,
      hunger: 0,
      thirst: 0,
      fatigue: 0,
      exhaustion: 0,
      daysWithoutFood: 0,
      daysWithoutWater: 0,
    };
    const mark: MarkComponent = {
      type: 'mark',
      intensity: MARK_MIN,
      band: 0,
      hoursBurning: 0,
    };
    const inventory: InventoryComponent = { type: 'inventory', items: {} };
    const combatant: CombatantComponent = {
      type: 'combatant',
      attackBonus: 0,
      damageDice: UNARMED_DAMAGE,
    };
    const equipment: EquipmentComponent = { type: 'equipment', slots: {} };
    const name: NameComponent = { type: 'name', name: 'you' };

    world.addComponent(playerId, pos);
    world.addComponent(playerId, player);
    world.addComponent(playerId, renderable);
    world.addComponent(playerId, stats);
    world.addComponent(playerId, mark);
    world.addComponent(playerId, inventory);
    world.addComponent(playerId, combatant);
    world.addComponent(playerId, equipment);
    world.addComponent(playerId, name);

    return { world, playerId, map, startX, startY, settlements };
  }

  /**
   * Constructs the system pipeline in simulation order.
   * @returns Freshly constructed systems bound to this loop's EventBus
   */
  private createSystems(): System[] {
    return [
      new TimeSystem(this.eventBus),
      new NeedsSystem(this.eventBus),
      new MarkSystem(this.eventBus),
      new EncounterSystem(this.eventBus),
      new NarrativeSystem(this.eventBus),
      new ErrandSystem(this.eventBus),
    ];
  }

  /**
   * Deals the character a background and grants what their origin left them carrying.
   *
   * Starting equipment is put to use immediately where it can be: a character who was
   * a free company soldier begins the run with the sword already in hand, because that
   * is what the origin means.
   */
  private dealBackground(setup: WorldSetup): void {
    const background = rollBackground(this.rng);
    this.state.background = background;

    // The origin decides where the standard array lands and what the character is
    // trained in, which is what makes an origin mechanical rather than decorative.
    const abilities: AbilitiesComponent = {
      type: 'abilities',
      scores: assignAbilityScores(background.origin),
      level: 1,
      xp: 0,
      proficientSkills: [...background.origin.skills],
      proficientSaves: [...background.origin.saves],
    };
    setup.world.addComponent(setup.playerId, abilities);

    const inventory = setup.world.getComponent<InventoryComponent>(
      setup.playerId,
      'inventory'
    );
    if (!inventory) return;

    for (const itemId of background.origin.startingItems) {
      if (addItem(inventory, itemId) === 0) continue;
      const item = getItem(itemId);
      if (item && isEquippable(item)) {
        equipItem(setup.world, setup.playerId, itemId);
      }
    }
  }

  /**
   * Logs and broadcasts the opening narration for a freshly created character.
   */
  private emitOpening(setup: WorldSetup, resumed: boolean = false): void {
    const startTile = setup.map[setup.startY][setup.startX];
    const background = this.state.background;
    const lines = resumed
      ? [`You take up the road again in ${TERRAIN_NAME[startTile.terrain]}.`]
      : [
          ...OPENING_LINES,
          `You are lying in ${TERRAIN_NAME[startTile.terrain]}.`,
          ...(background ? describeBackground(background) : []),
          ...this.describeCharacterSheet(setup),
          ...RECKONING_OPENING,
          this.describeDebt(setup.startX, setup.startY),
        ];

    for (const line of lines) {
      const event: GameEvent = {
        tick: 0,
        type: 'system',
        message: line,
        data: { x: setup.startX, y: setup.startY, seed: this.state.seedString },
      };
      recordEvent(this.state, event);
      this.eventBus.emit(event);
    }
  }

  /**
   * Says which way the tree lies and roughly how far.
   *
   * The bearing is always known -- the weal tightens toward it -- but the distance is
   * left in a traveller's terms, so the player still has to make the walk to find out.
   *
   * @param x Where the character is standing
   * @param y Where the character is standing
   * @returns One line naming the direction of the debt
   */
  private describeDebt(x: number, y: number): string {
    const { treeX, treeY } = this.state.reckoning;
    const bearing = bearingTo(x, y, treeX, treeY);
    const distance = Math.max(Math.abs(treeX - x), Math.abs(treeY - y));
    return `The weal pulls ${bearing}. Whatever is waiting there is ${describeDistance(distance)}.`;
  }

  /**
   * Renders the character sheet as opening narration.
   *
   * Showing the scores and training at embark is what tells the player which checks
   * they are likely to make and which they should avoid, before they have to learn it
   * the hard way.
   *
   * @param setup The assembled world
   * @returns Lines describing the character's abilities and training
   */
  private describeCharacterSheet(setup: WorldSetup): string[] {
    const abilities = setup.world.getComponent<AbilitiesComponent>(
      setup.playerId,
      'abilities'
    );
    if (!abilities) return [];

    const scores = ABILITY_ORDER.map((ability) => {
      const score = abilities.scores[ability];
      const modifier = abilityModifier(score);
      const sign = modifier >= 0 ? `+${modifier}` : `${modifier}`;
      return `${ABILITY_LABEL[ability]} ${score} (${sign})`;
    }).join('  ');

    const trained = abilities.proficientSkills
      .map((skill) => SKILL_NAME[skill as keyof typeof SKILL_NAME] ?? skill)
      .join(', ');

    return [scores, `Trained in ${trained}.`];
  }

  /**
   * Submits a command for execution. Processes command and invokes system updates.
   * @param command Simulation command
   */
  submitCommand(command: Command): void {
    if (command.type === 'NEW_GAME') {
      this.newGame(command.seed);
      return;
    }

    this.commandHandler.handle(command, this.state);
    this.update();
  }

  /**
   * Runs all registered ECS simulation systems for the current turn.
   */
  update(): void {
    for (const system of this.systems) {
      system.update(this.state);
    }

    // Trimmed here rather than at each push, so there is one place that decides how much
    // history a run carries.
    if (this.state.log.length > LIVE_LOG_LIMIT) {
      this.state.log.splice(0, this.state.log.length - LIVE_LOG_LIMIT);
    }
  }

  /**
   * Subscribes a global callback for all simulation events.
   * @param callback Callback receiving GameEvent
   */
  onEvent(callback: (event: GameEvent) => void): void {
    this.eventBus.subscribe('*', callback);
  }

  /**
   * Unsubscribes a global simulation event listener.
   * @param callback Callback to remove
   */
  offEvent(callback: (event: GameEvent) => void): void {
    this.eventBus.unsubscribe('*', callback);
  }

  /**
   * Returns internal EventBus instance.
   * @returns EventBus
   */
  getEventBus(): EventBus {
    return this.eventBus;
  }

  /**
   * Replaces the live state with a restored one and re-arms the system pipeline.
   *
   * Systems are seeked to the restored tick so that a loaded game does not replay
   * every hour of the history it was saved from.
   *
   * @param state Fully reconstructed GameState
   */
  restoreState(state: GameState): void {
    this.state = state;
    this.rng = state.rng;
    this.systems = this.createSystems();
    for (const system of this.systems) {
      system.seek?.(state.tick);
    }
  }

  /**
   * Resets simulation state and generates a fresh world without destroying event subscriptions.
   * @param seed Optional new seed string or number
   */
  newGame(seed?: string | number): void {
    const newSeed = seed !== undefined && seed !== '' ? seed : Date.now().toString();

    this.rng = new SeededRNG(newSeed);
    this.mapGenerator = new MapGenerator(this.rng);

    const setup = this.buildWorld();
    this.state = createInitialGameState(
      newSeed,
      setup.map,
      setup.world,
      setup.playerId,
      this.rng,
      setup.settlements,
      setup.startX,
      setup.startY
    );
    revealArea(this.state, setup.startX, setup.startY, sightRadiusAtHour(this.state.hour));
    this.dealBackground(setup);

    // Re-initialize systems with existing EventBus (preserving UI subscriptions)
    this.systems = this.createSystems();

    const marker: GameEvent = {
      tick: 0,
      type: 'system',
      message: `New game started. Seed: ${this.state.seedString}`,
      data: { seed: this.state.seedString },
    };
    recordEvent(this.state, marker);
    this.eventBus.emit(marker);

    this.emitOpening(setup);
  }
}
