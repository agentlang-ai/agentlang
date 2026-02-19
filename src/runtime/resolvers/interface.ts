import { JoinSpec } from '../../language/generated/ast.js';
import {
  callPostEventOnSubscription,
  Environment,
  runPostCreateEvents,
  runPostDeleteEvents,
  runPostUpdateEvents,
} from '../interpreter.js';
import { logger } from '../logger.js';
import {
  Instance,
  InstanceAttributes,
  makeInstance,
  newInstanceAttributes,
  Relationship,
} from '../module.js';
import { CrudType, nameToPath, generateLoggerCallId } from '../util.js';
import { DefaultAuthInfo, ResolverAuthInfo } from './authinfo.js';
import { SubscriptionEnvelope, isSubscriptionEnvelope, envelopeToSessionInfo } from './envelope.js';

export {
  SubscriptionEnvelope,
  isSubscriptionEnvelope,
  envelopeToSessionInfo,
  createSubscriptionEnvelope,
} from './envelope.js';

export type JoinInfo = {
  relationship: Relationship;
  queryInstance: Instance;
  subJoins: JoinInfo[] | undefined;
};

const subscriptionEvents: Map<string, string> = new Map<string, string>();

export function setSubscriptionEvent(fqEventName: string, resolverName: string) {
  subscriptionEvents.set(resolverName, fqEventName);
}

export function getSubscriptionEvent(resolverName: string): string | undefined {
  return subscriptionEvents.get(resolverName);
}

export type WhereClause = {
  attrName: string;
  op: string;
  qval: any;
};

export class Resolver {
  protected authInfo: ResolverAuthInfo = DefaultAuthInfo;
  protected env: Environment | undefined;
  protected name: string = 'default';

  static Default = new Resolver();

  constructor(name?: string) {
    if (name) this.name = name;
  }

  public setAuthInfo(authInfo: ResolverAuthInfo): Resolver {
    this.authInfo = authInfo;
    return this;
  }

  public setEnvironment(env: Environment): Resolver {
    this.env = env;
    return this;
  }

  public getEnvironment(): Environment | undefined {
    return this.env;
  }

  public suspend(): Resolver {
    this.env?.suspend();
    return this;
  }

  public getName(): string {
    return this.name;
  }

  protected notImpl(method: string) {
    logger.warn(`Method ${method} not implemented in resolver ${this.name}`);
  }

  public onSetPath(moduleName: string, entryName: string): any {
    this.notImpl(`onSetPath(${moduleName}, ${entryName})`);
  }

  public async createInstance(inst: Instance): Promise<any> {
    this.notImpl(`createInstance(${inst})`);
  }

  public async upsertInstance(inst: Instance): Promise<any> {
    return this.notImpl(`upsertInstance(${inst})`);
  }

  /**
   * @param {Instance} inst - an Instance with query and update attributes
   * @param {InstanceAttributes} newAttrs - updated attributes to set in instance
   */
  public async updateInstance(inst: Instance, newAttrs: InstanceAttributes): Promise<any> {
    return this.notImpl(`updateInstance(${inst}, ${newAttrs})`);
  }

  /**
   * @param {Instance} inst - an Instance with query attributes
   * @param {boolean} queryAll - if this flag is set, fetch all instances
   */
  public async queryInstances(
    inst: Instance,
    queryAll: boolean,
    distinct: boolean = false
  ): Promise<any> {
    return this.notImpl(`queryInstances(${inst}, ${queryAll}, ${distinct})`);
  }

  /**
   * Return all instances under the given parent-path.
   * @param {string} parentPath - path of the parent with the relevant relationship name as the last component
   * @param {Instance} inst - child Instance with query attributes
   */
  public async queryChildInstances(parentPath: string, inst: Instance): Promise<any> {
    return this.notImpl(`queryChildInstances(${parentPath}, ${inst})`);
  }

  /**
   * Return all instances connected to connectedInstance via the given between-relationship
   * @param relationship Between relationship
   * @param connectedInstance The instance to traverse the relationship from
   * @param inst Target instance with query attributes
   * @param connectedAlias For self-referencing relationships, the alias of the connected instance's role
   */
  public async queryConnectedInstances(
    relationship: Relationship,
    connectedInstance: Instance,
    inst: Instance,
    connectedAlias?: string
  ): Promise<any> {
    return this.notImpl(`queryConnectedInstances(${relationship}, ${connectedInstance}, ${inst})`);
  }

  public async queryByJoin(
    inst: Instance,
    joinInfo: JoinInfo[],
    intoSpec: Map<string, string>,
    distinct: boolean = false,
    rawJoinSpec?: JoinSpec[],
    whereClauses?: WhereClause[]
  ): Promise<any> {
    return this.notImpl(
      `queryByJoin(${inst}, ${joinInfo}, ${intoSpec}, ${distinct}, ${rawJoinSpec}, ${whereClauses})`
    );
  }

