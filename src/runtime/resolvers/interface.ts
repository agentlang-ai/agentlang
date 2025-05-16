import { Instance, RelationshipEntry } from '../module.js';

export abstract class Resolver {
  public abstract createInstance(inst: Instance): any;

  public abstract upsertInstance(inst: Instance): any;

  /**
   * @param {Instance} inst - an Instance with query and update attributes
   */
  public abstract updateInstance(inst: Instance): any;

  /**
   * @param {Instance} inst - an Instance with query attributes
   */
  public abstract queryInstances(inst: Instance): any;

  /**
   * @param {Instance} inst - an Instance with query attributes
   */
  public abstract deleteInstance(inst: Instance): any;

  /**
   * Connect instances via a between relationship
   * @param node1 The main node to connect
   * @param otherNodeOrNodes Nodes to be connected to node1
   * @param relEntry Details of the repationship
   */
  public abstract connectInstances(
    node1: Instance,
    otherNodeOrNodes: Instance | Instance[],
    relEntry: RelationshipEntry
  ): any;
}
