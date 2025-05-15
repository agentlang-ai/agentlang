import { Instance } from '../module.js';

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
}