  /**
   * @param {Instance} inst - an Instance with query attributes
   */
  public async deleteInstance(inst: Instance | Instance[], purge: boolean): Promise<any> {
    return this.notImpl(`deleteInstance(${inst}, ${purge})`);
  }

  /**
   * Connect/dis-connect instances via a between relationship
   * @param node1 The main node to connect
   * @param otherNodeOrNodes Nodes to be connected to node1
   * @param relEntry Details of the repationship
   */
  public async handleInstancesLink(
    node1: Instance,
    otherNodeOrNodes: Instance | Instance[],
    relEntry: Relationship,
    orUpdate: boolean,
    inDeleteMode: boolean
  ): Promise<any> {
    return this.notImpl(
      `handleInstancesLink(${node1}, ${otherNodeOrNodes}, ${relEntry}, ${orUpdate}, ${inDeleteMode})`
    );
  }

  public async fullTextSearch(
    entryName: string,
    moduleName: string,
    query: string,
    options?: any
  ): Promise<any> {
    return this.notImpl(`fullTextSearch(${entryName}, ${moduleName}, ${query}, ${options})`);
  }

  // Return a transactionId
  public async startTransaction(): Promise<any> {
    this.notImpl('startTransaction()');
    return 1;
  }

  public async commitTransaction(txnId: string): Promise<any> {
    return this.notImpl(`commitTransaction(${txnId})`);
  }

  public async rollbackTransaction(txnId: string): Promise<any> {
    return this.notImpl(`rollbackTransaction(${txnId})`);
  }

  public async subscribe(): Promise<any> {
    return undefined;
  }

  private async onOutOfBandCrud(
    inst: Instance,
    operation: CrudType,
    env: Environment,
    envelope?: SubscriptionEnvelope
  ): Promise<any> {
    if (envelope) {
      env.setActiveUser(envelope.userId);
      env.setActiveTenantId(envelope.tenantId);
      inst.setAuthContext(envelopeToSessionInfo(envelope));
    }
    switch (operation) {
      case CrudType.CREATE:
        return await runPostCreateEvents(inst, env);
      case CrudType.UPDATE:
        return await runPostUpdateEvents(inst, undefined, env);
      case CrudType.DELETE:
        return await runPostDeleteEvents(inst, env);
      default:
        return inst;
    }
  }

  public async onCreate(
    inst: Instance,
    env: Environment,
    envelope?: SubscriptionEnvelope
  ): Promise<any> {
    return this.onOutOfBandCrud(inst, CrudType.CREATE, env, envelope);
  }

  public async onUpdate(
    inst: Instance,
    env: Environment,
    envelope?: SubscriptionEnvelope
  ): Promise<any> {
    return this.onOutOfBandCrud(inst, CrudType.UPDATE, env, envelope);
  }

  public async onDelete(
    inst: Instance,
    env: Environment,
    envelope?: SubscriptionEnvelope
  ): Promise<any> {
    return this.onOutOfBandCrud(inst, CrudType.DELETE, env, envelope);
  }

  public async onSubscription(result: any, callPostCrudEvent: boolean = false): Promise<any> {
    if (result !== undefined) {
      let envelope: SubscriptionEnvelope | undefined;
      let actualResult = result;

      if (isSubscriptionEnvelope(result)) {
        envelope = result;
        actualResult = envelope.data;
      }

      try {
        if (callPostCrudEvent) {
          const inst = actualResult as Instance;
          return await callPostEventOnSubscription(CrudType.CREATE, inst, undefined, envelope);
        } else {
          const eventName = getSubscriptionEvent(this.name);
          if (eventName) {
            const path = nameToPath(eventName);
            const inst = makeInstance(
              path.getModuleName(),
              path.getEntryName(),
              newInstanceAttributes().set('data', actualResult)
            );
            if (envelope) {
              inst.setAuthContext(envelopeToSessionInfo(envelope));
            }
            const { evaluate } = await import('../interpreter.js');
            return await evaluate(inst);
          }
        }
      } catch (err: any) {
        logger.error(`Resolver ${this.name} raised error in onSubscription handler: ${err}`);
        return undefined;
      }
    }
  }
}

type MaybeFunction = Function | undefined;

export type GenericResolverMethods = {
  create: MaybeFunction;
  upsert: MaybeFunction;
  update: MaybeFunction;
  query: MaybeFunction;
  delete: MaybeFunction;
  startTransaction: MaybeFunction;
  commitTransaction: MaybeFunction;
  rollbackTransaction: MaybeFunction;
};

export type GenericResolverSubscription = {
  subscribe: MaybeFunction;
};

