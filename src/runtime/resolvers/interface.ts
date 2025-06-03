import { Instance, InstanceAttributes, RelationshipEntry } from '../module.js';

export class ResolverAuthInfo {
  userId: string;
  readForUpdate: boolean = false;
  readForDelete: boolean = false

  constructor(userId: string) {
    this.userId = userId
  }
};

const DefaultAuthInfo = new ResolverAuthInfo(
  // This user-id is only for testing, per-session user-id needs to be set from
  // the HTTP layer.
  '9459a305-5ee6-415d-986d-caaf6d6e2828',
);

export abstract class Resolver {
  protected authInfo: ResolverAuthInfo = DefaultAuthInfo;
  protected inKernelMode: boolean = false;

  public setAuthInfo(authInfo: ResolverAuthInfo): Resolver {
    this.authInfo = authInfo;
    return this;
  }

  public setKernelMode(flag: boolean): Resolver {
    this.inKernelMode = flag;
    return this;
  }

  public abstract getName(): string;
  public abstract onSetPath(moduleName: string, entryName: string): any;

  public abstract createInstance(inst: Instance): any;

  public abstract upsertInstance(inst: Instance): any;

  /**
   * @param {Instance} inst - an Instance with query and update attributes
   * @param {InstanceAttributes} newAttrs - updated attributes to set in instance
   */
  public abstract updateInstance(inst: Instance, newAttrs: InstanceAttributes): any;

  /**
   * @param {Instance} inst - an Instance with query attributes
   * @param {boolean} queryAll - if this flag is set, fetch all instances
   */
  public abstract queryInstances(inst: Instance, queryAll: boolean): any;

  /**
   * Return all instances under the given parent-path.
   * @param {string} parentPath - path of the parent with the relevant relationship name as the last component
   * @param {Instance} inst - child Instance with query attributes
   */
  public abstract queryChildInstances(parentPath: string, inst: Instance): any;

  /**
   * Return all instances connected to connectedInstance via the given between-relationship
   * @param relationship Between relationship
   * @param connectedInstance The instance to traveres the relationship from
   * @param inst Target instance with query attributes
   */
  public abstract queryConnectedInstances(
    relationship: RelationshipEntry,
    connectedInstance: Instance,
    inst: Instance
  ): any;

  /**
   * @param {Instance} inst - an Instance with query attributes
   */
  public abstract deleteInstance(inst: Instance | Instance[]): any;

  /**
   * Connect instances via a between relationship
   * @param node1 The main node to connect
   * @param otherNodeOrNodes Nodes to be connected to node1
   * @param relEntry Details of the repationship
   */
  public abstract connectInstances(
    node1: Instance,
    otherNodeOrNodes: Instance | Instance[],
    relEntry: RelationshipEntry,
    orUpdate: boolean
  ): any;

  public abstract startTransaction(): string; // Return a transactionId
  public abstract commitTransaction(txnId: string): any;
  public abstract rollbackTransaction(txtIn: string): any;
}
