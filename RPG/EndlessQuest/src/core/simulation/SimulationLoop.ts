import type { GameState } from '../state/GameState';
import { createInitialGameState, recordEvent, revealArea } from '../state/GameState';
import type { Command } from '../state/Commands';
import { CommandHandler } from '../state/CommandHandler';
import { World } from '../ecs/World';
import { SeededRNG } from '../rng/SeededRNG';
import { MapGenerator } from '../world/MapGenerator';
import type { Site } from '../world/Sites';
import { SiteKind, sitesInSight } from '../world/Sites';
import { learnPlacesNear, settlementAt } from '../world/Settlement';
import type { TravelPlan } from '../world/Travel';
import {
  TravelStop,
  crossesDay,
  describeLeg,
  forageOnTheMarch,
  marchLimit,
  nextStep,
  shouldStop,
} from '../world/Travel';
import type { TerrainType } from '../world/TerrainType';
import {
  MAX_JOURNEY_STEPS,
  SETTLEMENT_SIGHT,
  SIGNPOST_RANGE,
  VILLAGE_TALK_RANGE,
  TRAVEL_DAY_HOURS,
  TRAVEL_STOP_NEED,
  STARTING_COPPER,
} from '../SimulationConstants';
import { DayPhase, getDayPhase } from '../world/TimeOfDay';
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
import { Difficulty, settingsFor } from '../rules/Difficulty';
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
  sites: Site[];
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
/**
 * What the player chose before the run began.
 *
 * Both are optional: a run started without them is dealt a random origin at the balanced
 * setting, which is what every test and every reload does.
 */
export interface EmbarkChoices {
  /** How hard the country is */
  readonly difficulty?: Difficulty;
  /** Which origin the character walks out of, by its identifier */
  readonly originId?: string;
}

export class SimulationLoop {
  state: GameState;
  private commandHandler: CommandHandler;
  private systems: System[] = [];
  private eventBus: EventBus;
  private rng: SeededRNG;
  private mapGenerator: MapGenerator;
  private choices: EmbarkChoices;

  /**
   * Initializes a new simulation instance with a seed and optional event bus.
   * @param seed Seed string or number
   * @param eventBus Optional shared EventBus
   */
  constructor(seed: string | number, eventBus?: EventBus, choices: EmbarkChoices = {}) {
    this.eventBus = eventBus ?? new EventBus();
    this.choices = choices;
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
      setup.sites,
      setup.startX,
      setup.startY,
      this.choices.difficulty
    );
    revealArea(this.state, setup.startX, setup.startY, sightRadiusAtHour(this.state.hour));
    this.learnNearestPlace(setup.startX, setup.startY);
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
    const { map, startX, startY, settlements, sites } = this.mapGenerator.generate();

    const playerId = world.createEntity();

    const pos: PositionComponent = { type: 'position', x: startX, y: startY };
    const player: PlayerComponent = { type: 'player' };
    const renderable: RenderableComponent = { type: 'renderable', color: 0xffffff };
    // What a body can take at the start is one of the things a difficulty setting means.
    const constitution = STARTING_HIT_POINTS + settingsFor(this.choices.difficulty).bonusHitPoints;

    const stats: StatsComponent = {
      type: 'stats',
      hp: constitution,
      maxHp: constitution,
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
    const inventory: InventoryComponent = {
      type: 'inventory',
      items: {},
      copper: STARTING_COPPER,
    };
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

    return { world, playerId, map, startX, startY, settlements, sites };
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
    const background = rollBackground(this.rng, this.choices.originId);
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

    if (command.type === 'TRAVEL') {
      this.travel(command);
      return;
    }

    this.commandHandler.handle(command, this.state);
    this.update();
  }