export class GenericResolver extends Resolver {
  implementation: GenericResolverMethods | undefined;
  subs: GenericResolverSubscription | undefined;

  constructor(name: string, implementation?: GenericResolverMethods) {
    super(name);
    this.implementation = implementation;
  }

  public override async createInstance(inst: Instance): Promise<any> {
    const callId = generateLoggerCallId();
    let attrVals;
    if (inst.attributes) {
      attrVals = JSON.stringify(Object.fromEntries(inst.attributes));
    }
    logger.debug(
      `${callId}: Resolver createInstance called for ${inst.moduleName + '/' + inst.name} with values ${attrVals}`
    );
    let result;
    if (this.implementation?.create) {
      result = await this.implementation.create(this, inst);
    } else {
      result = await super.createInstance(inst);
    }
    logger.debug(`${callId}: Resolver createInstance response: ${JSON.stringify(result)}`);
    return result;
  }

  public override async upsertInstance(inst: Instance): Promise<any> {
    if (this.implementation?.upsert) {
      return await this.implementation.upsert(this, inst);
    }
    return await super.upsertInstance(inst);
  }

  public override async updateInstance(inst: Instance, newAttrs: InstanceAttributes): Promise<any> {
    const callId = generateLoggerCallId();

    const newAttrsVals = JSON.stringify(Object.fromEntries(newAttrs));
    logger.debug(
      `${callId} Resolver updateInstance called for ${inst.moduleName + '/' + inst.name} with values ${newAttrsVals}`
    );
    if (inst.queryAttributes && inst.queryAttributeValues) {
      const qattr = JSON.stringify(Object.fromEntries(inst.queryAttributes));
      const qattrValues = JSON.stringify(Object.fromEntries(inst.queryAttributeValues));
      logger.debug(`${callId}: Query attributes: ${qattr}, values ${qattrValues}`);
    }

    let result;
    if (this.implementation?.update) {
      result = await this.implementation.update(this, inst, newAttrs);
    } else {
      result = await super.updateInstance(inst, newAttrs);
    }
    logger.debug(`${callId}: Resolver updateInstance response: ${JSON.stringify(result)}`);
    return result;
  }

  public override async queryInstances(inst: Instance, queryAll: boolean): Promise<any> {
    const callId = generateLoggerCallId();
    logger.debug(
      `${callId}: Resolver queryInstances called for ${inst.moduleName + '/' + inst.name}`
    );
    if (inst.queryAttributes && inst.queryAttributeValues) {
      const qattr = JSON.stringify(Object.fromEntries(inst.queryAttributes));
      const qattrValues = JSON.stringify(Object.fromEntries(inst.queryAttributeValues));
      logger.debug(`${callId}: Query attributes: ${qattr}, values ${qattrValues}`);
    }
    let result;
    if (this.implementation?.query) {
      result = await this.implementation.query(this, inst, queryAll);
    } else {
      result = await super.queryInstances(inst, queryAll);
    }
    logger.debug(`${callId}: Resolver queryInstances response: ${JSON.stringify(result)}`);
    return result;
  }

  public override async deleteInstance(inst: Instance | Instance[], purge: boolean): Promise<any> {
    if (inst instanceof Instance) {
      if (inst.queryAttributes)
        logger.debug(`Resolver deleteInstance called for ${inst.moduleName + '/' + inst.name}`);
    } else {
      logger.debug(
        `Resolver deleteInstance called for ${inst.map(i => i.moduleName + '/' + i.name).join(', ')}`
      );
    }
    if (this.implementation?.delete) {
      return await this.implementation.delete(this, inst, purge);
    }
    return await super.deleteInstance(inst, purge);
  }

  public override async startTransaction(): Promise<any> {
    if (this.implementation?.startTransaction) {
      return await this.implementation.startTransaction(this);
    }
    return await super.startTransaction();
  }

  public override async commitTransaction(txnId: string): Promise<any> {
    if (this.implementation?.commitTransaction) {
      return await this.implementation.commitTransaction(this, txnId);
    }
    return await super.commitTransaction(txnId);
  }

  public override async rollbackTransaction(txnId: string): Promise<any> {
    if (this.implementation?.rollbackTransaction) {
      return await this.implementation.rollbackTransaction(this, txnId);
    }
    return await super.rollbackTransaction(txnId);
  }

  override async subscribe() {
    const MaxErrors = 3;
    let errCount = 0;
    while (true) {
      try {
        if (this.subs?.subscribe) {
          await this.subs.subscribe(this);
        }
        await super.subscribe();
        return;
      } catch (reason: any) {
        logger.warn(`subscribe error in resolver ${this.name}: ${reason}`);
        if (errCount >= MaxErrors) {
          logger.warn(`exiting resolver subscription after ${errCount} retries`);
          break;
        }
        ++errCount;
      }
    }
  }
}
