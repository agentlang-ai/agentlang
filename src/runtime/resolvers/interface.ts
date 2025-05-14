import { Instance } from "../module.js";

export abstract class Resolver {
    public abstract createInstance(inst: Instance): Instance
    
    public abstract upsertInstance(inst: Instance): Instance
    
    /**
     * @param {Instance} inst - an Instance with query and update attributes
    */
    public abstract updateInstance(inst: Instance): Instance
    
    /**
     * @param {Instance} inst - an Instance with query attributes
    */
    public abstract queryInstances(inst: Instance): Instance[] | null

    /**
     * @param {Instance} inst - an Instance with query attributes
    */
    public abstract deleteInstance(inst: Instance): Instance | null
}