  /**
   * Walks a leg of a journey.
   *
   * The leg is resolved a mile at a time with the whole simulation running between the
   * miles -- the clock, the Mark, the needs, and the encounter process all get every
   * hour they are owed, so something can and does come out of the country in the middle
   * of a march. What is different from pressing a direction thirty times is only the
   * telling: the steps are silent and the leg is written up once, which is the
   * difference between reading an account of a day's walk and reading thirty lines of
   * weather.
   *
   * @param command What the player asked for
   */
  private travel(command: Extract<Command, { type: 'TRAVEL' }>): void {
    const state = this.state;
    const pos = state.entities.getComponent<PositionComponent>(state.playerId, 'position');
    if (!pos) return;

    const stats = state.entities.getComponent<StatsComponent>(state.playerId, 'stats');
    const target = command.toward ? this.findKnownPlace(command.toward) : undefined;

    if (command.toward && !target) {
      const event: GameEvent = {
        tick: state.tick,
        type: 'error',
        message: `You do not know the way to ${command.toward}.`,
      };
      recordEvent(state, event);
      this.eventBus.emit(event);
      return;
    }

    const plan: TravelPlan = {
      direction: command.direction,
      target,
      hours: Math.max(1, Math.min(command.hours ?? TRAVEL_DAY_HOURS, marchLimit(stats))),
      throughNight: command.throughNight ?? false,
    };

    if (!plan.direction && !plan.target) return;

    const startedTick = state.tick;
    const startedInDaylight = getDayPhase(state.hour) !== DayPhase.NIGHT;
    // Whether the character set out in a fit state. If they were already past the mark
    // when they started, they have made that choice and the journey does not re-litigate
    // it every mile.
    const startedFresh = ((): boolean => {
      if (!stats) return true;
      return Math.max(stats.hunger, stats.thirst, stats.fatigue) < TRAVEL_STOP_NEED;
    })();
    let lastForagedTick = state.tick;
    const crossed = new Map<TerrainType, number>();
    const passed: Site[] = [];
    const villages: string[] = [];
    const namedAlready = new Set<string>();

    state.journeying = true;
    let stop: TravelStop | null = null;
    let distance = 0;

    try {
      // Bounded by the hours asked for; the guard is only here so that a bearing into a
      // corner cannot spin.
      for (let step = 0; step < MAX_JOURNEY_STEPS && stop === null; step++) {
        const direction = nextStep(state, plan, pos);
        if (!direction) {
          stop = TravelStop.BLOCKED;
          break;
        }

        this.commandHandler.handle({ type: 'MOVE', direction }, state);
        this.update();
        distance++;

        const tile = state.map[pos.y]?.[pos.x];
        if (tile) crossed.set(tile.terrain, (crossed.get(tile.terrain) ?? 0) + 1);

        // You are walking anyway. What the ground gives up as you pass is the whole of
        // the survival game out here, and it is taken once a day rather than once a mile.
        if (crossesDay(lastForagedTick, state.tick)) {
          lastForagedTick = state.tick;
          const found = forageOnTheMarch(state);
          if (found) {
            recordEvent(state, found);
            this.eventBus.emit(found);
          }
        }

        // Anything close enough to make out gets named in the account, once.
        for (const site of sitesInSight(state.sites, pos.x, pos.y)) {
          // Having laid eyes on it, you can go back to it.
          site.seen = true;
          if (namedAlready.has(site.id)) continue;
          namedAlready.add(site.id);
          passed.push(site);
        }

        // Smoke on the horizon is worth a line, and worth remembering the name of.
        for (const settlement of state.settlements) {
          const away = Math.max(Math.abs(settlement.x - pos.x), Math.abs(settlement.y - pos.y));
          if (away === 0 || away > SETTLEMENT_SIGHT) continue;
          if (namedAlready.has(settlement.name)) continue;
          namedAlready.add(settlement.name);
          // Having seen the smoke, you can find your way back to it.
          settlement.known = true;
          villages.push(settlement.name);
        }

        stop = shouldStop(state, plan, startedTick, startedInDaylight, startedFresh);
      }
    } finally {
      state.journeying = false;
    }

    // Standing in it counts as having seen it, which is what stops the same ruin
    // interrupting every journey that goes past it.
    const here = state.sites.find((site) => site.x === pos.x && site.y === pos.y);
    if (here) here.visited = true;

    // Word of the country. A village talks about its neighbours and a finger-post names
    // what is down each road, which is how the march stops being a maze.
    const heard = ((): string[] => {
      const village = settlementAt(state.settlements, pos.x, pos.y);
      if (village) {
        // A village has a well in it. Walking into one and still dying of thirst three
        // days later is what a stress run of forty worlds did thirty-eight times, and it
        // is not what a safe haven means.
        const stats = state.entities.getComponent<StatsComponent>(state.playerId, 'stats');
        if (stats && stats.thirst > 0) {
          const drawn = Math.round(stats.thirst);
          stats.thirst = 0;
          stats.daysWithoutWater = 0;
          const well: GameEvent = {
            tick: state.tick,
            type: 'system',
            message: `There is a well in ${village.name}, and nobody stops you drinking from it. (thirst \u2212${drawn})`,
            data: { village: village.name, thirst: drawn },
          };
          recordEvent(state, well);
          this.eventBus.emit(well);
        }

        return learnPlacesNear(state.settlements, pos.x, pos.y, VILLAGE_TALK_RANGE);
      }
      if (here?.kind === SiteKind.CROSSROADS) {
        return learnPlacesNear(state.settlements, pos.x, pos.y, SIGNPOST_RANGE);
      }
      return [];
    })();

    if (heard.length > 0) {
      const named = heard.slice(0, 4);
      const learned: GameEvent = {
        tick: state.tick,
        type: 'system',
        message:
          here?.kind === SiteKind.CROSSROADS
            ? `The board names what is down each road: ${named.join(', ')}${heard.length > named.length ? ', and others' : ''}.`
            : `You hear the names of the places along this road: ${named.join(', ')}${heard.length > named.length ? ', and others' : ''}.`,
        data: { learned: heard },
      };
      recordEvent(state, learned);
      this.eventBus.emit(learned);
    }

    const account = describeLeg(
      state,
      plan,
      stop ?? TravelStop.DONE,
      crossed,
      state.tick - startedTick,
      passed.filter((site) => site.x !== pos.x || site.y !== pos.y),
      villages
    );

    const event: GameEvent = {
      tick: state.tick,
      type: 'movement',
      message: account,
      data: {
        travel: stop ?? TravelStop.DONE,
        distance,
        hours: state.tick - startedTick,
        x: pos.x,
        y: pos.y,
      },
    };
    recordEvent(state, event);
    this.eventBus.emit(event);
  }

