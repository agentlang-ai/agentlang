import { Instance, isEventInstance } from "./module.js";

export function interpret(eventInstance: Instance) {
    if (isEventInstance(eventInstance)) {
        // TODO: fetch workflow
        // TODO: interpret patterns
    }
}