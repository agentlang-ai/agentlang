import { Environment, evaluate, MaskedEnvironment } from '../interpreter.js';
import { logger } from '../logger.js';
import {
  Instance,
  InstanceAttributes,
  makeInstance,
  newInstanceAttributes,
  Relationship,
} from '../module.js';
import { splitFqName } from '../util.js';

export class ResolverAuthInfo {
  userId: string;
  readForUpdate: boolean = false;
  readForDelete: boolean = false;

  constructor(userId: string, readForUpdate?: boolean, readForDelete?: boolean) {
    this.userId = userId;
    if (readForUpdate != undefined) this.readForUpdate = readForUpdate;
    if (readForDelete != undefined) this.readForDelete = readForDelete;
  }
}

export const DefaultAuthInfo = new ResolverAuthInfo(
  // This user-id is only for testing, per-session user-id needs to be set from
  // the HTTP layer.
  '9459a305-5ee6-415d-986d-caaf6d6e2828'
);

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

export class Resolver {
  protected authInfo: ResolverAuthInfo = DefaultAuthInfo;
  protected env: MaskedEnvironment | Environment | undefined;
  protected name: string = 'default';

  static Default = new Resolver();

  constructor(name?: string) {
    if (name) this.name = name;
  }

  public setAuthInfo(authInfo: ResolverAuthInfo): Resolver {
    this.authInfo = authInfo;
    return this;
  }

  public setEnvironment(env: MaskedEnvironment | Environment): Resolver {
    this.env = env;
    return this;
  }

  public getEnvironment(): MaskedEnvironment | Environment | undefined {
    return this.env;
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
  public async queryInstances(inst: Instance, queryAll: boolean): Promise<any> {
    return this.notImpl(`queryInstances(${inst}, ${queryAll})`);
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
   * @param connectedInstance The instance to traveres the relationship from
   * @param inst Target instance with query attributes
   */
  public async queryConnectedInstances(
    relationship: Relationship,
    connectedInstance: Instance,
    inst: Instance
  ): Promise<any> {
    return this.notImpl(`queryConnectedInstances(${relationship}, ${connectedInstance}, ${inst})`);
  }

  public async queryByJoin(
    inst: Instance,
    joinsSpec: JoinInfo[],
    intoSpec: Map<string, string>
  ): Promise<any> {
    return this.notImpl(`queryByJoin(${inst}, ${joinsSpec}, ${intoSpec})`);
  }

  /**
   * @param {Instance} inst - an Instance with query attributes
   */
  public async deleteInstance(inst: Instance | Instance[], purge: boolean): Promise<any> {
    return this.notImpl(`deleteInstance(${inst}, ${purge})`);
  }

  /**
   * Connect instances via a between relationship
   * @param node1 The main node to connect
   * @param otherNodeOrNodes Nodes to be connected to node1
   * @param relEntry Details of the repationship
   */
  public async connectInstances(
    node1: Instance,
    otherNodeOrNodes: Instance | Instance[],
    relEntry: Relationship,
    orUpdate: boolean
  ): Promise<any> {
    return this.notImpl(
      `connectInstances(${node1}, ${otherNodeOrNodes}, ${relEntry}, ${orUpdate})`
    );
  }

  public async fullTextSearch(
    entryName: string,
    moduleName: string,
    query: string,
    options?: Map<string, any>
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

  public async onSubscription(result: any): Promise<any> {
    if (result != undefined) {
      const eventName = getSubscriptionEvent(this.name);
      if (eventName) {
        const path = splitFqName(eventName);
        const inst = makeInstance(
          path.getModuleName(),
          path.getEntryName(),
          newInstanceAttributes().set('data', result)
        );
        return await evaluate(inst);
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
    if (this.implementation?.create) {
      return await this.implementation.create(this, inst);
    } else {
      return await super.createInstance(inst);
    }
  }

  public override async upsertInstance(inst: Instance): Promise<any> {
    if (this.implementation?.upsert) {
      return await this.implementation.upsert(this, inst);
    }
    return await super.upsertInstance(inst);
  }

  public override async updateInstance(inst: Instance, newAttrs: InstanceAttributes): Promise<any> {
    if (this.implementation?.update) {
      return await this.implementation.update(this, inst, newAttrs);
    }
    return await super.updateInstance(inst, newAttrs);
  }

  public override async queryInstances(inst: Instance, queryAll: boolean): Promise<any> {
    if (this.implementation?.query) {
      return await this.implementation.query(this, inst, queryAll);
    }
    return await super.queryInstances(inst, queryAll);
  }

  public override async deleteInstance(inst: Instance | Instance[], purge: boolean): Promise<any> {
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
    if (this.subs?.subscribe) {
      await this.subs.subscribe(this);
    }
    await super.subscribe();
  }
}