  /**
   * Puts the parish that hanged the character on their map.
   *
   * A run has to begin knowing at least one place exists, or the country is a maze with
   * no exits: an early playtest spent eleven days walking a world with sixty villages in
   * it and never found one, because there was no way to be looking for anything.
   *
   * @param x Where the run begins
   * @param y Where the run begins
   */
  private learnNearestPlace(x: number, y: number): void {
    const nearest = [...this.state.settlements].sort(
      (a, b) =>
        Math.max(Math.abs(a.x - x), Math.abs(a.y - y)) -
        Math.max(Math.abs(b.x - x), Math.abs(b.y - y))
    )[0];
    if (nearest) nearest.known = true;
  }

  /**
   * Finds a place the character knows of by name.
   *
   * Only places they have heard of or seen: naming somewhere they have never been told
   * about would be the map talking, not the character.
   *
   * @param name What the player typed
   * @returns Where it is, or undefined
   */
  private findKnownPlace(
    name: string
  ): { x: number; y: number; name: string } | undefined {
    const wanted = name.trim().toLowerCase();
    if (wanted.length === 0) return undefined;

    const matches = (candidate: string): boolean => {
      const lower = candidate.toLowerCase();
      return lower === wanted || lower.includes(wanted) || wanted.includes(lower);
    };

    for (const settlement of this.state.settlements) {
      if (settlement.known && matches(settlement.name)) {
        return { x: settlement.x, y: settlement.y, name: settlement.name };
      }
    }
    for (const site of this.state.sites) {
      if ((site.visited || site.seen) && matches(site.name)) {
        return { x: site.x, y: site.y, name: site.name };
      }
    }
    for (const vigil of this.state.reckoning.vigils) {
      if (matches(vigil.name)) return { x: vigil.x, y: vigil.y, name: vigil.name };
    }
    if (matches('the gallows-tree') || matches('the tree')) {
      return {
        x: this.state.reckoning.treeX,
        y: this.state.reckoning.treeY,
        name: 'the gallows-tree',
      };
    }
    return undefined;
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
  newGame(seed?: string | number, choices?: EmbarkChoices): void {
    if (choices) this.choices = choices;
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
      setup.sites,
      setup.startX,
      setup.startY,
      this.choices.difficulty
    );
    revealArea(this.state, setup.startX, setup.startY, sightRadiusAtHour(this.state.hour));
    this.learnNearestPlace(setup.startX, setup.startY);
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
